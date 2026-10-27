import type { Campaign, SafetyDecision } from "./domain.js";
import { activeCallStates } from "./domain.js";
import { MemoryStore } from "./store.js";

export interface SafetyContext {
  providerHealth: "CLOSED" | "OPEN" | "HALF_OPEN";
  providerOutage: boolean;
  now: number;
}

export class SafetyController {
  constructor(private readonly store: MemoryStore) {}

  evaluate(campaign: Campaign, requested: number, context: SafetyContext): SafetyDecision {
    const reasons: string[] = [];
    const agents = this.store.campaignAgents(campaign.id);
    const calls = this.store.campaignCalls(campaign.id);
    if (campaign.emergencyStopped || campaign.state !== "RUNNING") {
      reasons.push(campaign.emergencyStopped ? "Emergency stop is active" : "Campaign is not running");
    }
    if (context.providerHealth === "OPEN" || context.providerOutage) reasons.push("Provider circuit is open or provider is unavailable");
    const staleReservations = agents.filter((agent) => agent.state === "RESERVED" && (agent.reservationExpiresAt ?? Infinity) <= context.now).length;
    if (staleReservations > 0) reasons.push(`${staleReservations} stale reservation(s) require recovery`);
    const available = agents.filter((agent) => agent.state === "AVAILABLE").length;
    const active = calls.filter((call) => activeCallStates.includes(call.state)).length;
    const inProgressAgents = agents.filter((agent) => agent.activeCallId && ["RESERVED", "DIALING", "CONNECTED"].includes(agent.state)).length;
    const duplicateAgentOwners = agents.filter((agent) => agent.activeCallId).length;
    const maxCapacity = Math.max(0, Math.min(available, campaign.config.maxConcurrentCalls - active));
    let permitted = Math.min(requested, maxCapacity);
    if (reasons.length > 0) permitted = 0;
    if (inProgressAgents > active || duplicateAgentOwners !== inProgressAgents) {
      permitted = 0;
      reasons.push("Agent/call ownership invariant is inconsistent");
    }
    if (requested > permitted && permitted > 0) reasons.push("Request reduced to currently safe capacity");
    if (requested > 1 && permitted > available) {
      permitted = available;
      reasons.push("Progressive fallback caps starts at currently available agents");
    }
    const status: SafetyDecision["status"] = permitted === 0
      ? "REJECT"
      : requested > 1 && (context.providerHealth === "HALF_OPEN" || context.providerOutage)
        ? "FALLBACK_PROGRESSIVE"
        : permitted < requested ? "REDUCE" : "APPROVE";
    const decision: SafetyDecision = {
      id: `safety-${context.now}-${this.store.safetyDecisions.length + 1}`,
      at: context.now,
      campaignId: campaign.id,
      requested,
      permitted,
      status,
      reasons: reasons.length ? reasons : ["Request is within independent safety limits"]
    };
    this.store.safetyDecisions.push(decision);
    return decision;
  }
}