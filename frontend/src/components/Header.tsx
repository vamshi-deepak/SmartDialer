import React from 'react';
import { PhoneCall, ShieldAlert, ShieldCheck, Activity, Zap, Radio } from 'lucide-react';
import { Campaign, CampaignMetrics } from '../types/index.js';

interface HeaderProps {
  campaign: Campaign | null;
  metrics: CampaignMetrics | null;
  onModeToggle: (newMode: 'PROGRESSIVE' | 'PREDICTIVE') => void;
  onEmergencyStop: () => void;
  onProviderSwitch: (type: 'reliable' | 'unreliable') => void;
  activeProvider: string;
}

export const Header: React.FC<HeaderProps> = ({
  campaign,
  metrics,
  onModeToggle,
  onEmergencyStop,
  onProviderSwitch,
  activeProvider,
}) => {
  const isPredictive = campaign?.config.dialingMode === 'PREDICTIVE';
  const circuitState = metrics?.providerHealth.circuitState ?? 'CLOSED';
  const isEmergency = campaign?.status === 'STOPPED';

  return (
    <header className="bg-slate-800/80 border-b border-slate-700 backdrop-blur sticky top-0 z-50 px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30">
            <PhoneCall className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold tracking-tight text-white">SmartDialer</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40 font-mono">
                Safe Pacing Engine
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Progressive & Predictive Contact Center Simulator
            </p>
          </div>
        </div>

        {/* Campaign Info & Controls */}
        <div className="flex items-center flex-wrap gap-3">
          {/* Dialing Mode Toggle */}
          <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => onModeToggle('PROGRESSIVE')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 ${
                !isPredictive
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Progressive (1:1)</span>
            </button>
            <button
              onClick={() => onModeToggle('PREDICTIVE')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 ${
                isPredictive
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Predictive (Pacing)</span>
            </button>
          </div>

          {/* Provider Switch */}
          <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => onProviderSwitch('reliable')}
              className={`px-2.5 py-1.5 text-xs rounded-md transition-all flex items-center space-x-1 ${
                activeProvider === 'reliable'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>Reliable Carrier</span>
            </button>
            <button
              onClick={() => onProviderSwitch('unreliable')}
              className={`px-2.5 py-1.5 text-xs rounded-md transition-all flex items-center space-x-1 ${
                activeProvider === 'unreliable'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-3 h-3" />
              <span>Chaos Carrier</span>
            </button>
          </div>

          {/* Circuit Breaker Status */}
          <div
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono flex items-center space-x-1.5 ${
              circuitState === 'CLOSED'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : circuitState === 'HALF_OPEN'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400 animate-pulse'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-current" />
            <span>CIRCUIT: {circuitState}</span>
          </div>

          {/* Emergency Stop Button */}
          <button
            onClick={onEmergencyStop}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 shadow ${
              isEmergency
                ? 'bg-rose-900/60 text-rose-300 border border-rose-500/50'
                : 'bg-rose-600 hover:bg-rose-500 text-white'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>{isEmergency ? 'CAMPAIGN STOPPED' : 'EMERGENCY STOP'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

