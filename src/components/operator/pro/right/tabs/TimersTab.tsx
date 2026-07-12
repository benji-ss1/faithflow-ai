"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";

const KEY = "presentflow.pro.timer.v1";
type TimerType = "countdown" | "countdown_to" | "elapsed";

function pad(n: number) { return String(Math.max(0, Math.floor(n))).padStart(2, "0"); }
function fmt(secs: number) {
  const s = Math.max(0, secs);
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
}

export function TimersTab() {
  const [name, setName] = useState("Timer");
  const [type, setType] = useState<TimerType>("countdown");
  const [duration, setDuration] = useState("05:00");
  const [remaining, setRemaining] = useState(300);
  const [running, setRunning] = useState(false);
  const startedAt = useRef<number | null>(null);
  const baseline = useRef(300);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        setName(p.name ?? "Timer");
        setType(p.type ?? "countdown");
        setDuration(p.duration ?? "05:00");
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify({ name, type, duration })); } catch { /* noop */ }
    const [mm, ss] = duration.split(":").map((x) => parseInt(x, 10) || 0);
    baseline.current = mm * 60 + ss;
    if (!running) setRemaining(baseline.current);
  }, [name, type, duration, running]);

  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const start = baseline.current;
    const id = setInterval(() => {
      const elapsed = (Date.now() - (startedAt.current ?? Date.now())) / 1000;
      setRemaining(type === "elapsed" ? elapsed : start - elapsed);
    }, 250);
    return () => clearInterval(id);
  }, [running, type]);

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
          onClick={() => setRunning((r) => !r)}
          className="flex-1 h-9 rounded-md bg-[var(--color-brand)] text-black font-semibold flex items-center justify-center gap-1"
        >
          {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={() => { setRunning(false); setRemaining(baseline.current); }}
          className="w-9 h-9 rounded-md border border-[var(--color-border)] flex items-center justify-center"
          title="Reset"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
