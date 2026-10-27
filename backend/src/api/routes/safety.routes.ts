import { Router, Request, Response } from 'express';
import { ServiceContainer } from '../../container.js';

export function createSafetyRouter(container: ServiceContainer): Router {
  const router = Router();

  // GET /api/safety/decisions
  router.get('/decisions', (_req: Request, res: Response) => {
    const decisions = container.safetyController.getRecentDecisions(100).map(
      ({ decisionToken: _decisionToken, ...decision }) => decision
    );
    res.json({ success: true, count: decisions.length, data: decisions });
  });

  // GET /api/safety/status
  router.get('/status', (_req: Request, res: Response) => {
    const circuitSnapshot = container.safetyController.getCircuitBreaker().getSnapshot();
    res.json({
      success: true,
      circuitBreaker: circuitSnapshot,
    });
  });

  return router;
}

