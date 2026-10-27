import { Router, Request, Response } from 'express';
import { ServiceContainer } from '../../container.js';
import { InjectEventSchema } from '../validators/campaign.validator.js';
import { ProviderCallEvent } from '../../providers/telecom-provider.interface.js';

export function createProviderRouter(container: ServiceContainer): Router {
  const router = Router();

  // GET /api/providers/health
  router.get('/health', async (_req: Request, res: Response) => {
    const reliableHealth = await container.reliableProvider.getHealth();
    const unreliableHealth = await container.unreliableProvider.getHealth();
    const activeId = container.currentProvider.id;

    res.json({
      success: true,
      activeProvider: activeId,
      outageActive: container.unreliableProvider.outageActive,
      providers: {
        reliable: reliableHealth,
        unreliable: unreliableHealth,
      },
    });
  });

  // POST /api/providers/switch
  router.post('/switch', (req: Request, res: Response) => {
    const type = req.body?.type;
    if (type !== 'reliable' && type !== 'unreliable') {
      res.status(400).json({ success: false, error: "Provider type must be 'reliable' or 'unreliable'" });
      return;
    }

    container.setProvider(type);
    res.json({ success: true, message: `Active telecom provider switched to ${type}.` });
  });

  // POST /api/providers/outage
  router.post('/outage', (req: Request, res: Response) => {
    const active = Boolean(req.body?.active);
    container.unreliableProvider.setOutage(active);
    res.json({ success: true, message: `Carrier outage state set to ${active}.` });
  });

  // POST /api/providers/:providerId/events (Webhook / chaos injection)
  router.post('/:providerId/events', async (req: Request, res: Response) => {
    const parsed = InjectEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, errors: parsed.error.errors });
      return;
    }

    const event: ProviderCallEvent = {
      eventId: parsed.data.eventId ?? `INJ-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      providerCallId: parsed.data.providerCallId ?? `PROV-${parsed.data.callId}`,
      callId: parsed.data.callId,
      campaignId: parsed.data.campaignId,
      eventType: parsed.data.eventType,
      timestamp: new Date(),
    };

    const audit = await container.eventProcessor.processEvent(event);
    res.json({ success: true, audit });
  });

  // GET /api/providers/events/audit
  router.get('/events/audit', (_req: Request, res: Response) => {
    const history = container.eventProcessor.getAuditHistory(100);
    res.json({ success: true, count: history.length, data: history });
  });

  return router;
}

