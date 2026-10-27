import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAgentRepository } from '../../src/storage/in-memory/in-memory-agent.repository.js';
import { InMemoryBorrowerRepository } from '../../src/storage/in-memory/in-memory-borrower.repository.js';
import { Agent } from '../../src/domain/agent/agent.types.js';
import { Borrower } from '../../src/domain/borrower/borrower.types.js';

describe('Atomic Concurrency & Collision Protection', () => {
  let agentRepo: InMemoryAgentRepository;
  let borrowerRepo: InMemoryBorrowerRepository;

  beforeEach(() => {
    agentRepo = new InMemoryAgentRepository();
    borrowerRepo = new InMemoryBorrowerRepository();
  });

  it('prevents two concurrent workers from reserving the same agent', async () => {
    const agent: Agent = {
      id: 'agent-target-1',
      campaignId: 'camp-1',
      name: 'Agent Smith',
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
    const leaseExpires = new Date(Date.now() + 10000);

    // Simulate concurrent workers executing atomic reservation simultaneously
    const [workerA, workerB] = await Promise.all([
      agentRepo.atomicReserve(agent.id, agent.version, leaseExpires),
      agentRepo.atomicReserve(agent.id, agent.version, leaseExpires),
    ]);

    // Exactly one worker must succeed, and one must fail
    const successes = [workerA, workerB].filter((r) => r.success);
    const failures = [workerA, workerB].filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const saved = await agentRepo.findById(agent.id);
    expect(saved?.state).toBe('RESERVED');
    expect(saved?.version).toBe(2);
  });

  it('prevents two concurrent workers from reserving the same borrower', async () => {
    const borrower: Borrower = {
      id: 'bor-target-1',
      campaignId: 'camp-1',
      name: 'John Doe',
      phoneNumber: '+15551234567',
      debtAmount: 2500,
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
    const leaseExpires = new Date(Date.now() + 10000);

    const [workerA, workerB] = await Promise.all([
      borrowerRepo.atomicReserve(borrower.id, borrower.version, leaseExpires),
      borrowerRepo.atomicReserve(borrower.id, borrower.version, leaseExpires),
    ]);

    const successes = [workerA, workerB].filter((r) => r.success);
    const failures = [workerA, workerB].filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const saved = await borrowerRepo.findById(borrower.id);
    expect(saved?.state).toBe('RESERVED');
    expect(saved?.version).toBe(2);
  });
});

