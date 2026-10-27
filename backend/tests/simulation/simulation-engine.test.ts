import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../../src/simulation/simulation-engine.js';
import { SimulationScenarioConfig } from '../../src/simulation/scenarios.js';

describe('Deterministic SimulationEngine Reproducibility & Invariant Verification', () => {
  const simEngine = new SimulationEngine();

  const testConfig: SimulationScenarioConfig = {
    id: 'SIM-TEST-REPRO',
    name: 'Reproducibility Test',
    description: 'Verifies exact seed matching',
    dialingMode: 'PROGRESSIVE',
    agentCount: 10,
    borrowerCount: 40,
    ticks: 15,
    tickDurationMs: 10,
    targetAnswerRate: 0.40,
    averageTalkDurationTicks: 5,
    providerType: 'reliable',
    seed: 777,
  };

  it('produces 100% identical timeline and call results when executed with the same seed', async () => {
    const run1 = await simEngine.runScenario(testConfig);
    const run2 = await simEngine.runScenario(testConfig);

    expect(run1.totalCallsInitiated).toBe(run2.totalCallsInitiated);
    expect(run1.totalCallsAnswered).toBe(run2.totalCallsAnswered);
    expect(run1.totalCallsCompleted).toBe(run2.totalCallsCompleted);
    expect(run1.effectiveAnswerRate).toBe(run2.effectiveAnswerRate);
    expect(run1.timeline).toEqual(run2.timeline);
    expect(run1.invariantViolationsCount).toBe(0);
    expect(run2.invariantViolationsCount).toBe(0);
  });

  it('guarantees progressive invariant holds across all ticks (activeCalls <= eligibleAgents)', async () => {
    const result = await simEngine.runScenario(testConfig);

    expect(result.invariantViolationsCount).toBe(0);
    for (const snap of result.timeline) {
      const eligible = snap.availableAgents + snap.dialingAgents + snap.connectedAgents;
      if (eligible > 0) {
        expect(snap.activeCalls).toBeLessThanOrEqual(eligible);
      }
    }
  });
});

