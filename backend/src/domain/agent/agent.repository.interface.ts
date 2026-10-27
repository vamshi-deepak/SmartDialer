import { Agent, AgentReservationResult, AgentState } from './agent.types.js';

export interface IAgentRepository {
  findById(id: string): Promise<Agent | null>;
  findByCampaign(campaignId: string): Promise<Agent[]>;
  findAvailableAgents(campaignId: string, limit?: number): Promise<Agent[]>;
  countByState(campaignId: string): Promise<Record<AgentState, number>>;
  
  /**
   * Atomically transitions an agent from AVAILABLE to RESERVED using Compare-And-Swap.
   * Ensures two concurrent workers cannot reserve the same agent.
   */
  atomicReserve(
    agentId: string,
    expectedVersion: number,
    leaseExpiresAt: Date
  ): Promise<AgentReservationResult>;

  /**
   * Atomically releases an agent reservation back to AVAILABLE.
   */
  atomicRelease(agentId: string, reason: string): Promise<boolean>;

  /**
   * Updates agent state enforcing state machine rules and updating version.
   */
  updateState(
    agentId: string,
    toState: AgentState,
    reason: string,
    currentCallId?: string | null
  ): Promise<Agent>;
  compareAndSwap(agent: Agent, expectedVersion: number): Promise<boolean>;

  /**
   * Scans for agents whose reservation lease has expired without transitioning to DIALING.
   */
  findStaleReservations(campaignId: string, cutoffTime: Date): Promise<Agent[]>;

  /**
   * Creates or updates an agent entity.
   */
  save(agent: Agent): Promise<Agent>;
}

