import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SmartDialer, MemoryStore, createReliableProvider, createUnreliableProvider, type Agent, type Borrower, type Campaign } from "@smartdialer/core";
import type { ProviderEventSink, MockProvider } from "@smartdialer/core";

const configSchema = z.object({
  maxConcurrentCalls: z.number().int().min(1).max(10_000).default(100),
  reservationLeaseMs: z.number().int().min(100).default(10_000),
  wrapUpMs: z.number().int().min(0).default(5_000),
  priorAnswerRate: z.number().min(0).max(1).default(0.35),
  priorSampleSize: z.number().int().min(1).default(20),
  targetConcurrent: z.number().int().min(1).max(10_000).default(100)
});

export const store = new MemoryStore();
export const campaigns = store.campaigns;
export const agents = store.agents;
export const borrowers = store.borrowers;
const providerSink: ProviderEventSink = async (event) => dialer.processEvent(event).then(() => undefined);
export let provider: MockProvider = createReliableProvider(Number(process.env.RANDOM_SEED ?? 42), providerSink);
export let dialer = new SmartDialer(store, provider);

export function resetRuntime(seed = 42): void {
  store.campaigns.clear();
  store.agents.clear();
  store.borrowers.clear();
  store.calls.clear();
  store.events.clear();
  store.eventKeys.clear();
  store.providerEvents.length = 0;
  store.safetyDecisions.length = 0;
  store.providerStats.clear();
  provider = createReliableProvider(seed, providerSink);
  dialer = new SmartDialer(store, provider);
}

export function useProvider(kind: "reliable" | "unreliable"): void {
  provider = kind === "reliable"
    ? createReliableProvider(Number(process.env.RANDOM_SEED ?? 42), providerSink)
    : createUnreliableProvider(Number(process.env.RANDOM_SEED ?? 42), providerSink);
  dialer = new SmartDialer(store, provider);
}

export function createCampaign(input: { name: string; mode?: Campaign["mode"]; config?: Partial<Campaign["config"]> }): Campaign {
  const config = configSchema.parse(input.config ?? {});
  const campaign: Campaign = {
    id: randomUUID(),
    name: input.name,
    state: "DRAFT",
    mode: input.mode ?? "PROGRESSIVE",
    emergencyStopped: false,
    config,
    createdAt: Date.now()
  };
  campaigns.set(campaign.id, campaign);
  return campaign;
}

export function addAgents(campaignId: string, count: number): Agent[] {
  const created: Agent[] = [];
  for (let index = 0; index < count; index += 1) {
    const agent: Agent = {
      id: randomUUID(), campaignId, name: `Agent ${store.campaignAgents(campaignId).length + 1}`,
      state: "AVAILABLE", stateChangedAt: Date.now(), stateReason: "Seeded as available", history: []
    };
    agents.set(agent.id, agent);
    created.push(agent);
  }
  return created;
}

export function addBorrowers(campaignId: string, count: number): Borrower[] {
  const start = store.campaignBorrowers(campaignId).length;
  const created: Borrower[] = [];
  for (let index = 0; index < count; index += 1) {
    const sequence = start + index + 1;
    const borrower: Borrower = {
      id: randomUUID(), campaignId, name: `Synthetic Borrower ${sequence}`,
      phone: `+1555${String(sequence).padStart(7, "0")}`, state: "QUEUED"
    };
    borrowers.set(borrower.id, borrower);
    created.push(borrower);
  }
  return created;
}

export function seedDemo(): Campaign {
  if (store.campaigns.size) return [...store.campaigns.values()][0]!;
  const campaign = createCampaign({ name: "Northstar Collections Demo", config: { maxConcurrentCalls: 50, targetConcurrent: 50 } });
  addAgents(campaign.id, 12);
  addBorrowers(campaign.id, 100);
  return campaign;
}