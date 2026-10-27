import { randomUUID } from "node:crypto";
import {
  activeCallStates,
  isTerminalCallState,
  transitionAgent,
  transitionCall,
  type Agent,
  type Borrower,
  type Call,
  type Campaign,
  type EventOutcome,
  type ProviderEvent,
  type ProviderHealth
} from "./domain.js";
import { AsyncLock } from "./lock.js";
import { recommendCalls, type PacingRecommendation, type PacingSnapshot } from "./pacing.js";
import { SafetyController } from "./safety.js";
import type { ProviderAdapter } from "./providers.js";
import { MemoryStore } from "./store.js";

export type CrashPoint = "AGENT_RESERVED" | "BORROWER_RESERVED" | "CALL_CREATED" | "AFTER_INITIATION";

export class CircuitBreaker {
  private failures = 0;
  private openedAt?: number;
  private halfOpenSuccesses = 0;

  constructor(private readonly threshold = 3, private readonly cooldownMs = 5_000) {}

  health(now: number): ProviderHealth {
    if (this.openedAt === undefined) return "CLOSED";
    if (now - this.openedAt >= this.cooldownMs) return "HALF_OPEN";
    return "OPEN";
  }

  recordFailure(now: number): void {
    this.failures += 1;
    this.halfOpenSuccesses = 0;
    if (this.failures >= this.threshold || this.openedAt !== undefined) this.openedAt = now;
  }

  recordSuccess(now: number): void {
    if (this.openedAt === undefined) {
      this.failures = 0;
      return;
    }
    if (this.health(now) === "HALF_OPEN" && ++this.halfOpenSuccesses >= 2) {
      this.failures = 0;
      this.openedAt = undefined;
      this.halfOpenSuccesses = 0;
    }
  }
}

export interface DialResult {
  decision: ReturnType<SafetyController["evaluate"]>;
  started: Call[];
  recommendation: PacingRecommendation;
}

export class SmartDialer {
  readonly safety: SafetyController;
  readonly breaker = new CircuitBreaker();
  private readonly lock = new AsyncLock();
  private readonly providerStat;

  constructor(
    readonly store: MemoryStore,
    readonly provider: ProviderAdapter,
    private readonly now: () => number = Date.now
  ) {
    this.safety = new SafetyController(store);
    this.providerStat = store.providerStats.get(provider.id) ?? { failures: 0, timeouts: 0, successes: 0, latencyMs: [] };
    store.providerStats.set(provider.id, this.providerStat);
  }

  async dial(campaignId: string, requested?: number, crashAt?: CrashPoint): Promise<DialResult> {
    return this.lock.runExclusive(async () => {
      const campaign = this.getCampaign(campaignId);
      const recommendation = this.recommendation(campaignId);
      const desired = requested ?? (campaign.mode === "PREDICTIVE" ? recommendation.recommendedAdditionalCalls : recommendation.availableAgentCapacity);
      const now = this.now();
      const health = this.breaker.health(now);
      const decision = this.safety.evaluate(campaign, Math.max(0, Math.floor(desired)), {
        providerHealth: health,
        providerOutage: this.provider.isOutage(),
        now
      });
      const started: Call[] = [];
      for (let index = 0; index < decision.permitted; index += 1) {
        const agent = this.store.campaignAgents(campaignId).find((candidate) => candidate.state === "AVAILABLE");
        const borrower = this.store.campaignBorrowers(campaignId).find((candidate) => candidate.state === "QUEUED");
        if (!agent || !borrower) break;
        const reservationToken = `reservation:${randomUUID()}`;
        transitionAgent(agent, "RESERVED", now, "Dial allocation reserved agent");
        agent.activeCallId = reservationToken;
        agent.reservationExpiresAt = now + campaign.config.reservationLeaseMs;
        if (crashAt === "AGENT_RESERVED") throw new Error("Simulated worker crash after agent reservation");

        borrower.state = "RESERVED";
        borrower.activeCallId = reservationToken;
        borrower.reservationExpiresAt = now + campaign.config.reservationLeaseMs;
        if (crashAt === "BORROWER_RESERVED") throw new Error("Simulated worker crash after borrower reservation");

        const call: Call = {
          id: randomUUID(), campaignId, agentId: agent.id, borrowerId: borrower.id,
          providerId: this.provider.id, state: "QUEUED", createdAt: now, updatedAt: now, history: []
        };
        transitionCall(call, "RESERVED", now, "Agent and borrower reserved");
        this.store.calls.set(call.id, call);
        agent.activeCallId = call.id;
        borrower.activeCallId = call.id;
        if (crashAt === "CALL_CREATED") throw new Error("Simulated worker crash after call creation");

        transitionCall(call, "INITIATED", now, "Safety approved provider initiation");
        transitionAgent(agent, "DIALING", now, "Provider initiation requested");
        delete agent.reservationExpiresAt;
        delete borrower.reservationExpiresAt;
        this.providerStat.latencyMs.push(0);
        try {
          await this.provider.initiate(call);
          this.providerStat.successes += 1;
          this.breaker.recordSuccess(this.now());
          started.push(call);
          if (crashAt === "AFTER_INITIATION") throw new Error("Simulated worker crash after provider initiation");
        } catch (error) {
          if (crashAt === "AFTER_INITIATION") throw error;
          this.providerStat.failures += 1;
          this.breaker.recordFailure(this.now());
          this.failCall(call, agent, borrower, error instanceof Error ? error.message : "Provider initiation failed");
        }
      }
      return { decision, started, recommendation };
    });
  }

  async processEvent(event: ProviderEvent): Promise<EventOutcome> {
    return this.lock.runExclusive(() => {
      const receivedAt = this.now();
      this.store.providerEvents.push(event);
      const prior = this.store.events.get(event.id);
      if (prior) return { ...prior, reason: "Duplicate provider event ID" };
      const key = `${event.providerId}:${event.callId}:${event.type}`;
      const call = this.store.calls.get(event.callId);
      if (!call) return this.recordEvent(event, receivedAt, false, "Unknown call ID", "UNKNOWN");
      if (this.store.eventKeys.has(key) && ["ANSWERED", "CONNECTED", "COMPLETED", "FAILED", "CANCELLED"].includes(event.type)) {
        return this.recordEvent(event, receivedAt, false, "Duplicate semantic event", call.state);
      }
      if (isTerminalCallState(call.state)) return this.recordEvent(event, receivedAt, false, "Call is already terminal; stale event ignored", call.state);
      const nextState = event.type;
      if (!(["RINGING", "ANSWERED", "CONNECTED", "COMPLETED", "FAILED", "CANCELLED"] as string[]).includes(nextState)) {
        return this.recordEvent(event, receivedAt, false, "Unsupported provider event", call.state);
      }
      const agent = this.store.agents.get(call.agentId);
      const borrower = this.store.borrowers.get(call.borrowerId);
      try {
        transitionCall(call, nextState as Call["state"], receivedAt, event.reason ?? `Provider event ${event.type}`);
      } catch {
        return this.recordEvent(event, receivedAt, false, `Invalid event transition ${call.state} -> ${nextState}`, call.state);
      }
      this.store.eventKeys.add(key);
      if (event.type === "RINGING" && agent?.state === "DIALING") transitionAgent(agent, "DIALING", receivedAt, "Call is ringing");
      if ((event.type === "ANSWERED" || event.type === "CONNECTED") && agent && agent.state === "DIALING") {
        transitionAgent(agent, "CONNECTED", receivedAt, "Provider reported an answered call");
      }
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(event.type)) {
        if (agent) this.releaseAgent(agent, receivedAt, event.type === "COMPLETED" && call.answeredAt !== undefined);
        if (borrower) {
          borrower.state = event.type === "COMPLETED" && call.answeredAt !== undefined ? "CONTACTED" : "QUEUED";
          delete borrower.activeCallId;
          delete borrower.reservationExpiresAt;
        }
      }
      if (event.type === "ANSWERED") call.setupLatencyMs = Math.max(0, receivedAt - (call.initiatedAt ?? receivedAt));
      if (event.type === "COMPLETED" && call.answeredAt !== undefined) call.durationMs = Math.max(0, receivedAt - call.answeredAt);
      return this.recordEvent(event, receivedAt, true, "Event applied", call.state);
    });
  }

  async recover(staleAfterMs = 30_000): Promise<{ released: number; failed: number }> {
    return this.lock.runExclusive(() => {
      const now = this.now();
      let released = 0;
      let failed = 0;
      for (const agent of this.store.agents.values()) {
        if (agent.state !== "RESERVED" || (agent.reservationExpiresAt ?? Infinity) > now) continue;
        const borrower = this.store.borrowers.get([...this.store.borrowers.values()].find((item) => item.activeCallId === agent.activeCallId)?.id ?? "");
        const call = agent.activeCallId ? this.store.calls.get(agent.activeCallId) : undefined;
        if (call) {
          this.failCall(call, agent, borrower, "Reservation expired during recovery");
          failed += 1;
        } else {
          this.releaseAgent(agent, now, false);
          if (borrower) {
            borrower.state = "QUEUED";
            delete borrower.activeCallId;
            delete borrower.reservationExpiresAt;
          }
          released += 1;
        }
      }
      for (const call of this.store.calls.values()) {
        if (!["INITIATED", "RINGING", "ANSWERED", "CONNECTED"].includes(call.state)) continue;
        if (now - call.updatedAt < staleAfterMs) continue;
        const agent = this.store.agents.get(call.agentId);
        const borrower = this.store.borrowers.get(call.borrowerId);
        this.failCall(call, agent, borrower, "Call setup/heartbeat timed out; outcome not retried without reconciliation");
        failed += 1;
      }
      return { released, failed };
    });
  }

  async setAgentAvailable(agentId: string, available: boolean): Promise<void> {
    let activeCallId: string | undefined;
    await this.lock.runExclusive(() => {
      const agent = this.store.agents.get(agentId);
      if (!agent) throw new Error("Agent not found");
      activeCallId = agent.activeCallId;
      if (available) {
        if (agent.state === "OFFLINE" || agent.state === "PAUSED") transitionAgent(agent, "AVAILABLE", this.now(), "Agent became available");
      } else {
        if (["RESERVED", "DIALING", "CONNECTED"].includes(agent.state)) {
          const call = activeCallId ? this.store.calls.get(activeCallId) : undefined;
          if (call && !isTerminalCallState(call.state) && call.state === "RESERVED") {
            this.failCall(call, agent, this.store.borrowers.get(call.borrowerId), "Agent disappeared before provider initiation");
          } else if (call && !isTerminalCallState(call.state)) {
            transitionAgent(agent, "OFFLINE", this.now(), "Agent disappeared; existing call is being reconciled");
          } else {
            transitionAgent(agent, "OFFLINE", this.now(), "Agent became unavailable");
          }
        } else if (agent.state !== "OFFLINE") {
          transitionAgent(agent, "OFFLINE", this.now(), "Agent became unavailable");
        }
      }
    });
    if (!available && activeCallId) {
      const call = this.store.calls.get(activeCallId);
      if (call && !isTerminalCallState(call.state)) await this.provider.cancel(activeCallId).catch(() => undefined);
    }
  }

  async pauseCampaign(campaignId: string, emergency = false): Promise<void> {
    const calls = await this.lock.runExclusive(() => {
      const campaign = this.getCampaign(campaignId);
      campaign.state = emergency ? "STOPPED" : "PAUSED";
      campaign.emergencyStopped = emergency;
      return this.store.campaignCalls(campaignId).filter((call) => activeCallStates.includes(call.state)).map((call) => call.id);
    });
    if (emergency) await Promise.all(calls.map((callId) => this.provider.cancel(callId).catch(() => undefined)));
  }

  async startCampaign(campaignId: string): Promise<Campaign> {
    return this.lock.runExclusive(() => {
      const campaign = this.getCampaign(campaignId);
      if (campaign.emergencyStopped) throw new Error("Emergency-stopped campaign cannot be restarted; create a new campaign");
      campaign.state = "RUNNING";
      return campaign;
    });
  }

  setMode(campaignId: string, mode: Campaign["mode"]): void {
    this.getCampaign(campaignId).mode = mode;
  }

  recommendation(campaignId: string): PacingRecommendation {
    const campaign = this.getCampaign(campaignId);
    const agents = this.store.campaignAgents(campaignId);
    const calls = this.store.campaignCalls(campaignId);
    const completed = calls.filter((call) => call.state === "COMPLETED");
    const answered = completed.filter((call) => call.answeredAt !== undefined);
    const recent = completed.slice(-30);
    const recentAnswers = recent.filter((call) => call.answeredAt !== undefined).length;
    const stats = this.providerStat;
    const snapshot: PacingSnapshot = {
      campaign,
      agentStates: agents.map((agent) => agent.state),
      callStates: calls.map((call) => call.state),
      answerCount: answered.length,
      completedCount: completed.length,
      recentAnswers,
      recentCalls: recent.length,
      averageDurationMs: this.average(completed.flatMap((call) => call.durationMs === undefined ? [] : [call.durationMs])),
      averageSetupLatencyMs: this.average(calls.flatMap((call) => call.setupLatencyMs === undefined ? [] : [call.setupLatencyMs])),
      providerFailureRate: stats.failures / Math.max(1, stats.failures + stats.successes),
      providerHealth: this.breaker.health(this.now())
    };
    return recommendCalls(snapshot);
  }

  metrics(campaignId: string): Record<string, unknown> {
    const calls = this.store.campaignCalls(campaignId);
    const agents = this.store.campaignAgents(campaignId);
    const terminal = calls.filter((call) => isTerminalCallState(call.state));
    const completed = calls.filter((call) => call.state === "COMPLETED");
    const durations = calls.flatMap((call) => call.durationMs === undefined ? [] : [call.durationMs]);
    const latencies = calls.flatMap((call) => call.setupLatencyMs === undefined ? [] : [call.setupLatencyMs]);
    const total = calls.length;
    const answers = calls.filter((call) => call.answeredAt !== undefined).length;
    return {
      totalCallsInitiated: calls.filter((call) => call.initiatedAt !== undefined).length,
      totalCallsAnswered: answers,
      totalCallsConnected: calls.filter((call) => call.state === "CONNECTED" || call.state === "COMPLETED" && call.answeredAt !== undefined).length,
      failed: calls.filter((call) => call.state === "FAILED").length,
      cancelled: calls.filter((call) => call.state === "CANCELLED").length,
      queued: calls.filter((call) => call.state === "QUEUED").length,
      ringing: calls.filter((call) => call.state === "RINGING").length,
      answerRate: terminal.length ? answers / terminal.length : 0,
      agentUtilization: agents.length ? agents.filter((agent) => ["DIALING", "CONNECTED"].includes(agent.state)).length / agents.length : 0,
      averageCallDurationMs: this.average(durations),
      averageSetupLatencyMs: this.average(latencies),
      providerFailures: this.providerStat.failures,
      providerTimeouts: this.providerStat.timeouts,
      duplicateEvents: [...this.store.events.values()].filter((item) => !item.applied && item.reason.toLowerCase().includes("duplicate")).length,
      outOfOrderEvents: [...this.store.events.values()].filter((item) => !item.applied && item.reason.toLowerCase().includes("stale")).length,
      invariantViolations: this.invariantViolations(campaignId),
      safety: this.store.safetyDecisions.filter((decision) => decision.campaignId === campaignId).reduce((counts, decision) => ({ ...counts, [decision.status]: Number(counts[decision.status] ?? 0) + 1 }), {} as Record<string, number>),
      callsByState: calls.reduce((counts, call) => ({ ...counts, [call.state]: Number(counts[call.state] ?? 0) + 1 }), {} as Record<string, number>),
      answerRateDenominator: "Terminal calls, including failed and cancelled attempts",
      completedCalls: completed.length,
      recommended: this.recommendation(campaignId)
    };
  }

  invariantViolations(campaignId: string): number {
    const agents = this.store.campaignAgents(campaignId);
    const calls = this.store.campaignCalls(campaignId);
    const active = calls.filter((call) => activeCallStates.includes(call.state));
    const owners = new Set<string>();
    let violations = active.length > this.getCampaign(campaignId).config.maxConcurrentCalls ? 1 : 0;
    for (const call of active) {
      if (owners.has(call.agentId)) violations += 1;
      owners.add(call.agentId);
      const agent = this.store.agents.get(call.agentId);
      if (agent?.activeCallId !== call.id) violations += 1;
    }
    if (agents.some((agent) => agent.activeCallId && !active.some((call) => call.id === agent.activeCallId) && !agent.activeCallId.startsWith("reservation:"))) violations += 1;
    return violations;
  }

  getCampaign(campaignId: string): Campaign {
    const campaign = this.store.campaigns.get(campaignId);
    if (!campaign) throw new Error("Campaign not found");
    return campaign;
  }

  private recordEvent(event: ProviderEvent, receivedAt: number, applied: boolean, reason: string, resultingState: EventOutcome["resultingState"]): EventOutcome {
    const outcome: EventOutcome = { eventId: event.id, callId: event.callId, receivedAt, applied, reason, resultingState };
    this.store.events.set(event.id, outcome);
    return outcome;
  }

  private releaseAgent(agent: Agent, at: number, wrapUp: boolean): void {
    if (agent.state === "OFFLINE" || agent.state === "PAUSED") {
      delete agent.activeCallId;
      delete agent.reservationExpiresAt;
      return;
    }
    if (wrapUp && agent.state === "CONNECTED") transitionAgent(agent, "WRAP_UP", at, "Call completed; agent enters wrap-up");
    else if (agent.state !== "AVAILABLE") transitionAgent(agent, "AVAILABLE", at, "Call resources released");
    delete agent.activeCallId;
    delete agent.reservationExpiresAt;
  }

  private failCall(call: Call, agent: Agent | undefined, borrower: Borrower | undefined, reason: string): void {
    if (!isTerminalCallState(call.state)) transitionCall(call, "FAILED", this.now(), reason);
    if (agent) this.releaseAgent(agent, this.now(), false);
    if (borrower) {
      borrower.state = "QUEUED";
      delete borrower.activeCallId;
      delete borrower.reservationExpiresAt;
    }
  }

  private average(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }
}