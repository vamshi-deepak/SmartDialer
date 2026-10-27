import { Router, Request, Response } from 'express';
import { ServiceContainer } from '../../container.js';
import {
  CreateCampaignSchema,
  UpdateDialingModeSchema,
  SeedCampaignSchema,
} from '../validators/campaign.validator.js';
import { Agent } from '../../domain/agent/agent.types.js';
import { Borrower } from '../../domain/borrower/borrower.types.js';

export function createCampaignRouter(container: ServiceContainer): Router {
  const router = Router();

  // GET /api/campaigns
  router.get('/', (_req: Request, res: Response) => {
    const list = container.campaignManager.listCampaigns();
    res.json({ success: true, data: list });
  });

  // POST /api/campaigns
  router.post('/', async (req: Request, res: Response) => {
    const parsed = CreateCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, errors: parsed.error.errors });
      return;
    }

    const campaign = await container.campaignManager.createCampaign(parsed.data.name, {
      dialingMode: parsed.data.dialingMode,
      maxConcurrentCalls: parsed.data.maxConcurrentCalls,
      targetAbandonmentRate: parsed.data.targetAbandonmentRate,
      providerId: parsed.data.providerId,
    });

    res.status(201).json({ success: true, data: campaign });
  });

  // GET /api/campaigns/:id
  router.get('/:id', (req: Request, res: Response) => {
    const campaign = container.campaignManager.getCampaign(req.params.id as string);
    if (!campaign) {
      res.status(404).json({ success: false, error: 'Campaign not found' });
      return;
    }
    res.json({ success: true, data: campaign });
  });

  // POST /api/campaigns/:id/start
  router.post('/:id/start', async (req: Request, res: Response) => {
    try {
      const campaign = await container.campaignManager.startCampaign(req.params.id as string);
      res.json({ success: true, data: campaign });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /api/campaigns/:id/pause
  router.post('/:id/pause', async (req: Request, res: Response) => {
    try {
      const campaign = await container.campaignManager.pauseCampaign(req.params.id as string);
      res.json({ success: true, data: campaign });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /api/campaigns/:id/stop (Emergency Stop)
  router.post('/:id/stop', async (req: Request, res: Response) => {
    try {
      const campaign = await container.campaignManager.stopCampaign(req.params.id as string);
      res.json({ success: true, data: campaign });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /api/campaigns/:id/mode
  router.post('/:id/mode', async (req: Request, res: Response) => {
    const parsed = UpdateDialingModeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, errors: parsed.error.errors });
      return;
    }

    try {
      const campaign = await container.campaignManager.updateDialingMode(
        req.params.id as string,
        parsed.data.mode
      );
      res.json({ success: true, data: campaign });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // GET /api/campaigns/:id/agents
  router.get('/:id/agents', async (req: Request, res: Response) => {
    const agents = await container.agentRepo.findByCampaign(req.params.id as string);
    const counts = await container.agentRepo.countByState(req.params.id as string);
    res.json({ success: true, counts, data: agents });
  });

  // GET /api/campaigns/:id/borrowers
  router.get('/:id/borrowers', async (req: Request, res: Response) => {
    const borrowers = await container.borrowerRepo.findByCampaign(req.params.id as string);
    const counts = await container.borrowerRepo.countByState(req.params.id as string);
    res.json({ success: true, counts, data: borrowers });
  });

  // GET /api/campaigns/:id/calls
  router.get('/:id/calls', async (req: Request, res: Response) => {
    const calls = await container.callRepo.findByCampaign(req.params.id as string);
    const counts = await container.callRepo.countByState(req.params.id as string);
    const borrowerCounts = await container.borrowerRepo.countByState(req.params.id as string);
    res.json({ success: true, counts, queuedBorrowers: borrowerCounts.QUEUED, data: calls });
  });

  // GET /api/campaigns/:id/metrics
  router.get('/:id/metrics', async (req: Request, res: Response) => {
    const metrics = await container.metricsCollector.collectMetrics(req.params.id as string);
    res.json({ success: true, data: metrics });
  });

  // GET /api/campaigns/:id/recommendation
  router.get('/:id/recommendation', async (req: Request, res: Response) => {
    try {
      const recommendation = await container.campaignManager.getPacingRecommendation(req.params.id as string);
      res.json({ success: true, data: recommendation });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  // POST /api/campaigns/:id/dial
  router.post('/:id/dial', async (req: Request, res: Response) => {
    try {
      const result = await container.campaignManager.executeDialCycle(req.params.id as string);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /api/campaigns/:id/reconcile
  router.post('/:id/reconcile', async (req: Request, res: Response) => {
    try {
      const report = await container.campaignManager.runReconciliation(req.params.id as string);
      res.json({ success: true, data: report });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /api/campaigns/:id/seed (Seeds synthetic agents and borrowers)
  router.post('/:id/seed', async (req: Request, res: Response) => {
    const parsed = SeedCampaignSchema.safeParse(req.body);
    const agentCount = parsed.success ? parsed.data.agentCount : 20;
    const borrowerCount = parsed.success ? parsed.data.borrowerCount : 100;
    const campaignId = req.params.id as string;

    const firstNames = ['James', 'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];

    // Seed agents
    for (let i = 1; i <= agentCount; i++) {
      const firstName = firstNames[i % firstNames.length];
      const lastName = lastNames[i % lastNames.length];
      const agent: Agent = {
        id: `agent-${campaignId}-${i}`,
        campaignId,
        name: `${firstName} ${lastName}`,
        state: 'AVAILABLE',
        currentCallId: null,
        version: 1,
        reservationLeaseExpiresAt: null,
        lastStateChangeAt: new Date(),
        stateChangeReason: 'Seeded into pool',
        stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await container.agentRepo.save(agent);
    }

    // Seed borrowers
    for (let i = 1; i <= borrowerCount; i++) {
      const firstName = firstNames[(i * 3) % firstNames.length];
      const lastName = lastNames[(i * 7) % lastNames.length];
      const borrower: Borrower = {
        id: `bor-${campaignId}-${i}`,
        campaignId,
        name: `${firstName} ${lastName}`,
        phoneNumber: `+1555${String(i).padStart(7, '0')}`,
        debtAmount: Math.round(500 + (i * 123.45) % 8000),
        priority: (i % 3) + 1,
        state: 'QUEUED',
        attemptsCount: 0,
        version: 1,
        lastAttemptAt: null,
        reservationLeaseExpiresAt: null,
        createdAt: new Date(Date.now() - (borrowerCount - i) * 60000),
        updatedAt: new Date(),
      };
      await container.borrowerRepo.save(borrower);
    }

    res.json({
      success: true,
      message: `Successfully seeded ${agentCount} agents and ${borrowerCount} borrowers into campaign ${campaignId}.`,
    });
  });

  return router;
}

