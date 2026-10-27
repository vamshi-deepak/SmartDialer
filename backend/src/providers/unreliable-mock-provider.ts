import {
  ITelecomProvider,
  InitiateCallRequest,
  InitiateCallResponse,
  ProviderCallEvent,
  ProviderEventHandler,
  ProviderEventType,
} from './telecom-provider.interface.js';

export interface UnreliableMockProviderConfig {
  latencyMs?: number;
  failureRate?: number; // e.g. 0.20
  timeoutRate?: number; // e.g. 0.10
  duplicateEventRate?: number; // e.g. 0.15
  outOfOrderRate?: number; // e.g. 0.15
  ringingDelayMs?: number;
  answeredDelayMs?: number;
  connectedDelayMs?: number;
  simulatedTalkDurationMs?: number;
  isOutageActive?: boolean;
  seed?: number;
  isSimulated?: boolean;
}

export class UnreliableMockProvider implements ITelecomProvider {
  public readonly id = 'unreliable-provider';
  public readonly name = 'Unreliable Mock Carrier Trunk';

  private readonly eventHandlers: ProviderEventHandler[] = [];
  private readonly activeCalls = new Map<string, InitiateCallRequest>();
  private readonly config: Required<UnreliableMockProviderConfig>;
  private callSequence = 0;
  private rngState: number;

  constructor(config?: UnreliableMockProviderConfig) {
    this.config = {
      latencyMs: config?.latencyMs ?? 200,
      failureRate: config?.failureRate ?? 0.15,
      timeoutRate: config?.timeoutRate ?? 0.08,
      duplicateEventRate: config?.duplicateEventRate ?? 0.15,
      outOfOrderRate: config?.outOfOrderRate ?? 0.15,
      ringingDelayMs: config?.ringingDelayMs ?? 150,
      answeredDelayMs: config?.answeredDelayMs ?? 350,
      connectedDelayMs: config?.connectedDelayMs ?? 700,
      simulatedTalkDurationMs: config?.simulatedTalkDurationMs ?? 15000,
      isOutageActive: config?.isOutageActive ?? false,
      seed: config?.seed ?? 42,
      isSimulated: config?.isSimulated ?? false,
    };
    this.rngState = this.config.seed;
  }

  /**
   * Deterministic Mulberry32 PRNG
   */
  private nextRandom(): number {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public setOutage(active: boolean): void {
    this.config.isOutageActive = active;
  }

  public get outageActive(): boolean {
    return this.config.isOutageActive;
  }

  public onEvent(handler: ProviderEventHandler): void {
    this.eventHandlers.push(handler);
  }

  public async initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse> {
    if (this.config.isOutageActive) {
      return {
        providerCallId: `UNR-OUT-${++this.callSequence}`,
        status: 'FAILED',
        error: 'Carrier Major Outage: No upstream routes available (503 Service Unavailable)',
        timestamp: new Date(),
      };
    }

    if (this.config.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs));
    }

    // Simulate carrier timeout
    if (this.nextRandom() < this.config.timeoutRate) {
      return {
        providerCallId: `UNR-TO-${++this.callSequence}`,
        status: 'FAILED',
        error: 'SIP Trunk Request Timeout (408)',
        timestamp: new Date(),
      };
    }

    // Simulate carrier trunk rejection
    if (this.nextRandom() < this.config.failureRate) {
      return {
        providerCallId: `UNR-FAIL-${++this.callSequence}`,
        status: 'REJECTED',
        error: 'Circuit busy / congestion (504)',
        timestamp: new Date(),
      };
    }

    const providerCallId = `UNR-${++this.callSequence}`;
    this.activeCalls.set(providerCallId, request);

    // Chaos event generation: duplicates and out-of-order dispatch
    const shouldShuffle = this.nextRandom() < this.config.outOfOrderRate;
    const shouldDuplicate = this.nextRandom() < this.config.duplicateEventRate;

    const eventsToEmit: { type: ProviderEventType; delay: number }[] = shouldShuffle
      ? [
          { type: 'ANSWERED', delay: Math.min(200, this.config.answeredDelayMs) },
          { type: 'RINGING', delay: Math.max(350, this.config.ringingDelayMs) }, // Out-of-order!
        ]
      : [
          { type: 'RINGING', delay: this.config.ringingDelayMs },
          { type: 'ANSWERED', delay: this.config.answeredDelayMs },
        ];

    eventsToEmit.push(
      { type: 'CONNECTED', delay: this.config.connectedDelayMs },
      { type: 'COMPLETED', delay: this.config.connectedDelayMs + this.config.simulatedTalkDurationMs }
    );

    if (shouldDuplicate) {
      eventsToEmit.push({ type: 'ANSWERED', delay: 400 }); // Duplicate ANSWERED!
    }

    if (!this.config.isSimulated) {
      for (const item of eventsToEmit) {
        this.scheduleEvent(providerCallId, request, item.type, item.delay);
      }
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
    const isHealthy = !this.config.isOutageActive;
    return {
      isHealthy,
      latencyMs: this.config.latencyMs,
      failureRate: this.config.isOutageActive
        ? 1.0
        : this.config.failureRate + this.config.timeoutRate,
    };
  }

  public async injectEvent(event: ProviderCallEvent): Promise<void> {
    await this.dispatch(event);
  }

  private scheduleEvent(
    providerCallId: string,
    req: InitiateCallRequest,
    type: ProviderEventType,
    delayMs: number
  ): void {
    setTimeout(async () => {
      const event: ProviderCallEvent = {
        eventId: `CHAOS-${providerCallId}-${type}-${Date.now()}-${Math.floor(this.nextRandom() * 10000)}`,
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
        console.error(`[UnreliableMockProvider] Error in event handler:`, err);
      }
    }
  }
}
