export type SafetyDecisionType =
  | 'APPROVE'
  | 'REDUCE'
  | 'REJECT'
  | 'FALLBACK_PROGRESSIVE';

export interface SystemCapacitySnapshot {
  totalAgents: number;
  availableAgents: number;
  reservedAgents: number;
  dialingAgents: number;
  connectedAgents: number;
  totalActiveCalls: number;
  inFlightCalls: number; // INITIATED + RINGING
  maxConcurrentCallsCap: number;
  circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  circuitBreakerHealth: number; // 0.0 to 1.0
  isCampaignPaused: boolean;
  isEmergencyStopped: boolean;
}

export interface SafetyCheckRequest {
  campaignId: string;
  requestedCalls: number;
  mode: 'PROGRESSIVE' | 'PREDICTIVE';
  campaignMaxConcurrentCalls?: number;
  reason?: string;
}

export interface SafetyDecision {
  id: string;
  campaignId: string;
  decision: SafetyDecisionType;
  requestedCalls: number;
  approvedCalls: number;
  reason: string;
  capacitySnapshot: SystemCapacitySnapshot;
  decisionToken: string;
  timestamp: Date;
}

