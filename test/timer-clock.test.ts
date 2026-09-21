/**
 * Clock-skew correction for networked timers.
 * Run: npx tsx --test test/timer-clock.test.ts
 *
 * No devices and no fake timers needed — every function takes its clocks
 * explicitly, which is why it was written that way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldClockSync, measureOffset, senderNow, shouldSweepWireTimers,
  CLOCK_SYNC_RESET_MS, CLOCK_SYNC_JUMP_MS, TIMERS_LIVENESS_MS, TIMERS_WIRE_STALE_MS,
  type ClockSync,
} from "../src/lib/timer-clock";
import { computeRemainingSec, type TimerDefinition, type TimerRuntime } from "../src/engine/timers";

const R = 1_700_000_000_000; // a receiver-clock instant

test("offset is sender minus receiver", () => {
  assert.equal(measureOffset(R + 40_000, R), 40_000, "sender ahead ⇒ positive");
  assert.equal(measureOffset(R - 40_000, R), -40_000);
});

test("the first sample is taken whole", () => {
  const s = foldClockSync(null, R + 40_000, R);
  assert.equal(s.offsetMs, 40_000);
  assert.equal(s.samples, 1);
});

test("small differences are eased, not snapped (network jitter)", () => {
  const prev: ClockSync = { offsetMs: 1000, measuredAt: R, samples: 5 };
  const next = foldClockSync(prev, R + 200 + 1150, R + 200); // 150ms of jitter
  assert.ok(next.offsetMs > 1000 && next.offsetMs < 1150, "eased toward the new value");
  assert.equal(next.samples, 6);
});

test("a REAL clock jump snaps immediately instead of crawling", () => {
  // An NTP correction mid-service must not take minutes to catch up, or the
  // timer reads wrong for that whole time.
  const prev: ClockSync = { offsetMs: 0, measuredAt: R, samples: 10 };
  const jump = CLOCK_SYNC_JUMP_MS + 1000;
  const next = foldClockSync(prev, R + 1000 + jump, R + 1000);
  assert.equal(next.offsetMs, jump, "snapped");
  assert.equal(next.samples, 1, "and the average restarts");
});

test("a long silence forces a fresh measurement", () => {
  const prev: ClockSync = { offsetMs: 5000, measuredAt: R, samples: 20 };
  const later = R + CLOCK_SYNC_RESET_MS + 1;
  const next = foldClockSync(prev, later + 12, later);
  assert.equal(next.offsetMs, 12, "a stale offset is worse than a fresh one");
  assert.equal(next.samples, 1);
});

test("senderNow converts this device's clock into the sender's domain", () => {
  assert.equal(senderNow({ offsetMs: 40_000, measuredAt: R, samples: 1 }, R), R + 40_000);
  assert.equal(senderNow(null, R), R, "no sync yet ⇒ trust the local clock");
});

// ── the case this module exists for ───────────────────────────────────────
test("A TABLET 40 SECONDS WRONG SHOWS THE SAME NUMBER AS THE PROJECTOR", () => {
  const SENDER_NOW = R;
  const TABLET_SKEW = -40_000; // tablet's clock is 40s BEHIND the operator's

  const def: TimerDefinition = { id: "s", name: "Sermon", type: "countdown", durationSec: 600 };
  const rt: TimerRuntime = { running: true, anchorMs: SENDER_NOW, baseSec: 600 };

  // The tablet receives a frame stamped with the SENDER's clock.
  const sync = foldClockSync(null, SENDER_NOW, SENDER_NOW + TABLET_SKEW);
  assert.equal(sync.offsetMs, -TABLET_SKEW);

  for (const elapsed of [0, 60_000, 599_000, 601_000]) {
    const onOperator = computeRemainingSec(def, rt, SENDER_NOW + elapsed);
    const tabletClock = SENDER_NOW + TABLET_SKEW + elapsed;
    const onTablet = computeRemainingSec(def, rt, senderNow(sync, tabletClock));
    assert.equal(onTablet, onOperator, `disagree ${elapsed}ms in`);
  }
});

test("WITHOUT correction the same tablet would be 40 seconds wrong", () => {
  // Proves the test above is actually testing something.
  const def: TimerDefinition = { id: "s", name: "S", type: "countdown", durationSec: 600 };
  const rt: TimerRuntime = { running: true, anchorMs: R, baseSec: 600 };
  const naive = computeRemainingSec(def, rt, R - 40_000);      // raw local clock
  const correct = computeRemainingSec(def, rt, R);
  assert.equal(naive - correct, 40, "40 seconds of lie");
});

test("a countdown_to target is skew-corrected by the same conversion", () => {
  const def: TimerDefinition = { id: "c", name: "C", type: "countdown_to", durationSec: 0, targetMs: R + 300_000 };
  const rt: TimerRuntime = { running: true, anchorMs: R, baseSec: 0 };
  const sync = foldClockSync(null, R, R - 40_000);
  assert.equal(computeRemainingSec(def, rt, senderNow(sync, R - 40_000)), 300);
});

// ── liveness ──────────────────────────────────────────────────────────────
test("the sweep never fires before a frame has ever been seen", () => {
  assert.equal(shouldSweepWireTimers(0, R), false, "0 means 'never received one'");
  assert.equal(shouldSweepWireTimers(0, R + 99_999_999), false);
});

test("the sweep fires after three missed beats, not before", () => {
  assert.equal(shouldSweepWireTimers(R, R + TIMERS_WIRE_STALE_MS - 1), false);
  assert.equal(shouldSweepWireTimers(R, R + TIMERS_WIRE_STALE_MS + 1), true);
});

test("DRIFT GUARD: the sweep window stays at least three liveness beats", () => {
  // Shortening the sweep below three beats would drop a live timer off a remote
  // screen mid-service on a single dropped frame.
  assert.ok(TIMERS_WIRE_STALE_MS >= 3 * TIMERS_LIVENESS_MS,
    `sweep ${TIMERS_WIRE_STALE_MS}ms must be >= 3 beats (${3 * TIMERS_LIVENESS_MS}ms)`);
});

test("COST: a 3-hour service with 3 timers stays far under budget", () => {
  // The constraint that killed the naive design: ~5.2M msgs/month for ONE
  // church with ONE timer. Assert the shape of this one, so a future change
  // that re-introduces a heartbeat fails here instead of on a bill.
  const serviceMs = 3 * 60 * 60_000;
  const beats = Math.floor(serviceMs / TIMERS_LIVENESS_MS); // per FRAME, not per timer
  const stateChanges = 40;                                   // generous
  const perSurface = beats + stateChanges;
  const monthly = perSurface * 2 /* surfaces */ * 8 /* services */;
  assert.ok(monthly < 20_000, `~${monthly}/month must stay far under a 5M project allowance`);
});
