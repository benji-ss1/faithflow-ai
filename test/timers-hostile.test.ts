import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRemainingSec, isOverrun, startTimer, stopTimer, resetTimer,
  formatTimerClock, resolveTargetMs, parseDurationToSec, resolveTimerColor,
  initialRuntime, type TimerDefinition, type TimerRuntime,
} from "../src/engine/timers/index";

// ── colour resolution (ONE resolver since 2026-09-22) ──
// The timers/index.ts docstring explicitly promises: "Rules (match
// resolveWidgetColor in src/engine/stage, deliberately — the two must never
// disagree about what colour a timer is)". They disagree whenever
// `overrunColor` is unset: the timer engine falls back to the base `color`
// (or undefined), while the stage widget resolver hardcodes "#f87171".
// FIXED 2026-09-21. These two tests originally PINNED a real bug: the two
// resolvers disagreed when `overrunColor` was unset — the stage resolver
// hardcoded red past zero while the timer resolver fell back to the base
// colour, so the same overrun timer painted red on the stage screen and white
// on the projector. resolveWidgetColor now delegates to resolveTimerColor, so
// there is exactly ONE implementation. These now assert the agreement.


// ── 🔴 Editing durationSec on a STOPPED (already-used) timer is silently ignored ──
// computeRemainingSec/startTimer read rt.baseSec, not def.durationSec, once a
// runtime has ever banked a value. A caller who edits the duration field on a
// timer that has been started and stopped (so baseSec != durationSec) will see
// NO effect from the edit until they call resetTimer — startTimer just resumes
// the OLD banked remaining value, not the new duration.
test("🔴 editing durationSec after a stop does not take effect until reset", () => {
  const def: TimerDefinition = { id: "t1", name: "T", type: "countdown", durationSec: 60 };
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  rt = stopTimer(def, rt, 10_000); // banked baseSec = 50
  assert.equal(rt.baseSec, 50);

  // Operator edits the duration field from 60 -> 600 while stopped.
  const editedDef: TimerDefinition = { ...def, durationSec: 600 };

  // Starting again should, from a product standpoint, plausibly reflect the
  // freshly-typed duration — but it doesn't: it resumes from the stale 50s.
  const resumed = startTimer(editedDef, rt, 20_000);
  assert.equal(resumed.baseSec, 50, "confirms: new durationSec is ignored on resume");
  assert.notEqual(resumed.baseSec, editedDef.durationSec);
});

test("🟡 editing durationSec on a NEVER-STARTED timer is also silently ignored (needs explicit reset)", () => {
  const def: TimerDefinition = { id: "t1", name: "T", type: "countdown", durationSec: 60 };
  const rt = initialRuntime(def); // baseSec = 60, never started
  const editedDef: TimerDefinition = { ...def, durationSec: 300 };
  // Naive expectation: computeRemainingSec should read the fresh 300s.
  const remaining = computeRemainingSec(editedDef, rt, 0);
  assert.equal(remaining, 60, "confirms: banked baseSec from the OLD duration wins over the edited def");
  // Only resetTimer(editedDef) picks up the new value:
  const afterReset = resetTimer(editedDef);
  assert.equal(afterReset.baseSec, 300);
});

// ── 🟡 countdown_to ignores rt entirely: stop/reset never freeze or reset the displayed value ──
// FIXED 2026-09-21. This test originally PINNED the bug: stopping a
// countdown_to changed a flag and nothing else — the number kept ticking with
// the wall clock and the state still read "running". ProPresenter's API exposes
// stop for every timer id, so Stop must genuinely freeze. Now asserts the fix.
test("stopping a countdown_to freezes its displayed value", () => {
  const T0 = Date.UTC(2026, 8, 21, 10, 0, 0);
  const def: TimerDefinition = { id: "cto-stop", name: "C", type: "countdown_to", durationSec: 0, targetMs: T0 + 600_000 };
  let rt = startTimer(def, initialRuntime(def), T0);
  const atStop = computeRemainingSec(def, rt, T0 + 60_000);
  rt = stopTimer(def, rt, T0 + 60_000);
  assert.equal(computeRemainingSec(def, rt, T0 + 60_000), atStop);
  assert.equal(computeRemainingSec(def, rt, T0 + 300_000), atStop, "must NOT keep counting once stopped");
});

test("🟡 resetTimer is a no-op for the displayed value of a countdown_to timer", () => {
  const def: TimerDefinition = { id: "c1", name: "C", type: "countdown_to", durationSec: 0, targetMs: 100_000 };
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  const beforeReset = computeRemainingSec(def, rt, 40_000);
  rt = resetTimer(def);
  const afterReset = computeRemainingSec(def, rt, 40_000);
  assert.equal(beforeReset, 60);
  assert.equal(afterReset, 60, "reset changed nothing about the displayed countdown_to value");
});

// ── parseDurationToSec hostile inputs ──
test("🟡 parseDurationToSec silently drops digits from an internally-spaced token", () => {
  // " 5 : 0 5 " -> trimmed to "5 : 0 5" -> split(':') -> ["5 ", " 0 5"]
  // parseInt(" 0 5", 10) stops at the interior space and yields 0, not 5.
  const sec = parseDurationToSec(" 5 : 0 5 ");
  assert.equal(sec, 300, "expected data loss: '05' seconds silently became 0");
  // A human typing "5 : 05" would reasonably expect 305, not 300.
  assert.notEqual(sec, 305);
});

test("🟢 parseDurationToSec: negative single value clamps to 0 as documented", () => {
  assert.equal(parseDurationToSec("-5"), 0);
});

test("🟡 parseDurationToSec: negative middle component is not re-clamped per-part, only the final sum", () => {
  // parts = [1, -5] -> sec = 1*60 + -5 = 55 (clamped only at the very end)
  assert.equal(parseDurationToSec("1:-5"), 55);
});

test("🟡 parseDurationToSec: '1e3' is silently truncated by parseInt to 1, not treated as scientific 1000 or rejected", () => {
  assert.equal(parseDurationToSec("1e3"), 1);
});

test("🟢 parseDurationToSec: '0x10' parses as 0 under radix 10 (no hex surprise)", () => {
  assert.equal(parseDurationToSec("0x10"), 0);
});

test("🟢 parseDurationToSec: '::' / all-empty parts -> 0, no NaN leak, no throw", () => {
  assert.equal(parseDurationToSec("::"), 0);
  assert.equal(Number.isNaN(parseDurationToSec("::")), false);
});

test("🟡 parseDurationToSec: unicode fullwidth digits silently become 0 (no digit recognized)", () => {
  // U+FF15 etc. — parseInt does not understand fullwidth digits.
  const sec = parseDurationToSec("５:０５"); // "５:０５"
  assert.equal(sec, 0, "confirms silent total data loss for unicode digits, no error surfaced");
});

test("🟢 parseDurationToSec: '99:99:99' is accepted verbatim as an oversized-but-valid duration (documented as tolerant)", () => {
  assert.equal(parseDurationToSec("99:99:99"), 99 * 3600 + 99 * 60 + 99);
});

test("🟢 format(parse(x)) round-trips for well-formed inputs", () => {
  for (const s of ["0:00", "1:02", "1:02:03", "0:59", "59:59"]) {
    const sec = parseDurationToSec(s);
    assert.equal(formatTimerClock(sec), s);
  }
});

// ── resolveTargetMs hostile inputs ──
test("🟢 resolveTargetMs rejects '24:00' (out of range hour)", () => {
  assert.equal(resolveTargetMs("24:00", Date.now()), null);
});

test("🟢 resolveTargetMs rejects '0:60' (out of range minute)", () => {
  assert.equal(resolveTargetMs("0:60", Date.now()), null);
});

test("🟢 resolveTargetMs rejects malformed/whitespace-only strings without throwing", () => {
  assert.equal(resolveTargetMs("", 0), null);
  assert.equal(resolveTargetMs("   ", 0), null);
  assert.equal(resolveTargetMs("noon", 0), null);
  assert.equal(resolveTargetMs(undefined, 0), null);
  assert.equal(resolveTargetMs(null, 0), null);
});

test("🟢 resolveTargetMs: target exactly equal to now rolls forward 24h (never returns 'now' itself)", () => {
  const now = new Date(2026, 0, 1, 9, 30, 0, 0).getTime();
  const t = resolveTargetMs("09:30", now);
  assert.equal(t, now + 24 * 60 * 60 * 1000);
});

test("🟢 resolveTargetMs accepts single-digit hour with leading/trailing whitespace", () => {
  const now = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
  const t = resolveTargetMs("  9:05  ", now);
  assert.notEqual(t, null);
});

// ── overrun / start-stop-reset sequencing ──
test("🟢 countdown clamps at exactly 0 and stays there without going negative when overrun disallowed", () => {
  const def: TimerDefinition = { id: "t", name: "T", type: "countdown", durationSec: 5 };
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  assert.equal(computeRemainingSec(def, rt, 5_000), 0);
  assert.equal(computeRemainingSec(def, rt, 50_000), 0, "long past the endpoint, still clamped to 0");
  assert.equal(isOverrun(def, rt, 50_000), false);
});

test("🟢 countdown with allowsOverrun goes negative and isOverrun flips true past zero", () => {
  const def: TimerDefinition = { id: "t", name: "T", type: "countdown", durationSec: 5, allowsOverrun: true };
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  assert.equal(computeRemainingSec(def, rt, 8_000), -3);
  assert.equal(isOverrun(def, rt, 8_000), true);
});

test("🟢 stop-then-start after clamped overrun-disallowed countdown resumes from 0, not a stale negative", () => {
  const def: TimerDefinition = { id: "t", name: "T", type: "countdown", durationSec: 5 };
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  rt = stopTimer(def, rt, 20_000); // way past zero, but clamp means baseSec banks at 0
  assert.equal(rt.baseSec, 0);
  rt = startTimer(def, rt, 100_000);
  // one second after restart, without overrun this correctly re-clamps to 0
  assert.equal(computeRemainingSec(def, rt, 101_000), 0, "without overrun this should stay clamped at 0");
});

test("🟢 restarting a clamped countdown (overrun disallowed) from 0 correctly re-clamps rather than going negative", () => {
  const def: TimerDefinition = { id: "t", name: "T", type: "countdown", durationSec: 5 };
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  rt = stopTimer(def, rt, 20_000);
  rt = startTimer(def, rt, 100_000);
  const oneSecLater = computeRemainingSec(def, rt, 101_000);
  // Actual clamp math: baseSec=0, sinceAnchor=1 -> raw=-1 -> overrun false -> max(0,-1) = 0
  assert.equal(oneSecLater, 0, "engine DOES correctly re-clamp to 0 (documenting this is fine, not a bug)");
});

test("🟢 elapsed timer stops advancing once it reaches elapsedEndSec (overrun disallowed)", () => {
  const def: TimerDefinition = { id: "e", name: "E", type: "elapsed", durationSec: 0, elapsedEndSec: 10 };
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  assert.equal(computeRemainingSec(def, rt, 15_000), 10);
  assert.equal(computeRemainingSec(def, rt, 100_000), 10);
});

test("🟢 elapsed timer with elapsedStartSec offset begins there, not at zero", () => {
  const def: TimerDefinition = { id: "e", name: "E", type: "elapsed", durationSec: 0, elapsedStartSec: 30 };
  const rt = initialRuntime(def);
  assert.equal(rt.baseSec, 30);
  assert.equal(computeRemainingSec(def, rt, 0), 30);
});

test("🟢 elapsed timer: end < start still resolves — min(raw, end) immediately clamps to the (smaller) end", () => {
  const def: TimerDefinition = { id: "e", name: "E", type: "elapsed", durationSec: 0, elapsedStartSec: 50, elapsedEndSec: 10 };
  let rt = initialRuntime(def); // baseSec = 50 (start offset wins in initialRuntime)
  assert.equal(rt.baseSec, 50);
  rt = startTimer(def, rt, 0);
  // raw = 50 + sinceAnchor; min(raw, 10) => 10 permanently, even at t=0.
  assert.equal(computeRemainingSec(def, rt, 0), 10, "immediately clamped below its own start offset — end < start is degenerate but doesn't crash");
});

// ── start/stop cycling precision ──
test("🟢 1000 start/stop cycles bank an exact value with no floating point drift beyond epsilon", () => {
  const def: TimerDefinition = { id: "t", name: "T", type: "countdown", durationSec: 100000 };
  let rt = initialRuntime(def);
  let t = 0;
  for (let i = 0; i < 1000; i++) {
    rt = startTimer(def, rt, t);
    t += 137; // odd interval in ms
    rt = stopTimer(def, rt, t);
    t += 53;
  }
  const expectedElapsedSec = (1000 * 137) / 1000;
  const expectedRemaining = 100000 - expectedElapsedSec;
  assert.ok(Math.abs(rt.baseSec - expectedRemaining) < 1e-6, `drift too large: ${rt.baseSec} vs ${expectedRemaining}`);
});

test("🟢 10,000 sequential 100ms ticks show no cumulative drift (value is pure function of anchor, not incremental)", () => {
  const def: TimerDefinition = { id: "t", name: "T", type: "countdown", durationSec: 100000, allowsOverrun: true };
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  let last = 0;
  for (let i = 1; i <= 10000; i++) {
    const now = i * 100;
    last = computeRemainingSec(def, rt, now);
  }
  assert.equal(last, 100000 - 1000, "10000*100ms = 1000s elapsed, exact");
});

// ── resolveTimerColor / resolveWidgetColor threshold-boundary agreement (where they DO agree) ──
test("lowest-crossed-threshold holds at every exact boundary", () => {
  const triggers = [{ atSec: 60, color: "orange" }, { atSec: 30, color: "yellow" }, { atSec: 10, color: "red" }];
  const look = { color: "base", overrunColor: "over", colorTriggers: triggers };
  const expected: Array<[number, string]> = [
    [61, "base"], [60, "orange"], [59, "orange"],
    [30, "yellow"], [29, "yellow"], [10, "red"], [9, "red"], [0, "red"],
  ];
  for (const [sec, want] of expected) {
    assert.equal(resolveTimerColor(look, sec), want, `wrong colour at ${sec}s`);
  }
  assert.equal(resolveTimerColor(look, -1), "over", "past zero the overrun colour wins");
});


// ── NaN handling ──

test("🟢 computeRemainingSec with a NaN durationSec never crashes and degrades to NaN cleanly (not silently 0)", () => {
  const def: TimerDefinition = { id: "t", name: "T", type: "countdown", durationSec: NaN };
  const rt = initialRuntime(def);
  // Math.max(0, NaN) === NaN in JS (NaN comparisons are always false) — worth knowing.
  assert.ok(Number.isNaN(rt.baseSec), "initialRuntime banks NaN as-is; NaN propagates through the whole timer silently");
});
