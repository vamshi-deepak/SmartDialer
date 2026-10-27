export interface SimulationScenarioConfig {
  id: string;
  name: string;
  description: string;
  dialingMode: 'PROGRESSIVE' | 'PREDICTIVE';
  agentCount: number;
  borrowerCount: number;
  ticks: number; // e.g. 50 ticks
  tickDurationMs: number; // e.g. 50ms per tick in simulation time
  targetAnswerRate: number; // e.g. 0.20, 0.50, 0.70
  averageTalkDurationTicks: number; // e.g. 10 ticks
  providerType: 'reliable' | 'unreliable';
  seed: number;
}

export interface SimulationTickSnapshot {
  tick: number;
  availableAgents: number;
  connectedAgents: number;
  dialingAgents: number;
  activeCalls: number;
  ringingCalls: number;
  answeredCalls: number;
  completedCalls: number;
  failedCalls: number;
  safetyApprovedCalls: number;
  safetyReducedCalls: number;
  safetyRejectedCalls: number;
  safetyFallbackCalls: number;
  circuitBreakerHealth: number;
}

export interface SimulationResult {
  scenario: SimulationScenarioConfig;
  totalCallsInitiated: number;
  totalCallsAnswered: number;
  totalCallsConnected: number;
  totalCallsCompleted: number;
  totalCallsFailed: number;
  totalCallsCancelled: number;
  effectiveAnswerRate: number;
  averageAgentUtilization: number;
  totalSafetyDecisions: {
    approved: number;
    reduced: number;
    rejected: number;
    fallbackProgressive: number;
  };
  invariantViolationsCount: number;
  timeline: SimulationTickSnapshot[];
  summary: string;
}

