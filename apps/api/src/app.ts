import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import pino from "pino";
import { z } from "zod";
import { seedDemo, store, dialer, addAgents, addBorrowers, createCampaign, provider, useProvider } from "./runtime.js";
import { persistSnapshot } from "./persistence.js";

export const logger = pino({ level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization"] });
export const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

const campaignInput = z.object({ name: z.string().min(1).max(100), mode: z.enum(["PROGRESSIVE", "PREDICTIVE"]).optional(), config: z.object({
  maxConcurrentCalls: z.number().int().min(1).max(10_000).optional(),
  reservationLeaseMs: z.number().int().min(100).optional(),
  wrapUpMs: z.number().int().min(0).optional(),
  priorAnswerRate: z.number().min(0).max(1).optional(),
  priorSampleSize: z.number().int().min(1).optional(),
  targetConcurrent: z.number().int().min(1).max(10_000).optional()
}).optional() });
const countInput = z.object({ count: z.number().int().min(1).max(10_000) });
const dialInput = z.object({ requested: z.number().int().min(0).max(10_000).optional(), mode: z.enum(["PROGRESSIVE", "PREDICTIVE"]).optional(), crashAt: z.enum(["AGENT_RESERVED", "BORROWER_RESERVED", "CALL_CREATED", "AFTER_INITIATION"]).optional() });
const failureInput = z.object({ scenario: z.enum(["worker-crash", "provider-outage", "agent-loss", "duplicate-events", "out-of-order-events"]), count: z.number().int().min(1).max(1000).default(1) });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw Object.assign(new Error("Request validation failed"), { status: 400, details: result.error.flatten() });
  return result.data;
}

function getCampaignId(id: string): string {
  if (!store.campaigns.has(id)) throw Object.assign(new Error("Campaign not found"), { status: 404 });
  return id;
}

app.get("/api/health", (_request, response) => response.json({ status: "ok", mode: "in-memory simulation", provider: provider.id, circuit: dialer.breaker.health(Date.now()) }));

app.get("/api/campaigns", (_request, response) => response.json([...store.campaigns.values()]));
app.post("/api/campaigns", async (request, response) => {
  const input = parse(campaignInput, request.body);
  const campaign = createCampaign(input);
  await persistSnapshot(store);
  response.status(201).json(campaign);
});
app.get("/api/campaigns/:id", (request, response) => response.json(dialer.getCampaign(getCampaignId(request.params.id))));
app.post("/api/campaigns/:id/start", async (request, response) => response.json(await dialer.startCampaign(getCampaignId(request.params.id))));
app.post("/api/campaigns/:id/pause", async (request, response) => {
  await dialer.pauseCampaign(getCampaignId(request.params.id));
  response.json(dialer.getCampaign(request.params.id));
});
app.post("/api/campaigns/:id/stop", async (request, response) => {
  await dialer.pauseCampaign(getCampaignId(request.params.id), true);
  response.json(dialer.getCampaign(request.params.id));
});
app.get("/api/campaigns/:id/agents", (request, response) => response.json(store.campaignAgents(getCampaignId(request.params.id))));
app.post("/api/campaigns/:id/agents", (request, response) => response.status(201).json(addAgents(getCampaignId(request.params.id), parse(countInput, request.body).count)));
app.get("/api/campaigns/:id/borrowers", (request, response) => response.json(store.campaignBorrowers(getCampaignId(request.params.id))));
app.post("/api/campaigns/:id/borrowers", (request, response) => response.status(201).json(addBorrowers(getCampaignId(request.params.id), parse(countInput, request.body).count)));
app.get("/api/campaigns/:id/calls", (request, response) => response.json(store.campaignCalls(getCampaignId(request.params.id))));
app.get("/api/campaigns/:id/metrics", (request, response) => response.json(dialer.metrics(getCampaignId(request.params.id))));
app.post("/api/campaigns/:id/dial", async (request, response) => {
  const input = parse(dialInput, request.body ?? {});
  const id = getCampaignId(request.params.id);
  if (input.mode) dialer.setMode(id, input.mode);
  const result = await dialer.dial(id, input.requested, input.crashAt);
  await persistSnapshot(store);
  response.json(result);
});
app.post("/api/campaigns/:id/simulate", async (request, response) => {
  const id = getCampaignId(request.params.id);
  const count = parse(countInput, request.body).count;
  response.json(await dialer.dial(id, count));
});
app.post("/api/simulation/run", async (request, response) => {
  const input = parse(z.object({ scenarios: z.array(z.object({ answerRate: z.number().min(0).max(1), durationSeconds: z.number().positive(), providerLatencyMs: z.number().nonnegative() })).min(1).max(20).optional(), agentCount: z.number().int().min(1).max(1000).default(20), callsPerScenario: z.number().int().min(1).max(1000).default(100) }), request.body ?? {});
  const scenarios = input.scenarios ?? [
    { answerRate: 0.2, durationSeconds: 120, providerLatencyMs: 40 },
    { answerRate: 0.5, durationSeconds: 90, providerLatencyMs: 80 },
    { answerRate: 0.7, durationSeconds: 180, providerLatencyMs: 120 },
    { answerRate: 0.35, durationSeconds: 150, providerLatencyMs: 250 }
  ];
  response.json({ seed: Number(process.env.RANDOM_SEED ?? 42), results: scenarios.map((scenario) => ({ ...scenario, progressive: runScenario(scenario, input.agentCount, input.callsPerScenario, "PROGRESSIVE"), predictive: runScenario(scenario, input.agentCount, input.callsPerScenario, "PREDICTIVE") })) });
});
app.post("/api/simulation/failure-scenario", async (request, response) => {
  const input = parse(failureInput, request.body);
  const campaign = [...store.campaigns.values()][0] ?? seedDemo();
  await dialer.startCampaign(campaign.id);
  if (input.scenario === "provider-outage") {
    provider.setOutage(true);
    const result = await dialer.dial(campaign.id, input.count);
    return response.json({ scenario: input.scenario, result, health: dialer.breaker.health(Date.now()) });
  }
  if (input.scenario === "worker-crash") {
    try { await dialer.dial(campaign.id, input.count, "CALL_CREATED"); } catch (error) { logger.warn({ message: (error as Error).message }, "Worker crash injected"); }
    const recovered = await dialer.recover(0);
    return response.json({ scenario: input.scenario, recovered, metrics: dialer.metrics(campaign.id) });
  }
  if (input.scenario === "agent-loss") {
    const selected = store.campaignAgents(campaign.id).slice(0, input.count);
    await Promise.all(selected.map((agent) => dialer.setAgentAvailable(agent.id, false)));
    return response.json({ scenario: input.scenario, selected: selected.length, available: store.campaignAgents(campaign.id).filter((agent) => agent.state === "AVAILABLE").length });
  }
  const started = (await dialer.dial(campaign.id, input.count)).started;
  const call = started[0];
  if (call) {
    const events = input.scenario === "duplicate-events" ? ["ANSWERED", "ANSWERED", "COMPLETED"] as const : ["COMPLETED", "ANSWERED", "RINGING"] as const;
    const mock = provider;
    const outcomes = await Promise.all(mock.inject(call.id, [...events]));
    return response.json({ scenario: input.scenario, outcomes, metrics: dialer.metrics(campaign.id) });
  }
  response.json({ scenario: input.scenario, message: "No call available for injected event sequence" });
});
app.post("/api/providers/:providerId/events", async (request, response) => {
  const event = parse(z.object({ id: z.string().min(1), callId: z.string().min(1), type: z.enum(["RINGING", "ANSWERED", "CONNECTED", "COMPLETED", "FAILED", "CANCELLED"]), at: z.number().optional(), reason: z.string().optional() }), request.body);
  const outcome = await dialer.processEvent({ ...event, providerId: request.params.providerId, at: event.at ?? Date.now() });
  response.status(outcome.applied ? 200 : 202).json(outcome);
});
app.get("/api/safety/decisions", (_request, response) => response.json([...store.safetyDecisions].reverse()));
app.post("/api/providers/select", (request, response) => {
  const input = parse(z.object({ provider: z.enum(["reliable", "unreliable"]) }), request.body);
  useProvider(input.provider);
  response.json({ provider: provider.id, circuit: dialer.breaker.health(Date.now()) });
});
app.post("/api/system/recover", async (_request, response) => response.json(await dialer.recover()));

function runScenario(scenario: { answerRate: number; durationSeconds: number; providerLatencyMs: number }, agentCount: number, callCount: number, mode: "PROGRESSIVE" | "PREDICTIVE") {
  const active = Math.min(agentCount, callCount);
  const answered = Math.round(active * scenario.answerRate);
  const dialed = mode === "PROGRESSIVE" ? active : Math.min(active, Math.ceil(active * Math.min(1, scenario.answerRate + scenario.providerLatencyMs / 5000)));
  return {
    callsInitiated: dialed,
    callsAnswered: answered,
    answerRate: dialed ? answered / dialed : 0,
    estimatedAgentUtilization: Math.min(1, answered * scenario.durationSeconds / Math.max(1, agentCount * (scenario.durationSeconds + scenario.providerLatencyMs / 1000))),
    providerLatencyMs: scenario.providerLatencyMs,
    timeline: [{ second: 0, started: dialed }, { second: Math.ceil(scenario.providerLatencyMs / 1000), answered }, { second: scenario.durationSeconds, completed: answered }]
  };
}

app.use(((error, _request, response, _next) => {
  const status = Number((error as { status?: number }).status ?? 500);
  logger.error({ err: error }, "Request failed");
  response.status(status).json({ error: status === 500 ? "Internal server error" : (error as Error).message, details: (error as { details?: unknown }).details });
}) as ErrorRequestHandler);

export { seedDemo };