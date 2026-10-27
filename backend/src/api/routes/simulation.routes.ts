import { Router, Request, Response } from 'express';
import { ServiceContainer } from '../../container.js';
import { SimulationEngine } from '../../simulation/simulation-engine.js';
import { SimulationScenarioConfig } from '../../simulation/scenarios.js';
import { FailureScenarioRunner } from '../../simulation/failure-scenarios.js';
import { FailureScenarioSchema } from '../validators/campaign.validator.js';

export function createSimulationRouter(container: ServiceContainer): Router {
  const router = Router();
  const simEngine = new SimulationEngine();
  const failureRunner = new FailureScenarioRunner(container);

  // Standard Scenarios A - D definitions
  const STANDARD_SCENARIOS: Record<string, SimulationScenarioConfig> = {
    'A': {
      id: 'SCENARIO-A',
      name: 'Scenario A: 20% Answer Rate, 120s Average Talk Time',
      description: 'Low contact rate collections environment requiring aggressive overdialing.',
      dialingMode: 'PREDICTIVE',
      agentCount: 25,
      borrowerCount: 200,
      ticks: 40,
      tickDurationMs: 50,
      targetAnswerRate: 0.20,
      averageTalkDurationTicks: 12,
      providerType: 'reliable',
      seed: 101,
    },
    'B': {
      id: 'SCENARIO-B',
      name: 'Scenario B: 50% Answer Rate, 90s Average Talk Time',
      description: 'Balanced customer support / warm lead environment with moderate turnover.',
      dialingMode: 'PREDICTIVE',
      agentCount: 25,
      borrowerCount: 200,
      ticks: 40,
      tickDurationMs: 50,
      targetAnswerRate: 0.50,
      averageTalkDurationTicks: 9,
      providerType: 'reliable',
      seed: 202,
    },
    'C': {
      id: 'SCENARIO-C',
      name: 'Scenario C: 70% Answer Rate, 180s Average Talk Time',
      description: 'High contact rate appointment / consultation with high occupancy and long calls.',
      dialingMode: 'PREDICTIVE',
      agentCount: 25,
      borrowerCount: 200,
      ticks: 40,
      tickDurationMs: 50,
      targetAnswerRate: 0.70,
      averageTalkDurationTicks: 18,
      providerType: 'reliable',
      seed: 303,
    },
    'D': {
      id: 'SCENARIO-D',
      name: 'Scenario D: Dynamic Changing Rates & Telecom Latency Chaos',
      description: 'Unreliable telecom trunk with fluctuating carrier response times and noise.',
      dialingMode: 'PREDICTIVE',
      agentCount: 25,
      borrowerCount: 200,
      ticks: 40,
      tickDurationMs: 50,
      targetAnswerRate: 0.35,
      averageTalkDurationTicks: 10,
      providerType: 'unreliable',
      seed: 404,
    },
  };

  // GET /api/simulation/scenarios
  router.get('/scenarios', (_req: Request, res: Response) => {
    res.json({ success: true, scenarios: STANDARD_SCENARIOS });
  });

  // POST /api/simulation/run
  router.post('/run', async (req: Request, res: Response) => {
    const scenarioKey = req.body?.scenarioKey as string | undefined;
    let config: SimulationScenarioConfig;

    if (scenarioKey && scenarioKey in STANDARD_SCENARIOS) {
      config = { ...STANDARD_SCENARIOS[scenarioKey]! };
      if (req.body?.dialingMode) {
        config.dialingMode = req.body.dialingMode;
      }
    } else {
      config = {
        id: `CUSTOM-${Date.now()}`,
        name: req.body?.name ?? 'Custom Simulation',
        description: 'User-configured simulation scenario',
        dialingMode: req.body?.dialingMode ?? 'PROGRESSIVE',
        agentCount: req.body?.agentCount ?? 20,
        borrowerCount: req.body?.borrowerCount ?? 100,
        ticks: req.body?.ticks ?? 30,
        tickDurationMs: 50,
        targetAnswerRate: req.body?.targetAnswerRate ?? 0.35,
        averageTalkDurationTicks: req.body?.averageTalkDurationTicks ?? 10,
        providerType: req.body?.providerType ?? 'reliable',
        seed: req.body?.seed ?? 42,
      };
    }

    try {
      const result = await simEngine.runScenario(config);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/simulation/failure-scenario
  router.post('/failure-scenario', async (req: Request, res: Response) => {
    const parsed = FailureScenarioSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, errors: parsed.error.errors });
      return;
    }

    try {
      const report = await failureRunner.runScenario(parsed.data.scenario, parsed.data.campaignId);
      res.json({ success: true, data: report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

