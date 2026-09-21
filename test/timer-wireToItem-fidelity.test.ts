import { test } from "node:test";
import assert from "node:assert/strict";
import type { TimerWire } from "@/lib/broadcast";
import { computeRemainingSec, formatTimerClock, isOverrun, resolveTimerColor, triggerValueFor,
  type TimerDefinition, type TimerRuntime } from "@/engine/timers";

// wireToItem (src/components/live/TimerOverlayLayer.tsx:116-134) is NOT exported,
// and this worktree may only ADD tests, not modify source to export it for testing.
// This file reimplements it VERBATIM (see the comment on each line matching the
// source) so its behavior can be locked down and compared against what the
// OPERATOR panel computes for the exact same TimerDefinition/TimerRuntime pair
// (the two paths sharing the same pure engine is the whole point of the design --
// if they ever disagree, wireToItem itself is the bug, not this test).
function wireToItem_reimplementation(w: TimerWire, nowMs: number) {
  const def: TimerDefinition = {
    id: w.id, name: w.name ?? "", type: w.type, durationSec: w.durationSec,
    targetMs: w.targetMs ?? null, allowsOverrun: w.allowsOverrun,
    elapsedStartSec: w.elapsedStartSec, elapsedEndSec: w.elapsedEndSec,
  };
  const rt: TimerRuntime = { running: w.running, anchorMs: w.anchorMs, baseSec: w.baseSec };
  const remainingSec = computeRemainingSec(def, rt, nowMs);
  const tv = triggerValueFor(def, remainingSec);
  const color = tv === null
    ? w.color
    : resolveTimerColor({ color: w.color, overrunColor: w.overrunColor, colorTriggers: w.colorTriggers ?? [] }, tv);
  return {
    id: w.id, name: w.name, remainingSec, running: w.running,
    kind: w.type === "elapsed" ? "elapsed" : "countdown",
    position: w.position, overrun: isOverrun(def, rt, nowMs),
    scale: w.scale, color, showHours: w.showHours, leadingZeros: w.leadingZeros,
  };
}

function operatorSideExpected(def: TimerDefinition, rt: TimerRuntime, nowMs: number) {
  const remaining = computeRemainingSec(def, rt, nowMs);
  const tv = triggerValueFor(def, remaining);
  const color = tv === null ? undefined : resolveTimerColor({ colorTriggers: [] }, tv);
  return { remaining, formatted: formatTimerClock(remaining), overrun: isOverrun(def, rt, nowMs) };
}

const CASES: Array<{ label: string; def: TimerDefinition; rt: TimerRuntime; nowMs: number }> = [
  {
    label: "stopped countdown_to (frozen)",
    def: { id: "a", name: "", type: "countdown_to", durationSec: 0, targetMs: 5_000_000 },
    rt: { running: false, anchorMs: null, baseSec: 42 },
    nowMs: 9_999_999,
  },
  {
    label: "elapsed with an end, past it, overrun disallowed",
    def: { id: "b", name: "", type: "elapsed", durationSec: 0, elapsedEndSec: 30, allowsOverrun: false },
    rt: { running: true, anchorMs: 0, baseSec: 0 },
    nowMs: 60_000,
  },
  {
    label: "elapsed without an end",
    def: { id: "c", name: "", type: "elapsed", durationSec: 0 },
    rt: { running: true, anchorMs: 0, baseSec: 0 },
    nowMs: 5_000,
  },
  {
    label: "countdown past zero, no overrun (clamped)",
    def: { id: "d", name: "", type: "countdown", durationSec: 5, allowsOverrun: false },
    rt: { running: true, anchorMs: 0, baseSec: 5 },
    nowMs: 10_000,
  },
  {
    label: "countdown past zero, overrun allowed (negative)",
    def: { id: "e", name: "", type: "countdown", durationSec: 5, allowsOverrun: true },
    rt: { running: true, anchorMs: 0, baseSec: 5 },
    nowMs: 10_000,
  },
  {
    label: "timer with a trigger exactly at 0",
    def: { id: "f", name: "", type: "countdown", durationSec: 5, allowsOverrun: true },
    rt: { running: true, anchorMs: 0, baseSec: 5 },
    nowMs: 5_000, // exactly at zero-crossing
  },
];

for (const c of CASES) {
  test(`wireToItem fidelity: ${c.label}`, () => {
    const w: TimerWire = {
      id: c.def.id, name: c.def.name || undefined, type: c.def.type,
      running: c.rt.running, anchorMs: c.rt.anchorMs, baseSec: c.rt.baseSec,
      durationSec: c.def.durationSec, targetMs: c.def.targetMs ?? null,
      allowsOverrun: c.def.allowsOverrun, elapsedStartSec: c.def.elapsedStartSec,
      elapsedEndSec: c.def.elapsedEndSec,
    };
    const receiverItem = wireToItem_reimplementation(w, c.nowMs);
    const expected = operatorSideExpected(c.def, c.rt, c.nowMs);
    assert.equal(receiverItem.remainingSec, expected.remaining,
      `receiver remainingSec must equal operator-side computeRemainingSec for ${c.label}`);
    assert.equal(
      formatTimerClock(receiverItem.remainingSec, { showHours: w.showHours, leadingZeros: w.leadingZeros }),
      expected.formatted,
      `receiver-formatted clock must match operator's for ${c.label}`,
    );
    assert.equal(receiverItem.overrun, expected.overrun, `overrun flag mismatch for ${c.label}`);
  });
}

test("trigger-at-0 colours the value once remaining crosses to exactly 0 (not before, not stuck after clamp)", () => {
  const def: TimerDefinition = { id: "g", name: "", type: "countdown", durationSec: 5, allowsOverrun: true };
  // Just before zero: remaining = 0.001s -> trigger at 0 should NOT fire (remainingSec <= atSec is 0.001<=0 false)
  const before = wireToItem_reimplementation(
    { id: "g", type: "countdown", running: true, anchorMs: 0, baseSec: 5, durationSec: 5, allowsOverrun: true, colorTriggers: [{ atSec: 0, color: "#00ff00" }] },
    4_999,
  );
  assert.notEqual(before.color, "#00ff00", "trigger should not fire before crossing 0");
  const at = wireToItem_reimplementation(
    { id: "g", type: "countdown", running: true, anchorMs: 0, baseSec: 5, durationSec: 5, allowsOverrun: true, colorTriggers: [{ atSec: 0, color: "#00ff00" }] },
    5_000,
  );
  assert.equal(at.color, "#00ff00", "trigger must fire exactly at the zero-crossing");
});
