import { performance } from "node:perf_hooks";
import { SmartDialer, MemoryStore, createReliableProvider, type Campaign, type Agent, type Borrower } from "@smartdialer/core";

const agentCount = Number(process.argv[2] ?? 100);
const concurrency = Math.min(agentCount, 100);
const store = new MemoryStore();
const campaign: Campaign = { id: "load-campaign", name: "Local load test", state: "RUNNING", mode: "PROGRESSIVE", emergencyStopped: false, createdAt: Date.now(), config: { maxConcurrentCalls: agentCount, reservationLeaseMs: 10000, wrapUpMs: 1000, priorAnswerRate: 0.35, priorSampleSize: 20, targetConcurrent: agentCount } };
store.campaigns.set(campaign.id, campaign);
for (let index = 0; index < agentCount; index += 1) {
  const agent: Agent = { id: `agent-${index}`, campaignId: campaign.id, name: `Agent ${index}`, state: "AVAILABLE", stateChangedAt: Date.now(), stateReason: "load", history: [] };
  const borrower: Borrower = { id: `borrower-${index}`, campaignId: campaign.id, name: `Synthetic ${index}`, phone: `+1555${String(index).padStart(7, "0")}`, state: "QUEUED" };
  store.agents.set(agent.id, agent);
  store.borrowers.set(borrower.id, borrower);
}
const provider = createReliableProvider(42, async () => undefined);
const dialer = new SmartDialer(store, provider);
const latencies: number[] = [];
const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  const start = performance.now();
  await dialer.dial(campaign.id, 1);
  latencies.push(performance.now() - start);
}));
latencies.sort((left, right) => left - right);
const elapsed = performance.now() - startedAt;
const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0;
console.log(JSON.stringify({ label: "local prototype measurement; not production capacity guarantee", agents: agentCount, reservationAttempts: concurrency, attemptsPerSecond: concurrency / (elapsed / 1000), averageLatencyMs: latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length), p95LatencyMs: p95, invariantViolations: dialer.invariantViolations(campaign.id), provider: provider.id }, null, 2));