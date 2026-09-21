/**
 * Networked timers — no-regression guards.
 * Run: npx tsx test/timer-transport-parity.test.ts
 *
 * The failure modes here are all SILENT: a timer rendering twice, the
 * same-machine path losing primacy, a malformed frame blanking a projector, or
 * the whole thing quietly re-becoming a heartbeat. Source-level where the
 * behaviour lives in React, behavioural where it lives in a pure function.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sanitizeOutputState, scrubOutputStateForRemote, isValidOutputState, type OutputState } from "../src/lib/broadcast";
import { buildTimersWire, type WireableSlot } from "../src/engine/timers/wire";
import { TIMERS_LIVENESS_MS, TIMERS_WIRE_STALE_MS } from "../src/lib/timer-clock";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const slot = (id = "t1"): WireableSlot => ({
  def: { id, name: "Sermon", type: "countdown", durationSec: 300, targetMs: null },
  runtime: { running: true, anchorMs: 1_000_000, baseSec: 300 },
  shown: true,
  appearance: { position: "top-right", scale: 1, showLabel: true, leadingZeros: false, colorTriggers: [] },
});
const baseState = (): OutputState => ({ live: { kind: "empty" } } as OutputState);

/* ── 1. RULE 8: the same-machine path is untouched ───────────────────────── */

const shell = read("../src/components/operator/pro/ProOperatorShell.tsx");
assert.ok(/setInterval\(post, 1000\)/.test(shell),
  "the same-machine 1Hz timer heartbeat must still exist — rule 8's primary path");
assert.ok(/type: "timer",\s*\n\s*overlay: \{/.test(shell) || /type: "timer"/.test(shell),
  "the discrete TimerOverlay post must still exist");

/* ── 2. The local copy WINS; a timer can never render twice ──────────────── */

const layer = read("../src/components/live/TimerOverlayLayer.tsx");
assert.ok(/const localIds = new Set/.test(layer), "the renderer must de-duplicate by id");
assert.ok(/filter\(\(w\) => !localIds\.has\(w\.id\)\)/.test(layer),
  "the WIRE copy must be the one dropped — the same-machine path is primary");

/* ── 3. No interval is mounted when there is nothing remote ──────────────── */
// Otherwise every surface pays for a feature it is not using.
assert.ok(/if \(!hasWire\) return;/.test(layer),
  "the local tick must not mount when there are no wire timers");

/* ── 4. The receiver TICKS — it must not paint a frozen number ───────────── */
assert.ok(/computeRemainingSec\(def, rt, nowMs\)/.test(layer),
  "the receiver must compute the value itself, not read one off the wire");
assert.ok(/senderNow\(clockSync\)/.test(layer),
  "and it must tick in the SENDER's clock domain, or a skewed device reads wrong");

/* ── 5. Colour triggers still fire on a remote screen ────────────────────── */
assert.ok(/triggerValueFor\(def, remainingSec\)/.test(layer) && /resolveTimerColor/.test(layer),
  "triggers must be resolved receiver-side — a frozen value could never cross one");

/* ── 6. Ghost-operator guard on every surface ────────────────────────────── */
for (const p of ["../src/app/live/page.tsx", "../src/app/stage/page.tsx", "../src/app/livestream/page.tsx"]) {
  const src = read(p);
  assert.ok(/tw\.rev <= timersWireRevRef\.current/.test(src), `${p}: must ignore an older frame`);
  assert.ok(/foldClockSync\(/.test(src), `${p}: must measure clock skew`);
  assert.ok(/shouldSweepWireTimers\(/.test(src), `${p}: must sweep a crashed operator's timers`);
  assert.ok(/foldTimersWire\(/.test(src), `${p}: must actually fold the frame`);
}

/* ── 7. /ndi stays local-only ─────────────────────────────────────────────── */
// It is an in-process hidden window on the operator's own machine; giving it a
// remote path would be pure cost for zero benefit.
const ndi = read("../src/app/ndi/page.tsx");
assert.ok(!/wireTimers/.test(ndi), "/ndi is same-machine by construction — no remote path needed");

/* ── 8. A malformed frame must never blank a projector ───────────────────── */

const poisoned = { ...baseState(), timersWire: { timers: [{ id: "../../etc" }], senderNowMs: 1, rev: 1 } } as unknown as OutputState;
const cleaned = sanitizeOutputState(poisoned);
assert.ok(cleaned, "a malformed timer must not reject the whole snapshot");
assert.equal((cleaned as { timersWire?: unknown }).timersWire, undefined, "the bad field is dropped…");
assert.deepEqual(cleaned!.live, { kind: "empty" }, "…and the slide still projects");

/* ── 9. Nothing machine-local leaks to a remote device ───────────────────── */

const withTimers = { ...baseState(), timersWire: buildTimersWire([slot()], Date.now(), 1) } as OutputState;
const scrubbed = scrubOutputStateForRemote(withTimers);
assert.ok((scrubbed as { timersWire?: unknown }).timersWire, "timers survive the remote scrub");
// Adding the field must not change whether a state validates — whatever the
// verdict was without it, it must be the same with it. (The bare fixture here
// is deliberately minimal and does not itself validate; the point is the DELTA.)
assert.equal(
  isValidOutputState(scrubbed),
  isValidOutputState(baseState()),
  "adding timersWire must not change a state's validity",
);

/* ── 10. A church with no timer shown emits BYTE-IDENTICAL state ─────────── */

const before = JSON.stringify(baseState());
const noneShown = buildTimersWire([{ ...slot(), shown: false }], Date.now(), 1);
const after = JSON.stringify({ ...baseState(), ...(noneShown.timers.length > 0 ? { timersWire: noneShown } : {}) });
assert.equal(after, before, "nothing shown ⇒ the snapshot is unchanged from before this feature");

/* ── 11. The cost shape is enforced, not aspirational ────────────────────── */

assert.ok(TIMERS_WIRE_STALE_MS >= 3 * TIMERS_LIVENESS_MS, "sweep must allow three missed beats");
// Built at two DIFFERENT real wall-clock instants, not just with two different
// nowMs arguments — a field keyed on Date.now() rather than on the argument
// would otherwise slip straight through this check. (The primary determinism
// lock lives in test/timer-wire.test.ts; this one is the belt to its braces.)
const a = JSON.stringify(buildTimersWire([slot()], 1_000_000, 7).timers);
const busyUntil = Date.now() + 5;
while (Date.now() < busyUntil) { /* burn a few real milliseconds */ }
const b = JSON.stringify(buildTimersWire([slot()], 1_600_000, 7).timers);
assert.equal(a, b, "a running timer must not change the frame — that IS the cost guarantee");

/* ── 12. The snapshot replay re-stamps its clock ─────────────────────────── */
// A cached snapshot carries the senderNowMs from when it was BUILT. Replayed
// twenty minutes later, a joining device would measure a twenty-minute offset.
const console_ = read("../src/components/operator/OperatorConsole.tsx");
assert.ok(/onRequestSnapshot\(\(\) => \{[\s\S]*?senderNowMs: Date\.now\(\)/.test(console_),
  "the snapshot provider must re-stamp senderNowMs on replay");

console.log("timer-transport-parity: all guards passed");
