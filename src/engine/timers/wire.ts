/**
 * src/engine/timers/wire — build the NETWORKED timer frame. PURE.
 *
 * THE LOAD-BEARING RULE: nothing in a TimerWire may be derived from "now".
 * The whole design rests on a running timer producing a BYTE-IDENTICAL frame
 * as time passes, so the operator's snapshot dedupe drops it and nothing is
 * sent. Put a computed value in here and you have silently re-created the 1Hz
 * heartbeat this exists to avoid — roughly 5.2M Supabase messages a month for
 * one church with one timer, against a 5M project-wide allowance.
 *
 * test/timer-wire.test.ts locks that with a determinism test. If you add a
 * field and that test fails, the field is the bug, not the test.
 */
import type { TimerWire, TimersWire, OverlayPosition } from "@/lib/broadcast";
import { MAX_WIRE_TIMERS, MAX_COLOR_TRIGGERS } from "@/lib/broadcast";

/** The shape this needs from a TimerSlot — declared structurally so the engine
 *  stays free of any React/hook import. */
export type WireableSlot = {
  def: {
    id: string; name: string;
    type: "countdown" | "countdown_to" | "elapsed";
    durationSec: number; targetMs?: number | null;
    allowsOverrun?: boolean;
    elapsedStartSec?: number | null; elapsedEndSec?: number | null;
  };
  runtime: { running: boolean; anchorMs: number | null; baseSec: number };
  shown: boolean;
  appearance: {
    position: OverlayPosition; scale: number;
    color?: string; overrunColor?: string;
    showLabel: boolean; showHours?: boolean; leadingZeros: boolean;
    colorTriggers: Array<{ atSec: number; color: string }>;
  };
};

export function timerSlotToWire(s: WireableSlot): TimerWire {
  const a = s.appearance;
  return {
    id: s.def.id,
    // An absent name IS "no label" to every renderer — same convention the
    // same-machine path already uses.
    ...(a.showLabel === false ? {} : { name: s.def.name }),
    type: s.def.type,
    running: s.runtime.running,
    anchorMs: s.runtime.anchorMs,
    baseSec: s.runtime.baseSec,
    durationSec: s.def.durationSec,
    targetMs: s.def.targetMs ?? null,
    allowsOverrun: s.def.allowsOverrun === true,
    elapsedStartSec: s.def.elapsedStartSec ?? null,
    elapsedEndSec: s.def.elapsedEndSec ?? null,
    position: a.position,
    scale: a.scale,
    ...(a.color ? { color: a.color } : {}),
    ...(a.overrunColor ? { overrunColor: a.overrunColor } : {}),
    ...(a.showHours !== undefined ? { showHours: a.showHours } : {}),
    leadingZeros: a.leadingZeros,
    // Triggers ride as DATA. Resolving them here would need the ticking value.
    colorTriggers: (a.colorTriggers ?? []).slice(0, MAX_COLOR_TRIGGERS),
  };
}

/**
 * Build the frame. `nowMs` and `rev` are the ONLY time-varying inputs, and both
 * live on the envelope — never inside a TimerWire — precisely so the timers
 * array stays stable while a timer runs.
 */
export function buildTimersWire(slots: WireableSlot[], nowMs: number, rev: number): TimersWire {
  const timers = slots
    .filter((s) => s.shown)
    .slice(0, MAX_WIRE_TIMERS)   // bound on the SEND side too, so the validator never has to reject
    .map(timerSlotToWire);
  return { timers, senderNowMs: nowMs, rev };
}
