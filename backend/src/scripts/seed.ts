const apiBase = process.env.SMARTDIALER_API_URL ?? 'http://localhost:4000/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface CampaignSummary {
  id: string;
  name: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch(`${apiBase}${path}`, init);
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? `API request failed with status ${response.status}`);
  }
  return payload;
}

async function main(): Promise<void> {
  const created = await request<CampaignSummary>('/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Synthetic Seed ${new Date().toISOString()}`,
      dialingMode: 'PROGRESSIVE',
      maxConcurrentCalls: 25,
    }),
  });
  const campaign = created.data;

  if (!campaign) throw new Error('No campaign is available to seed.');

  await request(`/campaigns/${encodeURIComponent(campaign.id)}/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentCount: 25, borrowerCount: 100 }),
  });
  console.log(`Seeded 25 synthetic agents and 100 synthetic borrowers into "${campaign.name}" (${campaign.id}).`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed] ${message}`);
  process.exitCode = 1;
});
