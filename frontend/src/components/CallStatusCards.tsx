import React from 'react';
import { Phone, PhoneIncoming, PhoneForwarded, CheckCircle2, XCircle, Ban, Layers } from 'lucide-react';
import { CallCounts, CampaignMetrics } from '../types/index.js';

interface CallStatusCardsProps {
  counts: CallCounts | null;
  metrics: CampaignMetrics | null;
}

export const CallStatusCards: React.FC<CallStatusCardsProps> = ({ counts, metrics }) => {
  const c = counts ?? {
    queuedBorrowers: 0,
    QUEUED: 0,
    RESERVED: 0,
    INITIATED: 0,
    RINGING: 0,
    ANSWERED: 0,
    CONNECTED: 0,
    COMPLETED: 0,
    FAILED: 0,
    CANCELLED: 0,
  };

  const answerRatePct = metrics ? Math.round(metrics.answerRate * 100) : 0;
  const avgDuration = metrics?.averageCallDurationSeconds ?? 0;

  const cards = [
    {
      label: 'Queued Borrowers',
      count: c.queuedBorrowers,
      icon: Layers,
      color: 'text-slate-300 bg-slate-800/80 border-slate-700',
    },
    {
      label: 'Ringing / In-Flight',
      count: c.INITIATED + c.RINGING,
      icon: PhoneIncoming,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    },
    {
      label: 'Active Connected',
      count: c.CONNECTED + c.ANSWERED,
      icon: PhoneForwarded,
      color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    },
    {
      label: 'Completed',
      count: c.COMPLETED,
      icon: CheckCircle2,
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'Failed / Busy / No-Ans',
      count: c.FAILED,
      icon: XCircle,
      color: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    },
    {
      label: 'Cancelled / Reconciled',
      count: c.CANCELLED,
      icon: Ban,
      color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    },
  ];

  return (
    <div className="bg-slate-800/60 rounded-xl p-5 border border-slate-700/80 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Phone className="w-5 h-5 text-indigo-400" />
          <h2 className="text-base font-semibold text-white">Call Lifecycle & Queues</h2>
        </div>
        <div className="flex items-center space-x-4 text-xs font-mono">
          <div>
            <span className="text-slate-400">Answer Rate: </span>
            <span className="font-bold text-emerald-400">{answerRatePct}%</span>
          </div>
          <div>
            <span className="text-slate-400">Avg Duration: </span>
            <span className="font-bold text-indigo-300">{avgDuration}s</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={`p-3.5 rounded-lg border ${card.color} transition-all`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-300">{card.label}</span>
                <Icon className="w-3.5 h-3.5 opacity-70" />
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight">{card.count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

