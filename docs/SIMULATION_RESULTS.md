# Simulation Results

Recorded from the local API on 2026-10-27 using built-in scenario definitions and `PREDICTIVE` mode. Each scenario uses a fixed seed; runs are reproducible against the current simulator implementation. These are illustrative simulator outcomes, not forecast guarantees.

| Scenario | Configuration | Initiated | Answered | Effective answer rate | Average utilization | Completed | Invariant violations |
|---|---|---:|---:|---:|---:|---:|---:|
| A | 20% target answers, 120s talk time | 554 | 111 | 20.0% | 100.0% | 98 | 0 |
| B | 50% target answers, 90s talk time | 293 | 156 | 53.2% | 100.0% | 142 | 0 |
| C | 70% target answers, 180s talk time | 252 | 170 | 67.5% | 100.0% | 150 | 0 |
| D | Dynamic answer behavior and unreliable carrier latency | 366 | 92 | 25.1% | 70.5% | 92 | 0 |

Initiated, answered, and completed are cumulative call totals across the 40 simulation ticks, not simultaneous active-call counts. The answer rate is observed answered/connected/completed calls divided by initiated/failed call outcomes as computed by the simulator. It can differ from configured target rates, especially with finite samples and provider failures. Utilization is the mean per-tick connected-plus-dialing agents divided by configured agents.

Why pacing differs: answer-rate estimates affect how many attempts are needed to occupy free agents; longer call durations hold connected agents longer and reduce turnover; provider degradation dampens recommendations. The Safety Controller applies independent limits even if a recommendation exceeds currently available agent count or campaign headroom.
