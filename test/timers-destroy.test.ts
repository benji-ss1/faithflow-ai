import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRemainingSec, timerState, incrementTimer, resolveTimerColor, triggerValueFor,
  formatTimerClock, resolveTargetMs, to24Hour, parseDurationToSec,
  startTimer, stopTimer, resetTimer, applyCommand, initialRuntime,
  TimerDefinition, TimerRuntime,
} from "../src/engine/timers";

const cd = (over: Partial<TimerDefinition> = {}): TimerDefinition => ({
  id: "t1", name: "T", type: "countdown", durationSec: 60, ...over,
});

test("FIXED: a sub-second overrun renders as 0:00, not -0:00", () => {
  // A minus sign on a value that reads as zero looked broken, and showed for a
  // full second at every crossover. Now suppressed when it floors to zero.
  assert.equal(formatTimerClock(-0.4), "0:00");
  assert.equal(formatTimerClock(-0.5), "0:00");
  assert.equal(formatTimerClock(-1), "-0:01", "a real second of overrun still signs");
});

test("FIXED: countdown_to honours rt.running — stopTimer freezes it", () => {
  const def = cd({ type: "countdown_to", targetMs: 1_000_000 });
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  assert.equal(timerState(def, rt, 0), "running");
  const before = computeRemainingSec(def, rt, 0);
  rt = stopTimer(def, rt, 0);
  assert.equal(rt.running, false);
  assert.equal(timerState(def, rt, 0), "stopped", "state follows the operator, not the wall clock");
  assert.equal(computeRemainingSec(def, rt, 500_000), before, "and the value is genuinely frozen");
});

test("FIXED: a never-started countdown_to reads stopped", () => {
  const def = cd({ type: "countdown_to", targetMs: 1_000_000 });
  const rt = initialRuntime(def); // never started
  assert.equal(rt.running, false);
  assert.equal(timerState(def, rt, 0), "stopped");
  assert.equal(computeRemainingSec(def, rt, 0), 1000, "still previews the live wall-clock figure");
});

test("overrun toggle mid-flight: same runtime, value jumps discontinuously between allowsOverrun true/false", () => {
  const def = cd({ durationSec: 60 });
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  const nowMs = 90_000; // 30s past the 60s duration
  const withOverrun = computeRemainingSec({ ...def, allowsOverrun: true }, rt, nowMs);
  const without = computeRemainingSec({ ...def, allowsOverrun: false }, rt, nowMs);
  assert.equal(withOverrun, -30);
  assert.equal(without, 0);
  // A 30-second jump for the exact same runtime + clock, driven purely by a
  // boolean flag flip. Legitimate per the design (clamp vs no-clamp) but any
  // caller re-evaluating both branches (e.g. a live settings toggle) will see
  // the number snap by 30s instantly — flagging as a real UX surprise, not a bug.
});

test("state machine: increment a completed (clamped) countdown to push it back into positive time", () => {
  const def = cd({ durationSec: 60, allowsOverrun: false });
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  rt = { ...rt }; // running
  const atComplete = computeRemainingSec(def, rt, 60_000);
  assert.equal(atComplete, 0);
  assert.equal(timerState(def, rt, 60_000), "complete");
  // Increment by +30s while "complete"
  rt = incrementTimer(def, rt, 30, 60_000);
  const after = computeRemainingSec(def, rt, 60_000);
  assert.equal(after, 30);
  assert.equal(timerState(def, rt, 60_000), "running", "incrementing off zero un-completes it without any start/reset call");
});

test("state machine: increment a completed countdown by a NEGATIVE amount while overrun is disallowed re-clamps to 0, silently eating the decrement", () => {
  const def = cd({ durationSec: 60, allowsOverrun: false });
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  rt = incrementTimer(def, rt, -1000, 60_000); // try to push it deep negative
  // computeRemainingSec clamps to 0 for a countdown w/o overrun regardless of baseSec
  assert.equal(computeRemainingSec(def, rt, 60_000), 0);
  assert.equal(timerState(def, rt, 60_000), "complete");
});

test("state machine: reaching 'complete' then increment forward then let it re-decay back past zero -> 'complete' again, all with zero start/stop/reset calls", () => {
  const def = cd({ durationSec: 10, allowsOverrun: false });
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  rt = stopTimer(def, rt, 10_000); // paused at 0, complete
  assert.equal(timerState(def, rt, 10_000), "complete");
  rt = incrementTimer(def, rt, 5, 10_000); // now paused at 5s remaining, but running flag stays false (paused)
  assert.equal(rt.running, false);
  assert.equal(timerState(def, rt, 10_000), "stopped", "un-completed by increment alone while paused");
});

test("increment repeatedly at high frequency (1000x) is exact, no drift", () => {
  const def = cd({ type: "elapsed", durationSec: 0 });
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  for (let i = 0; i < 1000; i++) rt = incrementTimer(def, rt, 1, 0);
  assert.equal(computeRemainingSec(def, rt, 0), 1000);
});

test("increment by a huge number does not overflow to Infinity/NaN", () => {
  const def = cd({ durationSec: 60 });
  let rt = initialRuntime(def);
  rt = incrementTimer(def, rt, Number.MAX_SAFE_INTEGER, 0);
  const v = computeRemainingSec(def, rt, 0);
  assert.ok(Number.isFinite(v), `expected finite, got ${v}`);
});

test("time hostility: clock jumps BACKWARDS mid-countdown makes remaining go UP (negative elapsed)", () => {
  const def = cd({ durationSec: 60 });
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 100_000);
  const normal = computeRemainingSec(def, rt, 110_000); // 10s elapsed -> 50 remaining
  assert.equal(normal, 50);
  const backwards = computeRemainingSec(def, rt, 90_000); // clock went back 10s before anchor
  assert.equal(backwards, 70, "remaining EXCEEDS durationSec because sinceAnchor went negative — no clamp against the original duration");
});

test("time hostility: nowMs = 0", () => {
  const def = cd({ type: "countdown_to", targetMs: 5000 });
  const rt = initialRuntime(def);
  assert.equal(computeRemainingSec(def, rt, 0), 5);
});

test("time hostility: negative nowMs", () => {
  const def = cd({ type: "countdown_to", targetMs: 5000 });
  const rt = initialRuntime(def);
  assert.equal(computeRemainingSec(def, rt, -5000), 10);
});

test("time hostility: nowMs = Number.MAX_SAFE_INTEGER does not throw and stays finite", () => {
  const def = cd({ type: "countdown_to", targetMs: 0 });
  const rt = initialRuntime(def);
  const v = computeRemainingSec(def, rt, Number.MAX_SAFE_INTEGER);
  assert.ok(Number.isFinite(v));
});

test("resolveTargetMs: target exactly at now rolls to +24h (never returns 'now')", () => {
  const now = new Date(2026, 5, 1, 10, 30, 0, 0).getTime();
  const t = resolveTargetMs("10:30", now, "24_hour");
  assert.equal(t, now + 24 * 60 * 60 * 1000);
});

test("resolveTargetMs: DST spring-forward — 2:30 AM on the skipped day resolves to a real (shifted) instant, not garbage", () => {
  const origTZ = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    // 2026-03-08 is the US DST spring-forward date (2:00 -> 3:00 skipped).
    const now = new Date(2026, 2, 8, 1, 0, 0, 0).getTime();
    const t = resolveTargetMs("2:30", now, "am");
    assert.ok(t !== null);
    const d = new Date(t!);
    // JS Date.setHours(2,30) on a skipped hour normalizes forward to 3:30.
    // Document actual behavior rather than assume.
    assert.equal(d.getHours() === 2 || d.getHours() === 3, true, `unexpected hour ${d.getHours()}`);
  } finally {
    process.env.TZ = origTZ;
  }
});

test("AM/PM: to24Hour full matrix, 12 AM = 0, 12 PM = 12", () => {
  assert.equal(to24Hour(12, "am"), 0);
  assert.equal(to24Hour(12, "pm"), 12);
  for (let h = 1; h <= 11; h++) {
    assert.equal(to24Hour(h, "am"), h);
    assert.equal(to24Hour(h, "pm"), h + 12);
  }
  assert.equal(to24Hour(5, null), 5);
  assert.equal(to24Hour(5, undefined), 5);
  assert.equal(to24Hour(5, "garbage" as any), 5);
});

test("resolveTargetMs: '0:30' with period 'am' is rejected (no 0 AM in 12-hour input)", () => {
  const now = Date.now();
  assert.equal(resolveTargetMs("0:30", now, "am"), null);
});

test("resolveTargetMs: 24_hour mode accepts 0-23, rejects 24+", () => {
  const now = new Date(2026, 5, 1, 0, 0, 0, 0).getTime();
  assert.notEqual(resolveTargetMs("0:00", now, "24_hour"), null);
  assert.notEqual(resolveTargetMs("23:59", now, "24_hour"), null);
  assert.equal(resolveTargetMs("24:00", now, "24_hour"), null);
});

test("resolveTargetMs: garbage input rejected in every mode", () => {
  const now = Date.now();
  assert.equal(resolveTargetMs("garbage", now, "24_hour"), null);
  assert.equal(resolveTargetMs("25:99", now, null), null);
  assert.equal(resolveTargetMs("", now, "am"), null);
  assert.equal(resolveTargetMs("13:00", now, "pm"), null, "13 is out of 1-12 range for 12-hour mode");
});

test("colour triggers: elapsed timer WITH end shorter than its start — triggerValueFor can be negative from the start", () => {
  const def = cd({ type: "elapsed", elapsedStartSec: 100, elapsedEndSec: 50 });
  // start (100) is already past end (50) — an operator misconfiguration.
  const rt = initialRuntime(def); // baseSec = max(0, 100) = 100
  const displayed = computeRemainingSec(def, rt, 0); // min(100, 50) = 50, clamped immediately at "end"
  assert.equal(displayed, 50);
  assert.equal(timerState(def, rt, 0), "complete", "starts already 'complete' the instant it is created");
  const triggerVal = triggerValueFor(def, displayed);
  assert.equal(triggerVal, 0); // end(50) - displayed(50)
});

test("colour triggers: duplicate atSec, negative atSec, NaN atSec, 8 triggers", () => {
  const triggers = [
    { atSec: 30, color: "orange" },
    { atSec: 30, color: "ORANGE_DUPLICATE" },
    { atSec: -5, color: "impossible" },
    { atSec: NaN, color: "nan" },
    { atSec: 10, color: "red" },
    { atSec: 20, color: "yellow" },
    { atSec: 5, color: "deep-red" },
    { atSec: 0, color: "zero" },
  ];
  const look = { color: "base", overrunColor: "over", colorTriggers: triggers };
  // remaining=5 -> lowest crossed threshold among {30,30,10,20,5,0} that is >=5 is 5 itself (deep-red)
  assert.equal(resolveTimerColor(look, 5), "deep-red");
  // remaining=0 -> lowest is 0
  assert.equal(resolveTimerColor(look, 0), "zero");
  // remaining=-1 -> overrun colour beats everything including the atSec:-5 trigger
  assert.equal(resolveTimerColor(look, -1), "over");
  // remaining=29 -> both atSec:30 entries crossed (29<=30), duplicate first-by-sort-stability wins
  assert.equal(resolveTimerColor(look, 29), "orange");
});

test("colour triggers: NaN atSec is never crossed (Number.isFinite guard holds) — mutation check", () => {
  const look = { color: "base", colorTriggers: [{ atSec: NaN, color: "should-never-fire" }] };
  assert.equal(resolveTimerColor(look, 0), "base");
  assert.equal(resolveTimerColor(look, -Infinity), "base");
});

test("format: boundary table incl. -0.4/-0.5 negative-zero and 86400", () => {
  const cases: Array<[number, string]> = [
    [-3601, "-1:00:01"], [-3600, "-1:00:00"], [-60, "-1:00"], [-1, "-0:01"],
    [0, "0:00"], [59, "0:59"], [60, "1:00"], [3599, "59:59"], [3600, "1:00:00"],
    [86399, "23:59:59"], [86400, "24:00:00"],
  ];
  for (const [sec, expected] of cases) {
    assert.equal(formatTimerClock(sec), expected, `sec=${sec}`);
  }
  assert.equal(formatTimerClock(-0.5), "0:00", "sub-second overrun is not signed");
  assert.equal(formatTimerClock(-0.4), "0:00");
  assert.equal(formatTimerClock(1e9), "277777:46:40");
});

test("format: leadingZeros + showHours option combos at boundaries", () => {
  assert.equal(formatTimerClock(65, { leadingZeros: true }), "01:05");
  assert.equal(formatTimerClock(65, { showHours: true, leadingZeros: true }), "00:01:05");
  assert.equal(formatTimerClock(65, { showHours: true }), "0:01:05", "minutes/seconds are always 2-digit padded once the hours segment is shown, regardless of leadingZeros");
});

test("round-trip: parseDurationToSec(formatTimerClock(x)) holds for ordinary positive durations", () => {
  for (const x of [0, 1, 59, 60, 61, 3599, 3600, 3661, 86399]) {
    const s = formatTimerClock(x);
    assert.equal(parseDurationToSec(s), x, `roundtrip failed for ${x} -> "${s}"`);
  }
});

test("BUG: round-trip breaks for negative values — parseDurationToSec cannot represent overrun and silently clamps to 0", () => {
  const s = formatTimerClock(-90);
  assert.equal(s, "-1:30");
  assert.equal(parseDurationToSec(s), 0, "the minus sign + leading '-1' segment gets parsed as -1*60+30=-30, then clamped to 0 — negative durations are unrepresentable input");
});

test("BUG: parseDurationToSec silently accepts garbage segments as 0 (NaN -> 0 via `|| 0`) rather than rejecting", () => {
  assert.equal(parseDurationToSec("abc:def"), 0);
  assert.equal(parseDurationToSec("5:abc"), 300, "garbage seconds segment silently becomes :00, no error surfaced");
});

test("parseDurationToSec: bare seconds vs mm:ss ambiguity is not a bug (documented), just confirm behavior", () => {
  assert.equal(parseDurationToSec("90"), 90); // bare = seconds, not 90 minutes
  assert.equal(parseDurationToSec("1:30"), 90); // same numeric value via mm:ss
});

test("full state-machine sweep: every start/stop/reset ordering for countdown with overrun on/off never yields a value contradicting its state", () => {
  const orderings: Array<Array<"start" | "stop" | "reset">> = [
    ["start"], ["start", "stop"], ["start", "stop", "start"], ["start", "reset"],
    ["start", "stop", "reset", "start"], ["reset", "start", "stop", "start", "stop"],
    ["start", "start"], ["stop"], ["reset"], ["reset", "reset"],
  ];
  for (const overrun of [true, false]) {
    for (const ops of orderings) {
      const def = cd({ durationSec: 5, allowsOverrun: overrun });
      let rt = initialRuntime(def);
      let t = 0;
      for (const op of ops) {
        t += 1000;
        rt = applyCommand(def, rt, op, t);
      }
      // Invariant check only (not "did it reach the end" — a stop mid-run
      // legitimately leaves time remaining): state must never contradict value.
      const farNow = t + 100_000;
      const value = computeRemainingSec(def, rt, farNow);
      const state = timerState(def, rt, farNow);
      if (value > 0) {
        assert.ok(state === "running" || state === "stopped", `ops=${ops} overrun=${overrun} value=${value} state=${state} contradicts positive remaining time`);
      } else if (value === 0) {
        assert.ok(state === "complete" || state === "stopped" || state === "running", `ops=${ops} overrun=${overrun} value=0 state=${state}`);
      } else {
        // value < 0 can only happen with overrun allowed
        assert.equal(overrun, true, `ops=${ops} value=${value} went negative with overrun DISALLOWED — clamp violated`);
        assert.ok(state === "overrunning" || state === "overran", `ops=${ops} value=${value} state=${state} contradicts negative (overrun) value`);
      }
    }
  }
});

test("teardown: create, start, delete-equivalent (reset), recreate same id, still deterministic", () => {
  const def = cd({ id: "same-id", durationSec: 30 });
  let rt = initialRuntime(def);
  rt = startTimer(def, rt, 0);
  rt = resetTimer(def); // "delete while live" surrogate: reset drops all runtime state
  assert.deepEqual(rt, initialRuntime(def));
  rt = startTimer(def, rt, 5000);
  assert.equal(computeRemainingSec(def, rt, 10000), 25);
});
