import type { Campaign, ProviderHealth } from "./domain.js";
import { activeCallStates, type AgentState, type CallState } from "./domain.js";

export interface PacingSnapshot {
  campaign: Campaign;
  agentStates: AgentState[];
  callStates: CallState[];
  answerCount: number;
  completedCount: number;
  recentAnswers: number;
  recentCalls: number;
  averageDurationMs: number;
  averageSetupLatencyMs: number;
  providerFailureRate: number;
  providerHealth: ProviderHealth;
}

export interface PacingRecommendation {
  recommendedAdditionalCalls: number;
  estimatedAnswerRate: number;
  expectedAdditionalAnswers: number;
  availableAgentCapacity: number;
  currentRinging: number;
  currentConnected: number;
  providerHealth: ProviderHealth;
  explanation: string;
  assumptions: string[];
}

export function recommendCalls(snapshot: PacingSnapshot): PacingRecommendation {
  const { campaign } = snapshot;
  const sampleSize = Math.max(0, snapshot.completedCount);
  const priorN = campaign.config.priorSampleSize;
  const rate = (snapshot.answerCount + campaign.config.priorAnswerRate * priorN) / Math.max(1, sampleSize + priorN);
  const available = snapshot.agentStates.filter((state) => state === "AVAILABLE").length;
  const reserved = snapshot.agentStates.filter((state) => state === "RESERVED" || state === "DIALING").length;
  const ringing = snapshot.callStates.filter((state) => state === "RINGING").length;
  const connected = snapshot.callStates.filter((state) => state === "CONNECTED" || state === "ANSWERED").length;
  const active = snapshot.callStates.filter((state) => activeCallStates.includes(state)).length;
  const concurrencyRoom = Math.max(0, campaign.config.maxConcurrentCalls - active);
  const confidenceFactor = sampleSize < 10 ? 0.5 : sampleSize < 30 ? 0.75 : 1;
  const healthFactor = snapshot.providerHealth === "CLOSED" ? 1 : snapshot.providerHealth === "HALF_OPEN" ? 0.25 : 0;
  const reliabilityFactor = Math.max(0, 1 - snapshot.providerFailureRate * 2);
  const targetUtilization = Math.max(0, campaign.config.targetConcurrent - connected - ringing - reserved);
  const proposal = Math.floor(Math.min(available, concurrencyRoom, targetUtilization) * confidenceFactor * healthFactor * reliabilityFactor);
  const recommendedAdditionalCalls = Math.max(0, proposal);
  const assumptions = [
    `Smoothed rate uses ${campaign.config.priorSampleSize} prior observations at ${(campaign.config.priorAnswerRate * 100).toFixed(0)}%.`,
    `Recommendation is limited by available agents, the concurrent-call cap, and target concurrency.`,
    `Average talk time ${Math.round(snapshot.averageDurationMs / 1000)}s and setup latency ${Math.round(snapshot.averageSetupLatencyMs)}ms are descriptive; they are not guarantees.`
  ];
  const explanation = `Eligible now: ${available}; active calls: ${active}; safe headroom: ${concurrencyRoom}; provider factor: ${healthFactor.toFixed(2)}; confidence factor: ${confidenceFactor.toFixed(2)}. The conservative proposal is ${recommendedAdditionalCalls}.`;
  return {
    recommendedAdditionalCalls,
    estimatedAnswerRate: rate,
    expectedAdditionalAnswers: Number((recommendedAdditionalCalls * rate).toFixed(2)),
    availableAgentCapacity: available,
    currentRinging: ringing,
    currentConnected: connected,
    providerHealth: snapshot.providerHealth,
    explanation,
    assumptions
  };
}
