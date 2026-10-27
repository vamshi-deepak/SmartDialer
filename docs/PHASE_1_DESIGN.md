# SmartDialer: Architecture, Safety Invariants & System Design (Phase 1)

## 1. Executive Summary
SmartDialer is a safe progressive and predictive dialing simulation engine engineered specifically for high-compliance collections and contact centers. The core engineering mandate is simple but non-negotiable:
**Under no circumstances may predictive pacing violate physical agent availability, call pacing limits, or duplicate allocation constraints.**

---

## 2. Requirement-to-Implementation Mapping Checklist

| Requirement Area | Specification Requirement | Architectural Implementation |
|---|---|---|
| **Dialing Strategies** | Progressive (1-to-1 available agent to call ratio) & Predictive (dynamic overdial based on answer rates) | `ProgressiveDialer` + `PredictivePacingEngine` gated strictly by `SafetyController`. |
| **Separation of Concerns** | Pacing Engine MUST NEVER call telecom providers directly | Strict boundary: Pacing Engine produces a read-only `PacingRecommendation`. Only `CallAllocator` can invoke `ITelecomProvider`, and only with a cryptographically or structurally verified `SafetyDecision(APPROVE | REDUCE)`. |
| **Agent Lifecycle** | OFFLINE, AVAILABLE, RESERVED, DIALING, CONNECTED, WRAP_UP, PAUSED | Centralized `AgentStateMachine` with transition guards, lease timestamps, active call reference, and atomic reservation. |
| **Call Lifecycle** | QUEUED, RESERVED, INITIATED, RINGING, ANSWERED, CONNECTED, COMPLETED, FAILED, CANCELLED | Centralized `CallStateMachine` with idempotency, event sequence tracking, and immutable terminal state guards. |
| **Atomic Concurrency** | Zero duplicate agent reservations across concurrent workers | Compare-And-Swap (CAS) with versioning in MongoDB (`findOneAndUpdate({ _id, state: AVAILABLE, version })`) and atomic mutex / atomic slot reservations in deterministic in-memory store. |
| **Reservation Leases** | Prevent orphaned locks when worker dies mid-setup | Leases with explicit expiration (`leaseExpiresAt`). Background `ReconciliationService` reclaims expired reservations. |
| **Safety Enforcement** | Independent gatekeeper capping requests | `SafetyController` independently computes real-time system state (eligible agents, circuit breaker, active calls, max cap) and issues `APPROVE`, `REDUCE`, `REJECT`, or `FALLBACK_PROGRESSIVE`. |
| **Mock Providers** | Reliable vs Unreliable providers with identical interfaces | `ITelecomProvider` interface implemented by `ReliableMockProvider` and `UnreliableMockProvider` (with PRNG seeds, jitter, packet loss, duplicate events, out-of-order dispatch, manual scenario injection). |
| **Idempotency & Ordering** | Handle duplicate and out-of-order telecom webhooks | `ProviderEventProcessor` maintaining processed event IDs (`event_id` or `call_id + event_type + timestamp`) and sequence number validation; stale transitions are logged as no-ops. |
| **Circuit Breaker** | Protect from telecom cascade failures | Consecutive failure & error rate threshold monitor with CLOSED, OPEN, and HALF_OPEN states and exponential backoff cooldown. |
| **Deterministic Simulation** | Reproducible execution of scenarios A-D & failure tests | Seeded pseudo-random number generator (Mulberry32/PCG) driving discrete-event or tick-based simulation. |
| **Full-Stack Application** | REST API + React Operations Dashboard | Express + Zod + Pino backend paired with Vite + React + Tailwind + Recharts frontend. |

---

## 3. High-Risk Correctness Issues & Architectural Mitigations

### Risk 1: Pacing Overdial vs. Sudden Agent Disconnection
- **Danger**: The predictive pacing engine recommends 15 calls based on 10 available agents expecting an answer rate of 30%. Suddenly, 6 agents go `PAUSED` or `OFFLINE` while calls are ringing. When those calls connect, borrowers are abandoned (silent call / FCC violation).
- **Mitigation**: 
  1. The `SafetyController` evaluates agent capacity at the instant of allocation, not when pacing recommends it.
  2. The pacing formula incorporates dynamic abandonment budget limits: `RecommendedCalls = min(SafetyCap, (EligibleAgents - RingingExpected) / SmoothedAnswerRate)`.
  3. If agent drop occurs mid-flight, `ReconciliationService` signals early provider cancellation for ringing calls that lack available agents.

### Risk 2: Split-Brain Concurrency in Agent & Borrower Reservation
- **Danger**: Two concurrent dialer loops pick the same `AVAILABLE` agent or `QUEUED` borrower, creating a double-dial race condition.
- **Mitigation**:
  1. Atomic State Transitions: Every reservation must use atomic conditional queries (`state == AVAILABLE`).
  2. Two-Phase Reservation: Both Agent and Borrower must be atomically reserved before call record generation. If Borrower reservation fails after Agent reservation, the Agent reservation is immediately rolled back.

### Risk 3: Out-of-Order & Duplicate Provider Event Arrival
- **Danger**: Provider delivers `COMPLETED` before `ANSWERED` (due to network retries), or delivers two `ANSWERED` events concurrently, causing double-transitions or premature agent releases.
- **Mitigation**:
  1. Finite State Machine Terminal State Protection: Once a call reaches `COMPLETED`, `FAILED`, or `CANCELLED`, no non-terminal event (`ANSWERED`, `RINGING`) can transition it.
  2. Idempotency Store: In-flight and processed provider event IDs are tracked with deduplication keys `provider_event_id` or `(call_id, event_type, seq)`. Duplicate events are recorded as `DUPLICATE_IGNORED`.

### Risk 4: Worker Crash After Partial Call Initiation
- **Danger**: Worker process reserves an agent, calls provider `initiateCall()`, and crashes before persisting the returned provider call ID. The call rings in the wild while the database thinks the agent is stuck in `RESERVED`.
- **Mitigation**:
  1. Lease expiration (`reservation_expires_at = now + 15s`).
  2. The `ReconciliationService` queries the provider adapter for unlinked calls or times out expired reservations, forcing a graceful recovery transition (`RESERVED -> CANCELLED/AVAILABLE`).

---

## 4. State Machines & Allowed Transitions

### Agent State Machine
- States: `OFFLINE`, `AVAILABLE`, `RESERVED`, `DIALING`, `CONNECTED`, `WRAP_UP`, `PAUSED`
- Rules:
  - Only `AVAILABLE` can transition to `RESERVED`.
  - An agent owns at most ONE active call.
  - State changes require reason code, timestamp, and active call pointer updates.

### Call State Machine
- States: `QUEUED`, `RESERVED`, `INITIATED`, `RINGING`, `ANSWERED`, `CONNECTED`, `COMPLETED`, `FAILED`, `CANCELLED`
- Rules:
  - Terminal states (`COMPLETED`, `FAILED`, `CANCELLED`) can NEVER be exited or overwritten.
  - Events must follow logical graph progression:
    - `QUEUED -> RESERVED -> INITIATED -> RINGING -> ANSWERED -> CONNECTED -> COMPLETED`
    - Non-answering outcomes: `INITIATED/RINGING -> FAILED/CANCELLED`
  - Stale events (e.g., `RINGING` arriving after `ANSWERED` or `COMPLETED`) are rejected with `STALE_EVENT_IGNORED` and stored in the audit trail.

---

## 5. Formal Safety Invariants

1. **Progressive Mode Invariant**:
   $$\text{ActiveCalls}_{\text{progressive}} \le \text{EligibleAgents}_{\text{available}}$$
   Under Progressive dialing, at no instant may the count of calls in `[INITIATED, RINGING, ANSWERED, CONNECTED]` exceed the count of agents allocated and assigned to them.

2. **Predictive Safety Cap Invariant**:
   $$\text{TotalActiveCalls} \le \min(\text{CampaignMaxConcurrentCalls}, \text{ActiveAgents} \times \text{OverdialLimit})$$
   $$\text{SafetyDecision} = \text{APPROVE} \iff \text{ApprovedCalls} + \text{InFlightCalls} \le \text{SafetyCap}$$

3. **Single Ownership Invariant**:
   $$\forall \text{Agent } A, \quad |\{ C \in \text{Calls} \mid C.\text{agentId} = A.\text{id} \land C.\text{state} \notin \{\text{COMPLETED}, \text{FAILED}, \text{CANCELLED}\} \}| \le 1$$
   No agent can be linked to more than one non-terminal call.

4. **Terminal State Immutability Invariant**:
   $$\text{If } S(C) \in \{\text{COMPLETED}, \text{FAILED}, \text{CANCELLED}\}, \quad \forall e \in \text{Events}, S(C) \xrightarrow{e} S(C)$$
   Terminal states are absorbing and immutable.

---

## 6. Directory Structure

```
d:\CredResolve\
  package.json (workspace root)
  docker-compose.yml (optional local MongoDB)
  .env.example
  .gitignore
  README.md
  backend\
    package.json
    tsconfig.json
    src\
      domain\
        agent\ (entity, state machine, types)
        borrower\ (entity, queue, types)
        call\ (entity, state machine, types)
        events\ (types, event-keys, idempotency)
      pacing\
        predictive-engine.ts
        types.ts
      safety\
        safety-controller.ts
        circuit-breaker.ts
        types.ts
      providers\
        telecom-provider.interface.ts
        reliable-mock-provider.ts
        unreliable-mock-provider.ts
        provider-event-processor.ts
      allocator\
        call-allocator.ts
        progressive-dialer.ts
      recovery\
        reconciliation-service.ts
        lease-monitor.ts
      storage\
        repository.interface.ts
        in-memory\ (deterministic in-memory repositories)
        mongoose\ (schemas, models, database connection)
      campaign\
        campaign-manager.ts
        types.ts
      metrics\
        metrics-collector.ts
      simulation\
        simulation-engine.ts
        scenarios.ts
        failure-scenarios.ts
      api\
        server.ts
        app.ts
        routes\
        controllers\
        validators\
        middleware\
      scripts\
        seed.ts
        load-test.ts
    tests\
      unit\
      integration\
      concurrency\
      state-machines\
  frontend\
    package.json
    tsconfig.json
    vite.config.ts
    src\
      App.tsx
      components\
      services\
      types\
```

