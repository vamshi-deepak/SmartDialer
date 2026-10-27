import dotenv from 'dotenv';
import { createContainer } from '../container.js';
import { createApp } from './app.js';
import { Agent } from '../domain/agent/agent.types.js';
import { Borrower } from '../domain/borrower/borrower.types.js';

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const STORAGE_MODE = (process.env.STORAGE_MODE as 'in-memory' | 'mongodb') || 'in-memory';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smartdialer';
const DEMO_AGENT_COUNT = Math.min(500, Math.max(1, Number(process.env.DEMO_AGENT_COUNT) || 25));
const DEMO_BORROWER_COUNT = Math.min(2000, Math.max(1, Number(process.env.DEMO_BORROWER_COUNT) || 100));

async function bootstrap() {
  console.log(`[SmartDialer] Initializing server in ${STORAGE_MODE} storage mode...`);
  const container = await createContainer(STORAGE_MODE, STORAGE_MODE === 'mongodb' ? MONGODB_URI : undefined);

  // Seed default demonstration campaign if none exist
  const existingCampaigns = container.campaignManager.listCampaigns();
  if (existingCampaigns.length === 0) {
    const demoCampaign = await container.campaignManager.createCampaign('Collections Alpha - Safe Progressive & Predictive', {
      dialingMode: 'PROGRESSIVE',
      maxConcurrentCalls: 50,
      targetAbandonmentRate: 0.03,
      providerId: 'reliable',
    });

    console.log(`[SmartDialer] Seeded demo campaign: ${demoCampaign.id} (${demoCampaign.name})`);

    // Seed a configurable synthetic agent pool for the local demo.
    const names = [
      'Sarah Connor', 'John Matrix', 'Ellen Ripley', 'James Kirk', 'Spock Prime',
      'Dana Scully', 'Fox Mulder', 'Jean-Luc Picard', 'Leia Organa', 'Luke Skywalker',
      'Arthur Dent', 'Ford Prefect', 'Marty McFly', 'Doc Brown', 'Tony Stark'
    ];

    for (let i = 0; i < DEMO_AGENT_COUNT; i++) {
      const agent: Agent = {
        id: `agent-${demoCampaign.id}-${i + 1}`,
        campaignId: demoCampaign.id,
        name: names[i % names.length] ?? `Agent ${i + 1}`,
        state: 'AVAILABLE',
        currentCallId: null,
        version: 1,
        reservationLeaseExpiresAt: null,
        lastStateChangeAt: new Date(),
        stateChangeReason: 'Initial bootstrap seeding',
        stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await container.agentRepo.save(agent);
    }

    for (let i = 1; i <= DEMO_BORROWER_COUNT; i++) {
      const borrower: Borrower = {
        id: `bor-${demoCampaign.id}-${i}`,
        campaignId: demoCampaign.id,
        name: `Borrower Case #${1000 + i}`,
        phoneNumber: `+1555${String(i).padStart(7, '0')}`,
        debtAmount: Math.round(500 + (i * 137.5) % 5000),
        priority: (i % 3) + 1,
        state: 'QUEUED',
        attemptsCount: 0,
        version: 1,
        lastAttemptAt: null,
        reservationLeaseExpiresAt: null,
        createdAt: new Date(Date.now() - (DEMO_BORROWER_COUNT - i) * 60000),
        updatedAt: new Date(),
      };
      await container.borrowerRepo.save(borrower);
    }

    console.log(`[SmartDialer] Seeded ${DEMO_AGENT_COUNT} agents and ${DEMO_BORROWER_COUNT} borrowers into ${demoCampaign.id}`);
  }

  const app = createApp(container);

  app.listen(PORT, () => {
    console.log(`[SmartDialer] Server running on http://localhost:${PORT}`);
    console.log(`[SmartDialer] Health check: http://localhost:${PORT}/api/health`);
    console.log(`[SmartDialer] Campaigns: http://localhost:${PORT}/api/campaigns`);
  });
}

bootstrap().catch((err) => {
  console.error('[SmartDialer] Fatal startup error:', err);
  process.exit(1);
});

