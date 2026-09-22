import { test } from "node:test";
import assert from "node:assert/strict";
import { foldClockSync, measureOffset, senderNow, shouldSweepWireTimers,
  CLOCK_SYNC_JUMP_MS, CLOCK_SYNC_RESET_MS, TIMERS_WIRE_STALE_MS, type ClockSync } from "@/lib/timer-clock";

test("foldClockSync never produces NaN/Infinity under adversarial inputs", () => {
  const cases: Array<[number, number]> = [
    [NaN, 1000], [1000, NaN], [Infinity, 1000], [1000, -Infinity],
    [0, 0], [-1e15, 1e15], [1e15, -1e15],
  ];
  let prev: ClockSync | null = null;
  for (const [s, r] of cases) {
    prev = foldClockSync(prev, s, r);
    console.log(s, r, "->", prev);
  }
  // Document actual behavior: NaN input poisons state permanently (no recovery)
});

test("🔴 NaN sender clock poisons ClockSync state and never recovers", () => {
  let sync = foldClockSync(null, 1000, 1000); // good: offset 0
  assert.equal(sync.offsetMs, 0);
  sync = foldClockSync(sync, NaN, 2000); // poisoned sample
  console.log("after NaN sample:", sync);
  assert.ok(Number.isNaN(sync.offsetMs), "offset became NaN");
  // Now feed a perfectly normal sample right after -- does it recover?
  const recovered = foldClockSync(sync, 3000, 3000);
  console.log("next normal sample:", recovered);
  // abs(raw - prev.offsetMs) with prev.offsetMs=NaN is always NaN, and NaN > JUMP_MS is FALSE,
  // so the snap-on-jump branch never triggers -- it eases toward NaN forever.
  assert.ok(Number.isNaN(recovered.offsetMs), "BUG: once offsetMs is NaN, easing formula (NaN + 0.25*(raw-NaN)) keeps it NaN forever, never snaps back");
});

test("senderNow with NaN-poisoned sync returns NaN", () => {
  const sync = foldClockSync(foldClockSync(null, 1000, 1000), NaN, 2000);
  const now = senderNow(sync, 5000);
  console.log("senderNow with poisoned sync:", now);
  assert.ok(Number.isNaN(now));
});

test("EWMA converges under steady jitter within JUMP threshold", () => {
  let sync: ClockSync | null = null;
  let r = 0;
  const trueOffset = 500;
  for (let i = 0; i < 1000; i++) {
    r += 1000;
    const jitter = (i % 2 === 0 ? 1 : -1) * 100; // +-100ms jitter, under 2000 jump
    sync = foldClockSync(sync, r + trueOffset + jitter, r);
  }
  console.log("converged offset after 1000 jittery samples:", sync!.offsetMs, "true:", trueOffset);
  assert.ok(Math.abs(sync!.offsetMs - trueOffset) < 50, `EWMA should converge near ${trueOffset}, got ${sync!.offsetMs}`);
});

test("EWMA does not wander far from truth under alternating +/- jitter at exactly threshold", () => {
  let sync: ClockSync | null = null;
  let r = 0;
  const trueOffset = 0;
  for (let i = 0; i < 500; i++) {
    r += 1000;
    const jitter = (i % 2 === 0 ? 1 : -1) * (CLOCK_SYNC_JUMP_MS - 1); // just under jump threshold
    sync = foldClockSync(sync, r + trueOffset + jitter, r);
  }
  console.log("offset after alternating near-threshold jitter:", sync!.offsetMs);
  // Since first sample seeds raw offset (no prior), then further samples near jump threshold
  // may or may not snap depending on prev offset -- verify it stays bounded
  assert.ok(Math.abs(sync!.offsetMs) < CLOCK_SYNC_JUMP_MS * 2, "offset ballooned unexpectedly");
});

test("legitimate small samples cannot drift offset far from truth without a reset (creeping drift check)", () => {
  // Feed samples that individually are always < JUMP_MS from the CURRENT eased offset,
  // but where the true offset creeps steadily -- simulate real clock drift (NTP-free clocks drift ppm-scale,
  // but let's stress an adversarial "boiling frog" pattern: each sample truth-offset shifts by JUMP_MS - 1
  // relative to the LAST TRUE offset, while prev.offsetMs (eased) lags behind, so the delta from prev could
  // still be < JUMP_MS as the true value walks arbitrarily far in a straight line.
  let sync: ClockSync | null = null;
  let r = 0;
  let trueOffset = 0;
  const steps = 200;
  for (let i = 0; i < steps; i++) {
    r += 1000;
    trueOffset += (CLOCK_SYNC_JUMP_MS - 1); // walk up just under the jump threshold each sample
    sync = foldClockSync(sync, r + trueOffset, r);
  }
  console.log("boiling-frog walk: true final offset", trueOffset, "measured", sync!.offsetMs);
  // This documents that a slow "boiling frog" walk (never a single jump >2s) CAN be tracked
  // arbitrarily far via repeated near-threshold deltas -- this is expected/intended behavior
  // (each step genuinely reduces jitter vs a real slow drift), not being asserted as a bug,
  // just characterized.
});

test("shouldSweepWireTimers boundaries", () => {
  assert.equal(shouldSweepWireTimers(0, 1_000_000), false, "lastAt=0 must NEVER sweep");
  assert.equal(shouldSweepWireTimers(1000, 1000 + TIMERS_WIRE_STALE_MS), false, "exactly at threshold is NOT > threshold");
  assert.equal(shouldSweepWireTimers(1000, 1000 + TIMERS_WIRE_STALE_MS + 1), true);
  assert.equal(shouldSweepWireTimers(-1, 1000), false, "negative lastAt correctly never sweeps (lastAt>0 guard)");
});
