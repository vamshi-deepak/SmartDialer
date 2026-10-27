export interface Campaign {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'STOPPED';
  config: {
    dialingMode: 'PROGRESSIVE' | 'PREDICTIVE';
    maxConcurrentCalls: number;
    targetAbandonmentRate: number;
    providerId: 'reliable' | 'unreliable';
  };
  startedAt: string | null;
  endedAt: string | null;
}

export interface AgentCounts {
  OFFLINE: number;
  AVAILABLE: number;
  RESERVED: number;
  DIALING: number;
  CONNECTED: number;
  WRAP_UP: number;
  PAUSED: number;
}

export interface CallCounts {
  queuedBorrowers: number;
  QUEUED: number;
  RESERVED: number;
  INITIATED: number;
  RINGING: number;
  ANSWERED: number;
  CONNECTED: number;
  COMPLETED: number;
  FAILED: number;
  CANCELLED: number;
}

export interface SafetyDecision {
  id: string;
  campaignId: string;
  decision: 'APPROVE' | 'REDUCE' | 'REJECT' | 'FALLBACK_PROGRESSIVE';
  requestedCalls: number;
  approvedCalls: number;
  reason: string;
  timestamp: string;
  capacitySnapshot: {
    availableAgents: number;
    totalActiveCalls: number;
    circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    circuitBreakerHealth: number;
  };
}

export interface EventAudit {
  eventId: string;
  providerCallId: string;
  callId: string;
  eventType: string;
  status: 'APPLIED' | 'DUPLICATE_IGNORED' | 'STALE_OUT_OF_ORDER' | 'TERMINAL_STATE_BLOCKED' | 'CALL_NOT_FOUND';
  detail: string;
  timestamp: string;
}

export interface CampaignMetrics {
  totalCalls: number;
  totalInitiated: number;
  totalAnswered: number;
  totalConnected: number;
  totalCompleted: number;
  totalFailed: number;
  totalCancelled: number;
  answerRate: number;
  completionRate: number;
  agentUtilization: number;
  averageCallDurationSeconds: number;
  invariantViolationsCount: number;
  providerHealth: {
    isHealthy: boolean;
    latencyMs: number;
    failureRate: number;
    circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  };
  safetyDecisionsSummary: {
    total: number;
    approved: number;
    reduced: number;
    rejected: number;
    fallbackProgressive: number;
  };
}

export interface PacingRecommendation {
  campaignId: string;
  recommendedCalls: number;
  estimatedAnswerRate: number;
  expectedAdditionalAnswers: number;
  availableAgentCapacity: number;
  currentRingingAndConnectedCalls: number;
  providerHealth: number;
  explanation: string;
  assumptionsOrLimitations: string[];
  calculatedAt: string;
}

export interface SimulationResult {
  scenario: {
    name: string;
    dialingMode: string;
    agentCount: number;
    targetAnswerRate: number;
    seed: number;
  };
  totalCallsInitiated: number;
  totalCallsAnswered: number;
  totalCallsConnected: number;
  totalCallsCompleted: number;
  totalCallsFailed: number;
  effectiveAnswerRate: number;
  averageAgentUtilization: number;
  invariantViolationsCount: number;
  summary: string;
  timeline: Array<{
    tick: number;
    availableAgents: number;
    connectedAgents: number;
    activeCalls: number;
    ringingCalls: number;
    completedCalls: number;
    failedCalls: number;
  }>;
}

export interface FailureScenarioReport {
  scenario: string;
  chaosInjected: string;
  systemActionTaken: string;
  invariantsMaintained: boolean;
  explanation: string;
  finalState: Record<string, unknown>;
}

export interface DialCycleResult {
  campaignId: string;
  attemptedPairs: number;
  successfulCalls: number;
  recommendedCalls: number;
  safetyApprovedCalls: number;
  safetyReason: string;
  reason: string;
  allocationBreakdown: {
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
}

