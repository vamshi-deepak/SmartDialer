import { Agent, AgentReservationResult, AgentState } from '../../domain/agent/agent.types.js';
import { AgentStateMachine } from '../../domain/agent/agent.state-machine.js';
import { IAgentRepository } from '../../domain/agent/agent.repository.interface.js';

export class InMemoryAgentRepository implements IAgentRepository {
  private readonly agents = new Map<string, Agent>();
  // Synchronous lock/mutex map to model atomic hardware CAS operations in Node's event loop
  private readonly lockSet = new Set<string>();

  public async findById(id: string): Promise<Agent | null> {
    const agent = this.agents.get(id);
    return agent ? { ...agent } : null;
  }

  public async findByCampaign(campaignId: string): Promise<Agent[]> {
    return Array.from(this.agents.values())
      .filter((a) => a.campaignId === campaignId)
      .map((a) => ({ ...a }));
  }

  public async findAvailableAgents(campaignId: string, limit?: number): Promise<Agent[]> {
    const list = Array.from(this.agents.values())
      .filter((a) => a.campaignId === campaignId && a.state === 'AVAILABLE')
      .map((a) => ({ ...a }));
    return limit ? list.slice(0, limit) : list;
  }

  public async countByState(campaignId: string): Promise<Record<AgentState, number>> {
    const counts: Record<AgentState, number> = {
      OFFLINE: 0,
      AVAILABLE: 0,
      RESERVED: 0,
      DIALING: 0,
      CONNECTED: 0,
      WRAP_UP: 0,
      PAUSED: 0,
    };

    for (const agent of this.agents.values()) {
      if (agent.campaignId === campaignId) {
        counts[agent.state] = (counts[agent.state] ?? 0) + 1;
      }
    }

    return counts;
  }

  /**
   * Atomic Compare-and-Swap (CAS) reservation.
   * Simulates MongoDB's findOneAndUpdate({ _id, state: 'AVAILABLE', version: expectedVersion })
   */
  public async atomicReserve(
    agentId: string,
    expectedVersion: number,
    leaseExpiresAt: Date
  ): Promise<AgentReservationResult> {
    // Acquire CAS lock for this agent record
    if (this.lockSet.has(agentId)) {
      return {
        success: false,
        error: `Agent ${agentId} is locked by another concurrent worker.`,
      };
    }
    this.lockSet.add(agentId);

    try {
      const current = this.agents.get(agentId);
      if (!current) {
        return { success: false, error: `Agent ${agentId} not found.` };
      }

      if (current.state !== 'AVAILABLE') {
        return {
          success: false,
          error: `Agent ${agentId} is in state '${current.state}', expected 'AVAILABLE'.`,
        };
      }

      if (current.version !== expectedVersion) {
        return {
          success: false,
          error: `Agent ${agentId} version mismatch. Expected ${expectedVersion}, found ${current.version}.`,
        };
      }

      const updated = AgentStateMachine.transition(current, 'RESERVED', 'Atomic dialer reservation');
      updated.reservationLeaseExpiresAt = leaseExpiresAt;
      this.agents.set(agentId, updated);

      return {
        success: true,
        agent: { ...updated },
        leaseExpiresAt,
      };
    } finally {
      this.lockSet.delete(agentId);
    }
  }

  public async atomicRelease(agentId: string, reason: string): Promise<boolean> {
    if (this.lockSet.has(agentId)) {
      return false;
    }
    this.lockSet.add(agentId);

    try {
      const current = this.agents.get(agentId);
      if (!current) return false;

      if (current.state === 'RESERVED' || current.state === 'DIALING') {
        const released = AgentStateMachine.transition(current, 'AVAILABLE', reason, null);
        this.agents.set(agentId, released);
        return true;
      }
      return false;
    } finally {
      this.lockSet.delete(agentId);
    }
  }

  public async updateState(
    agentId: string,
    toState: AgentState,
    reason: string,
    currentCallId?: string | null
  ): Promise<Agent> {
    const current = this.agents.get(agentId);
    if (!current) {
      throw new Error(`Agent ${agentId} not found.`);
    }

    const updated = AgentStateMachine.transition(current, toState, reason, currentCallId);
    this.agents.set(agentId, updated);
    return { ...updated };
  }

  public async compareAndSwap(agent: Agent, expectedVersion: number): Promise<boolean> {
    const current = this.agents.get(agent.id);
    if (!current || current.version !== expectedVersion) return false;
    if (!AgentStateMachine.canTransition(current.state, agent.state) && current.state !== agent.state) return false;
    this.agents.set(agent.id, { ...agent });
    return true;
  }

  public async findStaleReservations(campaignId: string, cutoffTime: Date): Promise<Agent[]> {
    return Array.from(this.agents.values())
      .filter(
        (a) =>
          a.campaignId === campaignId &&
          a.state === 'RESERVED' &&
          a.reservationLeaseExpiresAt !== null &&
          a.reservationLeaseExpiresAt <= cutoffTime
      )
      .map((a) => ({ ...a }));
  }

  public async save(agent: Agent): Promise<Agent> {
    this.agents.set(agent.id, { ...agent });
    return { ...agent };
  }

  public clear(): void {
    this.agents.clear();
    this.lockSet.clear();
  }
}

