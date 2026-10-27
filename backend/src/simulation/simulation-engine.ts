import {
  SimulationScenarioConfig,
  SimulationResult,
  SimulationTickSnapshot,
} from './scenarios.js';
import { createContainer } from '../container.js';
import { Agent } from '../domain/agent/agent.types.js';
import { Borrower } from '../domain/borrower/borrower.types.js';

export class SimulationEngine {
  /**
   * Deterministic Mulberry32 PRNG generator
   */
  private createRng(seed: number): () => number {
    let s = seed;
    return () => {
      let t = (s += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  public async runScenario(config: SimulationScenarioConfig): Promise<SimulationResult> {
    const rng = this.createRng(config.seed);
    const container = await createContainer('in-memory', undefined, true);
    container.setProvider(config.providerType);

    const campaign = await container.campaignManager.createCampaign(config.name, {
      dialingMode: config.dialingMode,
      maxConcurrentCalls: config.agentCount * 2,
      providerId: config.providerType,
    });
    await container.campaignManager.startCampaign(campaign.id);

    // Seed agents
    for (let i = 1; i <= config.agentCount; i++) {
      const agent: Agent = {
        id: `sim-agent-${i}`,
        campaignId: campaign.id,
        name: `Sim Agent ${i}`,
        state: 'AVAILABLE',
        currentCallId: null,
        version: 1,
        reservationLeaseExpiresAt: null,
        lastStateChangeAt: new Date(),
        stateChangeReason: 'Simulation seeded',
        stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await container.agentRepo.save(agent);
    }

    // Seed borrowers
    for (let i = 1; i <= config.borrowerCount; i++) {
      const borrower: Borrower = {
        id: `sim-bor-${i}`,
        campaignId: campaign.id,
        name: `Sim Borrower ${i}`,
        phoneNumber: `+1555${String(i).padStart(7, '0')}`,
        debtAmount: 1000,
        priority: 1,
        state: 'QUEUED',
        attemptsCount: 0,
        version: 1,
        lastAttemptAt: null,
        reservationLeaseExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await container.borrowerRepo.save(borrower);
    }

    const timeline: SimulationTickSnapshot[] = [];
    const connectedCallDurations = new Map<string, number>(); // callId -> ticksConnected
    let invariantViolations = 0;

    // Simulation loop
    for (let tick = 1; tick <= config.ticks; tick++) {
      // 1. Progress active connected calls & simulate completion based on avg duration
      const allCalls = await container.callRepo.findByCampaign(campaign.id);
      const connectedCalls = allCalls.filter((c) => c.state === 'CONNECTED');

      for (const call of connectedCalls) {
        const currentTicks = (connectedCallDurations.get(call.id) ?? 0) + 1;
        connectedCallDurations.set(call.id, currentTicks);

        // Call completes if duration reached or stochastic hangup
        if (currentTicks >= config.averageTalkDurationTicks || rng() < 0.2) {
          if (call.providerCallId) {
            await container.currentProvider.injectEvent({
              eventId: `SIM-COMP-${call.id}-${tick}`,
              providerCallId: call.providerCallId,
              callId: call.id,
              campaignId: campaign.id,
              eventType: 'COMPLETED',
              timestamp: new Date(),
            });
          }
        }
      }

      // 2. Advance ringing/initiated calls to answered or failed based on target answer rate
      const inFlight = allCalls.filter((c) => c.state === 'INITIATED' || c.state === 'RINGING');
      for (const call of inFlight) {
        if (call.state === 'INITIATED' && call.providerCallId) {
          await container.currentProvider.injectEvent({
            eventId: `SIM-RING-${call.id}-${tick}`,
            providerCallId: call.providerCallId,
            callId: call.id,
            campaignId: campaign.id,
            eventType: 'RINGING',
            timestamp: new Date(),
          });
        }
        const isAnswered = rng() < config.targetAnswerRate;
        if (call.providerCallId) {
          if (isAnswered) {
            await container.currentProvider.injectEvent({
              eventId: `SIM-ANS-${call.id}-${tick}`,
              providerCallId: call.providerCallId,
              callId: call.id,
              campaignId: campaign.id,
              eventType: 'ANSWERED',
              timestamp: new Date(),
            });
            await container.currentProvider.injectEvent({
              eventId: `SIM-CONNECT-${call.id}-${tick}`,
              providerCallId: call.providerCallId,
              callId: call.id,
              campaignId: campaign.id,
              eventType: 'CONNECTED',
              timestamp: new Date(),
            });
          } else {
            await container.currentProvider.injectEvent({
              eventId: `SIM-FAIL-${call.id}-${tick}`,
              providerCallId: call.providerCallId,
              callId: call.id,
              campaignId: campaign.id,
              eventType: rng() < 0.5 ? 'BUSY' : 'NO_ANSWER',
              timestamp: new Date(),
            });
          }
        }
      }

      // 3. Fast-forward wrap-up agents back to AVAILABLE
      const agents = await container.agentRepo.findByCampaign(campaign.id);
      for (const agent of agents) {
        if (agent.state === 'WRAP_UP') {
          await container.agentRepo.updateState(
            agent.id,
            'AVAILABLE',
            'Simulation: wrap-up complete'
          );
        }
      }

      // 4. Execute dialing cycle for this tick
      await container.campaignManager.executeDialCycle(campaign.id);

      // 5. Run safety & reconciliation checks
      await container.campaignManager.runReconciliation(campaign.id);

      // 6. Snapshot tick state
      const agentCounts = await container.agentRepo.countByState(campaign.id);
      const callCounts = await container.callRepo.countByState(campaign.id);
      const activeCallsCount = await container.callRepo.countActiveCalls(campaign.id);
      const recentDecisions = container.safetyController.getRecentDecisions(10);
      const lastDecision = recentDecisions[recentDecisions.length - 1];

      // Invariant Check: Progressive calls must never exceed available agents
      if (config.dialingMode === 'PROGRESSIVE') {
        const eligibleAgents = agentCounts.AVAILABLE + agentCounts.DIALING + agentCounts.CONNECTED;
        if (activeCallsCount > eligibleAgents && eligibleAgents > 0) {
          invariantViolations++;
        }
      }

      const snapshot: SimulationTickSnapshot = {
        tick,
        availableAgents: agentCounts.AVAILABLE,
        connectedAgents: agentCounts.CONNECTED,
        dialingAgents: agentCounts.DIALING,
        activeCalls: activeCallsCount,
        ringingCalls: callCounts.INITIATED + callCounts.RINGING,
        answeredCalls: callCounts.ANSWERED,
        completedCalls: callCounts.COMPLETED,
        failedCalls: callCounts.FAILED,
        safetyApprovedCalls: lastDecision?.approvedCalls ?? 0,
        safetyReducedCalls: lastDecision?.decision === 'REDUCE' ? 1 : 0,
        safetyRejectedCalls: lastDecision?.decision === 'REJECT' ? 1 : 0,
        safetyFallbackCalls: lastDecision?.decision === 'FALLBACK_PROGRESSIVE' ? 1 : 0,
        circuitBreakerHealth: container.safetyController.getCircuitBreaker().getHealthScore(),
      };
      timeline.push(snapshot);
    }

    // Compute aggregate summary metrics
    const finalCallCounts = await container.callRepo.countByState(campaign.id);
    const totalInitiated =
      finalCallCounts.INITIATED +
      finalCallCounts.RINGING +
      finalCallCounts.ANSWERED +
      finalCallCounts.CONNECTED +
      finalCallCounts.COMPLETED +
      finalCallCounts.FAILED;

    const totalAnswered =
      finalCallCounts.ANSWERED + finalCallCounts.CONNECTED + finalCallCounts.COMPLETED;
    const effectiveAnswerRate = totalInitiated > 0 ? totalAnswered / totalInitiated : 0;

    const avgUtilization =
      timeline.reduce((acc, t) => acc + (t.connectedAgents + t.dialingAgents) / config.agentCount, 0) /
      timeline.length;

    const allDecisions = container.safetyController.getRecentDecisions(1000);
    const decisionSummary = {
      approved: allDecisions.filter((d) => d.decision === 'APPROVE').length,
      reduced: allDecisions.filter((d) => d.decision === 'REDUCE').length,
      rejected: allDecisions.filter((d) => d.decision === 'REJECT').length,
      fallbackProgressive: allDecisions.filter((d) => d.decision === 'FALLBACK_PROGRESSIVE').length,
    };

    const summary =
      `Scenario '${config.name}' (${config.dialingMode}) completed over ${config.ticks} ticks with seed ${config.seed}. ` +
      `Total calls initiated: ${totalInitiated}, Answered: ${totalAnswered}, Completed: ${finalCallCounts.COMPLETED}, ` +
      `Failed: ${finalCallCounts.FAILED}. Effective answer rate: ${(effectiveAnswerRate * 100).toFixed(1)}%. ` +
      `Average agent utilization: ${(avgUtilization * 100).toFixed(1)}%. Invariant violations: ${invariantViolations}.`;

    return {
      scenario: config,
      totalCallsInitiated: totalInitiated,
      totalCallsAnswered: totalAnswered,
      totalCallsConnected: finalCallCounts.CONNECTED + finalCallCounts.COMPLETED,
      totalCallsCompleted: finalCallCounts.COMPLETED,
      totalCallsFailed: finalCallCounts.FAILED,
      totalCallsCancelled: finalCallCounts.CANCELLED,
      effectiveAnswerRate,
      averageAgentUtilization: avgUtilization,
      totalSafetyDecisions: decisionSummary,
      invariantViolationsCount: invariantViolations,
      timeline,
      summary,
    };
  }
}
