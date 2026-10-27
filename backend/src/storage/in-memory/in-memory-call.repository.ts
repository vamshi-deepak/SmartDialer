import { Call, CallState } from '../../domain/call/call.types.js';
import { ICallRepository } from '../../domain/call/call.repository.interface.js';
import { CallStateMachine } from '../../domain/call/call.state-machine.js';

export class InMemoryCallRepository implements ICallRepository {
  private readonly calls = new Map<string, Call>();

  public async findById(id: string): Promise<Call | null> {
    const call = this.calls.get(id);
    return call ? { ...call, eventHistory: [...call.eventHistory] } : null;
  }

  public async findByCampaign(campaignId: string): Promise<Call[]> {
    return Array.from(this.calls.values())
      .filter((c) => c.campaignId === campaignId)
      .map((c) => ({ ...c, eventHistory: [...c.eventHistory] }));
  }

  public async findByProviderCallId(providerCallId: string): Promise<Call | null> {
    for (const call of this.calls.values()) {
      if (call.providerCallId === providerCallId) {
        return { ...call, eventHistory: [...call.eventHistory] };
      }
    }
    return null;
  }

  public async findActiveByAgent(agentId: string): Promise<Call | null> {
    for (const call of this.calls.values()) {
      if (call.agentId === agentId && !CallStateMachine.isTerminal(call.state)) {
        return { ...call, eventHistory: [...call.eventHistory] };
      }
    }
    return null;
  }

  public async findActiveByBorrower(borrowerId: string): Promise<Call | null> {
    for (const call of this.calls.values()) {
      if (call.borrowerId === borrowerId && !CallStateMachine.isTerminal(call.state)) {
        return { ...call, eventHistory: [...call.eventHistory] };
      }
    }
    return null;
  }

  public async countActiveCalls(campaignId: string): Promise<number> {
    let count = 0;
    for (const call of this.calls.values()) {
      if (call.campaignId === campaignId && !CallStateMachine.isTerminal(call.state)) {
        count++;
      }
    }
    return count;
  }

  public async countAllActiveCalls(): Promise<number> {
    let count = 0;
    for (const call of this.calls.values()) {
      if (!CallStateMachine.isTerminal(call.state)) count++;
    }
    return count;
  }

  public async countByState(campaignId: string): Promise<Record<CallState, number>> {
    const counts: Record<CallState, number> = {
      QUEUED: 0,
      RESERVED: 0,
      INITIATED: 0,
      RINGING: 0,
      ANSWERED: 0,
      CONNECTED: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
    };

    for (const call of this.calls.values()) {
      if (call.campaignId === campaignId) {
        counts[call.state] = (counts[call.state] ?? 0) + 1;
      }
    }

    return counts;
  }

  public async findInFlightCalls(campaignId: string): Promise<Call[]> {
    return Array.from(this.calls.values())
      .filter(
        (c) =>
          c.campaignId === campaignId &&
          (c.state === 'INITIATED' || c.state === 'RINGING' || c.state === 'ANSWERED')
      )
      .map((c) => ({ ...c, eventHistory: [...c.eventHistory] }));
  }

  public async findStaleInitiatedCalls(campaignId: string, cutoffTime: Date): Promise<Call[]> {
    return Array.from(this.calls.values())
      .filter(
        (c) =>
          c.campaignId === campaignId &&
          (c.state === 'RESERVED' || c.state === 'INITIATED' || c.state === 'RINGING' || c.state === 'ANSWERED' || c.state === 'CONNECTED') &&
          c.updatedAt <= cutoffTime
      )
      .map((c) => ({ ...c, eventHistory: [...c.eventHistory] }));
  }

  public async compareAndSwap(call: Call, expectedVersion: number): Promise<boolean> {
    const current = this.calls.get(call.id);
    if (!current || current.version !== expectedVersion) return false;
    this.calls.set(call.id, { ...call, eventHistory: [...call.eventHistory] });
    return true;
  }

  public async save(call: Call): Promise<Call> {
    this.calls.set(call.id, { ...call, eventHistory: [...call.eventHistory] });
    return { ...call, eventHistory: [...call.eventHistory] };
  }

  public clear(): void {
    this.calls.clear();
  }
}

