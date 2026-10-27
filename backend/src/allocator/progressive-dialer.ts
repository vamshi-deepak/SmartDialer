import { IAgentRepository } from '../domain/agent/agent.repository.interface.js';
import { IBorrowerRepository } from '../domain/borrower/borrower.repository.interface.js';
import { SafetyController } from '../safety/safety-controller.js';
import { CallAllocator, AllocationResult } from './call-allocator.js';

export interface ProgressiveCycleResult {
  campaignId: string;
  attemptedPairs: number;
  successfulCalls: number;
  recommendedCalls: number;
  safetyApprovedCalls: number;
  safetyReason: string;
  allocationBreakdown?: {
    totalAgents: number;
    eligibleAgents: number;
    queuedAtStart: number;
    recommendedCalls: number;
    safetyApprovedCalls: number;
    providerHealthy: boolean;
    providerLatencyMs: number;
    callsInitiated: number;
    callsCompletedDuringCycle: number;
    callsLeftQueued: number;
    safetyReason: string;
  };
  allocations: AllocationResult[];
  reason: string;
}

export class ProgressiveDialer {
  constructor(
    private readonly agentRepo: IAgentRepository,
    private readonly borrowerRepo: IBorrowerRepository,
    private readonly safetyController: SafetyController,
    private readonly callAllocator: CallAllocator
  ) {}

  /**
   * Executes a single progressive dialing cycle.
   * Invariant: Total active calls initiated never exceeds eligible available agents.
   */
  public async executeCycle(campaignId: string, campaignMaxConcurrentCalls?: number): Promise<ProgressiveCycleResult> {
    // 1. Identify available agents
    const availableAgents = await this.agentRepo.findAvailableAgents(campaignId);
    if (availableAgents.length === 0) {
      return {
        campaignId,
        attemptedPairs: 0,
        successfulCalls: 0,
        recommendedCalls: 0,
        safetyApprovedCalls: 0,
        safetyReason: 'No eligible agents.',
        allocations: [],
        reason: 'Cycle skipped: No agents currently AVAILABLE.',
      };
    }

    // 2. Fetch queued borrowers matching available agent capacity
    const eligibleBorrowers = await this.borrowerRepo.findNextEligible(
      campaignId,
      availableAgents.length
    );
    if (eligibleBorrowers.length === 0) {
      return {
        campaignId,
        attemptedPairs: 0,
        successfulCalls: 0,
        recommendedCalls: 0,
        safetyApprovedCalls: 0,
        safetyReason: 'No queued borrowers.',
        allocations: [],
        reason: 'Cycle skipped: Borrower queue is exhausted or empty.',
      };
    }

    const pairCount = Math.min(availableAgents.length, eligibleBorrowers.length);

    // 3. Request approval from Safety Controller
    const safetyDecision = await this.safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: pairCount,
      mode: 'PROGRESSIVE',
      campaignMaxConcurrentCalls,
      reason: `Progressive cycle matching ${pairCount} agents to borrowers.`,
    });

    if (safetyDecision.decision === 'REJECT' || safetyDecision.approvedCalls <= 0) {
      return {
        campaignId,
        attemptedPairs: 0,
        successfulCalls: 0,
        recommendedCalls: pairCount,
        safetyApprovedCalls: 0,
        safetyReason: safetyDecision.reason,
        allocations: [],
        reason: `Dialing halted by Safety Controller: ${safetyDecision.reason}`,
      };
    }

    const allocationsToRun = Math.min(pairCount, safetyDecision.approvedCalls);
    const results: AllocationResult[] = [];
    let successfulCount = 0;

    try {
      // 4. Pair and allocate calls
      for (let i = 0; i < allocationsToRun; i++) {
        const agent = availableAgents[i];
        const borrower = eligibleBorrowers[i];

        if (!agent || !borrower) break;

        const allocResult = await this.callAllocator.allocateCall(
          campaignId,
          agent,
          borrower,
          safetyDecision
        );

        results.push(allocResult);
        if (allocResult.success) {
          successfulCount++;
        }
      }
    } finally {
      this.safetyController.releaseDecision(safetyDecision);
    }

    return {
      campaignId,
      attemptedPairs: allocationsToRun,
      successfulCalls: successfulCount,
      recommendedCalls: pairCount,
      safetyApprovedCalls: safetyDecision.approvedCalls,
      safetyReason: safetyDecision.reason,
      allocations: results,
      reason: `Progressive cycle completed. ${successfulCount}/${allocationsToRun} calls successfully initiated.`,
    };
  }
}

