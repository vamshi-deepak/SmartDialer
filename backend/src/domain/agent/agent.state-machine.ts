import { Agent, AgentState } from './agent.types.js';

export class InvalidAgentTransitionError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly fromState: AgentState,
    public readonly toState: AgentState,
    public readonly reason: string
  ) {
    super(
      `Invalid agent transition for agent ${agentId}: cannot transition from '${fromState}' to '${toState}'. Reason: ${reason}`
    );
    this.name = 'InvalidAgentTransitionError';
  }
}

export class AgentStateMachine {
  /**
   * Transition graph defining permitted transitions.
   */
  private static readonly ALLOWED_TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
    OFFLINE: ['AVAILABLE'],
    AVAILABLE: ['RESERVED', 'PAUSED', 'OFFLINE'],
    RESERVED: ['DIALING', 'AVAILABLE', 'OFFLINE'], // AVAILABLE on rollback/lease expiry
    DIALING: ['CONNECTED', 'WRAP_UP', 'AVAILABLE', 'OFFLINE'], // WRAP_UP or AVAILABLE on call failure/busy
    CONNECTED: ['WRAP_UP', 'OFFLINE'], // Call ended by either party
    WRAP_UP: ['AVAILABLE', 'PAUSED', 'OFFLINE'], // Agent completes wrap-up
    PAUSED: ['AVAILABLE', 'OFFLINE'],
  };

  /**
   * Check if a transition is allowed by the lifecycle state machine.
   */
  public static canTransition(from: AgentState, to: AgentState): boolean {
    const allowed = this.ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Execute state transition with strict invariant checks.
   */
  public static transition(
    agent: Agent,
    toState: AgentState,
    reason: string,
    currentCallId?: string | null
  ): Agent {
    if (!this.canTransition(agent.state, toState)) {
      throw new InvalidAgentTransitionError(agent.id, agent.state, toState, reason);
    }

    // Invariant: Only AVAILABLE agents can transition to RESERVED
    if (toState === 'RESERVED' && agent.state !== 'AVAILABLE') {
      throw new InvalidAgentTransitionError(
        agent.id,
        agent.state,
        toState,
        'Only AVAILABLE agents can be reserved'
      );
    }

    // Invariant: An agent can own at most ONE active call
    let nextCallId: string | null = agent.currentCallId;
    if (toState === 'RESERVED' || toState === 'DIALING' || toState === 'CONNECTED') {
      if (currentCallId !== undefined) {
        nextCallId = currentCallId;
      }
    } else if (toState === 'AVAILABLE' || toState === 'OFFLINE' || toState === 'PAUSED') {
      nextCallId = null;
    }

    const now = new Date();

    return {
      ...agent,
      state: toState,
      currentCallId: nextCallId,
      version: agent.version + 1,
      reservationLeaseExpiresAt:
        toState === 'RESERVED' ? agent.reservationLeaseExpiresAt : null,
      lastStateChangeAt: now,
      stateChangeReason: reason,
      updatedAt: now,
    };
  }
}

