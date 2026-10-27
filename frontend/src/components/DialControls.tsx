import React, { useState } from 'react';
import { Play, Pause, Square, PhoneCall, RefreshCw, UserPlus } from 'lucide-react';
import { Campaign } from '../types/index.js';

interface DialControlsProps {
  campaign: Campaign | null;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDial: () => Promise<void>;
  onReconcile: () => Promise<void>;
  onSeed: () => Promise<void>;
}

export const DialControls: React.FC<DialControlsProps> = ({
  campaign,
  onStart,
  onPause,
  onStop,
  onDial,
  onReconcile,
  onSeed,
}) => {
  const [isDialing, setIsDialing] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  const status = campaign?.status ?? 'STOPPED';

  const handleDial = async () => {
    setIsDialing(true);
    try {
      await onDial();
    } finally {
      setIsDialing(false);
    }
  };

  const handleReconcile = async () => {
    setIsReconciling(true);
    try {
      await onReconcile();
    } finally {
      setIsReconciling(false);
    }
  };

  const handleSeed = async () => {
    setIsSeeding(true);
    try {
      await onSeed();
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="bg-slate-800/60 rounded-xl p-5 border border-slate-700/80 shadow-sm flex flex-wrap items-center justify-between gap-4">
      {/* Campaign Lifecycle States */}
      <div className="flex items-center space-x-2">
        <span className="text-xs text-slate-400 font-medium">Campaign Controls:</span>

        {status !== 'ACTIVE' ? (
          <button
            onClick={onStart}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow transition-all"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Start Campaign</span>
          </button>
        ) : (
          <button
            onClick={onPause}
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow transition-all"
          >
            <Pause className="w-3.5 h-3.5 fill-current" />
            <span>Pause Campaign</span>
          </button>
        )}

        <button
          onClick={onStop}
          className="px-3.5 py-2 bg-slate-700 hover:bg-rose-600 text-slate-200 hover:text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all"
        >
          <Square className="w-3.5 h-3.5" />
          <span>Stop</span>
        </button>
      </div>

      {/* Operational Actions */}
      <div className="flex items-center flex-wrap gap-2.5">
        {/* Trigger Dial Cycle */}
        <button
          onClick={handleDial}
          disabled={isDialing || status !== 'ACTIVE'}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-xs font-bold flex items-center space-x-2 shadow transition-all"
        >
          <PhoneCall className={`w-3.5 h-3.5 ${isDialing ? 'animate-bounce' : ''}`} />
          <span>{isDialing ? 'Dialing Trunk...' : 'Trigger Dial Cycle'}</span>
        </button>

        {/* Reconcile Leases */}
        <button
          onClick={handleReconcile}
          disabled={isReconciling}
          className="px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all"
          title="Sweep expired leases and recover orphaned locks"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
          <span>Reconcile Leases</span>
        </button>

        {/* Seed Data */}
        <button
          onClick={handleSeed}
          disabled={isSeeding}
          className="px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all"
          title="Seed 25 agents and 100 borrowers into campaign"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>{isSeeding ? 'Seeding...' : '+ Seed 25 Agents / 100 Borrowers'}</span>
        </button>
      </div>
    </div>
  );
};

