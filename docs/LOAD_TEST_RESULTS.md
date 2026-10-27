# Local Load-Test Results

Recorded from `npm run load-test` on 2026-10-27. The script uses in-memory repositories, seeds 100 or 1,000 agents, runs a progressive cycle, processes events including duplicates, then reconciles. Provider events are mock-only.

| Agents / provider | Calls initiated | Events processed | Elapsed | Operations/sec | Average sampled latency | p95 sampled latency | Invariant violations |
|---|---:|---:|---:|---:|---:|---:|---:|
| 100 / reliable | 98 | 118 | 3.56s | 61 | 37ms | 1ms | 0 |
| 100 / unreliable | 100 | 120 | 3.51s | 63 | 35ms | 1ms | 0 |
| 1,000 / reliable | 99 | 119 | 3.45s | 63 | 36ms | 2ms | 0 |

These are local prototype results, not production capacity guarantees. They are affected by the developer machine, timers, provider mock latency, and current implementation. The 1,000-agent run does not initiate 1,000 calls: the independent global safety-controller cap is 100. The script's latency sample mixes a dial-cycle duration with event-handler durations, so its p95 can be lower than its average and must not be interpreted as end-to-end p95. The test does not exercise a MongoDB replica set or multiple processes.

Reproduce with:

```powershell
npm run load-test
```
