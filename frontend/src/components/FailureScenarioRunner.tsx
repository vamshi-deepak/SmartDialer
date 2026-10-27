import React, { useState } from 'react';
import { Flame, Cpu, Radio, UserMinus, Copy, Shuffle, CheckCircle2 } from 'lucide-react';
import { FailureScenarioReport } from '../types/index.js';
import { runFailureScenario } from '../services/api.js';

interface FailureScenarioRunnerProps {
  campaignId: string;
}

export const FailureScenarioRunner: React.FC<FailureScenarioRunnerProps> = ({ campaignId }) => {
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [report, setReport] = useState<FailureScenarioReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scenarios = [
    {
      id: 'WORKER_CRASH_RESERVATION',
      label: 'Worker Crash',
      desc: 'Crash after reserving agent/borrower; tests lease reclamation.',
      icon: Cpu,
      color: 'border-amber-500/30 text-amber-300 hover:bg-amber-500/10',
    },
    {
      id: 'PROVIDER_OUTAGE',
      label: 'Carrier Outage',
      desc: 'Carrier 503 outage; tests circuit breaker auto-trip.',
      icon: Radio,
      color: 'border-rose-500/30 text-rose-300 hover:bg-rose-500/10',
    },
    {
      id: 'AGENT_DROP',
      label: 'Agent Drop',
      desc: 'Abrupt agent drop offline; tests capacity recalculation.',
      icon: UserMinus,
      color: 'border-purple-500/30 text-purple-300 hover:bg-purple-500/10',
    },
    {
      id: 'DUPLICATE_EVENTS',
      label: 'Duplicate Events',
      desc: 'Duplicate webhook packets; tests deduplication cache.',
      icon: Copy,
      color: 'border-blue-500/30 text-blue-300 hover:bg-blue-500/10',
    },
    {
      id: 'OUT_OF_ORDER_EVENTS',
      label: 'Out-of-Order',
      desc: 'COMPLETED before ANSWERED; tests terminal state immutability.',
      icon: Shuffle,
      color: 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10',
    },
  ];

  const handleRun = async (scenarioId: string) => {
    setRunningScenario(scenarioId);
    setReport(null);
    setError(null);
    try {
      const res = await runFailureScenario(scenarioId, campaignId);
      setReport(res);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failure scenario could not be completed.');
    } finally {
      setRunningScenario(null);
    }
  };

  return (
    <div className="bg-slate-800/60 rounded-xl p-5 border border-slate-700/80 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Flame className="w-5 h-5 text-rose-400" />
          <h2 className="text-base font-semibold text-white">Failure Scenario & Chaos Testing</h2>
        </div>
        <span className="text-xs text-slate-400 font-mono">Live Resilience Verification</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        {scenarios.map((s) => {
          const Icon = s.icon;
          const isLoading = runningScenario === s.id;
          return (
            <button
              key={s.id}
              onClick={() => handleRun(s.id)}
              disabled={runningScenario !== null}
              className={`p-3 rounded-lg border text-left transition-all ${s.color} bg-slate-900/60 disabled:opacity-50`}
            >
              <div className="flex items-center space-x-2 mb-1">
                <Icon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span className="text-xs font-bold">{s.label}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">{s.desc}</p>
            </button>
          );
        })}
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}

      {report && (
        <div className="p-4 bg-slate-900/90 rounded-lg border border-slate-700 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-white flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Scenario: {report.scenario}</span>
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                report.invariantsMaintained
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-rose-500/20 text-rose-300'
              }`}
            >
              {report.invariantsMaintained ? 'INVARIANTS PRESERVED' : 'INVARIANT BREACH'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-slate-300">
            <div>
              <span className="text-slate-500">Chaos Injected:</span>
              <p className="text-amber-300 mt-0.5">{report.chaosInjected}</p>
            </div>
            <div>
              <span className="text-slate-500">Action Taken:</span>
              <p className="text-emerald-300 mt-0.5">{report.systemActionTaken}</p>
            </div>
          </div>

          <div className="pt-2 text-slate-400 border-t border-slate-800">
            <span className="text-slate-500">Outcome: </span>
            <span>{report.explanation}</span>
          </div>
        </div>
      )}
    </div>
  );
};

