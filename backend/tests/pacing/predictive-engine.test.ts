import { describe, it, expect } from 'vitest';
import { PredictivePacingEngine } from '../../src/pacing/predictive-engine.js';
import { PacingMetricsInput } from '../../src/pacing/types.js';

describe('PredictivePacingEngine Mathematical Models & Scenarios A-D', () => {
  const engine = new PredictivePacingEngine({
    priorSampleWeight: 10,
    defaultSetupWindowSeconds: 10,
    maxOverdialMultiplier: 2.5,
  });

  it('Scenario A: 20% answer rate, 120s average talk time -> scales calls higher to overcome low answer rate', () => {
    const input: PacingMetricsInput = {
      campaignId: 'scen-a',
      availableAgents: 10,
      reservedAgents: 0,
      dialingAgents: 0,
      connectedAgents: 20,
      activeCalls: 20,
      ringingCalls: 0,
      connectedCalls: 20,
      historicalAnswerRate: 0.2,
      recentTotalCalls: 50,
      recentAnsweredCalls: 10, // 20%
      averageCallDurationSeconds: 120,
      callSetupLatencySeconds: 10,
      providerHealthScore: 1.0,
      maxConcurrentCallsLimit: 50,
    };

    const rec = engine.calculateRecommendation(input);

    expect(rec.recommendedCalls).toBeGreaterThan(10); // Overdials significantly for 20% answer rate
    expect(rec.estimatedAnswerRate).toBeCloseTo(0.2, 1);
    expect(rec.explanation).toContain('recommended');
  });

  it('Scenario B: 50% answer rate, 90s average talk time -> moderate overdialing', () => {
    const input: PacingMetricsInput = {
      campaignId: 'scen-b',
      availableAgents: 10,
      reservedAgents: 0,
      dialingAgents: 0,
      connectedAgents: 10,
      activeCalls: 10,
      ringingCalls: 0,
      connectedCalls: 10,
      historicalAnswerRate: 0.5,
      recentTotalCalls: 40,
      recentAnsweredCalls: 20, // 50%
      averageCallDurationSeconds: 90,
      callSetupLatencySeconds: 8,
      providerHealthScore: 1.0,
      maxConcurrentCallsLimit: 50,
    };

    const rec = engine.calculateRecommendation(input);

    // With 50% answer rate and 10 agents, needs roughly ~20-22 calls
    expect(rec.recommendedCalls).toBeGreaterThanOrEqual(15);
    expect(rec.recommendedCalls).toBeLessThanOrEqual(25);
    expect(rec.estimatedAnswerRate).toBeCloseTo(0.5, 1);
  });

  it('Scenario C: 70% answer rate, 180s average talk time -> conservative dialing to prevent abandoned calls', () => {
    const input: PacingMetricsInput = {
      campaignId: 'scen-c',
      availableAgents: 10,
      reservedAgents: 0,
      dialingAgents: 0,
      connectedAgents: 10,
      activeCalls: 10,
      ringingCalls: 0,
      connectedCalls: 10,
      historicalAnswerRate: 0.7,
      recentTotalCalls: 50,
      recentAnsweredCalls: 35, // 70%
      averageCallDurationSeconds: 180,
      callSetupLatencySeconds: 8,
      providerHealthScore: 1.0,
      maxConcurrentCallsLimit: 50,
    };

    const rec = engine.calculateRecommendation(input);

    // High answer rate requires much lower overdial to avoid burning available agents
    expect(rec.recommendedCalls).toBeLessThanOrEqual(16);
    expect(rec.estimatedAnswerRate).toBeCloseTo(0.7, 1);
  });

  it('Scenario D: provider health deterioration severely dampens recommended calls', () => {
    const healthyInput: PacingMetricsInput = {
      campaignId: 'scen-d-healthy',
      availableAgents: 10,
      reservedAgents: 0,
      dialingAgents: 0,
      connectedAgents: 0,
      activeCalls: 0,
      ringingCalls: 0,
      connectedCalls: 0,
      historicalAnswerRate: 0.3,
      recentTotalCalls: 20,
      recentAnsweredCalls: 6,
      averageCallDurationSeconds: 100,
      callSetupLatencySeconds: 10,
      providerHealthScore: 1.0, // 100% healthy
      maxConcurrentCallsLimit: 50,
    };

    const degradedInput: PacingMetricsInput = {
      ...healthyInput,
      campaignId: 'scen-d-degraded',
      providerHealthScore: 0.3, // Degraded to 30% health
    };

    const healthyRec = engine.calculateRecommendation(healthyInput);
    const degradedRec = engine.calculateRecommendation(degradedInput);

    expect(degradedRec.recommendedCalls).toBeLessThan(healthyRec.recommendedCalls);
    expect(degradedRec.explanation).toContain('dampened');
  });

  it('verifies strict architectural separation: pacing engine lacks provider execution methods', () => {
    // Check that engine has only pure calculation methods and no initiateCall or network capabilities
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(engine));
    expect(methods).not.toContain('initiateCall');
    expect(methods).not.toContain('allocateCall');
    expect(methods).not.toContain('terminateCall');
  });
});

