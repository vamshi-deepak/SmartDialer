import { ServiceContainer } from '../container.js';
import { Agent } from '../domain/agent/agent.types.js';
import { Borrower } from '../domain/borrower/borrower.types.js';

export interface FailureScenarioReport {
  scenario: string;
  campaignId: string;
  initialState: Record<string, unknown>;
  chaosInjected: string;
  systemActionTaken: string;
  recoveryReport: Record<string, unknown>;
  finalState: Record<string, unknown>;
  invariantsMaintained: boolean;
  explanation: string;
}

export class FailureScenarioRunner {
  constructor(private readonly container: ServiceContainer) {}

  public async runScenario(
    scenario:
      | 'WORKER_CRASH_RESERVATION'
      | 'PROVIDER_OUTAGE'
      | 'AGENT_DROP'
      | 'DUPLICATE_EVENTS'
      | 'OUT_OF_ORDER_EVENTS',
    campaignId: string
  ): Promise<FailureScenarioReport> {
    switch (scenario) {
      case 'WORKER_CRASH_RESERVATION':
        return this.runWorkerCrashReservation(campaignId);
      case 'PROVIDER_OUTAGE':
        return this.runProviderOutage(campaignId);
      case 'AGENT_DROP':
        return this.runAgentDrop(campaignId);
      case 'DUPLICATE_EVENTS':
        return this.runDuplicateEvents(campaignId);
      case 'OUT_OF_ORDER_EVENTS':
        return this.runOutOfOrderEvents(campaignId);
      default:
        throw new Error(`Unknown scenario: ${scenario}`);
    }
  }

  private async runWorkerCrashReservation(campaignId: string): Promise<FailureScenarioReport> {
    const expiredTime = new Date(Date.now() - 5000);
    const crashAgentId = `agent-crash-${Date.now()}`;
    const crashBorrowerId = `bor-crash-${Date.now()}`;

    // Agent stuck in RESERVED with expired lease
    const agent: Agent = {
      id: crashAgentId,
      campaignId,
      name: 'Crash Agent',
      state: 'RESERVED',
      currentCallId: null,
      version: 1,
      reservationLeaseExpiresAt: expiredTime,
      lastStateChangeAt: expiredTime,
      stateChangeReason: 'Worker crashed before provider initiation',
      stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.container.agentRepo.save(agent);

    // Borrower stuck in RESERVED with expired lease
    const borrower: Borrower = {
      id: crashBorrowerId,
      campaignId,
      name: 'Crash Borrower',
      phoneNumber: '+15550009999',
      debtAmount: 2000,
      priority: 1,
      state: 'RESERVED',
      attemptsCount: 0,
      version: 1,
      lastAttemptAt: null,
      reservationLeaseExpiresAt: expiredTime,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.container.borrowerRepo.save(borrower);

    // Execute Reconciliation sweep
    const recon = await this.container.reconciliationService.reconcile(campaignId);

    const recoveredAgent = await this.container.agentRepo.findById(crashAgentId);
    const recoveredBorrower = await this.container.borrowerRepo.findById(crashBorrowerId);

    const invariantsMaintained =
      recoveredAgent?.state === 'AVAILABLE' && recoveredBorrower?.state === 'QUEUED';

    return {
      scenario: 'WORKER_CRASH_RESERVATION',
      campaignId,
      initialState: { agentState: 'RESERVED', borrowerState: 'RESERVED', leaseExpired: true },
      chaosInjected: 'Simulated worker crash after reserving agent and borrower but before call creation.',
      systemActionTaken: 'ReconciliationService swept expired leases and rolled back orphaned locks.',
      recoveryReport: recon as any,
      finalState: {
        agentState: recoveredAgent?.state,
        borrowerState: recoveredBorrower?.state,
      },
      invariantsMaintained,
      explanation:
        'Zero resources remained orphaned. Both agent and borrower were safely reclaimed without double-dialing.',
    };
  }

  private async runProviderOutage(campaignId: string): Promise<FailureScenarioReport> {
    const campaign = this.container.campaignManager.getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found.`);
    if (campaign.status !== 'ACTIVE') await this.container.campaignManager.startCampaign(campaignId);

    const scenarioSuffix = Date.now();
    for (let index = 0; index < 6; index++) {
      const agentId = `agent-outage-${scenarioSuffix}-${index}`;
      const borrowerId = `borrower-outage-${scenarioSuffix}-${index}`;
      await this.container.agentRepo.save({
        id: agentId,
        campaignId,
        name: `Outage Test Agent ${index + 1}`,
        state: 'AVAILABLE',
        currentCallId: null,
        version: 1,
        reservationLeaseExpiresAt: null,
        lastStateChangeAt: new Date(),
        stateChangeReason: 'Provider outage scenario fixture',
        stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await this.container.borrowerRepo.save({
        id: borrowerId,
        campaignId,
        name: `Outage Test Borrower ${index + 1}`,
        phoneNumber: `+155501${String(index).padStart(6, '0')}`,
        debtAmount: 1000,
        priority: 1,
        state: 'QUEUED',
        attemptsCount: 0,
        version: 1,
        lastAttemptAt: null,
        reservationLeaseExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    this.container.setProvider('unreliable');
    this.container.unreliableProvider.setOutage(true);
    const dialResult = await this.container.campaignManager.executeDialCycle(campaignId);
    const breaker = this.container.safetyController.getCircuitBreaker();
    const breakerState = breaker.getState();
    this.container.unreliableProvider.setOutage(false);
    const [activeCalls, agents, calls] = await Promise.all([
      this.container.callRepo.countActiveCalls(campaignId),
      this.container.agentRepo.countByState(campaignId),
      this.container.callRepo.countByState(campaignId),
    ]);
    const eligibleAgents = agents.AVAILABLE + agents.DIALING + agents.CONNECTED;
    const invariantsMaintained = breakerState === 'OPEN' && activeCalls <= eligibleAgents && agents.DIALING === 0;

    return {
      scenario: 'PROVIDER_OUTAGE',
      campaignId,
      initialState: { providerHealth: 'OUTAGE_TRIGGERED' },
      chaosInjected: 'Carrier SIP trunk returned 503 Service Unavailable across all lines.',
      systemActionTaken: 'Circuit breaker detected repeated carrier failure and tripped to OPEN, blocking calls.',
      recoveryReport: {
        dialAttempts: dialResult.attemptedPairs,
        failures: calls.FAILED,
        cancelledBeforeInitiation: calls.CANCELLED,
      },
      finalState: { circuitBreakerState: breakerState, activeCalls, eligibleAgents, agentsStillDialing: agents.DIALING },
      invariantsMaintained,
      explanation:
        'Safety Controller intercepted carrier failure and isolated dialer to prevent wasteful carrier thrashing.',
    };
  }

  private async runAgentDrop(campaignId: string): Promise<FailureScenarioReport> {
    let available = await this.container.agentRepo.findAvailableAgents(campaignId);
    for (let index = available.length; index < 100; index++) {
      const now = new Date();
      await this.container.agentRepo.save({
        id: `agent-drop-${campaignId}-${Date.now()}-${index}`,
        campaignId,
        name: `Agent Drop Fixture ${index + 1}`,
        state: 'AVAILABLE',
        currentCallId: null,
        version: 1,
        reservationLeaseExpiresAt: null,
        lastStateChangeAt: now,
        stateChangeReason: 'Agent drop simulation fixture',
        stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
        createdAt: now,
        updatedAt: now,
      });
    }
    available = await this.container.agentRepo.findAvailableAgents(campaignId);
    const dropCount = Math.floor(available.length * 0.4);
    const droppedIds: string[] = [];

    for (const a of available.slice(0, dropCount)) {
      await this.container.agentRepo.updateState(
        a.id,
        'OFFLINE',
        'Simulated sudden agent network disconnection'
      );
      droppedIds.push(a.id);
    }

    // Run reconciliation
    const recon = await this.container.reconciliationService.reconcile(campaignId);

    // Verify Safety Controller adapts immediately
    const decision = await this.container.safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: Math.max(1, available.length),
      mode: 'PROGRESSIVE',
    });
    const afterDropCounts = await this.container.agentRepo.countByState(campaignId);
    const invariantsMaintained = decision.approvedCalls <= afterDropCounts.AVAILABLE;
    this.container.safetyController.releaseDecision(decision);

    return {
      scenario: 'AGENT_DROP',
      campaignId,
      initialState: { eligibleAgentsBeforeDrop: available.length, requestedDropFraction: 0.4 },
      chaosInjected: `${droppedIds.length} agents abruptly dropped offline during active operations.`,
      systemActionTaken: 'ReconciliationService swept in-flight calls; SafetyController recalculated capacity.',
      recoveryReport: recon as any,
      finalState: { droppedAgentCount: droppedIds.length, eligibleAgentsAfterDrop: afterDropCounts.AVAILABLE, approvedCalls: decision.approvedCalls, decisionType: decision.decision },
      invariantsMaintained,
      explanation:
        'SafetyController immediately restricted dialing capacity to reflect the sudden drop in active agents.',
    };
  }

  private async runDuplicateEvents(campaignId: string): Promise<FailureScenarioReport> {
    const scenarioSuffix = Date.now();
    const agentId = `agent-dup-${scenarioSuffix}`;
    const borrowerId = `borrower-dup-${scenarioSuffix}`;
    const callId = `call-dup-${scenarioSuffix}`;
    await this.container.agentRepo.save({
      id: agentId, campaignId, name: 'Duplicate Event Agent', state: 'DIALING', currentCallId: callId,
      version: 1, reservationLeaseExpiresAt: null, lastStateChangeAt: new Date(),
      stateChangeReason: 'Duplicate event fixture', stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
      createdAt: new Date(), updatedAt: new Date(),
    });
    await this.container.borrowerRepo.save({
      id: borrowerId, campaignId, name: 'Duplicate Event Borrower', phoneNumber: '+155501999001',
      debtAmount: 1000, priority: 1, state: 'RESERVED', attemptsCount: 1, version: 1,
      lastAttemptAt: new Date(), reservationLeaseExpiresAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const targetCall = await this.container.callRepo.save({
      id: callId, campaignId, borrowerId, agentId, providerId: 'reliable-provider',
      providerCallId: `prov-dup-${scenarioSuffix}`, state: 'INITIATED', version: 1,
      queuedAt: new Date(), reservedAt: new Date(), initiatedAt: new Date(), ringingAt: null,
      answeredAt: null, connectedAt: null, endedAt: null, durationSeconds: 0, failureReason: null,
      eventHistory: [], createdAt: new Date(), updatedAt: new Date(),
    });

    const event = {
      eventId: `DUPLICATE-EVT-${Date.now()}`,
      providerCallId: targetCall.providerCallId ?? 'prov-dup-1',
      callId: targetCall.id,
      campaignId,
      eventType: 'ANSWERED' as const,
      timestamp: new Date(),
    };

    const [firstResult, duplicateResult] = await Promise.all([
      this.container.eventProcessor.processEvent(event),
      this.container.eventProcessor.processEvent(event),
    ]);
    const [finalCall, finalAgent, finalBorrower] = await Promise.all([
      this.container.callRepo.findById(targetCall.id),
      this.container.agentRepo.findById(agentId),
      this.container.borrowerRepo.findById(borrowerId),
    ]);
    const results = [firstResult.status, duplicateResult.status];
    const invariantsMaintained = results.filter((status) => status === 'APPLIED').length === 1 &&
      results.filter((status) => status === 'DUPLICATE_IGNORED').length === 1 &&
      finalCall?.state === 'ANSWERED' && finalAgent?.state === 'CONNECTED' && finalBorrower?.state === 'CONNECTED';

    return {
      scenario: 'DUPLICATE_EVENTS',
      campaignId,
      initialState: { callId: targetCall.id },
      chaosInjected: 'Identical webhook event ID delivered twice concurrently.',
      systemActionTaken: 'ProviderEventProcessor detected duplicate event key and safely skipped duplicate side effects.',
      recoveryReport: { firstEventStatus: firstResult.status, duplicateEventStatus: duplicateResult.status },
      finalState: { duplicateStatuses: results, callState: finalCall?.state, agentState: finalAgent?.state, borrowerState: finalBorrower?.state },
      invariantsMaintained,
      explanation: 'Deduplication cache ensured duplicate carrier webhooks do not corrupt agent or call states.',
    };
  }

  private async runOutOfOrderEvents(campaignId: string): Promise<FailureScenarioReport> {
    const scenarioSuffix = Date.now();
    const targetCall = await this.container.callRepo.save({
      id: `call-ooo-${scenarioSuffix}`, campaignId, borrowerId: `borrower-ooo-${scenarioSuffix}`,
      agentId: null, providerId: 'reliable-provider', providerCallId: `prov-ooo-${scenarioSuffix}`,
      state: 'INITIATED', version: 1, queuedAt: new Date(), reservedAt: new Date(),
      initiatedAt: new Date(), ringingAt: null, answeredAt: null, connectedAt: null,
      endedAt: null, durationSeconds: 0, failureReason: null, eventHistory: [],
      createdAt: new Date(), updatedAt: new Date(),
    });

    // Advance to COMPLETED first
    await this.container.eventProcessor.processEvent({
      eventId: `EVT-COMP-${Date.now()}`,
      providerCallId: targetCall.providerCallId ?? 'prov-ooo-1',
      callId: targetCall.id,
      campaignId,
      eventType: 'COMPLETED',
      timestamp: new Date(),
    });

    // Stale late ANSWERED arrives
    const staleResult = await this.container.eventProcessor.processEvent({
      eventId: `EVT-LATE-ANS-${Date.now()}`,
      providerCallId: targetCall.providerCallId ?? 'prov-ooo-1',
      callId: targetCall.id,
      campaignId,
      eventType: 'ANSWERED',
      timestamp: new Date(),
    });
    const finalCall = await this.container.callRepo.findById(targetCall.id);

    return {
      scenario: 'OUT_OF_ORDER_EVENTS',
      campaignId,
      initialState: { targetCallId: targetCall.id, state: 'COMPLETED' },
      chaosInjected: 'COMPLETED arrived before late delayed ANSWERED packet.',
      systemActionTaken: 'CallStateMachine terminal state protection prevented overwriting immutable COMPLETED state.',
      recoveryReport: { staleResultStatus: staleResult.status, detail: staleResult.detail },
      finalState: { finalState: finalCall?.state },
      invariantsMaintained: staleResult.status === 'TERMINAL_STATE_BLOCKED' && finalCall?.state === 'COMPLETED',
      explanation: 'Terminal states are absorbing and immutable, rejecting stale out-of-order network packets.',
    };
  }
}
