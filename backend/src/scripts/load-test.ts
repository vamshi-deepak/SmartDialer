import { createContainer } from '../container.js';
import { Agent } from '../domain/agent/agent.types.js';
import { Borrower } from '../domain/borrower/borrower.types.js';

interface LoadTestMetrics {
  scale: string;
  totalAgents: number;
  totalBorrowers: number;
  totalCallsInitiated: number;
  totalEventsProcessed: number;
  elapsedSeconds: number;
  opsPerSecond: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  invariantViolations: number;
}

async function runScaleTest(agentScale: 100 | 1000, providerType: 'reliable' | 'unreliable'): Promise<LoadTestMetrics> {
  console.log(`\n============================================================`);
  console.log(`[LOAD TEST] Starting scale benchmark: ${agentScale} agents with '${providerType}' provider...`);
  console.log(`============================================================`);

  const container = await createContainer('in-memory');
  container.setProvider(providerType);

  const campaign = await container.campaignManager.createCampaign(`Benchmark-${agentScale}`, {
    dialingMode: 'PROGRESSIVE',
    maxConcurrentCalls: agentScale,
    providerId: providerType,
  });
  await container.campaignManager.startCampaign(campaign.id);

  const borrowerScale = agentScale * 2;

  // 1. Seed Agents
  for (let i = 1; i <= agentScale; i++) {
    const agent: Agent = {
      id: `load-agent-${i}`,
      campaignId: campaign.id,
      name: `Agent #${i}`,
      state: 'AVAILABLE',
      currentCallId: null,
      version: 1,
      reservationLeaseExpiresAt: null,
      lastStateChangeAt: new Date(),
      stateChangeReason: 'Load test seed',
      stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await container.agentRepo.save(agent);
  }

  // 2. Seed Borrowers
  for (let i = 1; i <= borrowerScale; i++) {
    const borrower: Borrower = {
      id: `load-bor-${i}`,
      campaignId: campaign.id,
      name: `Borrower #${i}`,
      phoneNumber: `+1555${String(i).padStart(7, '0')}`,
      debtAmount: 1500,
      priority: (i % 3) + 1,
      state: 'QUEUED',
      attemptsCount: 0,
      version: 1,
      lastAttemptAt: null,
      reservationLeaseExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await container.borrowerRepo.save(borrower);
  }

  const startTime = Date.now();
  const latencies: number[] = [];

  // 3. Execute Dialing Cycles under load
  const dialStartTime = Date.now();
  const dialResult = await container.campaignManager.executeDialCycle(campaign.id);
  const dialDuration = Date.now() - dialStartTime;
  latencies.push(dialDuration);

  // 4. Concurrently process event streams including duplicate events
  const inFlightCalls = await container.callRepo.findInFlightCalls(campaign.id);
  let eventsProcessed = 0;

  const eventTasks = inFlightCalls.map(async (call, index) => {
    const t0 = Date.now();
    const eventId = `EVT-LOAD-${call.id}`;

    // Deliver normal event
    await container.eventProcessor.processEvent({
      eventId,
      providerCallId: call.providerCallId ?? `prov-${call.id}`,
      callId: call.id,
      campaignId: campaign.id,
      eventType: index % 4 === 0 ? 'FAILED' : 'ANSWERED',
      timestamp: new Date(),
    });
    eventsProcessed++;

    // Inject duplicate event for 20% of calls to exercise deduplication
    if (index % 5 === 0) {
      await container.eventProcessor.processEvent({
        eventId,
        providerCallId: call.providerCallId ?? `prov-${call.id}`,
        callId: call.id,
        campaignId: campaign.id,
        eventType: 'ANSWERED',
        timestamp: new Date(),
      });
      eventsProcessed++;
    }

    latencies.push(Date.now() - t0);
  });

  await Promise.all(eventTasks);

  // 5. Run reconciliation pass
  await container.campaignManager.runReconciliation(campaign.id);

  const totalDurationSeconds = Math.max(0.001, (Date.now() - startTime) / 1000);
  const totalOps = dialResult.successfulCalls + eventsProcessed;
  const opsPerSecond = Math.round(totalOps / totalDurationSeconds);

  // Latency metrics
  latencies.sort((a, b) => a - b);
  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const p95Latency = latencies[Math.floor(latencies.length * 0.95)] ?? avgLatency;

  // Invariant verification check
  const activeCalls = await container.callRepo.countActiveCalls(campaign.id);
  const agentCounts = await container.agentRepo.countByState(campaign.id);
  const eligibleAgents = agentCounts.AVAILABLE + agentCounts.DIALING + agentCounts.CONNECTED;
  const violations = activeCalls > eligibleAgents ? 1 : 0;

  const metrics: LoadTestMetrics = {
    scale: `${agentScale} Agents (${providerType})`,
    totalAgents: agentScale,
    totalBorrowers: borrowerScale,
    totalCallsInitiated: dialResult.successfulCalls,
    totalEventsProcessed: eventsProcessed,
    elapsedSeconds: parseFloat(totalDurationSeconds.toFixed(2)),
    opsPerSecond,
    averageLatencyMs: avgLatency,
    p95LatencyMs: p95Latency,
    invariantViolations: violations,
  };

  console.log(`Results for ${metrics.scale}:`);
  console.log(`- Calls Initiated:     ${metrics.totalCallsInitiated}`);
  console.log(`- Events Processed:    ${metrics.totalEventsProcessed}`);
  console.log(`- Elapsed Duration:    ${metrics.elapsedSeconds}s`);
  console.log(`- Throughput:          ${metrics.opsPerSecond} operations/sec`);
  console.log(`- Average Latency:     ${metrics.averageLatencyMs} ms`);
  console.log(`- p95 Latency:         ${metrics.p95LatencyMs} ms`);
  console.log(`- Invariant Breaches:  ${metrics.invariantViolations}`);
  console.log(`[NOTE] Local prototype results on developer hardware; not production capacity guarantees.`);

  return metrics;
}

async function main() {
  console.log(`============================================================`);
  console.log(`   SmartDialer Performance & Scale Benchmark Engine        `);
  console.log(`============================================================`);

  const results: LoadTestMetrics[] = [];
  results.push(await runScaleTest(100, 'reliable'));
  results.push(await runScaleTest(100, 'unreliable'));
  results.push(await runScaleTest(1000, 'reliable'));

  console.log(`\n============================================================`);
  console.log(`                   LOAD TEST SUMMARY TABLE                  `);
  console.log(`============================================================`);
  console.table(results);
}

main().catch((err) => {
  console.error('[LOAD TEST ERROR]:', err);
  process.exit(1);
});

