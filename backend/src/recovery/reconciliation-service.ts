import { IAgentRepository } from '../domain/agent/agent.repository.interface.js';
import { IBorrowerRepository } from '../domain/borrower/borrower.repository.interface.js';
import { ICallRepository } from '../domain/call/call.repository.interface.js';
import { CallStateMachine } from '../domain/call/call.state-machine.js';
import { ITelecomProvider } from '../providers/telecom-provider.interface.js';

export interface ReconciliationReport {
  timestamp: Date;
  staleAgentsRecovered: number;
  staleBorrowersRecovered: number;
  orphanedCallsCancelled: number;
  agentDropReconciledCalls: number;
  details: string[];
}

export class ReconciliationService {
  constructor(
    private readonly agentRepo: IAgentRepository,
    private readonly borrowerRepo: IBorrowerRepository,
    private readonly callRepo: ICallRepository,
    private readonly provider?: ITelecomProvider
  ) {}

  /**
   * Sweeps the system for expired leases, worker crashes, and orphaned resources.
   * Runs periodically or on-demand after failure scenarios.
   */
  public async reconcile(campaignId: string, now: Date = new Date()): Promise<ReconciliationReport> {
    const details: string[] = [];
    let staleAgentsRecovered = 0;
    let staleBorrowersRecovered = 0;
    let orphanedCallsCancelled = 0;
    let agentDropReconciledCalls = 0;

    // 1. Recover stale Agent reservations (e.g. worker crashed after agent reservation)
    const staleAgents = await this.agentRepo.findStaleReservations(campaignId, now);
    for (const agent of staleAgents) {
      // Check if there is an active call attached
      const activeCall = agent.currentCallId
        ? await this.callRepo.findById(agent.currentCallId)
        : null;

      if (!activeCall || CallStateMachine.isTerminal(activeCall.state)) {
        await this.agentRepo.updateState(
          agent.id,
          'AVAILABLE',
          'Reconciliation: reservation lease expired without active call.',
          null
        );
        staleAgentsRecovered++;
        details.push(`Recovered agent ${agent.id} (lease expired at ${agent.reservationLeaseExpiresAt?.toISOString()}).`);
      }
    }

    // 2. Recover stale Borrower reservations (e.g. worker crashed after borrower reservation)
    const staleBorrowers = await this.borrowerRepo.findStaleReservations(campaignId, now);
    for (const borrower of staleBorrowers) {
      const activeCall = await this.callRepo.findActiveByBorrower(borrower.id);
      if (!activeCall || CallStateMachine.isTerminal(activeCall.state)) {
        await this.borrowerRepo.updateState(borrower.id, 'QUEUED');
        staleBorrowersRecovered++;
        details.push(`Recovered borrower ${borrower.id} back to QUEUED (lease expired).`);
      }
    }

    // 3. Reconcile calls with no lifecycle progress beyond the timeout.
    const staleCutoff = new Date(now.getTime() - 30000);
    const staleCalls = await this.callRepo.findStaleInitiatedCalls(campaignId, staleCutoff);
    for (const call of staleCalls) {
      if (this.provider && call.providerCallId) {
        await this.provider.terminateCall(call.providerCallId, 'Orphaned call timeout in reconciliation');
      }

      const outcome = CallStateMachine.transition(
        call,
        'CANCELLED',
        'Reconciliation: carrier timeout or worker crash during initiation.',
        `RECON-${Date.now()}`
      );
      if (!outcome.applied || !(await this.callRepo.compareAndSwap(outcome.call, call.version))) {
        details.push(`Skipped stale recovery for ${call.id}; call changed while reconciling.`);
        continue;
      }
      orphanedCallsCancelled++;

      // Free associated agent and borrower
      if (call.agentId) {
        const agent = await this.agentRepo.findById(call.agentId);
        if (agent?.state === 'CONNECTED') {
          await this.agentRepo.updateState(call.agentId, 'WRAP_UP', 'Reconciliation cancelled a stale connected call.');
        } else if (agent && (agent.state === 'RESERVED' || agent.state === 'DIALING')) {
          await this.agentRepo.updateState(call.agentId, 'AVAILABLE', 'Reconciliation: associated call was cancelled.', null);
        }
      }
      if (call.borrowerId) {
        await this.borrowerRepo.updateState(call.borrowerId, 'QUEUED', true);
      }
      details.push(`Cancelled orphaned call ${call.id}.`);
    }

    // 4. Reconcile Agent Drop / Disconnection
    // If an agent is in OFFLINE or PAUSED state but has an active non-terminal call attached
    const inFlightCalls = await this.callRepo.findInFlightCalls(campaignId);
    for (const call of inFlightCalls) {
      if (call.agentId) {
        const agent = await this.agentRepo.findById(call.agentId);
        if (!agent || agent.state === 'OFFLINE' || agent.state === 'PAUSED') {
          // Agent vanished or logged off while call was dialing/ringing!
          if (this.provider && call.providerCallId) {
            await this.provider.terminateCall(
              call.providerCallId,
              `Agent ${call.agentId} disappeared during call setup`
            );
          }

          const dropReason = `Agent ${call.agentId} went ${agent?.state ?? 'DISAPPEARED'} during call setup.`;
          const outcome = CallStateMachine.transition(
            call,
            'CANCELLED',
            dropReason,
            `AGENT-DROP-${Date.now()}`,
            { failureReason: dropReason }
          );
          await this.callRepo.save(outcome.call);

          if (call.borrowerId) {
            const borrower = await this.borrowerRepo.findById(call.borrowerId);
            if (borrower) {
              await this.borrowerRepo.updateState(call.borrowerId, 'QUEUED', true);
            }
          }

          agentDropReconciledCalls++;
          details.push(`Reconciled dropped call ${call.id} due to absent agent ${call.agentId}.`);
        }
      }
    }

    return {
      timestamp: now,
      staleAgentsRecovered,
      staleBorrowersRecovered,
      orphanedCallsCancelled,
      agentDropReconciledCalls,
      details,
    };
  }
}
