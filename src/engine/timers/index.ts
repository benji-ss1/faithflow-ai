/**
 * src/engine/timers — Phase 4 (P4) of the Engine Integration blueprint.
 *
 * A PURE, deterministic multi-timer engine. No React, no globals, no side
 * effects at module scope — every function takes an explicit `nowMs` so the
 * whole thing is unit-testable without fake clocks. The React layer
 * (useTimersSession in pro/hooks.ts) owns the ticking + persistence and calls
 * these pure reducers. As built, the legacy single-timer `useTimerSession`
 * hook is left UNTOUCHED beside this new engine — the two coexist (the legacy
 * "quick timer" publishes the wire's unkeyed "default" slot; each engine timer
 * publishes its own KEYED slot). There is no compatibility wrapper; nothing was
 * rewritten on top of the engine (see hooks.ts).
 *
 * Timer kinds (mirror ProPresenter + the existing TimerType in hooks.ts):
 *   - "countdown"     : counts down from `durationSec`; start/stop/reset apply.
 *   - "countdown_to"  : counts down to a wall-clock target (`targetMs`); the
 *                       displayed value is derived purely from the clock, so
 *                       start just makes it "active", stop/reset detach.
 *   - "elapsed"       : counts UP from zero (a stopwatch); start/stop/reset apply.
 *
 * Overrun: a countdown that passes zero keeps going NEGATIVE (ProPresenter
 * shows "-0:12" in red). `computeRemainingSec` returns the signed value and
 * `isOverrun()` reports the past-zero state so a renderer can style it.
 */

export type TimerType = "countdown" | "countdown_to" | "elapsed";

/** A church-persisted timer definition (name + type + duration/target). Pure
 *  data; the `id` is a stable slot key the UI + wire + overlay all key on. */
export interface TimerDefinition {
  id: string;
  name: string;
  type: TimerType;
  /** Seconds to count down from (countdown). Ignored for elapsed / countdown_to. */
  durationSec: number;
  /** Wall-clock epoch ms to count down to (countdown_to). Null otherwise. */
  targetMs?: number | null;
}

/** Mutable runtime state for one timer. `anchorMs` is the wall-clock instant
 *  the timer last (re)started; `baseSec` is the value banked at that instant
 *  (remaining-at-anchor for countdown, elapsed-at-anchor for elapsed). This
 *  "anchor + base" shape means a tick never mutates state — remaining is
 *  computed from (now - anchor), so persistence only stores the anchor/base. */
export interface TimerRuntime {
  running: boolean;
  anchorMs: number | null;
  baseSec: number;
}

/** Fresh runtime for a definition (stopped, at its starting value). */
export function initialRuntime(def: TimerDefinition): TimerRuntime {
  return {
    running: false,
    anchorMs: null,
    baseSec: def.type === "elapsed" ? 0 : Math.max(0, def.durationSec),
  };
}

/** Compute the SIGNED value to display, in seconds.
 *  - countdown    : remaining (goes negative on overrun)
 *  - elapsed      : elapsed since start (always ≥ 0)
 *  - countdown_to : (target - now); goes negative once the target passes */
export function computeRemainingSec(def: TimerDefinition, rt: TimerRuntime, nowMs: number): number {
  if (def.type === "countdown_to") {
    const target = def.targetMs ?? nowMs;
    return (target - nowMs) / 1000;
  }
  const sinceAnchor = rt.running && rt.anchorMs != null ? (nowMs - rt.anchorMs) / 1000 : 0;
  if (def.type === "elapsed") return rt.baseSec + sinceAnchor;
  // countdown
  return rt.baseSec - sinceAnchor;
}

/** True once a countdown / countdown_to has passed zero into overtime. */
export function isOverrun(def: TimerDefinition, rt: TimerRuntime, nowMs: number): boolean {
  if (def.type === "elapsed") return false;
  return computeRemainingSec(def, rt, nowMs) < 0;
}

/** Start (or resume) a timer. Banks the current computed value into `baseSec`
 *  and re-anchors to `nowMs`, so resuming after a stop continues cleanly.
 *  countdown_to ignores anchoring (its value is pure wall-clock) but we still
 *  mark it running so the UI/overlay treats it as active. Idempotent. */
export function startTimer(def: TimerDefinition, rt: TimerRuntime, nowMs: number): TimerRuntime {
  if (rt.running) return rt;
  if (def.type === "countdown_to") return { ...rt, running: true, anchorMs: nowMs };
  const current = computeRemainingSec(def, rt, nowMs);
  return { running: true, anchorMs: nowMs, baseSec: current };
}

/** Stop (pause) a timer, banking the current computed value. Idempotent. */
export function stopTimer(def: TimerDefinition, rt: TimerRuntime, nowMs: number): TimerRuntime {
  if (!rt.running) return rt;
  if (def.type === "countdown_to") return { ...rt, running: false, anchorMs: null };
  const current = computeRemainingSec(def, rt, nowMs);
  return { running: false, anchorMs: null, baseSec: current };
}

/** Reset a timer to its starting value and stop it. */
export function resetTimer(def: TimerDefinition): TimerRuntime {
  return initialRuntime(def);
}

/** Apply a start|stop|reset command by name (mirrors the TIMER_COMMAND action). */
export type TimerCommand = "start" | "stop" | "reset";
export function applyCommand(def: TimerDefinition, rt: TimerRuntime, cmd: TimerCommand, nowMs: number): TimerRuntime {
  switch (cmd) {
    case "start": return startTimer(def, rt, nowMs);
    case "stop": return stopTimer(def, rt, nowMs);
    case "reset": return resetTimer(def);
    default: return rt;
  }
}

/** Format a signed seconds value as [-]H:MM:SS (hours dropped when zero → M:SS).
 *  Deterministic, allocation-light; used by every output surface so a timer
 *  reads identically on /live and /stage. */
export function formatTimerClock(sec: number): string {
  const neg = sec < 0;
  const total = Math.floor(Math.abs(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return neg ? `-${body}` : body;
}

/** Resolve a "HH:MM" wall-clock string to the NEXT such instant in epoch ms
 *  (today, or tomorrow if the time already passed). Null-tolerant. Pure — the
 *  React layer calls this ONCE per countdown_to (at load / reset / re-show), NOT
 *  on every tick, so once `now` crosses the resolved target the timer runs
 *  NEGATIVE into overrun instead of silently rolling +24h on the next tick. */
export function resolveTargetMs(targetClock: string | null | undefined, nowMs: number): number | null {
  if (!targetClock || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(targetClock.trim())) return null;
  const [h, m] = targetClock.trim().split(":").map((x) => parseInt(x, 10));
  const d = new Date(nowMs);
  d.setHours(h, m, 0, 0);
  let t = d.getTime();
  if (t <= nowMs) t += 24 * 60 * 60 * 1000; // next occurrence
  return t;
}

/** Parse a "mm:ss" or "h:mm:ss" (or bare seconds) string to seconds. Tolerant;
 *  clamps negatives to 0. Used to turn the operator's duration field into
 *  `durationSec`. */
export function parseDurationToSec(input: string): number {
  const parts = input.trim().split(":").map((p) => parseInt(p, 10) || 0);
  let sec = 0;
  if (parts.length === 1) sec = parts[0];
  else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  else if (parts.length >= 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Math.max(0, sec);
}
