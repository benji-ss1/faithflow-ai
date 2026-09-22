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
import { TIMER_SCREEN_IDS, TIMER_SCREEN_LABELS, toggleTimerScreen, type TimerScreenId } from "@/engine/timers/screens";
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
  /** Church-wide overrun colour. Persisted on the timer itself, so it follows
   *  the church to a second operator machine — the per-machine appearance
   *  colour cannot. The DB column existed and was never written. */
  overrunColor: string;
};

const EMPTY_DRAFT: Draft = {
  // ProPresenter pre-fills "Timer" rather than refusing an empty name, so a
  // new timer is usable with one click (rule 0a).
  name: "Timer", type: "countdown", duration: "05:00",
  targetClock: "11:00", period: "am",
  elapsedStart: "", elapsedEnd: "", allowsOverrun: false, overrunColor: "#f87171",
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
    overrunColor: d.overrunColor,
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

      {/* Only reachable when overrun is on — without it the timer clamps at
          0:00 and this colour can never be seen. */}
      {d.allowsOverrun && (
        <div>
          <div className={label}>Colour once past zero</div>
          <input type="color" value={d.overrunColor}
            onChange={(e) => set({ overrunColor: e.target.value })}
            className="h-7 w-full bg-transparent border border-[var(--color-border)] rounded cursor-pointer" />
        </div>
      )}
    </>
  );
}

export function TimersPanel({ quick, timers }: { quick: TimerApi; timers: TimersApi }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const submit = async () => {
    // Never a dead button: an emptied name falls back rather than refusing.
    if (!draft.name.trim()) draft.name = "Timer";
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
          <div className="flex items-center gap-2">
            {/* Bulk start/stop/reset — ProPresenter's /v1/timers/{operation}.
                The end-of-service "reset everything for the next service" that
                operators otherwise do one timer at a time. */}
            {timers.slots.length > 1 && (
              <button onClick={() => timers.commandAll("reset")} title="Reset every timer"
                className="flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
                <RotateCcw className="w-3 h-3" /> Reset all
              </button>
            )}
            <button onClick={() => setAdding((a) => !a)} title="Add a timer"
              className="flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline">
              <Plus className="w-3 h-3" /> New timer
            </button>
          </div>
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
    // Seed from the STORED period. Hardcoding this destroyed AM/PM on every
    // edit — a rename turned "7:00 PM" into 07:00 the next morning.
    period: slot.period ?? "24_hour",
    elapsedStart: secToClock(slot.def.elapsedStartSec),
    elapsedEnd: secToClock(slot.def.elapsedEndSec),
    allowsOverrun: slot.def.allowsOverrun === true,
    overrunColor: slot.overrunColor ?? "#f87171",
  });

  // countdown_to is stoppable too: Stop freezes it at its current value, which
  // is what ProPresenter does (its API exposes stop for every timer id).
  const running = slot.runtime.running;
  const a = slot.appearance;
  const setLook = (p: Partial<typeof a>) => timers.setAppearance(slot.def.id, p);
  const save = async () => { await timers.editTimer(slot.def.id, draftToInput(d)); setOpen(false); };

  return (
    <div className="rounded border border-[var(--color-border)] overflow-hidden">
      {confirmDialog}

      {/* ── collapsed row: name, live clock, progress, transport ───────── */}
      <div className="p-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen((o) => !o)}
            aria-label={open ? `Collapse ${slot.def.name}` : `Expand ${slot.def.name}`}
            title={open ? "Collapse" : "Expand"}
            className="w-7 h-7 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] shrink-0">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          <span className="text-[12px] font-medium truncate flex-1">
            {slot.def.name}
            {/* Five-state model: "Done" and "Over" are different facts. */}
            {(slot.state === "complete" || slot.state === "overran" || slot.state === "overrunning") && (
              <span className={`ml-1.5 text-[9px] uppercase tracking-wider ${slot.state === "complete" ? "text-[var(--color-muted-foreground)]" : "text-[var(--color-destructive)]"}`}>
                {slot.state === "complete" ? "Done" : slot.state === "overrunning" ? "Over" : "Ran over"}
              </span>
            )}
          </span>
          {/* Live nudge — ProPresenter's TimerIncrement. "Give the preacher two
              more minutes" WITHOUT resetting, which editing the duration would
              do. Hidden for countdown_to, whose value comes from the wall
              clock and has nothing to nudge. */}
          {slot.def.type !== "countdown_to" && (
            <div className="flex items-center gap-0.5">
              <button onClick={() => timers.increment(slot.def.id, -60)}
                aria-label={`Take a minute off ${slot.def.name}`} title="Take a minute off"
                className="w-6 h-6 rounded border border-[var(--color-border)] flex items-center justify-center text-[10px] font-mono">
                −1
              </button>
              <button onClick={() => timers.increment(slot.def.id, 60)}
                aria-label={`Add a minute to ${slot.def.name}`} title="Add a minute"
                className="w-6 h-6 rounded border border-[var(--color-border)] flex items-center justify-center text-[10px] font-mono">
                +1
              </button>
            </div>
          )}
          <span className={`text-[15px] font-mono tabular-nums font-semibold ${slot.overrun ? "text-[var(--color-destructive)]" : ""}`}
            style={!slot.overrun && a.color ? { color: a.color } : undefined}>
            {formatTimerClock(slot.remaining)}
          </span>
        </div>

        {/* ProPresenter shows a progress bar across the timer row. When there is
            no meaningful total (a stopwatch with no end, or a countdown to a
            clock time) we draw a FLAT track rather than nothing, so its absence
            reads as "nothing to measure against" instead of looking broken. */}
        <div className="h-1 rounded-full bg-[var(--color-border)] overflow-hidden"
          title={slot.progress === null ? "No set length to count against" : undefined}>
          {slot.progress !== null && (
            <div className={`h-full ${slot.overrun ? "bg-[var(--color-destructive)]" : "bg-[var(--color-brand)]"}`}
              style={{ width: `${Math.round(slot.progress * 100)}%` }} />
          )}
        </div>

        {/* Transport only. DELETE DELIBERATELY LIVES IN THE EDITOR, not here:
            it previously sat in this row at the same size as Reset and
            Show/Hide — one mis-click away, in a dark room, mid-service. */}
        <div className="flex items-center gap-1">
          <button onClick={() => timers.command(slot.def.id, running ? "stop" : "start")}
            aria-label={running ? `Stop ${slot.def.name}` : `Start ${slot.def.name}`}
            title={running ? "Stop" : "Start"}
            className="flex-1 h-8 rounded bg-[var(--color-brand)] text-black font-semibold text-[11px] flex items-center justify-center gap-1 disabled:opacity-40">
            {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {running ? "Stop" : "Start"}
          </button>
          <button onClick={() => timers.command(slot.def.id, "reset")}
            aria-label={`Reset ${slot.def.name}`} title="Reset"
            className="w-8 h-8 rounded border border-[var(--color-border)] flex items-center justify-center">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          {/* "On screen" uses the BRAND colour, not red. Red is reserved for
              destructive actions and overrun, so it cannot mean "live" too. */}
          <button onClick={() => timers.toggleShown(slot.def.id)}
            aria-label={slot.shown ? `Hide ${slot.def.name} from the screens` : `Show ${slot.def.name} on the screens`}
            title={slot.shown ? "Hide from the screens" : "Show on the screens"}
            className={`h-8 px-2 rounded flex items-center justify-center gap-1 text-[10px] font-semibold ${slot.shown ? "bg-[var(--color-brand)] text-black" : "border border-[var(--color-border)]"}`}>
            {slot.shown ? <MonitorOff className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
            {/* A word, not just a colour — readable at a glance from a step back. */}
            {slot.shown ? "ON" : "OFF"}
          </button>
        </div>

        {/* WHERE IT GOES, visible without expanding anything (2026-09-22).
            Until now "ON" told the operator the timer was live but never which
            screens it reached, and the answer was "all four" with no way to
            see or change it. In a dark room mid-service, an operator must be
            able to read the destination off the row. */}
        {slot.shown && <ScreenSummary screens={a.screens} />}
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
              {/* Delete lives HERE, behind the expand chevron and below Save —
                  deliberately far from the transport row an operator uses
                  constantly mid-service. It was previously the same size and
                  right next to Reset. */}
              <button
                onClick={async () => {
                  if (await confirm({ title: `Delete timer "${slot.def.name}"?`, confirmLabel: "Delete", danger: true })) {
                    timers.removeTimer(slot.def.id);
                  }
                }}
                className="mt-1 h-7 rounded border border-[var(--color-destructive)] text-[var(--color-destructive)] text-[11px] flex items-center justify-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Delete this timer
              </button>
            </>
          ) : (
            <LookEditor slot={slot} setLook={setLook} />
          )}
        </div>
      )}
    </div>
  );
}

/** A sensible NEXT threshold: below the current lowest, with a colour that
 *  escalates orange -> amber -> red, so a second click never produces a row
 *  identical to one already there. */
function nextTrigger(existing: Array<{ atSec: number; color: string }>): { atSec: number; color: string } {
  const PALETTE = ["#fb923c", "#facc15", "#ef4444"];
  const lowest = existing.length ? Math.min(...existing.map((t) => t.atSec)) : 120;
  const atSec = Math.max(5, existing.length ? Math.floor(lowest / 2) : 60);
  return { atSec, color: PALETTE[Math.min(existing.length, PALETTE.length - 1)] };
}

/** Everything about how the timer LOOKS on the screens. Applies live — there is
 *  no Save button, because an operator adjusting a timer mid-service needs to
 *  see the change on the projector immediately. */
/** One line of plain English naming the outputs a timer reaches. Rendered both
 *  on the collapsed row and under the picker, because "where is this going?" is
 *  asked in both places. */
function ScreenSummary({ screens }: { screens?: readonly string[] }) {
  if (screens != null && screens.length === 0) {
    return (
      <div className="mt-1 text-[10px] font-medium text-[var(--color-destructive)]">
        Not on any screen — it will not appear anywhere
      </div>
    );
  }
  const names = screens == null
    ? "every screen"
    : TIMER_SCREEN_IDS.filter((id) => screens.includes(id)).map((id) => TIMER_SCREEN_LABELS[id]).join(" · ");
  return (
    <div className="mt-1 text-[10px] text-[var(--color-muted-foreground)]">
      Shows on {names}
      {/* Scenes can still hide it on top of this. Say so rather than letting an
          operator conclude the routing is broken. */}
    </div>
  );
}

function LookEditor({ slot, setLook }: { slot: TimerSlot; setLook: (p: Partial<TimerSlot["appearance"]>) => void }) {
  const a = slot.appearance;
  const triggers = a.colorTriggers ?? [];
  // Display longest-first so the visual order matches the order they fire.
  const sortedTriggers = [...triggers].sort((x, y) => y.atSec - x.atSec);

  const screens = a.screens;
  const on = (id: TimerScreenId) => screens == null || screens.includes(id);

  return (
    <div className="flex flex-col gap-2">
      {/* FIRST control in the Look tab, deliberately: "which screens" is the
          question an operator asks before "which corner". ProPresenter answers
          it per stage layout / per look; we answer it per timer, so one timer
          can be a stage-only confidence clock while another counts the
          congregation in on the projector — without an admin turning Scenes on. */}
      <div>
        <div className={label}>Shows on</div>
        <div className="flex flex-wrap gap-1">
          {TIMER_SCREEN_IDS.map((id) => (
            <button key={id} type="button"
              onClick={() => setLook({ screens: toggleTimerScreen(screens as TimerScreenId[] | undefined, id) })}
              aria-pressed={on(id)}
              title={on(id) ? `Stop showing on ${TIMER_SCREEN_LABELS[id]}` : `Also show on ${TIMER_SCREEN_LABELS[id]}`}
              className={`h-7 px-2 rounded text-[11px] font-medium ${on(id)
                ? "bg-[var(--color-brand)] text-black"
                : "border border-[var(--color-border)] text-[var(--color-muted-foreground)]"}`}>
              {TIMER_SCREEN_LABELS[id]}
            </button>
          ))}
        </div>
        <ScreenSummary screens={screens} />
      </div>

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
        <span className="text-[10px] text-[var(--color-muted-foreground)]">(off by default, like ProPresenter)</span>
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
        <span className={label}>Colour changes {triggers.length > 0 && `(${triggers.length}/8)`}</span>
        <button
          onClick={() => setLook({ colorTriggers: [...triggers, nextTrigger(triggers)] })}
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
        <>
        {/* Listed longest-time-first, which is the order they actually fire. */}
        <div className="text-[10px] text-[var(--color-muted-foreground)] leading-snug">
          Each colour takes over as the timer passes that time, so the last one listed is the colour it ends on.
        </div>
        {sortedTriggers.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-muted-foreground)] shrink-0">At</span>
            <input value={formatTimerClock(t.atSec)}
              onChange={(e) => {
                const next = [...sortedTriggers];
                next[i] = { ...t, atSec: parseDurationToSec(e.target.value) };
                setLook({ colorTriggers: next });
              }}
              className={`${field} font-mono w-16`} />
            <input type="color" value={t.color}
              onChange={(e) => {
                const next = [...sortedTriggers];
                next[i] = { ...t, color: e.target.value };
                setLook({ colorTriggers: next });
              }}
              className="h-7 w-10 bg-transparent border border-[var(--color-border)] rounded cursor-pointer shrink-0" />
            <button onClick={() => setLook({ colorTriggers: sortedTriggers.filter((_, j) => j !== i) })}
              aria-label="Remove this colour change" title="Remove"
              className="w-7 h-7 rounded border border-[var(--color-border)] flex items-center justify-center text-[var(--color-destructive)] shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        </>
      )}
    </div>
  );
}
