import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTimerWire, isValidTimersWire, type TimerWire, type TimersWire } from "@/lib/broadcast";

// ── Reconnect / replay (rev discipline, simulated the way live/page.tsx does it) ──
function makeRevGate() {
  const revRef = { current: -1 };
  return (tw: TimersWire) => {
    if (tw.rev <= revRef.current) return false; // ignored
    revRef.current = tw.rev;
    return true; // accepted
  };
}

function mkWire(rev: number, ids: string[] = ["default"]): TimersWire {
  return {
    timers: ids.map((id) => ({ id, type: "countdown", running: true, anchorMs: Date.now(), baseSec: 10, durationSec: 10 })),
    senderNowMs: Date.now(),
    rev,
  };
}

test("older frame (lower rev) after newer frame is ignored", () => {
  const gate = makeRevGate();
  assert.equal(gate(mkWire(100)), true);
  assert.equal(gate(mkWire(50)), false, "BUG if true: stale frame accepted");
});

test("equal rev is ignored (rev <= last, not just <)", () => {
  const gate = makeRevGate();
  assert.equal(gate(mkWire(100)), true);
  assert.equal(gate(mkWire(100)), false);
});

test("rev going backwards after an operator tab reload (reseeds from Date.now())", () => {
  // Tab A ran for a while, rev climbed to Date.now()_A + 500.
  const gate = makeRevGate();
  const tA = Date.now();
  assert.equal(gate(mkWire(tA + 500)), true);
  // Tab A reloads. New seed is Date.now() at reload time (must be later in real time,
  // but simulate the adversarial case: reload happens within the SAME millisecond,
  // so new seed could be <= tA, meaning rev resets BELOW the old high-water mark.
  const reloadSeed = tA; // worst case: no wall-clock time passed
  assert.equal(gate(mkWire(reloadSeed + 1)), false,
    "🔴/🟡 if the reload happens fast enough that new_seed+increments <= old high-water rev, " +
    "the reloaded (real, current) operator tab's frames are silently ignored until its rev " +
    "climbs back past the old value -- a legitimate tab can be locked out by its own past self");
});

test("two operator tabs interleaved: a ghost (stale) tab CANNOT permanently win once real tab overtakes it, but CAN win temporarily", () => {
  const gate = makeRevGate();
  const now = Date.now();
  // Ghost tab opened slightly later in wall time than ACTUAL tab, e.g. a duplicate
  // tab the operator forgot about, opened 2ms after the real one.
  const realTabSeed = now;
  const ghostTabSeed = now + 2;
  assert.equal(gate(mkWire(realTabSeed + 1)), true); // real tab posts first
  assert.equal(gate(mkWire(ghostTabSeed + 1)), true, "ghost tab (opened later) WINS and overwrites, since its base seed is higher");
  // Now the real tab keeps incrementing but can never catch up to the ghost's head start
  // unless it accumulates more increments than the seed gap (2ms here, trivial -- but if the
  // ghost tab was opened HOURS later by an accidental duplicate window, the real tab would need
  // hours worth of extra increments (impossible, increments are per-change) to ever win again.
  assert.equal(gate(mkWire(realTabSeed + 2)), false, "real tab's very next update is dropped because the ghost tab's rev is still higher");
});

// ── Duplicate id (validator should reject wrapper, test wireToItem/isValidTimerWire directly) ──
test("isValidTimersWire rejects duplicate ids", () => {
  const tw = mkWire(1, ["default", "default"]);
  assert.equal(isValidTimersWire(tw), false);
});

test("isValidTimerWire allows id colliding with reserved 'default' string (by design, that's the legacy slot key)", () => {
  const t: TimerWire = { id: "default", type: "countdown", running: false, anchorMs: null, baseSec: 5, durationSec: 5 };
  assert.equal(isValidTimerWire(t), true);
});

test("empty timers array validates (meaningful: nothing shown)", () => {
  assert.equal(isValidTimersWire({ timers: [], senderNowMs: Date.now(), rev: 1 }), true);
});

test("undefined/null timers array rejected", () => {
  assert.equal(isValidTimersWire({ timers: undefined, senderNowMs: Date.now(), rev: 1 }), false);
  assert.equal(isValidTimersWire({ timers: null, senderNowMs: Date.now(), rev: 1 }), false);
});

test("exactly 16 timers ok, 17 rejected (MAX_WIRE_TIMERS)", () => {
  const ids16 = Array.from({ length: 16 }, (_, i) => `t${i}`);
  const ids17 = Array.from({ length: 17 }, (_, i) => `t${i}`);
  assert.equal(isValidTimersWire(mkWire(1, ids16)), true);
  assert.equal(isValidTimersWire(mkWire(1, ids17)), false);
});

// ── Validator bypass attempts ──
test("hostile values rejected: huge baseSec, ancient anchorMs, targetMs=0, negative colorTrigger atSec beyond bound, 120+ char name, prototype pollution key", () => {
  const base: TimerWire = { id: "default", type: "countdown", running: true, anchorMs: 0, baseSec: 100, durationSec: 100 };
  assert.equal(isValidTimerWire({ ...base, baseSec: 1e9 }), false, "huge baseSec should be rejected (>86400 bound)");
  assert.equal(isValidTimerWire({ ...base, anchorMs: -1 }), false, "negative anchorMs rejected");
  assert.equal(isValidTimerWire({ ...base, type: "countdown_to", targetMs: 0 }), false, "targetMs=0 rejected (<=0 check)");
  assert.equal(isValidTimerWire({ ...base, colorTriggers: [{ atSec: -86401, color: "#fff" }] }), false, "atSec beyond -86400 bound rejected");
  assert.equal(isValidTimerWire({ ...base, name: "x".repeat(121) }), false, "121-char name rejected");
  assert.equal(isValidTimerWire({ ...base, name: "x".repeat(120) }), true, "exactly 120-char name allowed");
  // Real attack vector: a JSON-parsed payload (postMessage/BroadcastChannel/network),
  // where "__proto__" IS an own enumerable key, unlike object-literal `__proto__:` syntax.
  const hostileJson = JSON.parse('{"id":"default","type":"countdown","running":true,"anchorMs":0,"baseSec":1,"durationSec":1,"__proto__":{"polluted":true}}');
  assert.equal(isValidTimerWire(hostileJson), false, "JSON-parsed __proto__ own-key must be rejected by hasPollutionKey");
});

test("unicode name is accepted if under length (grapheme vs code-unit length trap?)", () => {
  const base: TimerWire = { id: "default", type: "countdown", running: true, anchorMs: 0, baseSec: 100, durationSec: 100 };
  const emoji = "🔥".repeat(60); // 60 emoji, each is 2 UTF-16 code units -> .length === 120
  console.log("emoji name .length:", emoji.length);
  assert.equal(isValidTimerWire({ ...base, name: emoji }), true);
  const emoji61 = "🔥".repeat(61); // .length === 122 > 120
  assert.equal(isValidTimerWire({ ...base, name: emoji61 }), false);
});

test("color hex vs near-hex: '#000000' valid, '#00000g' invalid", () => {
  const base: TimerWire = { id: "default", type: "countdown", running: true, anchorMs: 0, baseSec: 100, durationSec: 100 };
  assert.equal(isValidTimerWire({ ...base, color: "#000000" }), true);
  assert.equal(isValidTimerWire({ ...base, color: "#00000g" }), false);
});

test("id with pollution-adjacent LAYER_ID_RE bypass attempts", () => {
  const base = { type: "countdown" as const, running: true, anchorMs: 0, baseSec: 100, durationSec: 100 };
  assert.equal(isValidTimerWire({ ...base, id: "" }), false, "empty id rejected");
  assert.equal(isValidTimerWire({ ...base, id: "a".repeat(65) }), false, "65-char id rejected (>64 bound)");
  assert.equal(isValidTimerWire({ ...base, id: "__proto__" }), true, "🔴/🟡 id string '__proto__' passes LAYER_ID_RE (alnum/_/-) -- check downstream Map/object keying for prototype pollution");
});
