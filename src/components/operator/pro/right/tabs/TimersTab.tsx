"use client";
import { Play, Pause, RotateCcw, Monitor, MonitorOff } from "lucide-react";
import type { TimerApi, TimerType } from "../../hooks";
import { OVERLAY_POSITIONS, type OverlayPosition } from "@/lib/broadcast";

const POSITION_LABELS: Record<OverlayPosition, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  "lower-third": "Lower third",
  "center": "Center",
};

function pad(n: number) { return String(Math.max(0, Math.floor(n))).padStart(2, "0"); }
function fmt(secs: number) {
  const s = Math.max(0, secs);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
}

// R4: state is lifted to ProOperatorShell via useTimerSession() so ticks
// survive when Radix Tabs unmounts this component on tab-switch.
export function TimersTab({ api }: { api: TimerApi }) {
  const { state, setName, setType, setDuration, toggleRun, reset, toggleShown, setPosition } = api;
  const { name, type, duration, remaining, running, shown, position } = state;

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
      <div>
        <div className="eyebrow mb-1">Position</div>
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value as OverlayPosition)}
          className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded"
        >
          {OVERLAY_POSITIONS.map((p) => (
            <option key={p} value={p}>{POSITION_LABELS[p]}</option>
          ))}
        </select>
      </div>
      <button
        onClick={toggleShown}
        className={`h-9 rounded-md font-semibold flex items-center justify-center gap-2 ${
          shown
            ? "bg-red-600 text-white"
            : "border border-[var(--color-border)] text-[var(--color-foreground)]"
        }`}
      >
        {shown ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
        {shown ? "Hide from screen" : "Show on screen"}
      </button>
      {shown && (
        <div className="text-[10px] text-center text-[var(--color-muted-foreground)]">
          Timer live on projector &amp; stage {!running && "(paused)"}
        </div>
      )}
    </div>
  );
}
