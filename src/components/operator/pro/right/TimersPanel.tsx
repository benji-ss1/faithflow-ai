"use client";
/**
 * TimersPanel — the operator's Timers surface, rebuilt 2026-09-21 to match
 * ProPresenter 1:1 (CLAUDE.md rule 0a, docs/PRODUCT_DOCTRINE.md).
 *
 * Mirrors ProPresenter's Timers panel from the reference screenshot:
 *   - "+" at the UPPER RIGHT adds a timer (defaults to Countdown)
 *   - each timer is a COLLAPSIBLE row: collapsed shows name, clock, progress
 *     bar and transport; expanded reveals the full editor
 *   - Type dropdown: Countdown Timer / Countdown to Time / Elapsed Time
 *   - Duration H:MM:SS, Countdown-to time + AM/PM/24-hour, Elapsed start/end
 *   - "Allows Overrun" checkbox
 *
 * Plus the customisation ProPresenter reaches through its Theme / Stage layout,
 * surfaced HERE so an operator can design a timer without leaving the panel:
 * screen position (incl. lower/upper third), size, colour, overrun colour,
 * name label, hours + leading-zero format, and Color Triggers.
 */
import { useState } from "react";
import {
  Play, Pause, RotateCcw, Monitor, MonitorOff, Trash2, Plus, Check, X,
  ChevronRight, ChevronDown, Palette,
} from "lucide-react";
import { TimersTab } from "./tabs/TimersTab";
import type { TimerApi, TimersApi, TimerSlot } from "../hooks";
import { formatTimerClock, parseDurationToSec } from "@/engine/timers";
import { OVERLAY_POSITIONS, type OverlayPosition } from "@/lib/broadcast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const POSITION_LABELS: Record<OverlayPosition, string> = {
  "top-left": "Top left", "top-right": "Top right",
  "bottom-left": "Bottom left", "bottom-right": "Bottom right",
  "lower-third": "Lower third", "center": "Centre",
};

/** ProPresenter's own type names, not our internal ids. */
const TYPE_LABELS = {
  countdown: "Countdown Timer",
  countdown_to: "Countdown to Time",
  elapsed: "Elapsed Time",
} as const;

type TimerType = keyof typeof TYPE_LABELS;
type Period = "am" | "pm" | "24_hour";

type Draft = {
  name: string; type: TimerType; duration: string;
  targetClock: string; period: Period;
  elapsedStart: string; elapsedEnd: string; allowsOverrun: boolean;
};

const EMPTY_DRAFT: Draft = {
  name: "", type: "countdown", duration: "05:00",
  targetClock: "11:00", period: "am",
  elapsedStart: "", elapsedEnd: "", allowsOverrun: false,
};

const input = "h-8 px-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded text-[12px] w-full";
const field = "h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[12px] w-full";
const label = "text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]";

/** Seconds → "M:SS" for the optional elapsed bounds. Blank stays blank, which
 *  is meaningful: ProPresenter treats an omitted end as "unlimited". */
const secToClock = (s: number | null | undefined) =>
  s === null || s === undefined ? "" : formatTimerClock(s);
const clockToSec = (v: string) => (v.trim() === "" ? null : parseDurationToSec(v));

function draftToInput(d: Draft) {
  return {
    name: d.name,
    type: d.type,
    durationSec: parseDurationToSec(d.duration),
    targetClock: d.type === "countdown_to" ? d.targetClock : null,
    period: d.type === "countdown_to" ? d.period : null,
    elapsedStartSec: d.type === "elapsed" ? clockToSec(d.elapsedStart) : null,
    elapsedEndSec: d.type === "elapsed" ? clockToSec(d.elapsedEnd) : null,
    allowsOverrun: d.allowsOverrun,
  };
}

/** The type-specific fields. Shared by the add form and the row editor so the
 *  two can never drift apart. */
function TypeFields({ d, set }: { d: Draft; set: (p: Partial<Draft>) => void }) {
  return (
    <>
      <select value={d.type} onChange={(e) => set({ type: e.target.value as TimerType })} className={field}>
        {(Object.keys(TYPE_LABELS) as TimerType[]).map((t) => (
          <option key={t} value={t}>{TYPE_LABELS[t]}</option>
        ))}
      </select>

      {d.type === "countdown" && (
        <div>
          <div className={label}>Duration</div>
          <input value={d.duration} onChange={(e) => set({ duration: e.target.value })}
            placeholder="mm:ss or h:mm:ss" className={`${field} font-mono`} />
        </div>
      )}

      {d.type === "countdown_to" && (
        <div className="flex gap-2">
          <div className="flex-1">
            <div className={label}>Time of day</div>
            <input value={d.targetClock} onChange={(e) => set({ targetClock: e.target.value })}
              placeholder="hh:mm" className={`${field} font-mono`} />
          </div>
          <div className="w-24">
            <div className={label}>Period</div>
            <select value={d.period} onChange={(e) => set({ period: e.target.value as Period })} className={field}>
              <option value="am">AM</option>
              <option value="pm">PM</option>
              <option value="24_hour">24-hour</option>
            </select>
          </div>
        </div>
      )}

      {d.type === "elapsed" && (
        <div className="flex gap-2">
          <div className="flex-1">
            <div className={label}>Start at</div>
            <input value={d.elapsedStart} onChange={(e) => set({ elapsedStart: e.target.value })}
              placeholder="0:00" className={`${field} font-mono`} />
          </div>
          <div className="flex-1">
            <div className={label}>End at</div>
            <input value={d.elapsedEnd} onChange={(e) => set({ elapsedEnd: e.target.value })}
              placeholder="unlimited" className={`${field} font-mono`} />
          </div>
        </div>
      )}

      {/* ProPresenter's wording, and its meaning: run PAST the endpoint. */}
      <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
        <input type="checkbox" checked={d.allowsOverrun}
          onChange={(e) => set({ allowsOverrun: e.target.checked })} />
        Allows Overrun
      </label>
    </>
  );
}

export function TimersPanel({ quick, timers }: { quick: TimerApi; timers: TimersApi }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const submit = async () => {
    if (!draft.name.trim()) return;
    await timers.addTimer(draftToInput(draft));
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
          <div className="eyebrow">Timers</div>
          {/* ProPresenter puts "+" at the upper right of the Timers panel. */}
          <button onClick={() => setAdding((a) => !a)} title="Add a timer"
            className="flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline">
            <Plus className="w-3 h-3" /> New timer
          </button>
        </div>

        {adding && (
          <div className="flex flex-col gap-2 mb-3 p-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]">
            <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Timer name (e.g. Sermon)" className={input} />
            <TypeFields d={draft} set={(p) => setDraft({ ...draft, ...p })} />
            <div className="flex gap-2">
              <button onClick={submit}
                className="flex-1 h-8 rounded bg-[var(--color-brand)] text-black font-semibold text-[12px] flex items-center justify-center gap-1">
                <Check className="w-3.5 h-3.5" /> Save
              </button>
              <button onClick={() => { setAdding(false); setDraft(EMPTY_DRAFT); }}
                className="w-8 h-8 rounded border border-[var(--color-border)] flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {timers.loading ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)] py-2">Loading timers…</div>
        ) : timers.slots.length === 0 ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)] py-2">
            No timers yet. Add one for your sermon, worship set, or a countdown to the start of the service.
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
  // ProPresenter's collapse chevron: collapsed = operate, expanded = edit.
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"timer" | "look">("timer");
  const [d, setD] = useState<Draft>({
    name: slot.def.name,
    type: slot.def.type as TimerType,
    duration: formatTimerClock(slot.def.durationSec),
    targetClock: slot.targetClock ?? "11:00",
    period: "24_hour",
    elapsedStart: secToClock(slot.def.elapsedStartSec),
    elapsedEnd: secToClock(slot.def.elapsedEndSec),
    allowsOverrun: slot.def.allowsOverrun === true,
  });

  // countdown_to is pure wall-clock — it has no paused state to toggle.
  const running = slot.def.type === "countdown_to" ? true : slot.runtime.running;
  const a = slot.appearance;
  const setLook = (p: Partial<typeof a>) => timers.setAppearance(slot.def.id, p);
  const save = async () => { await timers.editTimer(slot.def.id, draftToInput(d)); setOpen(false); };

  return (
    <div className="rounded border border-[var(--color-border)] overflow-hidden">
      {confirmDialog}

      {/* ── collapsed row: name, live clock, progress, transport ───────── */}
      <div className="p-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen((o) => !o)} title={open ? "Collapse" : "Expand"}
            className="w-5 h-5 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] shrink-0">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          <span className="text-[12px] font-medium truncate flex-1">{slot.def.name}</span>
          <span className={`text-[15px] font-mono tabular-nums font-semibold ${slot.overrun ? "text-red-400" : ""}`}
            style={!slot.overrun && a.color ? { color: a.color } : undefined}>
            {formatTimerClock(slot.remaining)}
          </span>
        </div>

        {/* ProPresenter shows a progress bar across the timer row. */}
        {slot.progress !== null && (
          <div className="h-1 rounded-full bg-[var(--color-border)] overflow-hidden">
            <div className={`h-full ${slot.overrun ? "bg-red-400" : "bg-[var(--color-brand)]"}`}
              style={{ width: `${Math.round(slot.progress * 100)}%` }} />
          </div>
        )}

        <div className="flex items-center gap-1">
          <button onClick={() => timers.command(slot.def.id, running ? "stop" : "start")}
            disabled={slot.def.type === "countdown_to"}
            title={slot.def.type === "countdown_to" ? "Counts to a clock time automatically" : running ? "Stop" : "Start"}
            className="flex-1 h-7 rounded bg-[var(--color-brand)] text-black font-semibold text-[11px] flex items-center justify-center gap-1 disabled:opacity-40">
            {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {running ? "Stop" : "Start"}
          </button>
          <button onClick={() => timers.command(slot.def.id, "reset")} title="Reset"
            className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => timers.toggleShown(slot.def.id)}
            title={slot.shown ? "Hide from the screens" : "Show on the screens"}
            className={`w-7 h-7 rounded flex items-center justify-center ${slot.shown ? "bg-red-600 text-white" : "border border-[var(--color-border)]"}`}>
            {slot.shown ? <MonitorOff className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
          </button>
          <button onClick={async () => {
            if (await confirm({ title: `Delete timer "${slot.def.name}"?`, confirmLabel: "Delete", danger: true })) {
              timers.removeTimer(slot.def.id);
            }
          }} title="Delete"
            className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── expanded: full editor ───────────────────────────────────────── */}
      {open && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-elevated)] p-2 flex flex-col gap-2">
          <div className="flex gap-1">
            {(["timer", "look"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 h-6 rounded text-[11px] font-medium ${tab === t ? "bg-[var(--color-brand)] text-black" : "border border-[var(--color-border)]"}`}>
                {t === "timer" ? "Timer" : "Look"}
              </button>
            ))}
          </div>

          {tab === "timer" ? (
            <>
              <div>
                <div className={label}>Name</div>
                <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className={field} />
              </div>
              <TypeFields d={d} set={(p) => setD({ ...d, ...p })} />
              <div className="flex gap-2">
                <button onClick={save} className="flex-1 h-7 rounded bg-[var(--color-brand)] text-black font-semibold text-[11px]">Save</button>
                <button onClick={() => setOpen(false)} className="px-2 h-7 rounded border border-[var(--color-border)] text-[11px]">Cancel</button>
              </div>
            </>
          ) : (
            <LookEditor slot={slot} setLook={setLook} />
          )}
        </div>
      )}
    </div>
  );
}

/** Everything about how the timer LOOKS on the screens. Applies live — there is
 *  no Save button, because an operator adjusting a timer mid-service needs to
 *  see the change on the projector immediately. */
function LookEditor({ slot, setLook }: { slot: TimerSlot; setLook: (p: Partial<TimerSlot["appearance"]>) => void }) {
  const a = slot.appearance;
  const triggers = a.colorTriggers ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className={label}>Position on screen</div>
        <select value={a.position} onChange={(e) => setLook({ position: e.target.value as OverlayPosition })} className={field}>
          {OVERLAY_POSITIONS.map((p) => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}
        </select>
      </div>

      <div>
        <div className={label}>Size</div>
        <div className="flex items-center gap-2">
          <input type="range" min={0.5} max={5} step={0.25} value={a.scale}
            onChange={(e) => setLook({ scale: Number(e.target.value) })} className="flex-1" />
          <span className="text-[10px] font-mono tabular-nums w-10 text-right">{a.scale.toFixed(2)}×</span>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <div className={label}>Colour</div>
          <input type="color" value={a.color ?? "#ffffff"} onChange={(e) => setLook({ color: e.target.value })}
            className="h-7 w-full bg-transparent border border-[var(--color-border)] rounded cursor-pointer" />
        </div>
        <div className="flex-1">
          <div className={label}>Past zero</div>
          {/* Only meaningful when the timer is allowed to run past its end —
              otherwise it clamps at 0:00 and this colour is never reached. */}
          <input type="color" value={a.overrunColor ?? "#f87171"}
            onChange={(e) => setLook({ overrunColor: e.target.value })}
            disabled={slot.def.allowsOverrun !== true}
            title={slot.def.allowsOverrun === true
              ? "Colour once the timer passes zero"
              : "Tick Allows Overrun on the Timer tab to use this"}
            className={`h-7 w-full bg-transparent border border-[var(--color-border)] rounded cursor-pointer ${slot.def.allowsOverrun !== true ? "opacity-40 cursor-not-allowed" : ""}`} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
        <input type="checkbox" checked={a.showLabel} onChange={(e) => setLook({ showLabel: e.target.checked })} />
        Show the timer&apos;s name above it
      </label>

      <div className={label}>Format</div>
      <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
        <input type="checkbox" checked={a.showHours === true} onChange={(e) => setLook({ showHours: e.target.checked ? true : undefined })} />
        Always show hours (0:05:00)
      </label>
      <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none">
        <input type="checkbox" checked={a.leadingZeros} onChange={(e) => setLook({ leadingZeros: e.target.checked })} />
        Leading zeros (05:00)
      </label>

      {/* ProPresenter "Color Triggers": the timer changes colour as it runs down. */}
      <div className="flex items-center justify-between pt-1">
        <span className={label}>Colour changes</span>
        <button
          onClick={() => setLook({ colorTriggers: [...triggers, { atSec: 60, color: "#fb923c" }] })}
          disabled={triggers.length >= 8}
          className="flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline disabled:opacity-40">
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {triggers.length === 0 ? (
        <div className="text-[11px] text-[var(--color-muted-foreground)] flex items-center gap-1">
          <Palette className="w-3 h-3" /> Turn the timer orange, then red, as it runs out.
        </div>
      ) : (
        triggers.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-muted-foreground)] shrink-0">At</span>
            <input value={formatTimerClock(t.atSec)}
              onChange={(e) => {
                const next = [...triggers];
                next[i] = { ...t, atSec: parseDurationToSec(e.target.value) };
                setLook({ colorTriggers: next });
              }}
              className={`${field} font-mono w-16`} />
            <input type="color" value={t.color}
              onChange={(e) => {
                const next = [...triggers];
                next[i] = { ...t, color: e.target.value };
                setLook({ colorTriggers: next });
              }}
              className="h-7 w-10 bg-transparent border border-[var(--color-border)] rounded cursor-pointer shrink-0" />
            <button onClick={() => setLook({ colorTriggers: triggers.filter((_, j) => j !== i) })}
              title="Remove" className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center text-red-400 shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
