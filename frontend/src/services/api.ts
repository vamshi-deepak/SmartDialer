import {
  Campaign,
  AgentCounts,
  CallCounts,
  SafetyDecision,
  EventAudit,
  CampaignMetrics,
  PacingRecommendation,
  SimulationResult,
  FailureScenarioReport,
  DialCycleResult,
} from '../types/index.js';

const API_BASE = '/api';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = await response.json() as { success?: boolean; data?: T; error?: string; message?: string };
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return payload.data as T;
}

export async function fetchCampaigns(): Promise<Campaign[]> {
  return requestJson<Campaign[]>('/campaigns');
}

export async function createCampaign(input: {
  name: string;
  dialingMode?: 'PROGRESSIVE' | 'PREDICTIVE';
  maxConcurrentCalls?: number;
  targetAbandonmentRate?: number;
  providerId?: 'reliable' | 'unreliable';
}): Promise<Campaign> {
  return requestJson<Campaign>('/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function startCampaign(id: string): Promise<Campaign> {
  const res = await fetch(`${API_BASE}/campaigns/${id}/start`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export async function pauseCampaign(id: string): Promise<Campaign> {
  const res = await fetch(`${API_BASE}/campaigns/${id}/pause`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export async function stopCampaign(id: string): Promise<Campaign> {
  const res = await fetch(`${API_BASE}/campaigns/${id}/stop`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export async function updateDialingMode(id: string, mode: 'PROGRESSIVE' | 'PREDICTIVE'): Promise<Campaign> {
  const res = await fetch(`${API_BASE}/campaigns/${id}/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export async function executeDial(id: string): Promise<DialCycleResult> {
  return requestJson<DialCycleResult>(`/campaigns/${id}/dial`, { method: 'POST' });
}

export async function reconcileCampaign(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/campaigns/${id}/reconcile`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export async function seedCampaign(id: string, agentCount = 25, borrowerCount = 100): Promise<any> {
  const res = await fetch(`${API_BASE}/campaigns/${id}/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentCount, borrowerCount }),
  });
  const data = await res.json();
  return data;
}

export async function fetchAgentCounts(id: string): Promise<AgentCounts> {
  const response = await fetch(`${API_BASE}/campaigns/${id}/agents`);
  const payload = await response.json() as { success?: boolean; counts?: AgentCounts; error?: string };
  if (!response.ok || payload.success === false || !payload.counts) throw new Error(payload.error ?? 'Could not load agent counts.');
  return payload.counts;
}

export async function fetchCallCounts(id: string): Promise<CallCounts> {
  const response = await fetch(`${API_BASE}/campaigns/${id}/calls`);
  const payload = await response.json() as { success?: boolean; counts?: Omit<CallCounts, 'queuedBorrowers'>; queuedBorrowers?: number; error?: string };
  if (!response.ok || payload.success === false || !payload.counts) throw new Error(payload.error ?? 'Could not load call counts.');
  return { ...payload.counts, queuedBorrowers: payload.queuedBorrowers ?? 0 };
}

export async function fetchMetrics(id: string): Promise<CampaignMetrics> {
  return requestJson<CampaignMetrics>(`/campaigns/${id}/metrics`);
}

export async function fetchPacingRecommendation(id: string): Promise<PacingRecommendation> {
  return requestJson<PacingRecommendation>(`/campaigns/${id}/recommendation`);
}

export async function fetchSafetyDecisions(): Promise<SafetyDecision[]> {
  return requestJson<SafetyDecision[]>('/safety/decisions');
}

export async function fetchEventAudits(): Promise<EventAudit[]> {
  return requestJson<EventAudit[]>('/providers/events/audit');
}

export interface ProviderStatus {
  activeProvider: string;
  outageActive: boolean;
  providers: Record<string, { isHealthy: boolean; latencyMs: number; failureRate: number }>;
}

export async function fetchProviderStatus(): Promise<ProviderStatus> {
  const response = await fetch(`${API_BASE}/providers/health`);
  const payload = await response.json() as { success?: boolean; activeProvider?: string; outageActive?: boolean; providers?: ProviderStatus['providers']; error?: string };
  if (!response.ok || !payload.success || !payload.providers) throw new Error(payload.error ?? 'Could not load provider status.');
  return {
    activeProvider: payload.activeProvider ?? 'reliable',
    outageActive: payload.outageActive ?? false,
    providers: payload.providers,
  };
}

export async function switchProvider(type: 'reliable' | 'unreliable'): Promise<any> {
  return requestJson<unknown>('/providers/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
}

export async function toggleProviderOutage(active: boolean): Promise<any> {
  return requestJson<unknown>('/providers/outage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  });
}

export async function runSimulation(scenarioKey?: string, dialingMode?: string): Promise<SimulationResult> {
  const res = await fetch(`${API_BASE}/simulation/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioKey, dialingMode }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export async function runFailureScenario(scenario: string, campaignId: string): Promise<FailureScenarioReport> {
  const res = await fetch(`${API_BASE}/simulation/failure-scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, campaignId }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

