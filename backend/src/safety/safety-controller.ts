import { randomUUID } from 'node:crypto';
import { IAgentRepository } from '../domain/agent/agent.repository.interface.js';
import { ICallRepository } from '../domain/call/call.repository.interface.js';
import { CircuitBreaker } from './circuit-breaker.js';
import {
  SafetyCheckRequest,
  SafetyDecision,
  SafetyDecisionType,
  SystemCapacitySnapshot,
} from './safety.types.js';

export interface SafetyControllerConfig {
  globalMaxConcurrentCalls: number;
  maxOverdialRatio: number;
  minHealthForPredictive: number;
  minAgentsForPredictive: number;
}

interface InitiationAuthorization {
  campaignId: string;
  remainingCalls: number;
  expiresAt: number;
}

export class SafetyController {
  private readonly authorizations = new Map<string, InitiationAuthorization>();
  private evaluationQueue: Promise<void> = Promise.resolve();
  private isEmergencyStopped = false;
  private isCampaignPaused = false;
  private readonly decisionLog: SafetyDecision[] = [];

  constructor(
    private readonly agentRepo: IAgentRepository,
    private readonly callRepo: ICallRepository,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly config: SafetyControllerConfig = {
      globalMaxConcurrentCalls: 100,
      maxOverdialRatio: 2.0,
      minHealthForPredictive: 0.7,
      minAgentsForPredictive: 3,
    }
  ) {}

  public setEmergencyStop(active: boolean): void {
    this.isEmergencyStopped = active;
  }

  public setCampaignPaused(paused: boolean): void {
    this.isCampaignPaused = paused;
  }

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public getRecentDecisions(limit = 50): SafetyDecision[] {
    return this.decisionLog.slice(-limit);
  }

  public authorizeProviderInitiation(decision: SafetyDecision, campaignId: string): boolean {
    this.removeExpiredAuthorizations();
    const authorization = this.authorizations.get(decision.decisionToken);
    if (
      !authorization ||
      authorization.campaignId !== campaignId ||
      authorization.remainingCalls <= 0 ||
      decision.campaignId !== campaignId ||
      decision.approvedCalls <= 0 ||
      decision.decision === 'REJECT' ||
      this.isEmergencyStopped ||
      this.isCampaignPaused ||
      this.circuitBreaker.getState() === 'OPEN'
    ) {
      return false;
    }

    authorization.remainingCalls--;
    return true;
  }

  public releaseDecision(decision: SafetyDecision): void {
    this.authorizations.delete(decision.decisionToken);
  }

  public evaluateDialRequest(request: SafetyCheckRequest): Promise<SafetyDecision> {
    const evaluation = this.evaluationQueue.then(() => this.evaluateDialRequestLocked(request));
    this.evaluationQueue = evaluation.then(() => undefined, () => undefined);
    return evaluation;
  }

  private async evaluateDialRequestLocked(request: SafetyCheckRequest): Promise<SafetyDecision> {
    this.removeExpiredAuthorizations();
    const { campaignId, requestedCalls, mode } = request;
    const [agentCounts, totalActiveCalls, allActiveCalls, inFlightCalls] = await Promise.all([
      this.agentRepo.countByState(campaignId),
      this.callRepo.countActiveCalls(campaignId),
      this.callRepo.countAllActiveCalls(),
      this.callRepo.findInFlightCalls(campaignId),
    ]);
    const circuitState = this.circuitBreaker.getState();
    const circuitHealth = this.circuitBreaker.getHealthScore();
    const availableAgents = agentCounts.AVAILABLE ?? 0;
    const campaignCap = request.campaignMaxConcurrentCalls ?? this.config.globalMaxConcurrentCalls;
    const totalAgents = (agentCounts.AVAILABLE ?? 0) +
      (agentCounts.RESERVED ?? 0) +
      (agentCounts.DIALING ?? 0) +
      (agentCounts.CONNECTED ?? 0) +
      (agentCounts.WRAP_UP ?? 0) +
      (agentCounts.PAUSED ?? 0) +
      (agentCounts.OFFLINE ?? 0);

    const snapshot: SystemCapacitySnapshot = {
      totalAgents,
      availableAgents,
      reservedAgents: agentCounts.RESERVED ?? 0,
      dialingAgents: agentCounts.DIALING ?? 0,
      connectedAgents: agentCounts.CONNECTED ?? 0,
      totalActiveCalls,
      inFlightCalls: inFlightCalls.length,
      maxConcurrentCallsCap: Math.min(this.config.globalMaxConcurrentCalls, campaignCap),
      circuitBreakerState: circuitState,
      circuitBreakerHealth: circuitHealth,
      isCampaignPaused: this.isCampaignPaused,
      isEmergencyStopped: this.isEmergencyStopped,
    };

    const makeDecision = (type: SafetyDecisionType, approved: number, reason: string): SafetyDecision => {
      const decision: SafetyDecision = {
        id: randomUUID(),
        campaignId,
        decision: type,
        requestedCalls,
        approvedCalls: approved,
        reason,
        capacitySnapshot: snapshot,
        decisionToken: `SEC-TKN-${randomUUID()}`,
        timestamp: new Date(),
      };
      this.decisionLog.push(decision);
      if (approved > 0) {
        this.authorizations.set(decision.decisionToken, {
          campaignId,
          remainingCalls: approved,
          expiresAt: Date.now() + 30000,
        });
      }
      return decision;
    };

    if (this.isEmergencyStopped) return makeDecision('REJECT', 0, 'Rejected: Emergency stop is active across campaign.');
    if (this.isCampaignPaused) return makeDecision('REJECT', 0, 'Rejected: Campaign is currently paused.');
    if (circuitState === 'OPEN') {
      return makeDecision('REJECT', 0, 'Rejected: Telecom provider circuit breaker is OPEN due to excessive failure rate.');
    }

    const pendingGlobal = this.getPendingAuthorizedCalls();
    const pendingCampaign = this.getPendingAuthorizedCalls(campaignId);
    const globalHeadroom = Math.max(0, this.config.globalMaxConcurrentCalls - allActiveCalls - pendingGlobal);
    const campaignHeadroom = Math.max(0, campaignCap - totalActiveCalls - pendingCampaign);
    const remainingHeadroom = Math.min(globalHeadroom, campaignHeadroom);

    if (remainingHeadroom <= 0) {
      return makeDecision('REJECT', 0, `Rejected: Concurrent-call headroom is exhausted (campaign ${campaignHeadroom}, global ${globalHeadroom}).`);
    }
    if (availableAgents <= 0) return makeDecision('REJECT', 0, 'Rejected: Zero agents are currently in AVAILABLE state.');
    if (requestedCalls <= 0) return makeDecision('REJECT', 0, 'Requested call count must be greater than zero.');

    if (circuitState === 'HALF_OPEN') {
      const probeLimit = Math.min(Math.max(0, 1 - pendingCampaign), availableAgents, remainingHeadroom);
      return makeDecision('REDUCE', probeLimit, 'Circuit breaker is in HALF_OPEN recovery; throttling to one probe call.');
    }

    const progressiveCapacity = Math.min(Math.max(0, availableAgents - pendingCampaign), remainingHeadroom);
    if (mode === 'PROGRESSIVE') {
      const approved = Math.min(requestedCalls, progressiveCapacity);
      return makeDecision(
        approved === requestedCalls ? 'APPROVE' : approved > 0 ? 'REDUCE' : 'REJECT',
        approved,
        approved === requestedCalls
          ? `Approved: Progressive request for ${approved} calls matches available agent capacity.`
          : `Reduced: Progressive request capped to ${approved} available agents and safe headroom.`
      );
    }

    const deterioratingHealth = circuitHealth < this.config.minHealthForPredictive;
    const lowAgentPool = availableAgents < this.config.minAgentsForPredictive;
    if (deterioratingHealth || lowAgentPool) {
      const approved = Math.min(requestedCalls, progressiveCapacity);
      const reason = deterioratingHealth
        ? `Provider health is ${(circuitHealth * 100).toFixed(1)}%; falling back to progressive capacity (${approved}).`
        : `Agent pool is small (${availableAgents}); falling back to progressive capacity (${approved}).`;
      return makeDecision('FALLBACK_PROGRESSIVE', approved, reason);
    }

    const eligibleAgentPool = Math.max(0, availableAgents + (agentCounts.RESERVED ?? 0) - pendingCampaign);
    const predictiveAbsoluteMax = Math.floor(eligibleAgentPool * this.config.maxOverdialRatio);
    const predictiveAvailableSlots = Math.max(0, predictiveAbsoluteMax - inFlightCalls.length);
    const safeLimit = Math.min(
      remainingHeadroom,
      predictiveAvailableSlots,
      Math.max(0, availableAgents - pendingCampaign),
      availableAgents * 3
    );
    const approved = Math.min(requestedCalls, safeLimit);
    return makeDecision(
      approved === requestedCalls ? 'APPROVE' : approved > 0 ? 'REDUCE' : 'REJECT',
      approved,
      approved === requestedCalls
        ? `Approved: Predictive recommendation of ${approved} calls conforms to safety ceiling.`
        : `Reduced: Predictive recommendation of ${requestedCalls} capped to safety ceiling ${approved}.`
    );
  }

  private getPendingAuthorizedCalls(campaignId?: string): number {
    let pending = 0;
    for (const authorization of this.authorizations.values()) {
      if (!campaignId || authorization.campaignId === campaignId) pending += authorization.remainingCalls;
    }
    return pending;
  }

  private removeExpiredAuthorizations(): void {
    const now = Date.now();
    for (const [token, authorization] of this.authorizations) {
      if (authorization.expiresAt <= now) this.authorizations.delete(token);
    }
  }
}