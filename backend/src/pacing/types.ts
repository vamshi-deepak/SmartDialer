export interface PacingMetricsInput {
  campaignId: string;
  availableAgents: number;
  reservedAgents: number;
  dialingAgents: number;
  connectedAgents: number;
  activeCalls: number;
  ringingCalls: number;
  connectedCalls: number;
  historicalAnswerRate: number; // e.g. 0.30
  recentTotalCalls: number;
  recentAnsweredCalls: number;
  averageCallDurationSeconds: number; // e.g. 90
  callSetupLatencySeconds: number; // e.g. 6
  providerHealthScore: number; // 0.0 to 1.0
  maxConcurrentCallsLimit: number;
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
  calculatedAt: Date;
}

