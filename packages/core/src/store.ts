import type { Agent, Borrower, Call, Campaign, EventOutcome, ProviderEvent, SafetyDecision } from "./domain.js";

export class MemoryStore {
  readonly campaigns = new Map<string, Campaign>();
  readonly agents = new Map<string, Agent>();
  readonly borrowers = new Map<string, Borrower>();
  readonly calls = new Map<string, Call>();
  readonly events = new Map<string, EventOutcome>();
  readonly eventKeys = new Set<string>();
  readonly safetyDecisions: SafetyDecision[] = [];
  readonly providerEvents: ProviderEvent[] = [];
  readonly providerStats = new Map<string, { failures: number; timeouts: number; successes: number; latencyMs: number[] }>();

  campaignAgents(campaignId: string): Agent[] {
    return [...this.agents.values()].filter((agent) => agent.campaignId === campaignId);
  }

  campaignBorrowers(campaignId: string): Borrower[] {
    return [...this.borrowers.values()].filter((borrower) => borrower.campaignId === campaignId);
  }

  campaignCalls(campaignId: string): Call[] {
    return [...this.calls.values()].filter((call) => call.campaignId === campaignId);
  }
}