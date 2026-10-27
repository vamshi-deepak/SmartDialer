export type CallState =
  | 'QUEUED'
  | 'RESERVED'
  | 'INITIATED'
  | 'RINGING'
  | 'ANSWERED'
  | 'CONNECTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface CallEventRecord {
  eventId: string;
  eventType: string;
  fromState: CallState;
  toState: CallState;
  timestamp: Date;
  reason: string;
  payload?: Record<string, unknown>;
}

export interface Call {
  id: string;
  campaignId: string;
  borrowerId: string;
  agentId: string | null;
  providerId: string | null;
  providerCallId: string | null;
  state: CallState;
  version: number;
  queuedAt: Date;
  reservedAt: Date | null;
  initiatedAt: Date | null;
  ringingAt: Date | null;
  answeredAt: Date | null;
  connectedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number;
  failureReason: string | null;
  eventHistory: CallEventRecord[];
  createdAt: Date;
  updatedAt: Date;
}

