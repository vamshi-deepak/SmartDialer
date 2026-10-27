import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ServiceContainer } from '../container.js';
import { createCampaignRouter } from './routes/campaign.routes.js';
import { createSafetyRouter } from './routes/safety.routes.js';
import { createProviderRouter } from './routes/provider.routes.js';
import { createSimulationRouter } from './routes/simulation.routes.js';

export function createApp(container: ServiceContainer): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // GET /api/health
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'SmartDialer Core',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Mount feature routers
  app.use('/api/campaigns', createCampaignRouter(container));
  app.use('/api/safety', createSafetyRouter(container));
  app.use('/api/providers', createProviderRouter(container));
  app.use('/api/simulation', createSimulationRouter(container));

  // Global Error Handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API Error]:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Internal Server Error',
    });
  });

  return app;
}
