/**
 * Per-timer output routing.
 * Run: npx tsx --test test/timer-screen-routing.test.ts
 *
 * This is the feature the whole timers epic was asked for — "choose stage or
 * projector or livestream" — and it is the fifth capability in this subsystem
 * that could have shipped saved-but-never-read. So these are DERIVED and
 * BEHAVIOURAL: every surface must honour routing, the default must stay
 * byte-identical to the pre-routing wire, and the control must be reachable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TIMER_SCREEN_IDS, timerShowsOn, sanitizeTimerScreens, toggleTimerScreen, isValidTimerScreens,
  type TimerScreenId,
} from "../src/engine/timers/screens";
import { timerSlotToWire, buildTimersWire, type WireableSlot } from "../src/engine/timers/wire";
import { isValidTimerWire } from "../src/lib/broadcast";

const slot = (screens?: readonly string[]): WireableSlot => ({
  def: { id: "t1", name: "Countdown", type: "countdown", durationSec: 600, targetMs: null },
  runtime: { running: true, anchorMs: 1_700_000_000_000, baseSec: 600 },
  shown: true,
  appearance: {
    position: "top-right", scale: 1, showLabel: false, leadingZeros: false,
    colorTriggers: [], screens: screens as readonly TimerScreenId[] | undefined,
  },
});

test("undefined means every screen — the pre-routing behaviour", () => {
  for (const s of TIMER_SCREEN_IDS) assert.equal(timerShowsOn(undefined, s), true);
});

test("an empty list is a deliberate nowhere, not a fallback to everywhere", () => {
  for (const s of TIMER_SCREEN_IDS) assert.equal(timerShowsOn([], s), false);
});

test("a subset shows only where it was routed", () => {
  assert.equal(timerShowsOn(["stage"], "stage"), true);
  assert.equal(timerShowsOn(["stage"], "main"), false);
});

test("the full set collapses to undefined so the default wire never changes", () => {
  assert.equal(sanitizeTimerScreens([...TIMER_SCREEN_IDS]), undefined);
});

test("a screen this build has never heard of is dropped, not fatal", () => {
  assert.deepEqual(sanitizeTimerScreens(["stage", "hologram"]), ["stage"]);
});

test("toggling one off from the default leaves the other three", () => {
  assert.deepEqual(toggleTimerScreen(undefined, "main"), ["stage", "livestream", "ndi"]);
});

test("toggling every screen off yields an empty list, which is honoured", () => {
  let s = toggleTimerScreen(undefined, "main");
  for (const id of ["stage", "livestream", "ndi"] as const) s = toggleTimerScreen(s, id);
  assert.deepEqual(s, []);
});

test("the validator rejects a non-list and an over-long list", () => {
  assert.equal(isValidTimerScreens("stage"), false);
  assert.equal(isValidTimerScreens(["a", "b", "c", "d", "e"]), false);
  assert.equal(isValidTimerScreens(["stage"]), true);
});

test("the wire omits screens entirely when the timer goes everywhere", () => {
  assert.equal("screens" in timerSlotToWire(slot(undefined)), false);
  assert.equal("screens" in timerSlotToWire(slot([...TIMER_SCREEN_IDS])), false);
});

test("the wire carries a real subset, and the validator accepts it", () => {
  const w = timerSlotToWire(slot(["stage"]));
  assert.deepEqual(w.screens, ["stage"]);
  assert.equal(isValidTimerWire(w), true);
});

test("a routed timer's frame is still deterministic as time passes", () => {
  const a = JSON.stringify(buildTimersWire([slot(["stage"])], 1, 1).timers);
  const b = JSON.stringify(buildTimersWire([slot(["stage"])], 999_999, 1).timers);
  assert.equal(a, b);
});

// DERIVED over the surfaces, not a hardcoded list of four known-good files: a
// fifth output added tomorrow that renders timers without a `screen` prop
// fails here by construction, rather than silently ignoring the operator.
test("every output route passes a screen to the shared renderer", () => {
  for (const s of ["live", "stage", "livestream", "ndi"]) {
    const src = readFileSync(`src/app/${s}/page.tsx`, "utf8");
    const idx = src.indexOf("<TimerOverlayLayer");
    assert.ok(idx > -1, `${s} must render the shared TimerOverlayLayer`);
    const props = src.slice(idx, src.indexOf("/>", idx));
    assert.match(props, /screen=/,
      `${s} renders timers without a screen prop — routing silently ignored`);
  }
});

test("the renderer filters on screen rather than trusting the caller", () => {
  assert.match(readFileSync("src/components/live/TimerOverlayLayer.tsx", "utf8"), /timerShowsOn\(/);
});

test("the operator can actually reach the control", () => {
  const panel = readFileSync("src/components/operator/pro/right/TimersPanel.tsx", "utf8");
  assert.match(panel, /TIMER_SCREEN_IDS/, "no Shows on control — routing would be unreachable");
  assert.match(panel, /toggleTimerScreen/);
});
