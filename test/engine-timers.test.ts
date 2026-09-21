/**
 * engine/timers tests — pure multi-timer core.
 *
 * Run: npx tsx --test test/engine-timers.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type TimerDefinition,
  initialRuntime,
  computeRemainingSec,
  isOverrun,
  startTimer,
  stopTimer,
  resetTimer,
  applyCommand,
  formatTimerClock,
  parseDurationToSec,
  resolveTargetMs,
} from "../src/engine/timers";

const countdown: TimerDefinition = { id: "t1", name: "Countdown", type: "countdown", durationSec: 300 };
// ProPresenter "Allows Overrun" is OFF by default, so a timer that is MEANT to
// run past zero must opt in. The clamped default is covered separately below.
const countdownOverrun: TimerDefinition = { ...countdown, id: "t1o", allowsOverrun: true };
const elapsed: TimerDefinition = { id: "t2", name: "Elapsed", type: "elapsed", durationSec: 0 };
const T0 = 1_000_000;

test("countdown: initial runtime is stopped at full duration", () => {
  const rt = initialRuntime(countdown);
  assert.equal(rt.running, false);
  assert.equal(computeRemainingSec(countdown, rt, T0), 300);
});

test("countdown: ticks down while running", () => {
  let rt = initialRuntime(countdown);
  rt = startTimer(countdown, rt, T0);
  assert.equal(rt.running, true);
  assert.equal(computeRemainingSec(countdown, rt, T0 + 10_000), 290);
});

test("countdown: stop banks remaining, resume continues", () => {
  let rt = startTimer(countdown, initialRuntime(countdown), T0);
  rt = stopTimer(countdown, rt, T0 + 60_000); // 240 remaining
  assert.equal(computeRemainingSec(countdown, rt, T0 + 999_000), 240); // frozen while stopped
  rt = startTimer(countdown, rt, T0 + 100_000);
  assert.equal(computeRemainingSec(countdown, rt, T0 + 110_000), 230);
});

test("countdown: overrun goes negative and isOverrun flips (Allows Overrun ON)", () => {
  const rt = startTimer(countdownOverrun, initialRuntime(countdownOverrun), T0);
  assert.equal(isOverrun(countdownOverrun, rt, T0 + 300_000), false); // exactly zero
  assert.equal(computeRemainingSec(countdownOverrun, rt, T0 + 310_000), -10);
  assert.equal(isOverrun(countdownOverrun, rt, T0 + 310_000), true);
});

// ProPresenter "Allows Overrun" defaults to OFF, so by default a countdown
// STOPS at 0:00 rather than running into negative time. This is a deliberate
// behaviour change from PresentFlow's original always-overrun timers
// (user-directed 2026-09-21, CLAUDE.md rule 0a — ProPresenter is the base layer).
test("countdown: WITHOUT Allows Overrun it clamps at 0:00 and never goes negative", () => {
  const rt = startTimer(countdown, initialRuntime(countdown), T0);
  assert.equal(computeRemainingSec(countdown, rt, T0 + 300_000), 0);
  assert.equal(computeRemainingSec(countdown, rt, T0 + 310_000), 0, "must sit at zero, not -10");
  assert.equal(computeRemainingSec(countdown, rt, T0 + 99_999_000), 0, "still zero far past the end");
  assert.equal(isOverrun(countdown, rt, T0 + 310_000), false, "clamped ⇒ never reads as overrun");
});

test("countdown_to: WITHOUT Allows Overrun it clamps at 0 past its target", () => {
  const def: TimerDefinition = { id: "cto2", name: "C", type: "countdown_to", durationSec: 0, targetMs: T0 + 60_000 };
  const rt = initialRuntime(def);
  assert.equal(computeRemainingSec(def, rt, T0), 60);
  assert.equal(computeRemainingSec(def, rt, T0 + 120_000), 0, "past target must clamp, not go negative");
});

// ProPresenter's Elapsed timer takes a start offset and an OPTIONAL end
// ("omit to specify unlimited end time").
test("elapsed: starts at its configured start offset, not zero", () => {
  const def: TimerDefinition = { id: "e1", name: "E", type: "elapsed", durationSec: 0, elapsedStartSec: 90 };
  const rt = startTimer(def, initialRuntime(def), T0);
  assert.equal(computeRemainingSec(def, rt, T0), 90);
  assert.equal(computeRemainingSec(def, rt, T0 + 10_000), 100);
});

test("elapsed: an end time stops it there unless Allows Overrun is on", () => {
  const capped: TimerDefinition = { id: "e2", name: "E", type: "elapsed", durationSec: 0, elapsedEndSec: 60 };
  const rtc = startTimer(capped, initialRuntime(capped), T0);
  assert.equal(computeRemainingSec(capped, rtc, T0 + 30_000), 30);
  assert.equal(computeRemainingSec(capped, rtc, T0 + 90_000), 60, "must stop at the end time");

  const past: TimerDefinition = { ...capped, id: "e3", allowsOverrun: true };
  const rtp = startTimer(past, initialRuntime(past), T0);
  assert.equal(computeRemainingSec(past, rtp, T0 + 90_000), 90, "with overrun it keeps counting past the end");
});

test("elapsed: no end time = unlimited (ProPresenter's wording)", () => {
  const def: TimerDefinition = { id: "e4", name: "E", type: "elapsed", durationSec: 0 };
  const rt = startTimer(def, initialRuntime(def), T0);
  assert.equal(computeRemainingSec(def, rt, T0 + 7_200_000), 7200);
});

test("elapsed: counts up, never overruns", () => {
  let rt = startTimer(elapsed, initialRuntime(elapsed), T0);
  assert.equal(computeRemainingSec(elapsed, rt, T0 + 45_000), 45);
  assert.equal(isOverrun(elapsed, rt, T0 + 45_000), false);
  rt = stopTimer(elapsed, rt, T0 + 45_000);
  assert.equal(computeRemainingSec(elapsed, rt, T0 + 999_000), 45);
});

test("countdown_to: pure wall-clock, goes negative past target", () => {
  const def: TimerDefinition = { id: "t3", name: "To 10:00", type: "countdown_to", durationSec: 0, targetMs: T0 + 120_000, allowsOverrun: true };
  const rt = initialRuntime(def);
  assert.equal(computeRemainingSec(def, rt, T0), 120);
  assert.equal(computeRemainingSec(def, rt, T0 + 130_000), -10);
  assert.equal(isOverrun(def, rt, T0 + 130_000), true);
});

test("reset returns to start and stops", () => {
  let rt = startTimer(countdown, initialRuntime(countdown), T0);
  rt = resetTimer(countdown);
  assert.equal(rt.running, false);
  assert.equal(computeRemainingSec(countdown, rt, T0 + 999_000), 300);
});

test("applyCommand dispatches start/stop/reset", () => {
  let rt = initialRuntime(countdown);
  rt = applyCommand(countdown, rt, "start", T0);
  assert.equal(rt.running, true);
  rt = applyCommand(countdown, rt, "stop", T0 + 5000);
  assert.equal(rt.running, false);
  assert.equal(computeRemainingSec(countdown, rt, T0 + 99_000), 295);
  rt = applyCommand(countdown, rt, "reset", T0);
  assert.equal(computeRemainingSec(countdown, rt, T0), 300);
});

test("start/stop are idempotent", () => {
  let rt = startTimer(countdown, initialRuntime(countdown), T0);
  const rt2 = startTimer(countdown, rt, T0 + 5000);
  assert.equal(rt2, rt); // no-op returns same reference
  const stopped = stopTimer(countdown, rt, T0 + 5000);
  assert.equal(stopTimer(countdown, stopped, T0 + 9000), stopped);
});

test("formatTimerClock: mm:ss, h:mm:ss, and negative overrun", () => {
  assert.equal(formatTimerClock(0), "0:00");
  assert.equal(formatTimerClock(65), "1:05");
  assert.equal(formatTimerClock(3661), "1:01:01");
  assert.equal(formatTimerClock(-12), "-0:12");
  assert.equal(formatTimerClock(-3661), "-1:01:01");
});

test("parseDurationToSec: mm:ss, h:mm:ss, bare, clamps negative", () => {
  assert.equal(parseDurationToSec("05:00"), 300);
  assert.equal(parseDurationToSec("1:00:00"), 3600);
  assert.equal(parseDurationToSec("90"), 90);
  assert.equal(parseDurationToSec("garbage"), 0);
});

// ---------------------------------------------------------------- resolve-once
// The hook resolves a countdown_to target ONCE and then feeds that FIXED target
// to computeRemainingSec every tick. This locks the invariant the fix relies on:
// with a fixed target, crossing it goes NEGATIVE into overrun — it must NOT roll
// +24h the way it would if resolveTargetMs were called with the crossing `now`.
test("countdown_to resolved ONCE crosses zero into overrun (no +24h re-roll)", () => {
  const now = 2_000_000;
  const target = resolveTargetMs("00:00", now); // some concrete future instant
  assert.ok(target != null && target > now);
  const def: TimerDefinition = { id: "cto", name: "C", type: "countdown_to", durationSec: 0, targetMs: target, allowsOverrun: true };
  const rt = initialRuntime(def);
  // Just before the (fixed) target — positive.
  assert.ok(computeRemainingSec(def, rt, target! - 2000) > 0);
  // Exactly at / just after — the SAME fixed target yields ~0 then negative,
  // NOT a fresh ~24h roll (which is what re-resolving per tick would produce).
  assert.ok(computeRemainingSec(def, rt, target! + 3000) < 0);
  assert.ok(isOverrun(def, rt, target! + 3000));
  // Deep past the target stays a small negative overrun, never a huge positive.
  assert.ok(computeRemainingSec(def, rt, target! + 60_000) < 0);
});

// Re-resolution (reset / re-show) is what rolls to the NEXT occurrence: a target
// clock already passed today resolves forward, so the next resolve is > now.
test("resolveTargetMs rolls a passed clock to the next day; a future clock stays today", () => {
  const base = new Date(); base.setHours(12, 0, 0, 0);
  const noon = base.getTime();
  const past = resolveTargetMs("11:59", noon);   // one minute ago → tomorrow
  const future = resolveTargetMs("12:01", noon);  // one minute ahead → today
  assert.ok(past != null && past > noon && past - noon > 23 * 3600 * 1000);
  assert.ok(future != null && future > noon && future - noon <= 60_000);
});

// ── resolveTimerColor — ProPresenter "Color Triggers" ──────────────────────
// Resolved operator-side into the single `color` the wire already carries, so
// threshold colours reach every output with no wire or renderer change.
// MUST agree with resolveWidgetColor in src/engine/stage — a timer cannot be
// one colour on the projector and another on the stage screen.
import { resolveTimerColor } from "../src/engine/timers";
import { resolveWidgetColor } from "../src/engine/stage";

const TRIGGERS = [{ atSec: 60, color: "orange" }, { atSec: 30, color: "yellow" }, { atSec: 10, color: "red" }];

test("colour triggers: lowest crossed threshold wins (PP 60/30/10 example)", () => {
  const look = { color: "#4ade80", colorTriggers: TRIGGERS };
  assert.equal(resolveTimerColor(look, 120), "#4ade80", "above every threshold = base colour");
  assert.equal(resolveTimerColor(look, 60), "orange", "boundary is inclusive");
  assert.equal(resolveTimerColor(look, 31), "orange");
  assert.equal(resolveTimerColor(look, 30), "yellow");
  assert.equal(resolveTimerColor(look, 10), "red");
  assert.equal(resolveTimerColor(look, 5), "red", "5s must be RED, not orange");
});

test("overrun colour beats every trigger", () => {
  assert.equal(resolveTimerColor({ color: "#fff", overrunColor: "#f87171", colorTriggers: TRIGGERS }, -1), "#f87171");
});

test("unset stays unset, so the renderer keeps its own default", () => {
  assert.equal(resolveTimerColor({}, 120), undefined);
  assert.equal(resolveTimerColor({ colorTriggers: [] }, 120), undefined);
  // Past zero with no overrun colour falls back to the base, not to a literal.
  assert.equal(resolveTimerColor({ color: "#abcdef" }, -5), "#abcdef");
});

test("trigger order in the array does not matter", () => {
  const shuffled = [{ atSec: 10, color: "red" }, { atSec: 60, color: "orange" }, { atSec: 30, color: "yellow" }];
  assert.equal(resolveTimerColor({ colorTriggers: shuffled }, 5), "red");
  assert.equal(resolveTimerColor({ colorTriggers: shuffled }, 45), "orange");
});

test("garbage thresholds are ignored, not crashed on", () => {
  const look = { color: "#fff", colorTriggers: [{ atSec: NaN, color: "x" }, { atSec: 30, color: "yellow" }] };
  assert.equal(resolveTimerColor(look, 20), "yellow");
});

test("the timer and stage resolvers agree at every boundary", () => {
  // Same look, same value ⇒ same colour, or the projector and the stage screen
  // would disagree about what colour the sermon timer is.
  //
  // The FIRST version of this test only covered the case where every colour was
  // explicitly set, and so missed a real bug: with overrunColor UNSET the stage
  // resolver hardcoded red past zero while the timer resolver fell back to the
  // base colour. Every combination is now covered, including unset ones.
  const LOOKS = [
    { color: "#4ade80", overrunColor: "#f87171", colorTriggers: TRIGGERS },
    { color: "#4ade80", colorTriggers: TRIGGERS },          // no overrun colour
    { color: "#4ade80" },                                    // no triggers
    { overrunColor: "#f87171", colorTriggers: TRIGGERS },   // no base colour
    { colorTriggers: TRIGGERS },                             // triggers only
    {},                                                      // nothing set at all
  ];
  const SECONDS = [500, 61, 60, 59, 31, 30, 29, 11, 10, 9, 1, 0, -1, -600, -3600];
  for (const look of LOOKS) {
    for (const sec of SECONDS) {
      const fallback = "#ffffff";
      assert.equal(
        resolveTimerColor(look, sec) ?? fallback,
        resolveWidgetColor(look, sec, fallback),
        `resolvers disagree at ${sec}s for look ${JSON.stringify(look)}`,
      );
    }
  }
});

// ── Format options (were dead UI controls until 2026-09-21) ────────────────
test("formatTimerClock honours showHours and leadingZeros", () => {
  assert.equal(formatTimerClock(65), "1:05", "default: no hours under an hour");
  assert.equal(formatTimerClock(65, { showHours: true }), "0:01:05");
  assert.equal(formatTimerClock(65, { leadingZeros: true }), "01:05");
  assert.equal(formatTimerClock(65, { showHours: true, leadingZeros: true }), "00:01:05");
  assert.equal(formatTimerClock(3661, { showHours: true }), "1:01:01");
  assert.equal(formatTimerClock(-65, { leadingZeros: true }), "-01:05", "sign survives formatting");
  // Hours appear past an hour whether or not asked — a 90-minute timer must
  // never read "90:00" (that was the cross-screen bug).
  assert.equal(formatTimerClock(5400), "1:30:00");
});

// ── triggerValueFor — elapsed triggers used to fire backwards ──────────────
import { triggerValueFor } from "../src/engine/timers";

test("triggerValueFor converts an elapsed timer to time-LEFT", () => {
  const elapsed: TimerDefinition = { id: "e", name: "E", type: "elapsed", durationSec: 0, elapsedEndSec: 300 };
  // 60s elapsed of a 5-minute talk = 240s LEFT, not 60.
  assert.equal(triggerValueFor(elapsed, 60), 240);
  assert.equal(triggerValueFor(elapsed, 295), 5, "near the end = little time left");
});

test("an elapsed timer with NO end has no time-left, so triggers do not apply", () => {
  const open: TimerDefinition = { id: "e2", name: "E", type: "elapsed", durationSec: 0 };
  assert.equal(triggerValueFor(open, 120), null);
});

test("a countdown passes its value straight through", () => {
  const cd: TimerDefinition = { id: "c", name: "C", type: "countdown", durationSec: 300 };
  assert.equal(triggerValueFor(cd, 42), 42);
});

test("REGRESSION: elapsed triggers fire near the END, not the start", () => {
  // The bug: feeding the count-up value made a 60s trigger paint red from 0:00
  // and go normal at 1:00 — exactly backwards.
  const elapsed: TimerDefinition = { id: "e3", name: "E", type: "elapsed", durationSec: 0, elapsedEndSec: 300 };
  const look = { color: "#ffffff", colorTriggers: [{ atSec: 60, color: "red" }] };
  const at = (shown: number) => {
    const tv = triggerValueFor(elapsed, shown);
    return tv === null ? look.color : resolveTimerColor(look, tv);
  };
  assert.equal(at(10), "#ffffff", "10s in, plenty left — must NOT be red");
  assert.equal(at(250), "red", "250s in of 300, under a minute left — red");
});

// ── five-state model ───────────────────────────────────────────────────────
import { timerState, incrementTimer } from "../src/engine/timers";

test("timerState distinguishes complete / overrunning / overran", () => {
  const noOverrun: TimerDefinition = { id: "s1", name: "S", type: "countdown", durationSec: 60 };
  const rt = startTimer(noOverrun, initialRuntime(noOverrun), T0);
  assert.equal(timerState(noOverrun, rt, T0 + 30_000), "running");
  assert.equal(timerState(noOverrun, rt, T0 + 90_000), "complete", "clamped ⇒ finished cleanly");

  const over: TimerDefinition = { ...noOverrun, id: "s2", allowsOverrun: true };
  const rto = startTimer(over, initialRuntime(over), T0);
  assert.equal(timerState(over, rto, T0 + 90_000), "overrunning", "past zero and still going");
  const stopped = stopTimer(over, rto, T0 + 90_000);
  assert.equal(timerState(over, stopped, T0 + 90_000), "overran", "past zero and stopped");
});

test("timerState reports stopped before it is started", () => {
  const def: TimerDefinition = { id: "s3", name: "S", type: "countdown", durationSec: 60 };
  assert.equal(timerState(def, initialRuntime(def), T0), "stopped");
});

// ── incrementTimer — the live nudge ────────────────────────────────────────
test("increment adds time to a RUNNING timer without resetting it", () => {
  const def: TimerDefinition = { id: "i1", name: "I", type: "countdown", durationSec: 300 };
  let rt = startTimer(def, initialRuntime(def), T0);
  assert.equal(computeRemainingSec(def, rt, T0 + 60_000), 240);
  rt = incrementTimer(def, rt, 120, T0 + 60_000);   // "two more minutes"
  assert.equal(computeRemainingSec(def, rt, T0 + 60_000), 360, "240 + 120");
  assert.equal(rt.running, true, "must KEEP running — that is the whole point");
  // and it keeps ticking from the new value
  assert.equal(computeRemainingSec(def, rt, T0 + 70_000), 350);
});

test("increment can subtract, and works while paused", () => {
  const def: TimerDefinition = { id: "i2", name: "I", type: "countdown", durationSec: 300 };
  const rt = incrementTimer(def, initialRuntime(def), -60, T0);
  assert.equal(computeRemainingSec(def, rt, T0), 240);
  assert.equal(rt.running, false, "a paused timer stays paused");
});

test("increment is a no-op for countdown_to and for zero", () => {
  const cto: TimerDefinition = { id: "i3", name: "I", type: "countdown_to", durationSec: 0, targetMs: T0 + 60_000 };
  const rt = initialRuntime(cto);
  assert.deepEqual(incrementTimer(cto, rt, 60, T0), rt, "its value comes from the wall clock");
  const cd: TimerDefinition = { id: "i4", name: "I", type: "countdown", durationSec: 60 };
  assert.deepEqual(incrementTimer(cd, rt, 0, T0), rt);
});

// ── REGRESSIONS from the destructive pass (2026-09-21) ────────────────────

test("REGRESSION: a sub-second overrun does not render as \"-0:00\"", () => {
  // A minus sign on a value that reads as zero looks broken to an operator,
  // and it showed for a full second at every crossover.
  assert.equal(formatTimerClock(-0.4), "0:00");
  assert.equal(formatTimerClock(-0.9), "0:00");
  assert.equal(formatTimerClock(-1), "-0:01", "a real second of overrun still signs");
  assert.equal(formatTimerClock(0), "0:00");
});

test("REGRESSION: Stop genuinely freezes a countdown_to", () => {
  // It used to ignore the runtime entirely: Stop flipped a flag, the number
  // kept ticking, and timerState still said "running".
  const def: TimerDefinition = { id: "f1", name: "F", type: "countdown_to", durationSec: 0, targetMs: T0 + 300_000 };
  let rt = startTimer(def, initialRuntime(def), T0);
  assert.equal(computeRemainingSec(def, rt, T0 + 60_000), 240);

  rt = stopTimer(def, rt, T0 + 60_000);
  assert.equal(computeRemainingSec(def, rt, T0 + 60_000), 240, "frozen at the value when stopped");
  assert.equal(computeRemainingSec(def, rt, T0 + 120_000), 240, "and STAYS frozen as the clock moves on");
  assert.equal(timerState(def, rt, T0 + 120_000), "stopped", "state must follow the operator, not the wall clock");

  rt = startTimer(def, rt, T0 + 120_000);
  assert.equal(computeRemainingSec(def, rt, T0 + 120_000), 180, "resuming returns to the real clock");
  assert.equal(timerState(def, rt, T0 + 120_000), "running");
});

test("a never-started countdown_to shows the live clock and reads stopped", () => {
  const def: TimerDefinition = { id: "f2", name: "F", type: "countdown_to", durationSec: 0, targetMs: T0 + 90_000 };
  const rt = initialRuntime(def);
  assert.equal(computeRemainingSec(def, rt, T0), 90, "still previews the real figure");
  assert.equal(timerState(def, rt, T0), "stopped", "it has not been started");
});
