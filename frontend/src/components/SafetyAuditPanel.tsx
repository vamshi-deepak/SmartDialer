import React from 'react';
import { ShieldCheck, ShieldAlert, Shield, AlertTriangle, ArrowRight } from 'lucide-react';
import { SafetyDecision } from '../types/index.js';

interface SafetyAuditPanelProps {
  decisions: SafetyDecision[];
}

export const SafetyAuditPanel: React.FC<SafetyAuditPanelProps> = ({ decisions }) => {
  const latest = decisions[decisions.length - 1];

  const getBadge = (decision: SafetyDecision['decision']) => {
    switch (decision) {
      case 'APPROVE':
        return {
          icon: ShieldCheck,
          color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
          label: 'APPROVE',
        };
      case 'REDUCE':
        return {
          icon: AlertTriangle,
          color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
          label: 'REDUCE',
        };
      case 'REJECT':
        return {
          icon: ShieldAlert,
          color: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
          label: 'REJECT',
        };
      case 'FALLBACK_PROGRESSIVE':
        return {
          icon: Shield,
          color: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
          label: 'FALLBACK 1:1',
        };
    }
  };

  return (
    <div className="bg-slate-800/60 rounded-xl p-5 border border-slate-700/80 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-semibold text-white">Safety Controller Audit Stream</h2>
        </div>
        <span className="text-xs text-slate-400 font-mono">Independent Gatekeeper</span>
      </div>

      {/* Latest Decision Spotlight */}
      {latest ? (
        <div className="bg-slate-900/80 rounded-lg p-4 border border-slate-700 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              {(() => {
                const b = getBadge(latest.decision);
                const Icon = b.icon;
                return (
                  <span
                    className={`px-2.5 py-1 rounded-md text-xs font-bold border flex items-center space-x-1 ${b.color}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{b.label}</span>
                  </span>
                );
              })()}
              <span className="text-xs text-slate-400 font-mono">
                {new Date(latest.timestamp).toLocaleTimeString()}
              </span>
            </div>

            <div className="flex items-center space-x-2 text-xs font-mono">
              <span className="text-slate-400">Requested:</span>
              <span className="font-bold text-amber-400">{latest.requestedCalls}</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-400">Approved:</span>
              <span className="font-bold text-emerald-400">{latest.approvedCalls}</span>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed font-mono bg-slate-950/60 p-2.5 rounded border border-slate-800">
            {latest.reason}
          </p>

          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800 text-[11px] font-mono text-slate-400">
            <div>
              Avail Agents:{' '}
              <span className="text-white font-bold">{latest.capacitySnapshot.availableAgents}</span>
            </div>
            <div>
              Active Calls:{' '}
              <span className="text-white font-bold">{latest.capacitySnapshot.totalActiveCalls}</span>
            </div>
            <div>
              Circuit:{' '}
              <span className="text-emerald-400 font-bold">
                {latest.capacitySnapshot.circuitBreakerState}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 text-center text-xs text-slate-500 bg-slate-900/50 rounded-lg mb-4">
          No safety decisions recorded yet. Trigger a dial cycle.
        </div>
      )}

      {/* Decision History Feed */}
      <div className="flex-1 overflow-y-auto max-h-56 space-y-2 pr-1">
        {decisions.slice(-10).reverse().map((d) => {
          const b = getBadge(d.decision);
          return (
            <div
              key={d.id}
              className="p-2.5 rounded-lg bg-slate-900/40 border border-slate-800 text-xs flex items-center justify-between"
            >
              <div className="flex items-center space-x-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${b.color}`}>
                  {b.label}
                </span>
                <span className="text-slate-300 truncate max-w-xs">{d.reason}</span>
              </div>
              <div className="text-[11px] font-mono text-slate-400 whitespace-nowrap ml-2">
                {d.approvedCalls}/{d.requestedCalls} calls
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

