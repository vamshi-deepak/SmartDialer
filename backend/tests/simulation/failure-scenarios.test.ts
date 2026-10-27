import { describe, it, expect, beforeAll } from 'vitest';
import { createContainer, ServiceContainer } from '../../src/container.js';
import { FailureScenarioRunner } from '../../src/simulation/failure-scenarios.js';

describe('FailureScenarioRunner Invariant & Chaos Tests', () => {
  let container: ServiceContainer;
  let runner: FailureScenarioRunner;
  let campaignId: string;

  beforeAll(async () => {
    container = await createContainer('in-memory');
    const camp = await container.campaignManager.createCampaign('Failure Test Campaign');
    campaignId = camp.id;
    runner = new FailureScenarioRunner(container);
  });

  it('handles WORKER_CRASH_RESERVATION: reclaims orphaned agent and borrower locks', async () => {
    const report = await runner.runScenario('WORKER_CRASH_RESERVATION', campaignId);
    expect(report.invariantsMaintained, JSON.stringify(report.finalState)).toBe(true);
    expect(report.finalState.agentState).toBe('AVAILABLE');
    expect(report.finalState.borrowerState).toBe('QUEUED');
  });

  it('handles DUPLICATE_EVENTS: rejects duplicate webhook without double counting', async () => {
    const report = await runner.runScenario('DUPLICATE_EVENTS', campaignId);
    expect(report.invariantsMaintained).toBe(true);
    expect(report.finalState.duplicateStatuses).toContain('DUPLICATE_IGNORED');
    expect((report.finalState.duplicateStatuses as string[]).filter((status) => status === 'APPLIED')).toHaveLength(1);
  });

  it('handles OUT_OF_ORDER_EVENTS: blocks stale event arriving after COMPLETED', async () => {
    const report = await runner.runScenario('OUT_OF_ORDER_EVENTS', campaignId);
    expect(report.invariantsMaintained).toBe(true);
    expect(report.finalState.finalState).toBe('COMPLETED');
  });

  it('handles PROVIDER_OUTAGE: trips the circuit and leaves no dialing agents', async () => {
    const report = await runner.runScenario('PROVIDER_OUTAGE', campaignId);
    expect(report.invariantsMaintained, JSON.stringify(report.finalState)).toBe(true);
    expect(report.finalState.circuitBreakerState).toBe('OPEN');
    expect(report.finalState.agentsStillDialing).toBe(0);
    expect(report.recoveryReport.failures).toBeGreaterThanOrEqual(5);
  });

  it('handles AGENT_DROP: drops 40 of 100 agents and limits approval to remaining capacity', async () => {
    const report = await runner.runScenario('AGENT_DROP', campaignId);
    expect(report.invariantsMaintained).toBe(true);
    expect(report.finalState.droppedAgentCount).toBe(40);
    expect(report.finalState.eligibleAgentsAfterDrop).toBe(60);
    expect(report.finalState.approvedCalls).toBeLessThanOrEqual(60);
  });
});

