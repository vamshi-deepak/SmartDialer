import React, { useState } from 'react';
import { Play, LineChart as ChartIcon, CheckCircle2, ShieldCheck, Zap } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { SimulationResult } from '../types/index.js';
import { runSimulation } from '../services/api.js';

export const SimulationRunner: React.FC = () => {
  const [selectedScenario, setSelectedScenario] = useState<'A' | 'B' | 'C' | 'D'>('A');
  const [dialingMode, setDialingMode] = useState<'PROGRESSIVE' | 'PREDICTIVE'>('PREDICTIVE');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scenarioMeta = {
    A: {
      name: 'Scenario A: 20% Answer Rate, 120s Talk Time',
      badge: 'Aggressive Pacing',
      desc: 'Simulates low pickup collections where predictive overdial is necessary to maintain agent occupancy.',
    },
    B: {
      name: 'Scenario B: 50% Answer Rate, 90s Talk Time',
      badge: 'Balanced Pacing',
      desc: 'Moderate pickup with steady agent turnover and predictable call setup latency.',
    },
    C: {
      name: 'Scenario C: 70% Answer Rate, 180s Talk Time',
      badge: 'High Occupancy',
      desc: 'High pickup consultation calls requiring conservative pacing to prevent abandonment spikes.',
    },
    D: {
      name: 'Scenario D: Carrier Latency Fluctuations & Chaos',
      badge: 'Carrier Chaos',
      desc: 'Unreliable telecom trunk with network jitter and packet loss testing circuit breaker resilience.',
    },
  };

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const res = await runSimulation(selectedScenario, dialingMode);
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Simulation run failed');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="bg-slate-800/60 rounded-xl p-5 border border-slate-700/80 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <ChartIcon className="w-5 h-5 text-indigo-400" />
          <h2 className="text-base font-semibold text-white">Scenario Simulation Engine</h2>
        </div>
        <span className="text-xs text-slate-400 font-mono">Discrete-Event PRNG Benchmark</span>
      </div>

      {/* Scenario Selection Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {(['A', 'B', 'C', 'D'] as const).map((key) => {
          const s = scenarioMeta[key];
          const isSelected = selectedScenario === key;
          return (
            <button
              key={key}
              onClick={() => setSelectedScenario(key)}
              className={`p-3 rounded-lg border text-left transition-all ${
                isSelected
                  ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                  : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs">Scenario {key}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono">
                  {s.badge}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-tight line-clamp-2">{s.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Mode Toggle & Run Trigger */}
      <div className="flex items-center justify-between bg-slate-900/80 p-3 rounded-lg border border-slate-700 mb-5">
        <div className="flex items-center space-x-3">
          <span className="text-xs text-slate-400">Strategy to Test:</span>
          <div className="flex items-center bg-slate-800 p-0.5 rounded border border-slate-700">
            <button
              onClick={() => setDialingMode('PROGRESSIVE')}
              className={`px-3 py-1 rounded text-xs font-semibold flex items-center space-x-1 ${
                dialingMode === 'PROGRESSIVE' ? 'bg-blue-600 text-white' : 'text-slate-400'
              }`}
            >
              <ShieldCheck className="w-3 h-3" />
              <span>Progressive</span>
            </button>
            <button
              onClick={() => setDialingMode('PREDICTIVE')}
              className={`px-3 py-1 rounded text-xs font-semibold flex items-center space-x-1 ${
                dialingMode === 'PREDICTIVE' ? 'bg-indigo-600 text-white' : 'text-slate-400'
              }`}
            >
              <Zap className="w-3 h-3" />
              <span>Predictive</span>
            </button>
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={isRunning}
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white rounded-lg text-xs font-bold flex items-center space-x-2 shadow transition-all"
        >
          <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : 'fill-current'}`} />
          <span>{isRunning ? 'Simulating Ticks...' : `Run Scenario ${selectedScenario}`}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Simulation Result Presentation */}
      {result && (
        <div className="space-y-4">
          {/* Key Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400">Total Initiated</span>
              <div className="text-xl font-bold font-mono text-white mt-0.5">
                {result.totalCallsInitiated}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400">Answer Rate</span>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                {(result.effectiveAnswerRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400">Agent Utilization</span>
              <div className="text-xl font-bold font-mono text-blue-400 mt-0.5">
                {(result.averageAgentUtilization * 100).toFixed(1)}%
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400">Completed Calls</span>
              <div className="text-xl font-bold font-mono text-purple-400 mt-0.5">
                {result.totalCallsCompleted}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400">Invariant Violations</span>
              <div
                className={`text-xl font-bold font-mono mt-0.5 ${
                  result.invariantViolationsCount === 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {result.invariantViolationsCount}
              </div>
            </div>
          </div>

          {/* Timeline Chart */}
          <div className="bg-slate-900/80 p-4 rounded-lg border border-slate-700">
            <h3 className="text-xs font-semibold text-slate-300 mb-3">
              Discrete Tick Timeline (Active Calls vs Agent Pool)
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="tick" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      borderColor: '#475569',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Line
                    type="monotone"
                    dataKey="activeCalls"
                    stroke="#38bdf8"
                    name="Active Calls"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="connectedAgents"
                    stroke="#a855f7"
                    name="Connected Agents"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="availableAgents"
                    stroke="#10b981"
                    name="Available Agents"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="completedCalls"
                    stroke="#f59e0b"
                    name="Completed Calls"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{result.summary}</span>
          </div>
        </div>
      )}
    </div>
  );
};

