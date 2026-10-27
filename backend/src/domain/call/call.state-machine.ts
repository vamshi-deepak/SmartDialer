import { Call, CallState, CallEventRecord } from './call.types.js';

export class InvalidCallTransitionError extends Error {
  constructor(
    public readonly callId: string,
    public readonly fromState: CallState,
    public readonly toState: CallState,
    public readonly reason: string
  ) {
    super(
      `Invalid call transition for call ${callId}: cannot transition from '${fromState}' to '${toState}'. Reason: ${reason}`
    );
    this.name = 'InvalidCallTransitionError';
  }
}

export interface TransitionOutcome {
  call: Call;
  applied: boolean;
  reason: string;
  isTerminalBlocked?: boolean;
  isDuplicate?: boolean;
}

export class CallStateMachine {
  public static readonly TERMINAL_STATES: ReadonlySet<CallState> = new Set<CallState>([
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]);

  private static readonly ALLOWED_TRANSITIONS: Record<CallState, readonly CallState[]> = {
    QUEUED: ['RESERVED', 'CANCELLED'],
    RESERVED: ['INITIATED', 'CANCELLED', 'FAILED'],
    INITIATED: ['RINGING', 'ANSWERED', 'CONNECTED', 'FAILED', 'CANCELLED', 'COMPLETED'],
    RINGING: ['ANSWERED', 'CONNECTED', 'FAILED', 'CANCELLED', 'COMPLETED'],
    ANSWERED: ['CONNECTED', 'FAILED', 'CANCELLED', 'COMPLETED'],
    CONNECTED: ['COMPLETED', 'FAILED', 'CANCELLED'],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
  };

  public static isTerminal(state: CallState): boolean {
    return this.TERMINAL_STATES.has(state);
  }

  public static canTransition(from: CallState, to: CallState): boolean {
    const allowed = this.ALLOWED_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Evaluates and applies a state transition to a call.
   * Tolerant of duplicate and out-of-order events:
   * - Terminal states are NEVER overwritten.
   * - Duplicate transitions are recognized and safely ignored without error.
   * - Stale out-of-order events are recorded as no-ops.
   */
  public static transition(
    call: Call,
    toState: CallState,
    reason: string,
    eventId: string,
    metadata?: {
      agentId?: string | null;
      providerId?: string | null;
      providerCallId?: string | null;
      failureReason?: string | null;
      endedAt?: Date;
    }
  ): TransitionOutcome {
    const now = new Date();

    // 1. Terminal state check: terminal states are absorbing and immutable
    if (this.isTerminal(call.state)) {
      return {
        call,
        applied: false,
        reason: `Ignored: Call ${call.id} is already in terminal state '${call.state}'. Cannot transition to '${toState}'.`,
        isTerminalBlocked: true,
      };
    }

    // 2. Duplicate state check
    if (call.state === toState) {
      return {
        call,
        applied: false,
        reason: `Ignored duplicate event: Call ${call.id} is already in state '${toState}'.`,
        isDuplicate: true,
      };
    }

    // 3. Natural progression validity check
    if (!this.canTransition(call.state, toState)) {
      // Check if this is an out-of-order backward transition (e.g. RINGING received after ANSWERED)
      const statePrecedence: Record<CallState, number> = {
        QUEUED: 0,
        RESERVED: 1,
        INITIATED: 2,
        RINGING: 3,
        ANSWERED: 4,
        CONNECTED: 5,
        COMPLETED: 6,
        FAILED: 6,
        CANCELLED: 6,
      };

      const currentPrecedence = statePrecedence[call.state] ?? 0;
      const targetPrecedence = statePrecedence[toState] ?? 0;

      if (targetPrecedence <= currentPrecedence) {
        return {
          call,
          applied: false,
          reason: `Ignored stale/out-of-order event: Call ${call.id} in state '${call.state}' received earlier event '${toState}'.`,
        };
      }

      throw new InvalidCallTransitionError(call.id, call.state, toState, reason);
    }

    // 4. Construct updated call with accurate timestamps
    const historyEntry: CallEventRecord = {
      eventId,
      eventType: `TRANSITION_TO_${toState}`,
      fromState: call.state,
      toState,
      timestamp: now,
      reason,
      payload: metadata ? { ...metadata } : undefined,
    };

    let answeredAt = call.answeredAt;
    let connectedAt = call.connectedAt;
    let endedAt = call.endedAt;
    let initiatedAt = call.initiatedAt;
    let ringingAt = call.ringingAt;
    let durationSeconds = call.durationSeconds;

    if (toState === 'INITIATED' && !initiatedAt) initiatedAt = now;
    if (toState === 'RINGING' && !ringingAt) ringingAt = now;
    if (toState === 'ANSWERED' && !answeredAt) answeredAt = now;
    if (toState === 'CONNECTED' && !connectedAt) connectedAt = now;
    if (this.isTerminal(toState)) {
      endedAt = metadata?.endedAt ?? now;
      const startTime = connectedAt ?? answeredAt ?? initiatedAt;
      if (startTime) {
        durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startTime.getTime()) / 1000));
      }
    }

    const updatedCall: Call = {
      ...call,
      state: toState,
      version: call.version + 1,
      agentId: metadata?.agentId !== undefined ? metadata.agentId : call.agentId,
      providerId: metadata?.providerId !== undefined ? metadata.providerId : call.providerId,
      providerCallId:
        metadata?.providerCallId !== undefined ? metadata.providerCallId : call.providerCallId,
      failureReason:
        metadata?.failureReason !== undefined ? metadata.failureReason : call.failureReason,
      initiatedAt,
      ringingAt,
      answeredAt,
      connectedAt,
      endedAt,
      durationSeconds,
      eventHistory: [...call.eventHistory, historyEntry],
      updatedAt: now,
    };

    return {
      call: updatedCall,
      applied: true,
      reason: `Successfully transitioned from ${call.state} to ${toState}: ${reason}`,
    };
  }
}

