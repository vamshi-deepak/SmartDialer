import {
  ITelecomProvider,
  InitiateCallRequest,
  InitiateCallResponse,
  ProviderCallEvent,
  ProviderEventHandler,
} from './telecom-provider.interface.js';

export interface ReliableMockProviderConfig {
  latencyMs?: number;
  failureRate?: number; // e.g. 0.01
  ringingDelayMs?: number;
  answeredDelayMs?: number;
  connectedDelayMs?: number;
  simulatedTalkDurationMs?: number;
  isSimulated?: boolean;
}

export class ReliableMockProvider implements ITelecomProvider {
  public readonly id = 'reliable-provider';
  public readonly name = 'Reliable Mock Carrier Trunk';

  private readonly eventHandlers: ProviderEventHandler[] = [];
  private readonly activeCalls = new Map<string, InitiateCallRequest>();
  private readonly config: Required<ReliableMockProviderConfig>;
  private callSequence = 0;

  constructor(config?: ReliableMockProviderConfig) {
    this.config = {
      latencyMs: config?.latencyMs ?? 50,
      failureRate: config?.failureRate ?? 0.01,
      ringingDelayMs: config?.ringingDelayMs ?? 100,
      answeredDelayMs: config?.answeredDelayMs ?? 500,
      connectedDelayMs: config?.connectedDelayMs ?? 750,
      simulatedTalkDurationMs: config?.simulatedTalkDurationMs ?? 15000,
      isSimulated: config?.isSimulated ?? false,
    };
  }

  public onEvent(handler: ProviderEventHandler): void {
    this.eventHandlers.push(handler);
  }

  public async initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse> {
    if (this.config.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs));
    }

    if (Math.random() < this.config.failureRate) {
      return {
        providerCallId: `REL-ERR-${++this.callSequence}`,
        status: 'FAILED',
        error: 'Trunk busy or route unavailable',
        timestamp: new Date(),
      };
    }

    const providerCallId = `REL-${++this.callSequence}`;
    this.activeCalls.set(providerCallId, request);

    // In live mode, reliable provider emits asynchronous lifecycle events
    if (!this.config.isSimulated) {
      this.scheduleEvent(providerCallId, request, 'RINGING', this.config.ringingDelayMs);
      this.scheduleEvent(providerCallId, request, 'ANSWERED', this.config.answeredDelayMs);
      this.scheduleEvent(providerCallId, request, 'CONNECTED', this.config.connectedDelayMs);
      this.scheduleEvent(
        providerCallId,
        request,
        'COMPLETED',
        this.config.connectedDelayMs + this.config.simulatedTalkDurationMs
      );
    }

    return {
      providerCallId,
      status: 'QUEUED',
      timestamp: new Date(),
    };
  }

  public async terminateCall(providerCallId: string, _reason: string): Promise<boolean> {
    const request = this.activeCalls.get(providerCallId);
    if (!request) return false;

    this.activeCalls.delete(providerCallId);
    this.scheduleEvent(providerCallId, request, 'CANCELLED', 50);
    return true;
  }

  public async getHealth(): Promise<{ isHealthy: boolean; latencyMs: number; failureRate: number }> {
    return {
      isHealthy: true,
      latencyMs: this.config.latencyMs,
      failureRate: this.config.failureRate,
    };
  }

  public async injectEvent(event: ProviderCallEvent): Promise<void> {
    await this.dispatch(event);
  }

  private scheduleEvent(
    providerCallId: string,
    req: InitiateCallRequest,
    type: 'RINGING' | 'ANSWERED' | 'CONNECTED' | 'COMPLETED' | 'CANCELLED',
    delayMs: number
  ): void {
    setTimeout(async () => {
      const event: ProviderCallEvent = {
        eventId: `EVT-${providerCallId}-${type}-${Date.now()}`,
        providerCallId,
        callId: req.callId,
        campaignId: req.campaignId,
        eventType: type,
        timestamp: new Date(),
      };
      await this.dispatch(event);
      if (type === 'COMPLETED' || type === 'CANCELLED') this.activeCalls.delete(providerCallId);
    }, delayMs);
  }

  private async dispatch(event: ProviderCallEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`[ReliableMockProvider] Error in event handler:`, err);
      }
    }
  }
}
