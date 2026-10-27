import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Plus, RefreshCw, ShieldCheck, Siren } from 'lucide-react';
import { AgentStatusCards } from './components/AgentStatusCards.js';
import { CallStatusCards } from './components/CallStatusCards.js';
import { DialControls } from './components/DialControls.js';
import { FailureScenarioRunner } from './components/FailureScenarioRunner.js';
import { Header } from './components/Header.js';
import { SafetyAuditPanel } from './components/SafetyAuditPanel.js';
import { SimulationRunner } from './components/SimulationRunner.js';
import {
  createCampaign,
  executeDial,
  fetchAgentCounts,
  fetchCampaigns,
  fetchCallCounts,
  fetchEventAudits,
  fetchMetrics,
  fetchPacingRecommendation,
  fetchProviderStatus,
  fetchSafetyDecisions,
  pauseCampaign,
  reconcileCampaign,
  seedCampaign,
  startCampaign,
  stopCampaign,
  switchProvider,
  toggleProviderOutage,
  updateDialingMode,
} from './services/api.js';
import type {
  AgentCounts,
  Campaign,
  CampaignMetrics,
  CallCounts,
  DialCycleResult,
  EventAudit,
  PacingRecommendation,
  SafetyDecision,
} from './types/index.js';

interface DashboardSnapshot {
  agents: AgentCounts;
  calls: CallCounts;
  metrics: CampaignMetrics;
  decisions: SafetyDecision[];
  events: EventAudit[];
  pacing: PacingRecommendation | null;
}

const emptySnapshot: DashboardSnapshot = {
  agents: { OFFLINE: 0, AVAILABLE: 0, RESERVED: 0, DIALING: 0, CONNECTED: 0, WRAP_UP: 0, PAUSED: 0 },
  calls: { queuedBorrowers: 0, QUEUED: 0, RESERVED: 0, INITIATED: 0, RINGING: 0, ANSWERED: 0, CONNECTED: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 },
  metrics: {
    totalCalls: 0,
    totalInitiated: 0,
    totalAnswered: 0,
    totalConnected: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalCancelled: 0,
    answerRate: 0,
    completionRate: 0,
    agentUtilization: 0,
    averageCallDurationSeconds: 0,
    invariantViolationsCount: 0,
    providerHealth: { isHealthy: false, latencyMs: 0, failureRate: 0, circuitState: 'CLOSED' },
    safetyDecisionsSummary: { total: 0, approved: 0, reduced: 0, rejected: 0, fallbackProgressive: 0 },
  },
  decisions: [],
  events: [],
  pacing: null,
};

export default function App() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [activeProvider, setActiveProvider] = useState<'reliable' | 'unreliable'>('reliable');
  const [outageActive, setOutageActive] = useState(false);
  const [campaignName, setCampaignName] = useState('Collections Sandbox');
  const [initializing, setInitializing] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastCycle, setLastCycle] = useState<DialCycleResult | null>(null);
  const initialized = useRef(false);

  const refreshSnapshot = useCallback(async (id: string) => {
    const [agents, calls, metrics, decisions, events, pacing, provider] = await Promise.all([
      fetchAgentCounts(id),
      fetchCallCounts(id),
      fetchMetrics(id),
      fetchSafetyDecisions(),
      fetchEventAudits(),
      fetchPacingRecommendation(id),
      fetchProviderStatus(),
    ]);
    setActiveProvider(provider.activeProvider === 'unreliable-provider' ? 'unreliable' : 'reliable');
    setOutageActive(provider.outageActive);
    setSnapshot({
      agents,
      calls,
      metrics,
      decisions: decisions.filter((decision) => decision.campaignId === id),
      events,
      pacing,
    });
  }, []);

  const loadCampaigns = useCallback(async () => {
    let list = await fetchCampaigns();
    if (list.length === 0) {
      const campaign = await createCampaign({ name: 'Collections Sandbox' });
      list = [campaign];
    }
    setCampaigns(list);
    setCampaignId((current) => list.some((campaign) => campaign.id === current) ? current : list[0]!.id);
    return list[0]!.id;
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void loadCampaigns()
      .then((id) => refreshSnapshot(id))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Dashboard could not load.'))
      .finally(() => setInitializing(false));
  }, [loadCampaigns, refreshSnapshot]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    const refresh = async () => {
      try {
        const [campaignList] = await Promise.all([fetchCampaigns(), refreshSnapshot(campaignId)]);
        if (active) setCampaigns(campaignList);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Live refresh failed.');
      }
    };
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [campaignId, refreshSnapshot]);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId) ?? null;

  const refreshNow = async () => {
    if (!campaignId) return;
    setRefreshing(true);
    setError('');
    try {
      await refreshSnapshot(campaignId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  const runAction = async (label: string, operation: () => Promise<unknown>): Promise<unknown> => {
    setAction(label);
    setError('');
    setNotice('');
    try {
      const result = await operation();
      if (result && typeof result === 'object' && 'message' in result && typeof result.message === 'string') {
        setNotice(result.message);
      } else {
        setNotice(`${label} completed.`);
      }
      if (campaignId) await refreshSnapshot(campaignId);
      const updatedCampaigns = await fetchCampaigns();
      setCampaigns(updatedCampaigns);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} failed.`);
      return null;
    } finally {
      setAction('');
    }
  };

  const handleCreateCampaign = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAction('Create campaign');
    setError('');
    try {
      const campaign = await createCampaign({ name: campaignName.trim() });
      setCampaigns((current) => [...current, campaign]);
      setCampaignId(campaign.id);
      setCampaignName('');
      setNotice(`Campaign ${campaign.name} created.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Campaign creation failed.');
    } finally {
      setAction('');
    }
  };

  if (initializing) {
    return <main className="app-shell loading-shell"><Activity className="spin" size={18} /> Connecting to SmartDialer API…</main>;
  }

  return (
    <main className="app-shell">
      <Header
        campaign={selectedCampaign}
        metrics={snapshot.metrics}
        activeProvider={activeProvider}
        onModeToggle={(mode) => selectedCampaign && void runAction('Dialing mode updated', () => updateDialingMode(selectedCampaign.id, mode))}
        onEmergencyStop={() => selectedCampaign && void runAction('Emergency stop', () => stopCampaign(selectedCampaign.id))}
        onProviderSwitch={(provider) => void runAction('Provider switched', async () => {
          const result = await switchProvider(provider);
          setActiveProvider(provider);
          return result;
        })}
      />

      <div className="dashboard-content">
        <section className="campaign-toolbar" aria-label="Campaign selection and actions">
          <div className="campaign-picker">
            <label htmlFor="campaign-select">Campaign</label>
            <select id="campaign-select" value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setLastCycle(null); }}>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
            <span className={`status-pill status-${selectedCampaign?.status.toLowerCase() ?? 'stopped'}`}>
              {selectedCampaign?.status ?? 'NO CAMPAIGN'}
            </span>
          </div>
          <div className="campaign-actions">
            <form className="create-campaign" onSubmit={(event) => void handleCreateCampaign(event)}>
              <input
                aria-label="New campaign name"
                maxLength={100}
                minLength={2}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder="New campaign name"
                required
                value={campaignName}
              />
              <button className="icon-button" disabled={Boolean(action)} title="Create campaign" type="submit">
                <Plus size={16} />
              </button>
            </form>
            <button className="icon-button" disabled={refreshing} onClick={() => void refreshNow()} title="Refresh dashboard">
              <RefreshCw className={refreshing ? 'spin' : ''} size={16} />
            </button>
          </div>
        </section>

        {error && <div className="notice notice-error" role="alert"><AlertCircle size={16} /> {error}</div>}
        {notice && !error && <div className="notice notice-success" role="status"><ShieldCheck size={16} /> {notice}</div>}
        {action && <div className="action-progress" role="status"><Activity className="spin" size={14} /> {action}…</div>}

        <DialControls
          campaign={selectedCampaign}
          onStart={() => selectedCampaign && void runAction('Campaign started', () => startCampaign(selectedCampaign.id))}
          onPause={() => selectedCampaign && void runAction('Campaign paused', () => pauseCampaign(selectedCampaign.id))}
          onStop={() => selectedCampaign && void runAction('Campaign stopped', () => stopCampaign(selectedCampaign.id))}
          onDial={async () => {
            if (!selectedCampaign) return;
            const result = await runAction('Dial cycle', () => executeDial(selectedCampaign.id));
            if (result && typeof result === 'object' && 'allocationBreakdown' in result) {
              setLastCycle(result as DialCycleResult);
            }
          }}
          onReconcile={async () => { if (selectedCampaign) await runAction('Lease reconciliation', () => reconcileCampaign(selectedCampaign.id)); }}
          onSeed={async () => { if (selectedCampaign) await runAction('Synthetic seed data', () => seedCampaign(selectedCampaign.id)); }}
        />

        {lastCycle && <section className="cycle-report" aria-live="polite">
          <div className="cycle-report-heading">
            <div><span className="section-kicker">LATEST CYCLE</span><h2>Allocation breakdown</h2></div>
            <span>{lastCycle.reason}</span>
          </div>
          <div className="cycle-report-metrics">
            <div><span>Total agents</span><strong>{lastCycle.allocationBreakdown.totalAgents}</strong></div>
            <div><span>Eligible now</span><strong>{lastCycle.allocationBreakdown.eligibleAgents}</strong></div>
            <div><span>Borrowers queued at start</span><strong>{lastCycle.allocationBreakdown.queuedAtStart}</strong></div>
            <div><span>Pacing recommendation</span><strong>{lastCycle.allocationBreakdown.recommendedCalls}</strong></div>
            <div><span>Safety approved</span><strong>{lastCycle.allocationBreakdown.safetyApprovedCalls}</strong></div>
            <div><span>Calls initiated</span><strong>{lastCycle.allocationBreakdown.callsInitiated}</strong></div>
            <div><span>Completed during cycle</span><strong>{lastCycle.allocationBreakdown.callsCompletedDuringCycle}</strong></div>
            <div><span>Borrowers still queued</span><strong>{lastCycle.allocationBreakdown.callsLeftQueued}</strong></div>
            <div><span>Provider</span><strong>{lastCycle.allocationBreakdown.providerHealthy ? 'Healthy' : 'Degraded'} · {lastCycle.allocationBreakdown.providerLatencyMs} ms</strong></div>
          </div>
          <p>{lastCycle.allocationBreakdown.safetyReason}</p>
        </section>}

        <AgentStatusCards counts={snapshot.agents} />
        <CallStatusCards counts={snapshot.calls} metrics={snapshot.metrics} />

        <section className="operations-grid">
          <SafetyAuditPanel decisions={snapshot.decisions} />
          <section className="provider-panel">
            <div className="panel-heading"><Activity size={17} /><h2>Provider Health</h2></div>
            <div className="provider-state">
              <span className={`health-dot ${snapshot.metrics.providerHealth.isHealthy ? 'healthy' : 'unhealthy'}`} />
              <strong>{snapshot.metrics.providerHealth.isHealthy ? 'Healthy' : 'Degraded'}</strong>
              <span className="circuit-label">Circuit {snapshot.metrics.providerHealth.circuitState}</span>
            </div>
            <dl className="provider-stats">
              <div><dt>Setup latency</dt><dd>{snapshot.metrics.providerHealth.latencyMs} ms</dd></div>
              <div><dt>Failure rate</dt><dd>{(snapshot.metrics.providerHealth.failureRate * 100).toFixed(1)}%</dd></div>
              <div><dt>Active adapter</dt><dd>{activeProvider}</dd></div>
              <div><dt>Invariant violations</dt><dd className={snapshot.metrics.invariantViolationsCount ? 'text-danger' : 'text-good'}>{snapshot.metrics.invariantViolationsCount}</dd></div>
            </dl>
            <button
              className={`outage-control ${outageActive ? 'outage-active' : ''}`}
              disabled={Boolean(action)}
              onClick={() => void runAction(outageActive ? 'Provider outage cleared' : 'Provider outage injected', async () => {
                const result = await toggleProviderOutage(!outageActive);
                setOutageActive(!outageActive);
                return result;
              })}
            >
              <Siren size={15} />
              {outageActive ? 'Clear simulated outage' : 'Inject simulated outage'}
            </button>
            <div className="event-log-heading"><h3>Recent provider events</h3><span>{snapshot.events.length} recorded</span></div>
            <div className="event-list">
              {snapshot.events.length === 0 ? <p className="empty-state">No provider events recorded.</p> : snapshot.events.slice(-8).reverse().map((entry) => (
                <div className="event-row" key={`${entry.eventId}-${entry.timestamp}`}>
                  <span className={`event-outcome outcome-${entry.status.toLowerCase()}`}>{entry.status.replace(/_/g, ' ')}</span>
                  <span className="event-type">{entry.eventType}</span>
                  <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                  <small title={entry.detail}>{entry.detail}</small>
                </div>
              ))}
            </div>
          </section>
        </section>

        <section className="pacing-panel">
          <div className="pacing-title">
            <div><span className="section-kicker">READ-ONLY FORECAST</span><h2>Predictive pacing</h2></div>
            <span className="pacing-timestamp">{snapshot.pacing ? `Updated ${new Date(snapshot.pacing.calculatedAt).toLocaleTimeString()}` : 'Waiting for metrics'}</span>
          </div>
          {snapshot.pacing ? <>
            <div className="pacing-metrics">
              <div><span>Recommended next calls</span><strong>{snapshot.pacing.recommendedCalls}</strong></div>
              <div><span>Smoothed answer estimate</span><strong>{(snapshot.pacing.estimatedAnswerRate * 100).toFixed(1)}%</strong></div>
              <div><span>Expected answers</span><strong>{snapshot.pacing.expectedAdditionalAnswers}</strong></div>
              <div><span>Available capacity</span><strong>{snapshot.pacing.availableAgentCapacity}</strong></div>
              <div><span>Ringing + connected</span><strong>{snapshot.pacing.currentRingingAndConnectedCalls}</strong></div>
            </div>
            <p className="pacing-explanation">{snapshot.pacing.explanation}</p>
            <details className="pacing-assumptions"><summary>Assumptions and confidence limits</summary>
              <ul>{snapshot.pacing.assumptionsOrLimitations.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
            </details>
          </> : <p className="empty-state">Pacing estimate is unavailable until campaign data loads.</p>}
          <p className="pacing-safety-note">Recommendation only. The independent Safety Controller remains authoritative for every initiation.</p>
        </section>

        <SimulationRunner />
        {campaignId && <FailureScenarioRunner campaignId={campaignId} />}
        <footer className="dashboard-footer">Simulation environment only · synthetic borrower data · no real calls are placed</footer>
      </div>
    </main>
  );
}