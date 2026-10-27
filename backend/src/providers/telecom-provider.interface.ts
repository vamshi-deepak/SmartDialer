export interface InitiateCallRequest {
  callId: string;
  campaignId: string;
  borrowerPhoneNumber: string;
  borrowerName: string;
  agentId?: string | null;
  timeoutMs?: number;
}

export interface InitiateCallResponse {
  providerCallId: string;
  status: 'QUEUED' | 'RINGING' | 'REJECTED' | 'FAILED';
  error?: string;
  timestamp: Date;
}

export type ProviderEventType =
  | 'RINGING'
  | 'ANSWERED'
  | 'CONNECTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'BUSY'
  | 'NO_ANSWER';

export interface ProviderCallEvent {
  eventId: string;
  providerCallId: string;
  callId: string;
  campaignId: string;
  eventType: ProviderEventType;
  timestamp: Date;
  details?: Record<string, unknown>;
  sequenceNumber?: number;
}

export type ProviderEventHandler = (event: ProviderCallEvent) => Promise<void>;

export interface ITelecomProvider {
  readonly id: string;
  readonly name: string;
  
  /**
   * Registers a listener callback for asynchronous carrier webhooks/events.
   */
  onEvent(handler: ProviderEventHandler): void;

  /**
   * Dispatches an outbound call attempt through carrier trunk.
   */
  initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse>;

  /**
   * Terminates or cancels an in-flight call (e.g. emergency stop or abandonment).
   */
  terminateCall(providerCallId: string, reason: string): Promise<boolean>;

  /**
   * Health status of telecom provider connection.
   */
  getHealth(): Promise<{ isHealthy: boolean; latencyMs: number; failureRate: number }>;

  /**
   * Allows injecting synthetic event sequences for deterministic chaos testing.
   */
  injectEvent(event: ProviderCallEvent): Promise<void>;
}

