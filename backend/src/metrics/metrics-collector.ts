import { IAgentRepository } from '../domain/agent/agent.repository.interface.js';
import { ICallRepository } from '../domain/call/call.repository.interface.js';
import { SafetyController } from '../safety/safety-controller.js';
import { ProviderEventProcessor } from '../providers/provider-event-processor.js';
import { ITelecomProvider } from '../providers/telecom-provider.interface.js';

export interface CampaignMetricsSummary {
  campaignId: string;
  totalCalls: number;
  totalInitiated: number;
  totalAnswered: number;
  totalConnected: number;
  totalCompleted: number;
  totalFailed: number;
  totalCancelled: number;
  answerRate: number; // Answered / Initiated
  completionRate: number; // Completed / Answered
  agentUtilization: number; // (Connected + Dialing) / Total Agents
  averageCallDurationSeconds: number;
  safetyDecisionsSummary: {
    total: number;
    approved: number;
    reduced: number;
    rejected: number;
    fallbackProgressive: number;
  };
  eventProcessorMetrics: {
    applied: number;
    duplicatesIgnored: number;
    staleOutOfOrder: number;
    terminalBlocked: number;
  };
  providerHealth: {
    isHealthy: boolean;
    latencyMs: number;
    failureRate: number;
    circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  };
  invariantViolationsCount: number;
  timestamp: Date;
}

export class MetricsCollector {
  private invariantViolations = 0;

  constructor(
    private readonly agentRepo: IAgentRepository,
    private readonly callRepo: ICallRepository,
    private readonly safetyController: SafetyController,
    private readonly eventProcessor: ProviderEventProcessor,
    private readonly provider: ITelecomProvider
  ) {}

  public recordInvariantViolation(detail: string): void {
    this.invariantViolations++;
    console.error(`[CRITICAL INVARIANT VIOLATION] ${detail}`);
  }

  public async collectMetrics(campaignId: string): Promise<CampaignMetricsSummary> {
    const callCounts = await this.callRepo.countByState(campaignId);
    const agentCounts = await this.agentRepo.countByState(campaignId);
    const calls = await this.callRepo.findByCampaign(campaignId);
    const health = await this.provider.getHealth();
    const circuitSnapshot = this.safetyController.getCircuitBreaker().getSnapshot();

    const totalInitiated =
      callCounts.INITIATED +
      callCounts.RINGING +
      callCounts.ANSWERED +
      callCounts.CONNECTED +
      callCounts.COMPLETED +
      callCounts.FAILED;

    const totalAnswered = callCounts.ANSWERED + callCounts.CONNECTED + callCounts.COMPLETED;
    const totalConnected = callCounts.CONNECTED + callCounts.COMPLETED;

    const answerRate = totalInitiated > 0 ? totalAnswered / totalInitiated : 0;
    const completionRate = totalAnswered > 0 ? callCounts.COMPLETED / totalAnswered : 0;

    const totalAgents =
      agentCounts.AVAILABLE +
      agentCounts.RESERVED +
      agentCounts.DIALING +
      agentCounts.CONNECTED +
      agentCounts.WRAP_UP +
      agentCounts.PAUSED +
      agentCounts.OFFLINE;

    const busyAgents = agentCounts.DIALING + agentCounts.CONNECTED;
    const agentUtilization = totalAgents > 0 ? busyAgents / totalAgents : 0;

    // Calculate Average Call Duration
    const completedCalls = calls.filter((c) => c.state === 'COMPLETED' && c.durationSeconds > 0);
    const totalDuration = completedCalls.reduce((acc, c) => acc + c.durationSeconds, 0);
    const avgDuration = completedCalls.length > 0 ? totalDuration / completedCalls.length : 0;

    // Safety Decisions Audit
    const recentDecisions = this.safetyController
      .getRecentDecisions(200)
      .filter((d) => d.campaignId === campaignId);

    const safetySummary = {
      total: recentDecisions.length,
      approved: recentDecisions.filter((d) => d.decision === 'APPROVE').length,
      reduced: recentDecisions.filter((d) => d.decision === 'REDUCE').length,
      rejected: recentDecisions.filter((d) => d.decision === 'REJECT').length,
      fallbackProgressive: recentDecisions.filter((d) => d.decision === 'FALLBACK_PROGRESSIVE').length,
    };

    // Event Processor Metrics
    const auditLogs = this.eventProcessor.getAuditHistory(200);
    const eventMetrics = {
      applied: auditLogs.filter((l) => l.status === 'APPLIED').length,
      duplicatesIgnored: auditLogs.filter((l) => l.status === 'DUPLICATE_IGNORED').length,
      staleOutOfOrder: auditLogs.filter((l) => l.status === 'STALE_OUT_OF_ORDER').length,
      terminalBlocked: auditLogs.filter((l) => l.status === 'TERMINAL_STATE_BLOCKED').length,
    };

    // Real-time Invariant Verification Check
    const activeCalls = await this.callRepo.countActiveCalls(campaignId);
    const eligibleAgents = agentCounts.AVAILABLE + agentCounts.DIALING + agentCounts.CONNECTED;
    if (activeCalls > eligibleAgents && eligibleAgents > 0) {
      this.recordInvariantViolation(
        `Active calls (${activeCalls}) exceeded eligible agents (${eligibleAgents}) in campaign ${campaignId}.`
      );
    }

    return {
      campaignId,
      totalCalls: calls.length,
      totalInitiated,
      totalAnswered,
      totalConnected,
      totalCompleted: callCounts.COMPLETED,
      totalFailed: callCounts.FAILED,
      totalCancelled: callCounts.CANCELLED,
      answerRate,
      completionRate,
      agentUtilization,
      averageCallDurationSeconds: Math.round(avgDuration),
      safetyDecisionsSummary: safetySummary,
      eventProcessorMetrics: eventMetrics,
      providerHealth: {
        isHealthy: health.isHealthy,
        latencyMs: health.latencyMs,
        failureRate: health.failureRate,
        circuitState: circuitSnapshot.state,
      },
      invariantViolationsCount: this.invariantViolations,
      timestamp: new Date(),
    };
  }
}

