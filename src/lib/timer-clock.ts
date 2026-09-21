/**
 * src/lib/timer-clock — clock-skew correction for NETWORKED timers (2026-09-21).
 *
 * A timer's value is derived from (now - anchorMs). The anchor is stamped on the
 * OPERATOR's clock, so a receiver must never mix it with its OWN clock: a tablet
 * running 40 seconds fast would show a timer 40 seconds out, which on a
 * confidence monitor is the difference between "wrap up" and "you have time".
 *
 * Every timer frame carries the sender's Date.now(), so the receiver measures
 * the offset continuously and converts its own clock into the sender's domain
 * before asking the engine for a value.
 *
 * PURE — every function takes its clocks explicitly, so it is directly testable
 * with no devices and no fake timers.
 */

export type ClockSync = {
  /** senderNow - receiverNow. Positive ⇒ the sender's clock is AHEAD. */
  offsetMs: number;
  /** Receiver-clock time of the last measurement, for the staleness reset. */
  measuredAt: number;
  samples: number;
};

/** Re-measure from scratch after this long without a frame — an old offset is
 *  worse than no offset, because clocks drift and devices sleep. */
export const CLOCK_SYNC_RESET_MS = 5 * 60_000;
/** A shift larger than this is a real clock correction (NTP), not jitter, so
 *  snap to it instead of easing — easing would crawl for minutes while the
 *  timer reads wrong. Far above network jitter (~300ms), far below anything an
 *  operator would accept being wrong by. */
export const CLOCK_SYNC_JUMP_MS = 2_000;
/** How often the operator re-stamps a frame purely to say "still alive". */
export const TIMERS_LIVENESS_MS = 20_000;
/** Drop remote timers after this long with no frame — three missed beats. Kept
 *  SEPARATE from the same-machine 5s sweep, which still guards the 1Hz path. */
export const TIMERS_WIRE_STALE_MS = 60_000;

export function measureOffset(senderNowMs: number, receiverNowMs: number): number {
  return senderNowMs - receiverNowMs;
}

/** Fold a new sample in. Eases small differences (network jitter), snaps on a
 *  genuine jump or after a long silence. */
export function foldClockSync(
  prev: ClockSync | null,
  senderNowMs: number,
  receiverNowMs: number,
): ClockSync {
  const raw = measureOffset(senderNowMs, receiverNowMs);
  if (!prev
    || receiverNowMs - prev.measuredAt > CLOCK_SYNC_RESET_MS
    || Math.abs(raw - prev.offsetMs) > CLOCK_SYNC_JUMP_MS) {
    return { offsetMs: raw, measuredAt: receiverNowMs, samples: 1 };
  }
  return {
    offsetMs: prev.offsetMs + 0.25 * (raw - prev.offsetMs),
    measuredAt: receiverNowMs,
    samples: prev.samples + 1,
  };
}

/** The value to hand the engine as `nowMs` — this device's clock expressed in
 *  the SENDER's domain. With no sync yet it degrades to the local clock, which
 *  is correct when both machines agree and no worse than not showing a timer. */
export function senderNow(sync: ClockSync | null, receiverNowMs: number = Date.now()): number {
  return receiverNowMs + (sync?.offsetMs ?? 0);
}

/** True when remote timers should be swept. Extracted so the rule is unit
 *  testable rather than trapped inside a React interval. `lastAt` of 0 means
 *  "never received one", which must NEVER sweep — otherwise a surface that has
 *  simply never seen a timer would keep clearing nothing. */
export function shouldSweepWireTimers(lastAt: number, nowMs: number): boolean {
  return lastAt > 0 && nowMs - lastAt > TIMERS_WIRE_STALE_MS;
}
