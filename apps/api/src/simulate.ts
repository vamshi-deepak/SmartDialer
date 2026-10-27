const scenarios = [
  { name: "A", answerRate: 0.2, talkSeconds: 120, providerLatencyMs: 40 },
  { name: "B", answerRate: 0.5, talkSeconds: 90, providerLatencyMs: 80 },
  { name: "C", answerRate: 0.7, talkSeconds: 180, providerLatencyMs: 120 },
  { name: "D", answerRate: 0.35, talkSeconds: 150, providerLatencyMs: 250 }
];
const seed = Number(process.env.RANDOM_SEED ?? 42);
console.log(JSON.stringify({ label: "deterministic illustrative simulation; not provider capacity data", seed, scenarios: scenarios.map((scenario) => {
  const trials = 100;
  const answered = Math.round(trials * scenario.answerRate);
  const progressive = { initiated: trials, answered, answerRate: answered / trials };
  const predicted = { initiated: Math.min(trials, Math.ceil(trials * Math.min(1, scenario.answerRate + scenario.providerLatencyMs / 5000))), answered, answerRate: answered / Math.max(1, Math.min(trials, Math.ceil(trials * Math.min(1, scenario.answerRate + scenario.providerLatencyMs / 5000)))) };
  return { ...scenario, progressive, predictive: predicted, timeline: [{ second: 0, initiated: predicted.initiated }, { second: Math.ceil(scenario.providerLatencyMs / 1000), answered }, { second: scenario.talkSeconds, completed: answered }] };
}) }, null, 2));