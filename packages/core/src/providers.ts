import type { Call, ProviderEvent } from "./domain.js";

export type ProviderEventSink = (event: ProviderEvent) => Promise<void>;

export interface ProviderAdapter {
  readonly id: string;
  initiate(call: Call): Promise<void>;
  cancel(callId: string): Promise<void>;
  isOutage(): boolean;
  setOutage(enabled: boolean): void;
}

export interface MockProviderOptions {
  seed: number;
  latencyMs: number;
  failureRate: number;
  duplicateRate: number;
  outOfOrderRate: number;
  outage?: boolean;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
}

export class MockProvider implements ProviderAdapter {
  private readonly random: SeededRandom;
  private outage: boolean;
  private sequence = 0;

  constructor(
    readonly id: string,
    private readonly options: MockProviderOptions,
    private readonly sink: ProviderEventSink
  ) {
    this.random = new SeededRandom(options.seed);
    this.outage = options.outage ?? false;
  }

  async initiate(call: Call): Promise<void> {
    if (this.outage || this.random.next() < this.options.failureRate) {
      throw new Error(this.outage ? "Provider outage" : "Simulated provider initiation failure");
    }
    const now = Date.now();
    const events: ProviderEvent[] = [
      this.event(call.id, "RINGING", now + this.options.latencyMs),
      this.event(call.id, "ANSWERED", now + this.options.latencyMs + 30),
      this.event(call.id, "COMPLETED", now + this.options.latencyMs + 100)
    ];
    if (this.random.next() < this.options.outOfOrderRate) events.reverse();
    for (const event of events) {
      void this.deliverLater(event, Math.max(10, event.at - now));
      if (this.random.next() < this.options.duplicateRate) {
        void this.deliverLater(event, Math.max(20, event.at - now + 5));
      }
    }
  }

  async cancel(callId: string): Promise<void> {
    await this.sink(this.event(callId, "CANCELLED", Date.now(), "Cancelled by safety controller"));
  }

  isOutage(): boolean {
    return this.outage;
  }

  setOutage(enabled: boolean): void {
    this.outage = enabled;
  }

  inject(callId: string, types: ProviderEvent["type"][]): Promise<void>[] {
    return types.map((type) => this.sink(this.event(callId, type, Date.now(), "Manually injected event")));
  }

  private event(callId: string, type: ProviderEvent["type"], at: number, reason?: string): ProviderEvent {
    this.sequence += 1;
    return {
      id: `${this.id}-event-${this.sequence}`,
      providerId: this.id,
      callId,
      type,
      at,
      ...(reason ? { reason } : {})
    };
  }

  private async deliverLater(event: ProviderEvent, delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    await this.sink(event);
  }
}

export function createReliableProvider(seed: number, sink: ProviderEventSink): MockProvider {
  return new MockProvider("reliable", { seed, latencyMs: 40, failureRate: 0.01, duplicateRate: 0.01, outOfOrderRate: 0.01 }, sink);
}

export function createUnreliableProvider(seed: number, sink: ProviderEventSink): MockProvider {
  return new MockProvider("unreliable", { seed, latencyMs: 180, failureRate: 0.15, duplicateRate: 0.25, outOfOrderRate: 0.3 }, sink);
}