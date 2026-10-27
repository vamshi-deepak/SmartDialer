export type AgentState =
  | 'OFFLINE'
  | 'AVAILABLE'
  | 'RESERVED'
  | 'DIALING'
  | 'CONNECTED'
  | 'WRAP_UP'
  | 'PAUSED';

export interface AgentStats {
  callsHandled: number;
  totalTalkTimeSeconds: number;
  lastConnectedAt?: Date;
}

export interface Agent {
  id: string;
  campaignId: string;
  name: string;
  state: AgentState;
  currentCallId: string | null;
  version: number;
  reservationLeaseExpiresAt: Date | null;
  lastStateChangeAt: Date;
  stateChangeReason: string;
  stats: AgentStats;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentReservationResult {
  success: boolean;
  agent?: Agent;
  error?: string;
  leaseExpiresAt?: Date;
}

