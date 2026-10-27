import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAgentRepository } from '../../src/storage/in-memory/in-memory-agent.repository.js';
import { InMemoryBorrowerRepository } from '../../src/storage/in-memory/in-memory-borrower.repository.js';
import { InMemoryCallRepository } from '../../src/storage/in-memory/in-memory-call.repository.js';
import { ReconciliationService } from '../../src/recovery/reconciliation-service.js';
import { Agent } from '../../src/domain/agent/agent.types.js';
import { Borrower } from '../../src/domain/borrower/borrower.types.js';
import { Call } from '../../src/domain/call/call.types.js';

describe('ReconciliationService Worker Crash & Disconnection Recovery', () => {
  let agentRepo: InMemoryAgentRepository;
  let borrowerRepo: InMemoryBorrowerRepository;
  let callRepo: InMemoryCallRepository;
  let reconciliationService: ReconciliationService;

  const campaignId = 'camp-recon-1';

  beforeEach(() => {
    agentRepo = new InMemoryAgentRepository();
    borrowerRepo = new InMemoryBorrowerRepository();
    callRepo = new InMemoryCallRepository();
    reconciliationService = new ReconciliationService(agentRepo, borrowerRepo, callRepo);
  });

  it('recovers agent reservation when worker crashes after reservation and lease expires', async () => {
    const expiredTime = new Date(Date.now() - 5000); // Expired 5 seconds ago
    const agent: Agent = {
      id: 'agent-stuck',
      campaignId,
      name: 'Stuck Agent',
      state: 'RESERVED',
      currentCallId: null,
      version: 2,
      reservationLeaseExpiresAt: expiredTime,
      lastStateChangeAt: expiredTime,
      stateChangeReason: 'Worker crashed before call creation',
      stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await agentRepo.save(agent);

    const report = await reconciliationService.reconcile(campaignId, new Date());

    expect(report.staleAgentsRecovered).toBe(1);

    const recoveredAgent = await agentRepo.findById('agent-stuck');
    expect(recoveredAgent?.state).toBe('AVAILABLE');
    expect(recoveredAgent?.reservationLeaseExpiresAt).toBeNull();
  });

  it('recovers borrower stuck in RESERVED when worker crashes before call creation', async () => {
    const expiredTime = new Date(Date.now() - 5000);
    const borrower: Borrower = {
      id: 'bor-stuck',
      campaignId,
      name: 'Stuck Borrower',
      phoneNumber: '+15558881234',
      debtAmount: 800,
      priority: 1,
      state: 'RESERVED',
      attemptsCount: 0,
      version: 2,
      lastAttemptAt: null,
      reservationLeaseExpiresAt: expiredTime,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await borrowerRepo.save(borrower);

    const report = await reconciliationService.reconcile(campaignId, new Date());

    expect(report.staleBorrowersRecovered).toBe(1);

    const recoveredBorrower = await borrowerRepo.findById('bor-stuck');
    expect(recoveredBorrower?.state).toBe('QUEUED');
  });

  it('cancels a stale initiated call after a worker crash and releases its agent', async () => {
    const staleAt = new Date(Date.now() - 60000);
    const agent: Agent = {
      id: 'agent-crashed-initiation', campaignId, name: 'Crashed Initiation', state: 'DIALING',
      currentCallId: 'call-crashed-initiation', version: 3, reservationLeaseExpiresAt: null,
      lastStateChangeAt: staleAt, stateChangeReason: 'Worker stopped after initiation',
      stats: { callsHandled: 0, totalTalkTimeSeconds: 0 }, createdAt: staleAt, updatedAt: staleAt,
    };
    const borrower: Borrower = {
      id: 'borrower-crashed-initiation', campaignId, name: 'Crashed Initiation',
      phoneNumber: '+15550000031', debtAmount: 500, priority: 1, state: 'DIALING',
      attemptsCount: 1, version: 2, lastAttemptAt: staleAt, reservationLeaseExpiresAt: null,
      createdAt: staleAt, updatedAt: staleAt,
    };
    const call: Call = {
      id: 'call-crashed-initiation', campaignId, borrowerId: borrower.id, agentId: agent.id,
      providerId: 'reliable-provider', providerCallId: 'provider-stale-init', state: 'INITIATED',
      version: 2, queuedAt: staleAt, reservedAt: staleAt, initiatedAt: staleAt, ringingAt: null,
      answeredAt: null, connectedAt: null, endedAt: null, durationSeconds: 0, failureReason: null,
      eventHistory: [], createdAt: staleAt, updatedAt: staleAt,
    };
    await agentRepo.save(agent);
    await borrowerRepo.save(borrower);
    await callRepo.save(call);

    const report = await reconciliationService.reconcile(campaignId);

    expect(report.orphanedCallsCancelled).toBe(1);
    expect((await callRepo.findById(call.id))?.state).toBe('CANCELLED');
    expect((await agentRepo.findById(agent.id))?.state).toBe('AVAILABLE');
    expect((await borrowerRepo.findById(borrower.id))?.state).toBe('QUEUED');
  });

  it('moves an agent to wrap-up when a connected call is recovered as stale', async () => {
    const staleAt = new Date(Date.now() - 60000);
    const agent: Agent = {
      id: 'agent-crashed-connected', campaignId, name: 'Crashed Connected', state: 'CONNECTED',
      currentCallId: 'call-crashed-connected', version: 4, reservationLeaseExpiresAt: null,
      lastStateChangeAt: staleAt, stateChangeReason: 'Worker stopped while connected',
      stats: { callsHandled: 0, totalTalkTimeSeconds: 0 }, createdAt: staleAt, updatedAt: staleAt,
    };
    const borrower: Borrower = {
      id: 'borrower-crashed-connected', campaignId, name: 'Crashed Connected',
      phoneNumber: '+15550000032', debtAmount: 500, priority: 1, state: 'CONNECTED',
      attemptsCount: 1, version: 3, lastAttemptAt: staleAt, reservationLeaseExpiresAt: null,
      createdAt: staleAt, updatedAt: staleAt,
    };
    const call: Call = {
      id: 'call-crashed-connected', campaignId, borrowerId: borrower.id, agentId: agent.id,
      providerId: 'reliable-provider', providerCallId: 'provider-stale-connected', state: 'CONNECTED',
      version: 4, queuedAt: staleAt, reservedAt: staleAt, initiatedAt: staleAt, ringingAt: staleAt,
      answeredAt: staleAt, connectedAt: staleAt, endedAt: null, durationSeconds: 0,
      failureReason: null, eventHistory: [], createdAt: staleAt, updatedAt: staleAt,
    };
    await agentRepo.save(agent);
    await borrowerRepo.save(borrower);
    await callRepo.save(call);

    const report = await reconciliationService.reconcile(campaignId);

    expect(report.orphanedCallsCancelled).toBe(1);
    expect((await callRepo.findById(call.id))?.state).toBe('CANCELLED');
    expect((await agentRepo.findById(agent.id))?.state).toBe('WRAP_UP');
    expect((await borrowerRepo.findById(borrower.id))?.state).toBe('QUEUED');
  });

  it('handles agent availability drop: cancels in-flight call if agent disconnects (OFFLINE) mid-setup', async () => {
    const agentId = 'agent-disappeared';
    const callId = 'call-in-flight-drop';

    // Agent disconnected (went OFFLINE)
    const agent: Agent = {
      id: agentId,
      campaignId,
      name: 'Agent Offline',
      state: 'OFFLINE',
      currentCallId: callId,
      version: 3,
      reservationLeaseExpiresAt: null,
      lastStateChangeAt: new Date(),
      stateChangeReason: 'Network dropped / logged off',
      stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await agentRepo.save(agent);

    // Call is still ringing/initiated
    const call: Call = {
      id: callId,
      campaignId,
      borrowerId: 'bor-drop-1',
      agentId,
      providerId: 'reliable',
      providerCallId: 'prov-drop-1',
      state: 'RINGING',
      version: 2,
      queuedAt: new Date(),
      reservedAt: new Date(),
      initiatedAt: new Date(),
      ringingAt: new Date(),
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

    const report = await reconciliationService.reconcile(campaignId, new Date());

    expect(report.agentDropReconciledCalls).toBe(1);

    const cancelledCall = await callRepo.findById(callId);
    expect(cancelledCall?.state).toBe('CANCELLED');
    expect(cancelledCall?.failureReason).toContain('OFFLINE');
  });
});

