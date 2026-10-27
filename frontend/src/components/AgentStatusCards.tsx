import React from 'react';
import { Users, UserCheck, PhoneCall, Headphones, Clock, Coffee } from 'lucide-react';
import { AgentCounts } from '../types/index.js';

interface AgentStatusCardsProps {
  counts: AgentCounts | null;
}

export const AgentStatusCards: React.FC<AgentStatusCardsProps> = ({ counts }) => {
  const c = counts ?? {
    AVAILABLE: 0,
    RESERVED: 0,
    DIALING: 0,
    CONNECTED: 0,
    WRAP_UP: 0,
    PAUSED: 0,
    OFFLINE: 0,
  };

  const totalAgents =
    c.AVAILABLE + c.RESERVED + c.DIALING + c.CONNECTED + c.WRAP_UP + c.PAUSED + c.OFFLINE;
  const activeWorking = c.DIALING + c.CONNECTED;
  const utilizationPct = totalAgents > 0 ? Math.round((activeWorking / totalAgents) * 100) : 0;

  const cards = [
    {
      label: 'Available',
      count: c.AVAILABLE,
      icon: UserCheck,
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      description: 'Ready for new call',
    },
    {
      label: 'Reserved',
      count: c.RESERVED,
      icon: Clock,
      color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
      description: 'Locked by dialer',
    },
    {
      label: 'Dialing',
      count: c.DIALING,
      icon: PhoneCall,
      color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
      description: 'Trunk call in flight',
    },
    {
      label: 'Connected',
      count: c.CONNECTED,
      icon: Headphones,
      color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
      description: 'Active borrower audio',
    },
    {
      label: 'Wrap-Up',
      count: c.WRAP_UP,
      icon: Clock,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
      description: 'Post-call disposition',
    },
    {
      label: 'Paused / Offline',
      count: c.PAUSED + c.OFFLINE,
      icon: Coffee,
      color: 'text-slate-400 bg-slate-800/60 border-slate-700',
      description: 'Unavailable for calls',
    },
  ];

  return (
    <div className="bg-slate-800/60 rounded-xl p-5 border border-slate-700/80 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Users className="w-5 h-5 text-blue-400" />
          <h2 className="text-base font-semibold text-white">Agent Pool Status</h2>
          <span className="text-xs text-slate-400 font-mono">({totalAgents} total)</span>
        </div>
        <div className="flex items-center space-x-2 text-xs">
          <span className="text-slate-400">Utilization:</span>
          <span className="font-bold text-white font-mono">{utilizationPct}%</span>
          <div className="w-24 bg-slate-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${utilizationPct}%` }}
            />
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
              <div className="text-[10px] text-slate-400 mt-0.5">{card.description}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

