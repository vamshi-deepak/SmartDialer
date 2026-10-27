import { describe, it, expect } from 'vitest';
import { ReliableMockProvider } from '../../src/providers/reliable-mock-provider.js';
import { UnreliableMockProvider } from '../../src/providers/unreliable-mock-provider.js';

describe('Mock Telecom Providers', () => {
  it('ReliableMockProvider initiates calls and returns QUEUED status with low latency', async () => {
    const provider = new ReliableMockProvider({ latencyMs: 5, failureRate: 0 });
    const res = await provider.initiateCall({
      callId: 'call-rel-1',
      campaignId: 'camp-1',
      borrowerPhoneNumber: '+15551112222',
      borrowerName: 'Test Borrower',
    });

    expect(res.status).toBe('QUEUED');
    expect(res.providerCallId).toContain('REL-');

    const health = await provider.getHealth();
    expect(health.isHealthy).toBe(true);
  });

  it('ReliableMockProvider emits observable lifecycle states before delayed completion', async () => {
    const provider = new ReliableMockProvider({
      latencyMs: 0,
      failureRate: 0,
      ringingDelayMs: 5,
      answeredDelayMs: 10,
      connectedDelayMs: 15,
      simulatedTalkDurationMs: 80,
    });
    const events: string[] = [];
    provider.onEvent(async (event) => { events.push(event.eventType); });
    const initiated = await provider.initiateCall({
      callId: 'call-lifecycle',
      campaignId: 'camp-lifecycle',
      borrowerPhoneNumber: '+15550000001',
      borrowerName: 'Synthetic Borrower',
      agentId: 'agent-lifecycle',
    });

    expect(initiated.status).toBe('QUEUED');
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(events).toEqual(['RINGING', 'ANSWERED', 'CONNECTED']);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(events).toEqual(['RINGING', 'ANSWERED', 'CONNECTED', 'COMPLETED']);
  });

  it('UnreliableMockProvider produces reproducible random results with fixed seed', async () => {
    const provider1 = new UnreliableMockProvider({ seed: 12345, latencyMs: 0 });
    const provider2 = new UnreliableMockProvider({ seed: 12345, latencyMs: 0 });

    const res1 = await provider1.initiateCall({
      callId: 'c1',
      campaignId: 'camp-1',
      borrowerPhoneNumber: '+15551112222',
      borrowerName: 'Test Borrower',
    });

    const res2 = await provider2.initiateCall({
      callId: 'c1',
      campaignId: 'camp-1',
      borrowerPhoneNumber: '+15551112222',
      borrowerName: 'Test Borrower',
    });

    expect(res1.status).toBe(res2.status);
    expect(res1.error).toBe(res2.error);
  });

  it('UnreliableMockProvider fails immediately when outage is triggered', async () => {
    const provider = new UnreliableMockProvider({ latencyMs: 0, isOutageActive: true });
    const res = await provider.initiateCall({
      callId: 'c-outage',
      campaignId: 'camp-1',
      borrowerPhoneNumber: '+15550009999',
      borrowerName: 'Outage Borrower',
    });

    expect(res.status).toBe('FAILED');
    expect(res.error).toContain('Major Outage');

    const health = await provider.getHealth();
    expect(health.isHealthy).toBe(false);
  });
});

