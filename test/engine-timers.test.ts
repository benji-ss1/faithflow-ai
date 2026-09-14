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

test("countdown: overrun goes negative and isOverrun flips", () => {
  let rt = startTimer(countdown, initialRuntime(countdown), T0);
  assert.equal(isOverrun(countdown, rt, T0 + 300_000), false); // exactly zero
  assert.equal(computeRemainingSec(countdown, rt, T0 + 310_000), -10);
  assert.equal(isOverrun(countdown, rt, T0 + 310_000), true);
});

test("elapsed: counts up, never overruns", () => {
  let rt = startTimer(elapsed, initialRuntime(elapsed), T0);
  assert.equal(computeRemainingSec(elapsed, rt, T0 + 45_000), 45);
  assert.equal(isOverrun(elapsed, rt, T0 + 45_000), false);
  rt = stopTimer(elapsed, rt, T0 + 45_000);
  assert.equal(computeRemainingSec(elapsed, rt, T0 + 999_000), 45);
});

test("countdown_to: pure wall-clock, goes negative past target", () => {
  const def: TimerDefinition = { id: "t3", name: "To 10:00", type: "countdown_to", durationSec: 0, targetMs: T0 + 120_000 };
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
  const def: TimerDefinition = { id: "cto", name: "C", type: "countdown_to", durationSec: 0, targetMs: target };
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
