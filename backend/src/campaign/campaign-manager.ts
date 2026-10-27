import { randomUUID } from 'node:crypto';
import { Campaign, CampaignConfig, DialingMode } from './types.js';
import { IAgentRepository } from '../domain/agent/agent.repository.interface.js';
import { IBorrowerRepository } from '../domain/borrower/borrower.repository.interface.js';
import { ICallRepository } from '../domain/call/call.repository.interface.js';
import { SafetyController } from '../safety/safety-controller.js';
import { ProgressiveDialer, ProgressiveCycleResult } from '../allocator/progressive-dialer.js';
import { CallAllocator } from '../allocator/call-allocator.js';
import { PredictivePacingEngine } from '../pacing/predictive-engine.js';
import { PacingRecommendation } from '../pacing/types.js';
import { ReconciliationService, ReconciliationReport } from '../recovery/reconciliation-service.js';
import { ITelecomProvider } from '../providers/telecom-provider.interface.js';

export class CampaignManager {
  private readonly campaigns = new Map<string, Campaign>();

  constructor(
    private readonly agentRepo: IAgentRepository,
    private readonly borrowerRepo: IBorrowerRepository,
    private readonly callRepo: ICallRepository,
    private readonly safetyController: SafetyController,
    private readonly progressiveDialer: ProgressiveDialer,
    private readonly callAllocator: CallAllocator,
    private readonly pacingEngine: PredictivePacingEngine,
    private readonly reconciliationService: ReconciliationService,
    private readonly provider: ITelecomProvider
  ) {}

  public async createCampaign(name: string, config?: Partial<CampaignConfig>): Promise<Campaign> {
    const id = `camp-${randomUUID().slice(0, 8)}`;
    const fullConfig: CampaignConfig = {
      dialingMode: config?.dialingMode ?? 'PROGRESSIVE',
      maxConcurrentCalls: config?.maxConcurrentCalls ?? 50,
      targetAbandonmentRate: config?.targetAbandonmentRate ?? 0.03,
      reservationLeaseDurationSeconds: config?.reservationLeaseDurationSeconds ?? 15,
      providerId: config?.providerId ?? 'reliable',
    };

    const campaign: Campaign = {
      id,
      name,
      status: 'STOPPED',
      config: fullConfig,
      startedAt: null,
      endedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.campaigns.set(id, campaign);
    return campaign;
  }

  public getCampaign(id: string): Campaign | null {
    return this.campaigns.get(id) ?? null;
  }

  public listCampaigns(): Campaign[] {
    return Array.from(this.campaigns.values());
  }

  public async startCampaign(id: string): Promise<Campaign> {
    const campaign = this.campaigns.get(id);
    if (!campaign) throw new Error(`Campaign ${id} not found.`);

    campaign.status = 'ACTIVE';
    campaign.startedAt = campaign.startedAt ?? new Date();
    campaign.updatedAt = new Date();

    this.safetyController.setCampaignPaused(false);
    this.safetyController.setEmergencyStop(false);

    return campaign;
  }

  public async pauseCampaign(id: string): Promise<Campaign> {
    const campaign = this.campaigns.get(id);
    if (!campaign) throw new Error(`Campaign ${id} not found.`);

    campaign.status = 'PAUSED';
    campaign.updatedAt = new Date();

    this.safetyController.setCampaignPaused(true);
    return campaign;
  }

  public async stopCampaign(id: string): Promise<Campaign> {
    const campaign = this.campaigns.get(id);
    if (!campaign) throw new Error(`Campaign ${id} not found.`);

    campaign.status = 'STOPPED';
    campaign.endedAt = new Date();
    campaign.updatedAt = new Date();

    this.safetyController.setEmergencyStop(true);

    // Run immediate reconciliation to sweep in-flight calls
    await this.reconciliationService.reconcile(id);

    return campaign;
  }

  public async updateDialingMode(id: string, mode: DialingMode): Promise<Campaign> {
    const campaign = this.campaigns.get(id);
    if (!campaign) throw new Error(`Campaign ${id} not found.`);

    campaign.config.dialingMode = mode;
    campaign.updatedAt = new Date();
    return campaign;
  }

  /**
   * Main dialing cycle execution for campaign:
   * Dispatches to Progressive or Predictive flow gated by SafetyController.
   */
  public async executeDialCycle(id: string): Promise<ProgressiveCycleResult> {
    const campaign = this.campaigns.get(id);
    if (!campaign) throw new Error(`Campaign ${id} not found.`);

    if (campaign.status !== 'ACTIVE') {
      return {
        campaignId: id,
        attemptedPairs: 0,
        successfulCalls: 0,
        recommendedCalls: 0,
        safetyApprovedCalls: 0,
        safetyReason: `Campaign is ${campaign.status}.`,
        allocations: [],
        reason: `Dialing skipped: Campaign is ${campaign.status}.`,
      };
    }

    const [agentCountsBefore, borrowerCountsBefore] = await Promise.all([
      this.agentRepo.countByState(id),
      this.borrowerRepo.countByState(id),
    ]);
    const totalAgents = Object.values(agentCountsBefore).reduce((sum, count) => sum + count, 0);
    const eligibleAgents = agentCountsBefore.AVAILABLE;
    const queuedAtStart = borrowerCountsBefore.QUEUED;
    const result = campaign.config.dialingMode === 'PROGRESSIVE'
      ? await this.progressiveDialer.executeCycle(id, campaign.config.maxConcurrentCalls)
      : await this.executePredictiveCycle(campaign);
    const [borrowerCountsAfter, providerHealth, completedDuringCycle] = await Promise.all([
      this.borrowerRepo.countByState(id),
      this.provider.getHealth(),
      this.countCycleCompletions(result),
    ]);

    return {
      ...result,
      allocationBreakdown: {
        totalAgents,
        eligibleAgents,
        queuedAtStart,
        recommendedCalls: result.recommendedCalls,
        safetyApprovedCalls: result.safetyApprovedCalls,
        providerHealthy: providerHealth.isHealthy,
        providerLatencyMs: providerHealth.latencyMs,
        callsInitiated: result.successfulCalls,
        callsCompletedDuringCycle: completedDuringCycle,
        callsLeftQueued: borrowerCountsAfter.QUEUED,
        safetyReason: result.safetyReason,
      },
    };
  }

  private async countCycleCompletions(result: ProgressiveCycleResult): Promise<number> {
    const calls = await Promise.all(
      result.allocations
        .filter((allocation) => allocation.success && allocation.call)
        .map((allocation) => this.callRepo.findById(allocation.call!.id))
    );
    return calls.filter((call) => call?.state === 'COMPLETED').length;
  }

  public async getPacingRecommendation(id: string): Promise<PacingRecommendation | null> {
    const campaign = this.campaigns.get(id);
    if (!campaign) throw new Error(`Campaign ${id} not found.`);

    const [agentCounts, availableAgents, activeCalls, callCounts, calls, health] = await Promise.all([
      this.agentRepo.countByState(id),
      this.agentRepo.findAvailableAgents(id),
      this.callRepo.countActiveCalls(id),
      this.callRepo.countByState(id),
      this.callRepo.findByCampaign(id),
      this.provider.getHealth(),
    ]);
    const answeredCount = callCounts.ANSWERED + callCounts.CONNECTED + callCounts.COMPLETED;
    const recentTotalCalls = answeredCount + callCounts.FAILED;
    const completedCalls = calls.filter((call) => call.state === 'COMPLETED' && call.durationSeconds > 0);
    const averageCallDurationSeconds = completedCalls.length > 0
      ? completedCalls.reduce((sum, call) => sum + call.durationSeconds, 0) / completedCalls.length
      : 90;

    return this.pacingEngine.calculateRecommendation({
      campaignId: id,
      availableAgents: availableAgents.length,
      reservedAgents: agentCounts.RESERVED ?? 0,
      dialingAgents: agentCounts.DIALING ?? 0,
      connectedAgents: agentCounts.CONNECTED ?? 0,
      activeCalls,
      ringingCalls: callCounts.RINGING + callCounts.INITIATED,
      connectedCalls: callCounts.CONNECTED,
      historicalAnswerRate: 0.35,
      recentTotalCalls,
      recentAnsweredCalls: answeredCount,
      averageCallDurationSeconds,
      callSetupLatencySeconds: Math.max(0.1, health.latencyMs / 1000),
      providerHealthScore: health.isHealthy ? 1 - health.failureRate : 0.2,
      maxConcurrentCallsLimit: campaign.config.maxConcurrentCalls,
    });
  }

  private async executePredictiveCycle(campaign: Campaign): Promise<ProgressiveCycleResult> {
    const campaignId = campaign.id;

    const availableAgents = await this.agentRepo.findAvailableAgents(campaignId);
    const recommendation = await this.getPacingRecommendation(campaignId);
    if (!recommendation) {
      return {
        campaignId,
        attemptedPairs: 0,
        successfulCalls: 0,
        recommendedCalls: 0,
        safetyApprovedCalls: 0,
        safetyReason: 'Campaign not found.',
        allocations: [],
        reason: 'Campaign not found.',
      };
    }

    if (recommendation.recommendedCalls <= 0) {
      return {
        campaignId,
        attemptedPairs: 0,
        successfulCalls: 0,
        recommendedCalls: recommendation.recommendedCalls,
        safetyApprovedCalls: 0,
        safetyReason: recommendation.explanation,
        allocations: [],
        reason: `Predictive Engine recommended 0 calls: ${recommendation.explanation}`,
      };
    }

    // 3. Request independent approval from Safety Controller
    const safetyDecision = await this.safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: recommendation.recommendedCalls,
      mode: 'PREDICTIVE',
      campaignMaxConcurrentCalls: campaign.config.maxConcurrentCalls,
      reason: recommendation.explanation,
    });

    if (safetyDecision.decision === 'REJECT' || safetyDecision.approvedCalls <= 0) {
      return {
        campaignId,
        attemptedPairs: 0,
        successfulCalls: 0,
        recommendedCalls: recommendation.recommendedCalls,
        safetyApprovedCalls: safetyDecision.approvedCalls,
        safetyReason: safetyDecision.reason,
        allocations: [],
        reason: `Safety Controller rejected predictive recommendation: ${safetyDecision.reason}`,
      };
    }

    // 4. Run allocations up to safety approved calls
    const approvedCount = safetyDecision.approvedCalls;
    const eligibleBorrowers = await this.borrowerRepo.findNextEligible(campaignId, approvedCount);

    if (eligibleBorrowers.length === 0) {
      this.safetyController.releaseDecision(safetyDecision);
      return {
        campaignId,
        attemptedPairs: 0,
        successfulCalls: 0,
        recommendedCalls: recommendation.recommendedCalls,
        safetyApprovedCalls: approvedCount,
        safetyReason: 'Safety approved, but the borrower queue is empty.',
        allocations: [],
        reason: 'Borrower queue is empty.',
      };
    }

    const runs = Math.min(approvedCount, availableAgents.length, eligibleBorrowers.length);
    const allocations = [];
    let successes = 0;

    try {
      for (let i = 0; i < runs; i++) {
        const agent = availableAgents[i];
        const borrower = eligibleBorrowers[i];
        if (!agent || !borrower) break;

        const res = await this.callAllocator.allocateCall(
          campaignId,
          agent,
          borrower,
          safetyDecision
        );
        allocations.push(res);
        if (res.success) successes++;
      }
    } finally {
      this.safetyController.releaseDecision(safetyDecision);
    }

    return {
      campaignId,
      attemptedPairs: runs,
      successfulCalls: successes,
      recommendedCalls: recommendation.recommendedCalls,
      safetyApprovedCalls: approvedCount,
      safetyReason: safetyDecision.reason,
      allocations,
      reason: `Predictive cycle executed. Recommended: ${recommendation.recommendedCalls}, Approved: ${approvedCount}, Initiated: ${successes}.`,
    };
  }

  public async runReconciliation(campaignId: string): Promise<ReconciliationReport> {
    return this.reconciliationService.reconcile(campaignId);
  }
}

