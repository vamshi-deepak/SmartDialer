import { randomUUID } from 'node:crypto';
import { Agent } from '../domain/agent/agent.types.js';
import { IAgentRepository } from '../domain/agent/agent.repository.interface.js';
import { Borrower } from '../domain/borrower/borrower.types.js';
import { IBorrowerRepository } from '../domain/borrower/borrower.repository.interface.js';
import { Call } from '../domain/call/call.types.js';
import { ICallRepository } from '../domain/call/call.repository.interface.js';
import { CallStateMachine } from '../domain/call/call.state-machine.js';
import { ITelecomProvider } from '../providers/telecom-provider.interface.js';
import { SafetyController } from '../safety/safety-controller.js';
import { SafetyDecision } from '../safety/safety.types.js';

export interface AllocationResult {
  success: boolean;
  call?: Call;
  agent?: Agent;
  borrower?: Borrower;
  error?: string;
  stepFailed?: 'SAFETY' | 'AGENT_RESERVATION' | 'BORROWER_RESERVATION' | 'CALL_CREATION' | 'PROVIDER_INITIATION';
}

export class CallAllocator {
  constructor(
    private readonly agentRepo: IAgentRepository,
    private readonly borrowerRepo: IBorrowerRepository,
    private readonly callRepo: ICallRepository,
    private readonly safetyController: SafetyController,
    private readonly provider: ITelecomProvider,
    private readonly leaseDurationMs: number = 15000
  ) {}

  /**
   * Orchestrates safe, atomic call allocation across Agent, Borrower, Safety, and Provider.
   * Employs strict two-phase atomic reservation with immediate rollback on partial failure.
   */
  public async allocateCall(
    campaignId: string,
    agent: Agent,
    borrower: Borrower,
    safetyDecision: SafetyDecision
  ): Promise<AllocationResult> {
    if (safetyDecision.decision === 'REJECT' || safetyDecision.approvedCalls <= 0) {
      return {
        success: false,
        stepFailed: 'SAFETY',
        error: `Safety controller rejected dialing: ${safetyDecision.reason}`,
      };
    }

    const leaseExpiresAt = new Date(Date.now() + this.leaseDurationMs);

    // 2. Phase 1: Atomically reserve Agent
    const agentReservation = await this.agentRepo.atomicReserve(
      agent.id,
      agent.version,
      leaseExpiresAt
    );

    if (!agentReservation.success || !agentReservation.agent) {
      return {
        success: false,
        stepFailed: 'AGENT_RESERVATION',
        error: agentReservation.error ?? 'Failed to reserve agent atomically.',
      };
    }

    const reservedAgent = agentReservation.agent;

    // 3. Phase 2: Atomically reserve Borrower
    const borrowerReservation = await this.borrowerRepo.atomicReserve(
      borrower.id,
      borrower.version,
      leaseExpiresAt
    );

    if (!borrowerReservation.success || !borrowerReservation.borrower) {
      // Partial failure: unwind Agent reservation immediately
      await this.agentRepo.atomicRelease(
        reservedAgent.id,
        'Borrower reservation failed; releasing agent back to AVAILABLE.'
      );

      return {
        success: false,
        stepFailed: 'BORROWER_RESERVATION',
        error: borrowerReservation.error ?? 'Failed to reserve borrower atomically.',
      };
    }

    const reservedBorrower = borrowerReservation.borrower;
    const callId = `CALL-${randomUUID()}`;

    // 4. Phase 3: Create initial Call record in RESERVED state
    const newCall: Call = {
      id: callId,
      campaignId,
      borrowerId: reservedBorrower.id,
      agentId: reservedAgent.id,
      providerId: this.provider.id,
      providerCallId: null,
      state: 'RESERVED',
      version: 1,
      queuedAt: reservedBorrower.createdAt,
      reservedAt: new Date(),
      initiatedAt: null,
      ringingAt: null,
      answeredAt: null,
      connectedAt: null,
      endedAt: null,
      durationSeconds: 0,
      failureReason: null,
      eventHistory: [
        {
          eventId: randomUUID(),
          eventType: 'RESERVED',
          fromState: 'QUEUED',
          toState: 'RESERVED',
          timestamp: new Date(),
          reason: 'Call matched with agent and borrower.',
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.callRepo.save(newCall);

    // 5. Phase 4: Transition Agent to DIALING and Call to INITIATED
    const dialingAgent = await this.agentRepo.updateState(
      reservedAgent.id,
      'DIALING',
      'Outbound call initiation in flight',
      callId
    );

    const transitionOutcome = CallStateMachine.transition(
      newCall,
      'INITIATED',
      'Dispatched to telecom provider carrier',
      randomUUID(),
      { agentId: dialingAgent.id, providerId: this.provider.id }
    );
    const initiatedCall = await this.callRepo.save(transitionOutcome.call);

    // 6. Phase 5: Invoke Telecom Provider
    try {
      if (!this.safetyController.authorizeProviderInitiation(safetyDecision, campaignId)) {
        const cancelOutcome = CallStateMachine.transition(
          initiatedCall,
          'CANCELLED',
          'Safety authorization became invalid before provider initiation.',
          randomUUID()
        );
        await this.callRepo.save(cancelOutcome.call);
        const releasedAgent = await this.agentRepo.updateState(
          dialingAgent.id,
          'AVAILABLE',
          'Safety authorization failed before provider initiation.',
          null
        );
        const releasedBorrower = await this.borrowerRepo.updateState(reservedBorrower.id, 'QUEUED');
        return {
          success: false,
          stepFailed: 'SAFETY',
          error: 'Safety Controller authorization is invalid, exhausted, expired, or no longer safe.',
          call: cancelOutcome.call,
          agent: releasedAgent,
          borrower: releasedBorrower,
        };
      }

      const response = await this.provider.initiateCall({
        callId: initiatedCall.id,
        campaignId,
        borrowerPhoneNumber: reservedBorrower.phoneNumber,
        borrowerName: reservedBorrower.name,
        agentId: dialingAgent.id,
      });

      if (response.status === 'REJECTED' || response.status === 'FAILED') {
        throw new Error(response.error ?? `Provider returned ${response.status}`);
      }

      // Record success in Circuit Breaker
      this.safetyController.getCircuitBreaker().recordSuccess();

      // Update call record with carrier call ID
      const callWithProviderId = await this.attachProviderCallId(initiatedCall.id, response.providerCallId);

      return {
        success: true,
        call: callWithProviderId ?? initiatedCall,
        agent: dialingAgent,
        borrower: reservedBorrower,
      };
    } catch (providerError: unknown) {
      const errorMsg =
        providerError instanceof Error ? providerError.message : String(providerError);

      // Record failure on circuit breaker
      this.safetyController.getCircuitBreaker().recordFailure(errorMsg);

      // Handle Provider Initiation Failure gracefully
      const failOutcome = CallStateMachine.transition(
        initiatedCall,
        'FAILED',
        `Provider initiation error: ${errorMsg}`,
        randomUUID(),
        { failureReason: errorMsg, endedAt: new Date() }
      );
      await this.callRepo.save(failOutcome.call);

      // Release Agent back to AVAILABLE immediately
      const releasedAgent = await this.agentRepo.updateState(
        dialingAgent.id,
        'AVAILABLE',
        `Carrier initiation failed (${errorMsg}); returned to available pool.`
      );

      // Release Borrower back to QUEUED, incrementing attempt counter
      const releasedBorrower = await this.borrowerRepo.updateState(
        reservedBorrower.id,
        'QUEUED',
        true
      );

      return {
        success: false,
        stepFailed: 'PROVIDER_INITIATION',
        error: errorMsg,
        call: failOutcome.call,
        agent: releasedAgent,
        borrower: releasedBorrower,
      };
    }
  }

  private async attachProviderCallId(callId: string, providerCallId: string): Promise<Call | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.callRepo.findById(callId);
      if (!current) return null;
      if (current.providerCallId === providerCallId) return current;
      const updated: Call = {
        ...current,
        providerCallId,
        version: current.version + 1,
        updatedAt: new Date(),
      };
      if (await this.callRepo.compareAndSwap(updated, current.version)) return updated;
    }
    return this.callRepo.findById(callId);
  }
}

