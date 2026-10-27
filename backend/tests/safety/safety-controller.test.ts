import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryAgentRepository } from '../../src/storage/in-memory/in-memory-agent.repository.js';
import { InMemoryCallRepository } from '../../src/storage/in-memory/in-memory-call.repository.js';
import { CircuitBreaker } from '../../src/safety/circuit-breaker.js';
import { SafetyController } from '../../src/safety/safety-controller.js';
import { Agent } from '../../src/domain/agent/agent.types.js';

describe('SafetyController Independent Gatekeeper', () => {
  let agentRepo: InMemoryAgentRepository;
  let callRepo: InMemoryCallRepository;
  let circuitBreaker: CircuitBreaker;
  let safetyController: SafetyController;

  const campaignId = 'camp-safety-1';

  beforeEach(() => {
    agentRepo = new InMemoryAgentRepository();
    callRepo = new InMemoryCallRepository();
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownPeriodMs: 1000,
      halfOpenSuccessThreshold: 2,
    });
    safetyController = new SafetyController(agentRepo, callRepo, circuitBreaker, {
      globalMaxConcurrentCalls: 10,
      maxOverdialRatio: 2.0,
      minHealthForPredictive: 0.7,
      minAgentsForPredictive: 3,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const seedAgents = async (count: number, state: 'AVAILABLE' | 'CONNECTED' = 'AVAILABLE') => {
    for (let i = 0; i < count; i++) {
      const agent: Agent = {
        id: `agent-${i}`,
        campaignId,
        name: `Agent ${i}`,
        state,
        currentCallId: null,
        version: 1,
        reservationLeaseExpiresAt: null,
        lastStateChangeAt: new Date(),
        stateChangeReason: 'Seeded',
        stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await agentRepo.save(agent);
    }
  };

  it('rejects all dialing if emergency stop is enabled', async () => {
    await seedAgents(5);
    safetyController.setEmergencyStop(true);

    const decision = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 3,
      mode: 'PROGRESSIVE',
    });

    expect(decision.decision).toBe('REJECT');
    expect(decision.approvedCalls).toBe(0);
    expect(decision.reason).toContain('Emergency stop');
  });

  it('rejects dialing when circuit breaker is tripped (OPEN)', async () => {
    await seedAgents(5);
    circuitBreaker.forceOpen('Carrier trunk dropped');

    const decision = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 3,
      mode: 'PROGRESSIVE',
    });

    expect(decision.decision).toBe('REJECT');
    expect(decision.approvedCalls).toBe(0);
    expect(decision.reason).toContain('circuit breaker is OPEN');
  });

  it('caps progressive dialing to available agent count (REDUCE)', async () => {
    await seedAgents(3); // Only 3 agents available

    const decision = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 8, // Requesting 8 calls
      mode: 'PROGRESSIVE',
    });

    expect(decision.decision).toBe('REDUCE');
    expect(decision.approvedCalls).toBe(3); // strictly capped to 3!
  });

  it('enforces global max concurrent call ceiling', async () => {
    await seedAgents(20);

    // Call ceiling is 10
    const decision = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 15,
      mode: 'PROGRESSIVE',
    });

    expect(decision.decision).toBe('REDUCE');
    expect(decision.approvedCalls).toBe(10);
  });

  it('reserves safety headroom across concurrent approvals', async () => {
    await seedAgents(5);

    const [first, second] = await Promise.all([
      safetyController.evaluateDialRequest({
        campaignId,
        requestedCalls: 5,
        mode: 'PROGRESSIVE',
      }),
      safetyController.evaluateDialRequest({
        campaignId,
        requestedCalls: 5,
        mode: 'PROGRESSIVE',
      }),
    ]);

    expect(first.approvedCalls).toBe(5);
    expect(second.approvedCalls).toBe(0);
    safetyController.releaseDecision(first);
  });

  it('rejects forged and reused provider-initiation authorizations', async () => {
    await seedAgents(2);
    const decision = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 1,
      mode: 'PROGRESSIVE',
    });

    expect(safetyController.authorizeProviderInitiation(
      { ...decision, decisionToken: 'forged-token' },
      campaignId
    )).toBe(false);
    expect(safetyController.authorizeProviderInitiation(decision, campaignId)).toBe(true);
    expect(safetyController.authorizeProviderInitiation(decision, campaignId)).toBe(false);
  });

  it('caps approval by campaign-specific concurrency limit', async () => {
    await seedAgents(5);
    const decision = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 5,
      mode: 'PROGRESSIVE',
      campaignMaxConcurrentCalls: 2,
    });

    expect(decision.approvedCalls).toBe(2);
    expect(decision.capacitySnapshot.maxConcurrentCallsCap).toBe(2);
    safetyController.releaseDecision(decision);
  });

  it('rejects while OPEN and permits only one half-open probe before recovery', async () => {
    vi.useFakeTimers();
    await seedAgents(5);
    circuitBreaker.recordFailure('failure-1');
    circuitBreaker.recordFailure('failure-2');
    circuitBreaker.recordFailure('failure-3');

    const openDecision = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 1,
      mode: 'PROGRESSIVE',
    });
    expect(openDecision.approvedCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1001);
    const probe = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 5,
      mode: 'PROGRESSIVE',
    });
    const blockedProbe = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 5,
      mode: 'PROGRESSIVE',
    });
    expect(probe.capacitySnapshot.circuitBreakerState).toBe('HALF_OPEN');
    expect(probe.approvedCalls).toBe(1);
    expect(blockedProbe.approvedCalls).toBe(0);

    expect(safetyController.authorizeProviderInitiation(probe, campaignId)).toBe(true);
    circuitBreaker.recordSuccess();
    safetyController.releaseDecision(probe);
    const secondProbe = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 1,
      mode: 'PROGRESSIVE',
    });
    expect(secondProbe.approvedCalls).toBe(1);
    safetyController.authorizeProviderInitiation(secondProbe, campaignId);
    circuitBreaker.recordSuccess();
    expect(circuitBreaker.getState()).toBe('CLOSED');
    safetyController.releaseDecision(secondProbe);
  });

  it('falls back to Progressive safety when agent pool is too small for predictive variance', async () => {
    await seedAgents(2); // below minAgentsForPredictive (3)

    const decision = await safetyController.evaluateDialRequest({
      campaignId,
      requestedCalls: 5,
      mode: 'PREDICTIVE',
    });

    expect(decision.decision).toBe('FALLBACK_PROGRESSIVE');
    expect(decision.approvedCalls).toBe(2);
  });
});

