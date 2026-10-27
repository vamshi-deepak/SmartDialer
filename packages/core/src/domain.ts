export const agentStates = ["OFFLINE", "AVAILABLE", "RESERVED", "DIALING", "CONNECTED", "WRAP_UP", "PAUSED"] as const;
export type AgentState = (typeof agentStates)[number];

export const callStates = ["QUEUED", "RESERVED", "INITIATED", "RINGING", "ANSWERED", "CONNECTED", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type CallState = (typeof callStates)[number];
export type CampaignState = "DRAFT" | "RUNNING" | "PAUSED" | "STOPPED";
export type DialingMode = "PROGRESSIVE" | "PREDICTIVE";
export type ProviderHealth = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface StateChange {
  from: AgentState | CallState;
  to: AgentState | CallState;
  at: number;
  reason: string;
}

export interface Agent {
  id: string;
  campaignId: string;
  name: string;
  state: AgentState;
  activeCallId?: string;
  reservationExpiresAt?: number;
  stateChangedAt: number;
  stateReason: string;
  history: StateChange[];
}

export interface Borrower {
  id: string;
  campaignId: string;
  name: string;
  phone: string;
  state: "QUEUED" | "RESERVED" | "CONTACTED" | "DO_NOT_CALL";
  activeCallId?: string;
  reservationExpiresAt?: number;
}

export interface Call {
  id: string;
  campaignId: string;
  agentId: string;
  borrowerId: string;
  providerId: string;
  state: CallState;
  createdAt: number;
  updatedAt: number;
  initiatedAt?: number;
  answeredAt?: number;
  completedAt?: number;
  setupLatencyMs?: number;
  durationMs?: number;
  outcomeReason?: string;
  history: StateChange[];
}

export interface CampaignConfig {
  maxConcurrentCalls: number;
  reservationLeaseMs: number;
  wrapUpMs: number;
  priorAnswerRate: number;
  priorSampleSize: number;
  targetConcurrent: number;
}

export interface Campaign {
  id: string;
  name: string;
  state: CampaignState;
  mode: DialingMode;
  emergencyStopped: boolean;
  config: CampaignConfig;
  createdAt: number;
}

export interface ProviderEvent {
  id: string;
  providerId: string;
  callId: string;
  type: "RINGING" | "ANSWERED" | "CONNECTED" | "COMPLETED" | "FAILED" | "CANCELLED";
  at: number;
  reason?: string;
}

export interface EventOutcome {
  eventId: string;
  callId: string;
  receivedAt: number;
  applied: boolean;
  reason: string;
  resultingState: CallState | "UNKNOWN";
}

export interface SafetyDecision {
  id: string;
  at: number;
  campaignId: string;
  requested: number;
  permitted: number;
  status: "APPROVE" | "REDUCE" | "REJECT" | "FALLBACK_PROGRESSIVE";
  reasons: string[];
}

export const allowedAgentTransitions: Record<AgentState, readonly AgentState[]> = {
  OFFLINE: ["AVAILABLE"],
  AVAILABLE: ["RESERVED", "PAUSED", "OFFLINE"],
  RESERVED: ["DIALING", "AVAILABLE", "PAUSED", "OFFLINE"],
  DIALING: ["CONNECTED", "AVAILABLE", "PAUSED", "OFFLINE"],
  CONNECTED: ["WRAP_UP", "AVAILABLE", "PAUSED", "OFFLINE"],
  WRAP_UP: ["AVAILABLE", "PAUSED", "OFFLINE"],
  PAUSED: ["AVAILABLE", "OFFLINE"]
};

export const allowedCallTransitions: Record<CallState, readonly CallState[]> = {
  QUEUED: ["RESERVED", "CANCELLED"],
  RESERVED: ["INITIATED", "FAILED", "CANCELLED"],
  INITIATED: ["RINGING", "ANSWERED", "CONNECTED", "COMPLETED", "FAILED", "CANCELLED"],
  RINGING: ["ANSWERED", "CONNECTED", "COMPLETED", "FAILED", "CANCELLED"],
  ANSWERED: ["CONNECTED", "COMPLETED", "FAILED", "CANCELLED"],
  CONNECTED: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: []
};

export function transitionAgent(agent: Agent, next: AgentState, at: number, reason: string): void {
  if (!allowedAgentTransitions[agent.state].includes(next)) {
    throw new Error(`Invalid agent transition ${agent.state} -> ${next}`);
  }
  agent.history.push({ from: agent.state, to: next, at, reason });
  agent.state = next;
  agent.stateChangedAt = at;
  agent.stateReason = reason;
}

export function transitionCall(call: Call, next: CallState, at: number, reason: string): void {
  if (!allowedCallTransitions[call.state].includes(next)) {
    throw new Error(`Invalid call transition ${call.state} -> ${next}`);
  }
  call.history.push({ from: call.state, to: next, at, reason });
  call.state = next;
  call.updatedAt = at;
  call.outcomeReason = reason;
  if (next === "INITIATED") call.initiatedAt = at;
  if (next === "ANSWERED" || next === "CONNECTED") call.answeredAt ??= at;
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(next)) call.completedAt = at;
}

export const activeCallStates: readonly CallState[] = ["RESERVED", "INITIATED", "RINGING", "ANSWERED", "CONNECTED"];

export function isTerminalCallState(state: CallState): boolean {
  return allowedCallTransitions[state].length === 0;
}