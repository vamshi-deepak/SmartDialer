import { PacingMetricsInput, PacingRecommendation } from './types.js';

export interface PredictiveEngineConfig {
  priorSampleWeight: number; // weight of prior in Laplace smoothing (default 10)
  defaultSetupWindowSeconds: number; // expected seconds until dial answers (default 10)
  maxOverdialMultiplier: number; // hard ceiling on overdial relative to available agents (default 2.5)
}

export class PredictivePacingEngine {
  constructor(
    private readonly config: PredictiveEngineConfig = {
      priorSampleWeight: 10,
      defaultSetupWindowSeconds: 10,
      maxOverdialMultiplier: 2.5,
    }
  ) {}

  /**
   * Generates a deterministic, explainable pacing recommendation based on Erlang/turnover queuing principles.
   * NOTE: This engine does NOT have provider initiation access. It produces read-only recommendations.
   */
  public calculateRecommendation(input: PacingMetricsInput): PacingRecommendation {
    const assumptions: string[] = [];

    // 1. Calculate Smoothed Answer Rate (Bayesian Laplace smoothing)
    // Prevents wild overdial swings on small recent samples
    const alpha = input.historicalAnswerRate * this.config.priorSampleWeight;
    const totalSample = input.recentTotalCalls + this.config.priorSampleWeight;
    const answeredSample = input.recentAnsweredCalls + alpha;
    const smoothedAnswerRate = Math.min(0.95, Math.max(0.05, answeredSample / totalSample));

    assumptions.push(
      `Answer rate smoothed to ${(smoothedAnswerRate * 100).toFixed(1)}% ` +
        `combining ${input.recentTotalCalls} recent samples with prior ${input.historicalAnswerRate * 100}%.`
    );

    // 2. Estimate Agent Turnover (Freeing Capacity) during Call Setup Window
    // During the setup latency window (t_setup), some connected agents will wrap up their calls
    const setupWindow = Math.max(
      4,
      input.callSetupLatencySeconds || this.config.defaultSetupWindowSeconds
    );
    const avgDuration = Math.max(30, input.averageCallDurationSeconds);
    const turnoverRatePerSecond = 1 / avgDuration;
    const expectedTurnoverAgents = input.connectedCalls * turnoverRatePerSecond * setupWindow;

    assumptions.push(
      `Expected ${expectedTurnoverAgents.toFixed(1)} connected agents to complete calls ` +
        `during ${setupWindow}s setup window (avg talk time: ${avgDuration}s).`
    );

    // 3. Calculate Total Available Agent Capacity for Incoming Pickups
    const effectiveAgentCapacity = Math.max(
      0,
      input.availableAgents + expectedTurnoverAgents - input.reservedAgents
    );

    // 4. In-Flight Ringing Calls Expected to Answer
    const expectedAnswersFromInFlight = input.ringingCalls * smoothedAnswerRate;
    assumptions.push(
      `${input.ringingCalls} calls currently ringing are projected to yield ${expectedAnswersFromInFlight.toFixed(1)} answers.`
    );

    // 5. Net Capacity Needed
    const netAgentNeed = Math.max(0, effectiveAgentCapacity - expectedAnswersFromInFlight);

    // 6. Base Call Recommendation to satisfy net agent need
    let rawRecommendedCalls = netAgentNeed / smoothedAnswerRate;

    // 7. Provider Health Dampening
    // If provider health deteriorates or circuit is shaky, scale down dialing aggression
    const healthDampener = Math.min(1.0, Math.max(0.1, input.providerHealthScore));
    if (healthDampener < 0.9) {
      rawRecommendedCalls *= healthDampener;
      assumptions.push(
        `Provider health is ${(input.providerHealthScore * 100).toFixed(0)}%; dampened dialing rate by ${((1 - healthDampener) * 100).toFixed(0)}%.`
      );
    }

    // 8. Ceiling Bounds & Physical Headroom
    const maxAllowedByHeadroom = Math.max(
      0,
      input.maxConcurrentCallsLimit - input.activeCalls
    );

    // Cap overdial multiplier: never recommend more than 2.5x current available agents in one burst
    const agentMultiplierCap = Math.ceil(
      Math.max(1, input.availableAgents) * this.config.maxOverdialMultiplier
    );

    let finalRecommendation = Math.floor(rawRecommendedCalls);
    finalRecommendation = Math.min(finalRecommendation, maxAllowedByHeadroom, agentMultiplierCap);
    finalRecommendation = Math.max(0, finalRecommendation);

    const expectedAnswers = Math.round(finalRecommendation * smoothedAnswerRate);

    const healthNote =
      healthDampener < 0.9
        ? ` (dampened due to carrier health: ${(input.providerHealthScore * 100).toFixed(0)}%)`
        : '';

    const explanation =
      `Based on ${input.availableAgents} available agents, ${expectedTurnoverAgents.toFixed(1)} expected wrap-ups, ` +
      `and ${(smoothedAnswerRate * 100).toFixed(1)}% answer rate, recommended ${finalRecommendation} calls ` +
      `to yield ~${expectedAnswers} answered calls without exceeding headroom (${maxAllowedByHeadroom})${healthNote}.`;

    return {
      campaignId: input.campaignId,
      recommendedCalls: finalRecommendation,
      estimatedAnswerRate: smoothedAnswerRate,
      expectedAdditionalAnswers: expectedAnswers,
      availableAgentCapacity: effectiveAgentCapacity,
      currentRingingAndConnectedCalls: input.ringingCalls + input.connectedCalls,
      providerHealth: input.providerHealthScore,
      explanation,
      assumptionsOrLimitations: assumptions,
      calculatedAt: new Date(),
    };
  }
}
