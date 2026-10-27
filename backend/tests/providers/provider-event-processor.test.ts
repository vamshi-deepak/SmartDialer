import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAgentRepository } from '../../src/storage/in-memory/in-memory-agent.repository.js';
import { InMemoryBorrowerRepository } from '../../src/storage/in-memory/in-memory-borrower.repository.js';
import { InMemoryCallRepository } from '../../src/storage/in-memory/in-memory-call.repository.js';
import { ProviderEventProcessor } from '../../src/providers/provider-event-processor.js';
import { Agent } from '../../src/domain/agent/agent.types.js';
import { Borrower } from '../../src/domain/borrower/borrower.types.js';
import { Call } from '../../src/domain/call/call.types.js';
import { ProviderCallEvent } from '../../src/providers/telecom-provider.interface.js';
import { ReliableMockProvider } from '../../src/providers/reliable-mock-provider.js';

describe('ProviderEventProcessor Idempotency & Resource Sync', () => {
  let agentRepo: InMemoryAgentRepository;
  let borrowerRepo: InMemoryBorrowerRepository;
  let callRepo: InMemoryCallRepository;
  let eventProcessor: ProviderEventProcessor;

  const campaignId = 'camp-pep-1';
  const callId = 'call-test-sync';
  const agentId = 'agent-sync-1';
  const borrowerId = 'bor-sync-1';

  beforeEach(async () => {
    agentRepo = new InMemoryAgentRepository();
    borrowerRepo = new InMemoryBorrowerRepository();
    callRepo = new InMemoryCallRepository();
    eventProcessor = new ProviderEventProcessor(agentRepo, borrowerRepo, callRepo);

    const agent: Agent = {
      id: agentId,
      campaignId,
      name: 'Agent Sync',
      state: 'DIALING',
      currentCallId: callId,
      version: 2,
      reservationLeaseExpiresAt: null,
      lastStateChangeAt: new Date(),
      stateChangeReason: 'Dialing',
      stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await agentRepo.save(agent);

    const borrower: Borrower = {
      id: borrowerId,
      campaignId,
      name: 'Borrower Sync',
      phoneNumber: '+15559990000',
      debtAmount: 500,
      priority: 1,
      state: 'RESERVED',
      attemptsCount: 1,
      version: 2,
      lastAttemptAt: new Date(),
      reservationLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await borrowerRepo.save(borrower);

    const call: Call = {
      id: callId,
      campaignId,
      borrowerId,
      agentId,
      providerId: 'reliable',
      providerCallId: 'prov-sync-1',
      state: 'INITIATED',
      version: 2,
      queuedAt: new Date(),
      reservedAt: new Date(),
      initiatedAt: new Date(),
      ringingAt: null,
      answeredAt: null,
      connectedAt: null,
      endedAt: null,
      durationSeconds: 0,
      failureReason: null,
      eventHistory: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await callRepo.save(call);
  });

  it('safely ignores duplicate provider event with identical eventId', async () => {
    const event: ProviderCallEvent = {
      eventId: 'evt-unique-101',
      providerCallId: 'prov-sync-1',
      callId,
      campaignId,
      eventType: 'RINGING',
      timestamp: new Date(),
    };

    const first = await eventProcessor.processEvent(event);
    expect(first.status).toBe('APPLIED');

    const duplicate = await eventProcessor.processEvent(event);
    expect(duplicate.status).toBe('DUPLICATE_IGNORED');
  });

  it('applies concurrent duplicate ANSWERED events and resource side effects only once', async () => {
    const event: ProviderCallEvent = {
      eventId: 'evt-concurrent-answer',
      providerCallId: 'prov-sync-1',
      callId,
      campaignId,
      eventType: 'ANSWERED',
      timestamp: new Date(),
    };
    const [first, second] = await Promise.all([
      eventProcessor.processEvent(event),
      eventProcessor.processEvent(event),
    ]);

    expect([first.status, second.status].sort()).toEqual(['APPLIED', 'DUPLICATE_IGNORED']);
    expect((await callRepo.findById(callId))?.version).toBe(3);
    expect((await agentRepo.findById(agentId))?.version).toBe(3);
    expect((await borrowerRepo.findById(borrowerId))?.version).toBe(3);
  });

  it('cancels an initiated call and returns its agent and borrower safely', async () => {
    const audit = await eventProcessor.processEvent({
      eventId: 'evt-cancel-initiated',
      providerCallId: 'prov-sync-1',
      callId,
      campaignId,
      eventType: 'CANCELLED',
      timestamp: new Date(),
    });

    expect(audit.status).toBe('APPLIED');
    expect((await callRepo.findById(callId))?.state).toBe('CANCELLED');
    expect((await agentRepo.findById(agentId))?.state).toBe('AVAILABLE');
    expect((await borrowerRepo.findById(borrowerId))?.state).toBe('QUEUED');
  });

  it('persists RINGING, ANSWERED, CONNECTED, then delayed COMPLETED states', async () => {
    const provider = new ReliableMockProvider({
      latencyMs: 0,
      failureRate: 0,
      ringingDelayMs: 5,
      answeredDelayMs: 10,
      connectedDelayMs: 15,
      simulatedTalkDurationMs: 50,
    });
    provider.onEvent(async (event) => { await eventProcessor.processEvent(event); });

    await provider.initiateCall({
      callId,
      campaignId,
      borrowerPhoneNumber: '+15559990000',
      borrowerName: 'Borrower Sync',
      agentId,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    let call = await callRepo.findById(callId);
    expect(call?.state).toBe('CONNECTED');
    expect((await agentRepo.findById(agentId))?.state).toBe('CONNECTED');
    expect((await borrowerRepo.findById(borrowerId))?.state).toBe('CONNECTED');

    await new Promise((resolve) => setTimeout(resolve, 50));
    call = await callRepo.findById(callId);
    expect(call?.state).toBe('COMPLETED');
    expect(call?.eventHistory.map((entry) => entry.toState)).toContain('CONNECTED');
    expect((await agentRepo.findById(agentId))?.state).toBe('WRAP_UP');
    expect((await borrowerRepo.findById(borrowerId))?.state).toBe('COMPLETED');
  });

  it('blocks out-of-order stale events arriving after call COMPLETED', async () => {
    // 1. Advance call to ANSWERED
    await eventProcessor.processEvent({
      eventId: 'evt-ans',
      providerCallId: 'prov-sync-1',
      callId,
      campaignId,
      eventType: 'ANSWERED',
      timestamp: new Date(),
    });

    // 2. Call completes normally
    await eventProcessor.processEvent({
      eventId: 'evt-comp',
      providerCallId: 'prov-sync-1',
      callId,
      campaignId,
      eventType: 'COMPLETED',
      timestamp: new Date(),
    });

    const completedCall = await callRepo.findById(callId);
    expect(completedCall?.state).toBe('COMPLETED');

    // 3. Late duplicate or retransmitted ANSWERED arrives
    const lateAnswer = await eventProcessor.processEvent({
      eventId: 'evt-late-ans',
      providerCallId: 'prov-sync-1',
      callId,
      campaignId,
      eventType: 'ANSWERED',
      timestamp: new Date(),
    });

    expect(lateAnswer.status).toBe('TERMINAL_STATE_BLOCKED');

    // Call state remains COMPLETED
    const callAfter = await callRepo.findById(callId);
    expect(callAfter?.state).toBe('COMPLETED');
  });

  it('synchronizes agent and borrower states on call ANSWERED and COMPLETED', async () => {
    // ANSWERED event: agent should move to CONNECTED
    await eventProcessor.processEvent({
      eventId: 'evt-sync-ans',
      providerCallId: 'prov-sync-1',
      callId,
      campaignId,
      eventType: 'ANSWERED',
      timestamp: new Date(),
    });

    let agent = await agentRepo.findById(agentId);
    let borrower = await borrowerRepo.findById(borrowerId);
    expect(agent?.state).toBe('CONNECTED');
    expect(borrower?.state).toBe('CONNECTED');

    // COMPLETED event: agent enters WRAP_UP, borrower marks COMPLETED
    await eventProcessor.processEvent({
      eventId: 'evt-sync-comp',
      providerCallId: 'prov-sync-1',
      callId,
      campaignId,
      eventType: 'COMPLETED',
      timestamp: new Date(),
    });

    agent = await agentRepo.findById(agentId);
    borrower = await borrowerRepo.findById(borrowerId);
    expect(agent?.state).toBe('WRAP_UP');
    expect(borrower?.state).toBe('COMPLETED');
  });
});

