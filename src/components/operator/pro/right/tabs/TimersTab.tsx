"use client";
import { Play, Pause, RotateCcw } from "lucide-react";
import type { TimerApi, TimerType } from "../../hooks";

function pad(n: number) { return String(Math.max(0, Math.floor(n))).padStart(2, "0"); }
function fmt(secs: number) {
  const s = Math.max(0, secs);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
}

// R4: state is lifted to ProOperatorShell via useTimerSession() so ticks
// survive when Radix Tabs unmounts this component on tab-switch.
export function TimersTab({ api }: { api: TimerApi }) {
  const { state, setName, setType, setDuration, toggleRun, reset } = api;
  const { name, type, duration, remaining, running } = state;

  return (
    <div className="flex flex-col gap-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded"
      />
      <div className="text-3xl font-mono font-semibold tabular-nums text-center py-2">
        {fmt(remaining)}
      </div>
      <div>
        <div className="eyebrow mb-1">Type</div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TimerType)}
          className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded"
        >
          <option value="countdown">Countdown Timer</option>
          <option value="countdown_to">Countdown to Time</option>
          <option value="elapsed">Elapsed Time</option>
        </select>
      </div>
      <div>
        <div className="eyebrow mb-1">Duration (mm:ss)</div>
        <input
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded font-mono"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleRun}
          className="flex-1 h-9 rounded-md bg-[var(--color-brand)] text-black font-semibold flex items-center justify-center gap-1"
        >
          {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={reset}
          className="w-9 h-9 rounded-md border border-[var(--color-border)] flex items-center justify-center"
          title="Reset"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
