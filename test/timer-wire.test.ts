/**
 * Networked timer wire — payload, determinism and validation.
 * Run: npx tsx --test test/timer-wire.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimersWire, timerSlotToWire, type WireableSlot } from "../src/engine/timers/wire";
import { isValidTimerWire, isValidTimersWire, MAX_WIRE_TIMERS, MAX_COLOR_TRIGGERS } from "../src/lib/broadcast";
import { computeRemainingSec, type TimerDefinition, type TimerRuntime } from "../src/engine/timers";

const slot = (over: Partial<WireableSlot> = {}): WireableSlot => ({
  def: { id: "t1", name: "Sermon", type: "countdown", durationSec: 300, targetMs: null },
  runtime: { running: true, anchorMs: 1_000_000, baseSec: 300 },
  shown: true,
  appearance: {
    position: "top-right", scale: 1, showLabel: true, leadingZeros: false, colorTriggers: [],
  },
  ...over,
});

// ── THE test. If this fails, someone put a ticking value on the wire. ──────
test("DETERMINISM: a running timer produces a BYTE-IDENTICAL frame as time passes", () => {
  const slots = [slot(), slot({ def: { id: "t2", name: "B", type: "elapsed", durationSec: 0, elapsedEndSec: 600 } })];
  const a = JSON.stringify(buildTimersWire(slots, 1_000_000, 1).timers);
  const b = JSON.stringify(buildTimersWire(slots, 1_010_000, 1).timers);  // 10s later
  const c = JSON.stringify(buildTimersWire(slots, 9_999_999, 1).timers);  // much later
  assert.equal(a, b, "the timers array must not change as the clock moves");
  assert.equal(a, c);
  // The envelope IS allowed to change — that is what carries liveness + skew.
  assert.notEqual(buildTimersWire(slots, 1_000_000, 1).senderNowMs, buildTimersWire(slots, 1_010_000, 1).senderNowMs);
});

test("no field on a TimerWire is derived from now", () => {
  const w = timerSlotToWire(slot());
  for (const [k, v] of Object.entries(w)) {
    if (typeof v !== "number") continue;
    // anchorMs and targetMs are absolute SENDER-clock stamps — they are
    // allowed to be large. Nothing else may look like a timestamp.
    if (k === "anchorMs" || k === "targetMs") continue;
    assert.ok(Math.abs(v) < 1e7, `${k}=${v} looks like a clock value, not config`);
  }
  assert.equal("remainingSec" in w, false, "a computed value must never ride this wire");
  assert.equal("overrun" in w, false);
});

// ── builder behaviour ─────────────────────────────────────────────────────
test("only SHOWN timers ride the wire", () => {
  const w = buildTimersWire([slot(), slot({ def: { ...slot().def, id: "hidden" }, shown: false })], 1, 1);
  assert.deepEqual(w.timers.map((t) => t.id), ["t1"]);
});

test("showLabel:false drops the name entirely", () => {
  const w = timerSlotToWire(slot({ appearance: { ...slot().appearance, showLabel: false } }));
  assert.equal("name" in w, false, "an absent name IS 'no label' to every renderer");
});

test("the send side caps the timer count, so the validator never has to reject", () => {
  const many = Array.from({ length: 40 }, (_, i) => slot({ def: { ...slot().def, id: `t${i}` } }));
  assert.equal(buildTimersWire(many, 1, 1).timers.length, MAX_WIRE_TIMERS);
});

test("colour triggers ride as DATA, capped", () => {
  const triggers = Array.from({ length: 20 }, (_, i) => ({ atSec: i * 5, color: "#ff0000" }));
  const w = timerSlotToWire(slot({ appearance: { ...slot().appearance, colorTriggers: triggers } }));
  assert.ok((w.colorTriggers ?? []).length <= MAX_COLOR_TRIGGERS);
  assert.equal(w.colorTriggers?.[0].atSec, 0, "unresolved — the receiver applies them against its own tick");
});

// ── the round trip that actually matters ──────────────────────────────────
test("a receiver reconstructs the SAME value the sender would compute", () => {
  const s = slot();
  const w = timerSlotToWire(s);
  const def: TimerDefinition = {
    id: w.id, name: w.name ?? "", type: w.type, durationSec: w.durationSec,
    targetMs: w.targetMs ?? null, allowsOverrun: w.allowsOverrun,
    elapsedStartSec: w.elapsedStartSec, elapsedEndSec: w.elapsedEndSec,
  };
  const rt: TimerRuntime = { running: w.running, anchorMs: w.anchorMs, baseSec: w.baseSec };
  for (const t of [1_000_000, 1_060_000, 1_299_000, 1_400_000]) {
    assert.equal(
      computeRemainingSec(def, rt, t),
      computeRemainingSec({ ...s.def, name: s.def.name } as TimerDefinition, s.runtime, t),
      `receiver and sender disagree at ${t}`,
    );
  }
});

// ── validation ────────────────────────────────────────────────────────────
test("valid frames pass", () => {
  assert.equal(isValidTimersWire(buildTimersWire([slot()], Date.now(), Date.now())), true);
  assert.equal(isValidTimersWire({ timers: [], senderNowMs: Date.now(), rev: 1 }), true, "empty = 'nothing shown'");
});

test("a SKEWED sender clock is NOT a validation failure", () => {
  // This is the entire point of senderNowMs — a device whose clock is wrong
  // must still be able to correct itself, not have its frames rejected.
  for (const skew of [40_000, -40_000, 600_000, -600_000]) {
    assert.equal(
      isValidTimersWire({ timers: [], senderNowMs: Date.now() + skew, rev: 1 }), true,
      `skew ${skew}ms must validate`,
    );
  }
});

test("duplicate ids are rejected — they would render twice", () => {
  const w = buildTimersWire([slot(), slot()], Date.now(), 1);
  assert.equal(w.timers.length, 2);
  assert.equal(isValidTimersWire(w), false);
});

test("hostile frames are rejected", () => {
  const base = () => buildTimersWire([slot()], Date.now(), 1);
  const bad: Array<[string, unknown]> = [
    ["not an object", 42],
    ["timers not an array", { timers: "no", senderNowMs: 1, rev: 1 }],
    ["too many timers", { timers: Array.from({ length: 17 }, (_, i) => ({ ...base().timers[0], id: `x${i}` })), senderNowMs: 1, rev: 1 }],
    ["NaN senderNowMs", { timers: [], senderNowMs: NaN, rev: 1 }],
    ["negative senderNowMs", { timers: [], senderNowMs: -1, rev: 1 }],
    // Same correction as anchorMs: rev is seeded from the SENDER's clock and is
    // MONOTONIC-ONLY. Ordering is enforced receiver-side (rev <= lastRev), which
    // is what actually stops a ghost tab. Only a nonsense epoch is refused.
    ["rev beyond a sane epoch", { timers: [], senderNowMs: Date.now(), rev: 5_000_000_000_000 }],
  ];
  for (const [why, v] of bad) assert.equal(isValidTimersWire(v), false, why);
});

test("a hostile individual timer is rejected", () => {
  const ok = buildTimersWire([slot()], Date.now(), 1).timers[0];
  const bad: Array<[string, unknown]> = [
    ["bad id charset", { ...ok, id: "a b/../c" }],
    ["unknown type", { ...ok, type: "sundial" }],
    ["NaN baseSec", { ...ok, baseSec: NaN }],
    ["Infinity duration", { ...ok, durationSec: Infinity }],
    ["scale out of range", { ...ok, scale: 99 }],
    ["non-hex colour", { ...ok, color: "red; background:url(javascript:alert(1))" }],
    ["non-hex trigger colour", { ...ok, colorTriggers: [{ atSec: 5, color: "red" }] }],
    ["too many triggers", { ...ok, colorTriggers: Array.from({ length: 9 }, () => ({ atSec: 5, color: "#ff0000" })) }],
    ["bad position", { ...ok, position: "nowhere" }],
    // NOTE: an anchor merely "far ahead of MY clock" must NOT be rejected —
    // it is a SENDER-clock stamp, and a device with a wrong clock is exactly
    // what skew correction exists for. Only a nonsense epoch is refused.
    ["anchor beyond a sane epoch", { ...ok, anchorMs: 5_000_000_000_000 }],
  ];
  for (const [why, v] of bad) assert.equal(isValidTimerWire(v), false, why);
  assert.equal(isValidTimerWire(ok), true, "the good one still passes");
  // REGRESSION: anchorMs/rev were bounded against the RECEIVER's clock, so a
  // sender more than a day out had every frame rejected — the timer silently
  // never appeared, on exactly the devices skew correction exists to serve.
  const yearOut = Date.now() + 365 * 86_400_000;
  assert.equal(isValidTimerWire({ ...ok, anchorMs: yearOut }), true,
    "a sender whose clock is a year out must still validate");
});

test("prototype pollution is rejected, not absorbed", () => {
  const poisoned = JSON.parse('{"timers":[],"senderNowMs":1,"rev":1,"__proto__":{"pwned":true}}');
  assert.equal(isValidTimersWire(poisoned), false);
  assert.equal(({} as Record<string, unknown>).pwned, undefined);
});
