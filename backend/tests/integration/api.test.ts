import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createContainer, ServiceContainer } from '../../src/container.js';
import { createApp } from '../../src/api/app.js';
import { Express } from 'express';

describe('SmartDialer REST API Integration Suite', () => {
  let app: Express;
  let container: ServiceContainer;
  let campaignId: string;

  beforeAll(async () => {
    container = await createContainer('in-memory');
    const campaign = await container.campaignManager.createCampaign('Test REST Campaign', {
      dialingMode: 'PROGRESSIVE',
      maxConcurrentCalls: 20,
    });
    campaignId = campaign.id;
    app = createApp(container);
  });

  it('GET /api/health returns healthy system status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('GET /api/campaigns lists active campaigns', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('POST /api/campaigns/:id/seed populates agents and borrowers', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${campaignId}/seed`)
      .send({ agentCount: 5, borrowerCount: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const agentsRes = await request(app).get(`/api/campaigns/${campaignId}/agents`);
    expect(agentsRes.body.counts.AVAILABLE).toBe(5);

    const borrowersRes = await request(app).get(`/api/campaigns/${campaignId}/borrowers`);
    expect(borrowersRes.body.counts.QUEUED).toBe(10);
  });

  it('GET /api/campaigns/:id/recommendation returns a read-only pacing estimate', async () => {
    const res = await request(app).get(`/api/campaigns/${campaignId}/recommendation`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      campaignId,
      recommendedCalls: expect.any(Number),
      estimatedAnswerRate: expect.any(Number),
      expectedAdditionalAnswers: expect.any(Number),
      explanation: expect.any(String),
    });
  });

  it('provider health reports the injected mock outage state', async () => {
    await request(app).post('/api/providers/outage').send({ active: true });
    const outage = await request(app).get('/api/providers/health');
    expect(outage.status).toBe(200);
    expect(outage.body.outageActive).toBe(true);

    await request(app).post('/api/providers/outage').send({ active: false });
    const recovered = await request(app).get('/api/providers/health');
    expect(recovered.body.outageActive).toBe(false);
  });

  it('POST /api/campaigns/:id/start activates campaign', async () => {
    const res = await request(app).post(`/api/campaigns/${campaignId}/start`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('POST /api/campaigns/:id/dial executes progressive dialing cycle', async () => {
    const res = await request(app).post(`/api/campaigns/${campaignId}/dial`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.successfulCalls).toBeGreaterThan(0);
    expect(res.body.data.allocationBreakdown.callsInitiated).toBe(res.body.data.successfulCalls);
    expect(res.body.data.allocationBreakdown.callsCompletedDuringCycle).toBe(0);

    const callsRes = await request(app).get(`/api/campaigns/${campaignId}/calls`);
    expect(callsRes.body.counts.COMPLETED).toBe(0);
    expect(callsRes.body.counts.INITIATED + callsRes.body.counts.RINGING).toBeGreaterThan(0);
    expect(callsRes.body.queuedBorrowers).toBeGreaterThan(0);
  });

  it('GET /api/safety/decisions returns structured decision audit trail', async () => {
    const res = await request(app).get('/api/safety/decisions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('executes a predictive cycle through pacing and the independent safety gate', async () => {
    const created = await request(app)
      .post('/api/campaigns')
      .send({ name: 'Predictive Cycle Test', dialingMode: 'PREDICTIVE', maxConcurrentCalls: 20 });
    const predictiveId = created.body.data.id as string;
    await request(app).post(`/api/campaigns/${predictiveId}/seed`).send({ agentCount: 4, borrowerCount: 8 });
    await request(app).post(`/api/campaigns/${predictiveId}/start`);

    const recommendation = await request(app).get(`/api/campaigns/${predictiveId}/recommendation`);
    const cycle = await request(app).post(`/api/campaigns/${predictiveId}/dial`);
    const agents = await request(app).get(`/api/campaigns/${predictiveId}/agents`);

    expect(recommendation.status).toBe(200);
    expect(cycle.status).toBe(200);
    expect(cycle.body.data.recommendedCalls).toBeGreaterThanOrEqual(0);
    expect(cycle.body.data.safetyApprovedCalls).toBeLessThanOrEqual(4);
    expect(cycle.body.data.successfulCalls).toBeLessThanOrEqual(4);
    expect(agents.body.counts.DIALING + agents.body.counts.CONNECTED).toBeLessThanOrEqual(4);
  });

  it('POST /api/campaigns/:id/pause pauses campaign and blocks dial', async () => {
    await request(app).post(`/api/campaigns/${campaignId}/pause`);
    const dialRes = await request(app).post(`/api/campaigns/${campaignId}/dial`);
    expect(dialRes.status).toBe(200);
    expect(dialRes.body.data.successfulCalls).toBe(0);
    expect(dialRes.body.data.reason).toContain('PAUSED');
  });
});

