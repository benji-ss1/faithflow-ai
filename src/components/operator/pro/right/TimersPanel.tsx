"use client";
/**
 * TimersPanel (Wave 7) — the operator's dedicated Timers surface (rec6: "give
 * timers their own section"). Combines:
 *   - the legacy "Quick timer" (existing TimersTab, wire slot "default") at top,
 *   - a list of church-saved NAMED timers (useTimersSession) with per-timer
 *     start/stop/reset, show/hide, position, edit + delete,
 *   - an add-timer form.
 * Tokens/lucide only — no emojis. Honest empty states.
 */
import { useState } from "react";
import { Play, Pause, RotateCcw, Monitor, MonitorOff, Trash2, Plus, Pencil, Check, X } from "lucide-react";
import { TimersTab } from "./tabs/TimersTab";
import type { TimerApi, TimersApi, TimerSlot } from "../hooks";
import { formatTimerClock, parseDurationToSec } from "@/engine/timers";
import { OVERLAY_POSITIONS, type OverlayPosition } from "@/lib/broadcast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const POSITION_LABELS: Record<OverlayPosition, string> = {
  "top-left": "Top left", "top-right": "Top right",
  "bottom-left": "Bottom left", "bottom-right": "Bottom right",
  "lower-third": "Lower third", "center": "Center",
};

type Draft = { name: string; type: "countdown" | "countdown_to" | "elapsed"; duration: string; targetClock: string };
const EMPTY_DRAFT: Draft = { name: "", type: "countdown", duration: "05:00", targetClock: "12:00" };

export function TimersPanel({ quick, timers }: { quick: TimerApi; timers: TimersApi }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const submit = async () => {
    if (!draft.name.trim()) return;
    await timers.addTimer({
      name: draft.name, type: draft.type,
      durationSec: parseDurationToSec(draft.duration),
      targetClock: draft.type === "countdown_to" ? draft.targetClock : null,
    });
    setDraft(EMPTY_DRAFT); setAdding(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="eyebrow mb-1">Quick timer</div>
        <TimersTab api={quick} />
      </div>

      <div className="border-t border-[var(--color-border)] pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow">Saved timers</div>
          <button
            onClick={() => setAdding((a) => !a)}
            className="flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline"
          >
            <Plus className="w-3 h-3" /> New timer
          </button>
        </div>

        {adding && (
          <div className="flex flex-col gap-2 mb-3 p-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]">
            <input
              autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Timer name (e.g. Sermon)"
              className="h-8 px-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded text-[12px]"
            />
            <select
              value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })}
              className="h-8 px-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded text-[12px]"
            >
              <option value="countdown">Countdown</option>
              <option value="countdown_to">Countdown to time</option>
              <option value="elapsed">Elapsed (stopwatch)</option>
            </select>
            {draft.type === "countdown_to" ? (
              <input
                value={draft.targetClock} onChange={(e) => setDraft({ ...draft, targetClock: e.target.value })}
                placeholder="HH:MM"
                className="h-8 px-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded font-mono text-[12px]"
              />
            ) : draft.type === "countdown" ? (
              <input
                value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
                placeholder="mm:ss"
                className="h-8 px-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded font-mono text-[12px]"
              />
            ) : null}
            <div className="flex gap-2">
              <button onClick={submit} className="flex-1 h-8 rounded bg-[var(--color-brand)] text-black font-semibold text-[12px] flex items-center justify-center gap-1">
                <Check className="w-3.5 h-3.5" /> Save
              </button>
              <button onClick={() => { setAdding(false); setDraft(EMPTY_DRAFT); }} className="w-8 h-8 rounded border border-[var(--color-border)] flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {timers.loading ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)] py-2">Loading timers…</div>
        ) : timers.slots.length === 0 ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)] py-2">
            No saved timers yet. Add one for your sermon, worship set, or announcements countdown.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {timers.slots.map((s) => <SlotRow key={s.def.id} slot={s} timers={timers} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function SlotRow({ slot, timers }: { slot: TimerSlot; timers: TimersApi }) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Draft>({
    name: slot.def.name,
    type: slot.def.type,
    duration: formatTimerClock(slot.def.durationSec),
    targetClock: slot.targetClock ?? "12:00",
  });
  const running = slot.def.type === "countdown_to" ? true : slot.runtime.running;

  const saveEdit = async () => {
    await timers.editTimer(slot.def.id, {
      name: d.name, type: d.type,
      durationSec: parseDurationToSec(d.duration),
      targetClock: d.type === "countdown_to" ? d.targetClock : null,
    });
    setEditing(false);
  };

  return (
    <div className="rounded border border-[var(--color-border)] p-2 flex flex-col gap-2">
      {confirmDialog}
      {editing ? (
        <div className="flex flex-col gap-2">
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className="h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[12px]" />
          <select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as Draft["type"] })} className="h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[12px]">
            <option value="countdown">Countdown</option>
            <option value="countdown_to">Countdown to time</option>
            <option value="elapsed">Elapsed</option>
          </select>
          {d.type === "countdown_to" ? (
            <input value={d.targetClock} onChange={(e) => setD({ ...d, targetClock: e.target.value })} placeholder="HH:MM" className="h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded font-mono text-[12px]" />
          ) : d.type === "countdown" ? (
            <input value={d.duration} onChange={(e) => setD({ ...d, duration: e.target.value })} placeholder="mm:ss" className="h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded font-mono text-[12px]" />
          ) : null}
          <div className="flex gap-2">
            <button onClick={saveEdit} className="flex-1 h-7 rounded bg-[var(--color-brand)] text-black font-semibold text-[11px]">Save</button>
            <button onClick={() => setEditing(false)} className="px-2 h-7 rounded border border-[var(--color-border)] text-[11px]">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium truncate">{slot.def.name}</span>
            <span className={`text-[15px] font-mono tabular-nums font-semibold ${slot.overrun ? "text-red-400" : ""}`}>
              {formatTimerClock(slot.remaining)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => timers.command(slot.def.id, running ? "stop" : "start")}
              disabled={slot.def.type === "countdown_to"}
              title={slot.def.type === "countdown_to" ? "Counts to a clock time automatically" : running ? "Stop" : "Start"}
              className="flex-1 h-7 rounded bg-[var(--color-brand)] text-black font-semibold text-[11px] flex items-center justify-center gap-1 disabled:opacity-40"
            >
              {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {running ? "Stop" : "Start"}
            </button>
            <button onClick={() => timers.command(slot.def.id, "reset")} title="Reset" className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => timers.toggleShown(slot.def.id)} title={slot.shown ? "Hide from screen" : "Show on screen"} className={`w-7 h-7 rounded flex items-center justify-center ${slot.shown ? "bg-red-600 text-white" : "border border-[var(--color-border)]"}`}>
              {slot.shown ? <MonitorOff className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => setEditing(true)} title="Edit" className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={async () => { if (await confirm({ title: `Delete timer "${slot.def.name}"?`, confirmLabel: "Delete", danger: true })) timers.removeTimer(slot.def.id); }}
              title="Delete" className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center text-red-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {slot.shown && (
            <>
              <select
                value={slot.position}
                onChange={(e) => timers.setPosition(slot.def.id, e.target.value as OverlayPosition)}
                className="h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[11px]"
              >
                {OVERLAY_POSITIONS.map((p) => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}
              </select>
              {/* Size control — the operator's "make it bigger" ask. Slider from
                  0.5× to 5×; the number renders as clean big digits on outputs. */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--color-muted-foreground)] w-8">Size</span>
                <input
                  type="range" min={0.5} max={5} step={0.25}
                  value={slot.scale}
                  onChange={(e) => timers.setScale(slot.def.id, Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-[10px] font-mono tabular-nums w-8 text-right">{slot.scale.toFixed(2)}×</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
