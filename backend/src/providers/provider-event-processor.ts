import { IAgentRepository } from '../domain/agent/agent.repository.interface.js';
import { IBorrowerRepository } from '../domain/borrower/borrower.repository.interface.js';
import { ICallRepository } from '../domain/call/call.repository.interface.js';
import { CallStateMachine } from '../domain/call/call.state-machine.js';
import { AgentStateMachine } from '../domain/agent/agent.state-machine.js';
import { AgentState } from '../domain/agent/agent.types.js';
import { BorrowerState } from '../domain/borrower/borrower.types.js';
import { CallState } from '../domain/call/call.types.js';
import { ProviderCallEvent } from './telecom-provider.interface.js';

export type EventProcessingStatus =
  | 'APPLIED'
  | 'DUPLICATE_IGNORED'
  | 'STALE_OUT_OF_ORDER'
  | 'TERMINAL_STATE_BLOCKED'
  | 'CALL_NOT_FOUND'
  | 'ERROR';

export interface ProcessedEventAudit {
  eventId: string;
  providerCallId: string;
  callId: string;
  eventType: string;
  status: EventProcessingStatus;
  detail: string;
  timestamp: Date;
}

export class ProviderEventProcessor {
  private readonly processedEventIds = new Set<string>();
  private readonly auditLog: ProcessedEventAudit[] = [];

  constructor(
    private readonly agentRepo: IAgentRepository,
    private readonly borrowerRepo: IBorrowerRepository,
    private readonly callRepo: ICallRepository
  ) {}

  public getAuditHistory(limit = 100): ProcessedEventAudit[] {
    return this.auditLog.slice(-limit);
  }

  /**
   * Idempotently processes a provider webhook event, maintaining call state machine invariants
   * and synchronizing associated agent and borrower state.
   */
  public async processEvent(event: ProviderCallEvent): Promise<ProcessedEventAudit> {
    const recordAudit = (status: EventProcessingStatus, detail: string): ProcessedEventAudit => {
      const entry: ProcessedEventAudit = {
        eventId: event.eventId,
        providerCallId: event.providerCallId,
        callId: event.callId,
        eventType: event.eventType,
        status,
        detail,
        timestamp: new Date(),
      };
      this.auditLog.push(entry);
      return entry;
    };

    // 1. Strict Idempotency Check (Duplicate Event ID)
    if (this.processedEventIds.has(event.eventId)) {
      return recordAudit(
        'DUPLICATE_IGNORED',
        `Event ID '${event.eventId}' has already been processed.`
      );
    }
    // 2. Map Provider Event to Target Call State
    const targetState = this.mapEventTypeToCallState(event.eventType);
    for (let attempt = 0; attempt < 3; attempt++) {
      let call = await this.callRepo.findById(event.callId);
      if (!call && event.providerCallId) {
        call = await this.callRepo.findByProviderCallId(event.providerCallId);
      }
      if (!call) {
        this.processedEventIds.add(event.eventId);
        return recordAudit('CALL_NOT_FOUND', `Call '${event.callId}' not found in call repository.`);
      }

      let outcome;
      try {
        outcome = CallStateMachine.transition(
          call,
          targetState,
          `Carrier event: ${event.eventType}`,
          event.eventId,
          {
            providerCallId: event.providerCallId,
            endedAt: CallStateMachine.isTerminal(targetState) ? event.timestamp : undefined,
          }
        );
      } catch (error) {
        return recordAudit('ERROR', `Invalid provider transition: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!outcome.applied) {
        if (outcome.isTerminalBlocked) return recordAudit('TERMINAL_STATE_BLOCKED', outcome.reason);
          if (outcome.isDuplicate) {
            try {
              await this.synchronizeResources(call, targetState, event);
              this.processedEventIds.add(event.eventId);
              return recordAudit('DUPLICATE_IGNORED', outcome.reason);
            } catch (error) {
              return recordAudit('ERROR', `State already advanced, but resource synchronization failed: ${String(error)}`);
            }
          }
          this.processedEventIds.add(event.eventId);
        return recordAudit('STALE_OUT_OF_ORDER', outcome.reason);
      }

      if (!(await this.callRepo.compareAndSwap(outcome.call, call.version))) continue;

        try {
          await this.synchronizeResources(outcome.call, targetState, event);
          this.processedEventIds.add(event.eventId);
          return recordAudit('APPLIED', outcome.reason);
        } catch (error) {
          return recordAudit('ERROR', `Call state applied, but resource synchronization failed: ${String(error)}`);
        }
    }

    this.processedEventIds.add(event.eventId);
    return recordAudit('ERROR', 'Call changed repeatedly while processing this event; reconciliation is required.');
  }

  private mapEventTypeToCallState(type: string): CallState {
    switch (type) {
      case 'RINGING':
        return 'RINGING';
      case 'ANSWERED':
        return 'ANSWERED';
      case 'CONNECTED':
        return 'CONNECTED';
      case 'COMPLETED':
        return 'COMPLETED';
      case 'CANCELLED':
        return 'CANCELLED';
      case 'FAILED':
      case 'BUSY':
      case 'NO_ANSWER':
        return 'FAILED';
      default:
        return 'FAILED';
    }
  }

  private async synchronizeResources(
    call: import('../domain/call/call.types.js').Call,
    newState: CallState,
    event: ProviderCallEvent
  ): Promise<void> {
    const { agentId, borrowerId } = call;

    if (newState === 'ANSWERED' || newState === 'CONNECTED') {
      if (agentId) {
        const agent = await this.agentRepo.findById(agentId);
        if (agent && (agent.state === 'DIALING' || agent.state === 'RESERVED')) {
          await this.transitionAgent(agentId, 'CONNECTED', `Call answered and bridged (${event.eventType}).`, call.id);
        }
      }
      if (borrowerId) await this.transitionBorrower(borrowerId, 'CONNECTED');
    } else if (newState === 'COMPLETED') {
      if (agentId) {
        const agent = await this.agentRepo.findById(agentId);
        if (agent?.state === 'CONNECTED') {
          await this.transitionAgent(agentId, 'WRAP_UP', 'Call completed normally; entering wrap-up.');
        } else if (agent && (agent.state === 'DIALING' || agent.state === 'RESERVED')) {
          await this.transitionAgent(agentId, 'AVAILABLE', 'Call completed before connection.', null);
        }
      }
      if (borrowerId) await this.transitionBorrower(borrowerId, 'COMPLETED');
    } else if (newState === 'CANCELLED') {
      if (agentId) {
        const agent = await this.agentRepo.findById(agentId);
        if (agent?.state === 'CONNECTED') {
          await this.transitionAgent(agentId, 'WRAP_UP', 'Call cancelled after connection.');
        } else if (agent && (agent.state === 'DIALING' || agent.state === 'RESERVED')) {
          await this.transitionAgent(agentId, 'AVAILABLE', 'Call cancelled before connection.', null);
        }
      }
      if (borrowerId) await this.transitionBorrower(borrowerId, 'QUEUED');
    } else if (newState === 'FAILED') {
      if (agentId) {
        const agent = await this.agentRepo.findById(agentId);
        if (agent?.state === 'CONNECTED') {
          await this.transitionAgent(agentId, 'WRAP_UP', `Call failed after connection (${event.eventType}).`);
        } else if (agent && (agent.state === 'DIALING' || agent.state === 'RESERVED')) {
          await this.transitionAgent(agentId, 'AVAILABLE', `Call failed (${event.eventType}).`, null);
        }
      }
      if (borrowerId) await this.transitionBorrower(borrowerId, 'QUEUED', true);
      }
  }

  private async transitionAgent(
    agentId: string,
    toState: AgentState,
    reason: string,
    currentCallId?: string | null
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.agentRepo.findById(agentId);
      if (!current || current.state === toState) return;
      const updated = AgentStateMachine.transition(current, toState, reason, currentCallId);
      if (await this.agentRepo.compareAndSwap(updated, current.version)) return;
    }
    throw new Error(`Agent ${agentId} changed repeatedly during event synchronization.`);
  }

  private async transitionBorrower(
    borrowerId: string,
    toState: BorrowerState,
    incrementAttempt = false
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.borrowerRepo.findById(borrowerId);
      if (!current || current.state === toState) return;
      const now = new Date();
      const updated = {
        ...current,
        state: toState,
        attemptsCount: current.attemptsCount + (incrementAttempt ? 1 : 0),
        lastAttemptAt: incrementAttempt ? now : current.lastAttemptAt,
        reservationLeaseExpiresAt: toState === 'RESERVED' ? current.reservationLeaseExpiresAt : null,
        version: current.version + 1,
        updatedAt: now,
      };
      if (await this.borrowerRepo.compareAndSwap(updated, current.version)) return;
    }
    throw new Error(`Borrower ${borrowerId} changed repeatedly during event synchronization.`);
  }
}
