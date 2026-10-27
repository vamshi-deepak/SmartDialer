import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAgentRepository } from '../../src/storage/in-memory/in-memory-agent.repository.js';
import { InMemoryBorrowerRepository } from '../../src/storage/in-memory/in-memory-borrower.repository.js';
import { InMemoryCallRepository } from '../../src/storage/in-memory/in-memory-call.repository.js';
import { CircuitBreaker } from '../../src/safety/circuit-breaker.js';
import { SafetyController } from '../../src/safety/safety-controller.js';
import { CallAllocator } from '../../src/allocator/call-allocator.js';
import { ProgressiveDialer } from '../../src/allocator/progressive-dialer.js';
import {
  ITelecomProvider,
  InitiateCallRequest,
  InitiateCallResponse,
  ProviderEventHandler,
  ProviderCallEvent,
} from '../../src/providers/telecom-provider.interface.js';
import { Agent } from '../../src/domain/agent/agent.types.js';
import { Borrower } from '../../src/domain/borrower/borrower.types.js';
import { UnreliableMockProvider } from '../../src/providers/unreliable-mock-provider.js';

class MockTestProvider implements ITelecomProvider {
  readonly id = 'test-mock-provider';
  readonly name = 'Test Mock Provider';
  public shouldFailInitiation = false;
  public initiatedCalls: InitiateCallRequest[] = [];

  onEvent(_handler: ProviderEventHandler): void {}

  async initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse> {
    if (this.shouldFailInitiation) {
      throw new Error('Simulated telecom trunk network timeout');
    }
    this.initiatedCalls.push(request);
    return {
      providerCallId: `prov-${request.callId}`,
      status: 'QUEUED',
      timestamp: new Date(),
    };
  }

  async terminateCall(_providerCallId: string, _reason: string): Promise<boolean> {
    return true;
  }

  async getHealth() {
    return { isHealthy: true, latencyMs: 20, failureRate: 0 };
  }

  async injectEvent(_event: ProviderCallEvent): Promise<void> {}
}

describe('ProgressiveDialer & CallAllocator Invariant Tests', () => {
  let agentRepo: InMemoryAgentRepository;
  let borrowerRepo: InMemoryBorrowerRepository;
  let callRepo: InMemoryCallRepository;
  let circuitBreaker: CircuitBreaker;
  let safetyController: SafetyController;
  let provider: MockTestProvider;
  let allocator: CallAllocator;
  let dialer: ProgressiveDialer;

  const campaignId = 'camp-prog-1';

  beforeEach(() => {
    agentRepo = new InMemoryAgentRepository();
    borrowerRepo = new InMemoryBorrowerRepository();
    callRepo = new InMemoryCallRepository();
    circuitBreaker = new CircuitBreaker();
    safetyController = new SafetyController(agentRepo, callRepo, circuitBreaker, {
      globalMaxConcurrentCalls: 100,
      maxOverdialRatio: 1.0,
      minHealthForPredictive: 0.7,
      minAgentsForPredictive: 3,
    });
    provider = new MockTestProvider();
    allocator = new CallAllocator(
      agentRepo,
      borrowerRepo,
      callRepo,
      safetyController,
      provider,
      15000
    );
    dialer = new ProgressiveDialer(agentRepo, borrowerRepo, safetyController, allocator);
  });

  const setupPool = async (agentCount: number, borrowerCount: number) => {
    for (let i = 0; i < agentCount; i++) {
      const agent: Agent = {
        id: `agent-${i}`,
        campaignId,
        name: `Agent ${i}`,
        state: 'AVAILABLE',
        currentCallId: null,
        version: 1,
        reservationLeaseExpiresAt: null,
        lastStateChangeAt: new Date(),
        stateChangeReason: 'Initial',
        stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await agentRepo.save(agent);
    }

    for (let i = 0; i < borrowerCount; i++) {
      const borrower: Borrower = {
        id: `bor-${i}`,
        campaignId,
        name: `Borrower ${i}`,
        phoneNumber: `+1555000${String(i).padStart(4, '0')}`,
        debtAmount: 1000 + i * 50,
        priority: 1,
        state: 'QUEUED',
        attemptsCount: 0,
        version: 1,
        lastAttemptAt: null,
        reservationLeaseExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await borrowerRepo.save(borrower);
    }
  };

  it('strictly adheres to 1-to-1 progressive invariant: 50 agents initiate exactly 50 calls', async () => {
    await setupPool(50, 100);

    const result = await dialer.executeCycle(campaignId);

    expect(result.attemptedPairs).toBe(50);
    expect(result.successfulCalls).toBe(50);
    expect(provider.initiatedCalls.length).toBe(50);

    const activeCalls = await callRepo.countActiveCalls(campaignId);
    expect(activeCalls).toBe(50);

    const agentCounts = await agentRepo.countByState(campaignId);
    expect(agentCounts.AVAILABLE).toBe(0);
    expect(agentCounts.DIALING).toBe(50);
  });

  it('does not exceed campaign capacity when simultaneous cycles compete', async () => {
    await setupPool(20, 40);

    const results = await Promise.all([
      dialer.executeCycle(campaignId, 1),
      dialer.executeCycle(campaignId, 1),
    ]);

    expect(results.reduce((total, result) => total + result.successfulCalls, 0)).toBe(1);
    expect(provider.initiatedCalls).toHaveLength(1);
    expect(await callRepo.countActiveCalls(campaignId)).toBe(1);
    expect((await borrowerRepo.countByState(campaignId)).QUEUED).toBe(39);
  });

  it('allocates more than 15 calls when eligible agent capacity allows it', async () => {
    await setupPool(20, 30);

    const result = await dialer.executeCycle(campaignId, 50);

    expect(result.successfulCalls).toBe(20);
    expect(provider.initiatedCalls).toHaveLength(20);
  });

  it('unwinds and recovers resources safely if provider throws an initiation failure', async () => {
    await setupPool(1, 1);
    provider.shouldFailInitiation = true; // Carrier trunk failure

    const result = await dialer.executeCycle(campaignId);

    expect(result.successfulCalls).toBe(0);
    expect(result.allocations[0]?.stepFailed).toBe('PROVIDER_INITIATION');

    // Agent must be restored to AVAILABLE, not left stuck in RESERVED or DIALING
    const agent = await agentRepo.findById('agent-0');
    expect(agent?.state).toBe('AVAILABLE');
    expect(agent?.currentCallId).toBeNull();

    // Borrower must be returned to QUEUED with attempt count incremented
    const borrower = await borrowerRepo.findById('bor-0');
    expect(borrower?.state).toBe('QUEUED');
    expect(borrower?.attemptsCount).toBe(1);

    // Call record must record FAILED with carrier error reason
    const calls = await callRepo.findByCampaign(campaignId);
    expect(calls.length).toBe(1);
    expect(calls[0]?.state).toBe('FAILED');
    expect(calls[0]?.failureReason).toContain('trunk network timeout');
  });

  it('does not initiate with a forged safety token and releases its reservations', async () => {
    await setupPool(1, 1);
    const decision = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 1,
      mode: 'PROGRESSIVE',
    });
    const [agent] = await agentRepo.findAvailableAgents(campaignId);
    const [borrower] = await borrowerRepo.findNextEligible(campaignId, 1);
    expect(agent).toBeDefined();
    expect(borrower).toBeDefined();

    const result = await allocator.allocateCall(
      campaignId,
      agent!,
      borrower!,
      { ...decision, decisionToken: 'forged-token' }
    );

    expect(result.success).toBe(false);
    expect(result.stepFailed).toBe('SAFETY');
    expect(provider.initiatedCalls).toHaveLength(0);
    expect((await agentRepo.findById(agent!.id))?.state).toBe('AVAILABLE');
    expect((await borrowerRepo.findById(borrower!.id))?.state).toBe('QUEUED');
    expect(await callRepo.countActiveCalls(campaignId)).toBe(0);
    safetyController.releaseDecision(decision);
  });

  it('opens the breaker on provider outage and does not leave the remaining agent dialing', async () => {
    await setupPool(6, 6);
    const outageProvider = new UnreliableMockProvider({
      latencyMs: 0,
      isOutageActive: true,
      failureRate: 0,
      timeoutRate: 0,
      duplicateEventRate: 0,
      outOfOrderRate: 0,
    });
    const outageAllocator = new CallAllocator(
      agentRepo,
      borrowerRepo,
      callRepo,
      safetyController,
      outageProvider
    );
    const outageDialer = new ProgressiveDialer(agentRepo, borrowerRepo, safetyController, outageAllocator);

    const result = await outageDialer.executeCycle(campaignId, 20);
    const agentCounts = await agentRepo.countByState(campaignId);
    const callCounts = await callRepo.countByState(campaignId);

    expect(safetyController.getCircuitBreaker().getState()).toBe('OPEN');
    expect(result.successfulCalls).toBe(0);
    expect(callCounts.FAILED).toBe(5);
    expect(callCounts.CANCELLED).toBe(1);
    expect(agentCounts.DIALING).toBe(0);
    expect(agentCounts.AVAILABLE).toBe(6);
  });
});

