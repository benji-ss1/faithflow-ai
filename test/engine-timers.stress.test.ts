/**
 * Wave 7 STRESS suite for the pure timer/message core.
 * Run: npx tsx --test test/engine-timers.stress.test.ts
 *
 * Attacks the anchor+banked model and the messages[] wire under the abusive
 * conditions from the six-agent stress mandate: rapid start/stop cycles,
 * reset-while-running, deep overrun, countdown_to across midnight/DST/past,
 * 50 ticking timers, 20 simultaneous messages, 5000-char text, {{timer}}
 * bound to a deleted timer, tab-background throttle self-heal, and legacy
 * projector sanitize of messages[].
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type TimerDefinition,
  type TimerRuntime,
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
import { timerToOverlay, timerClearOverlay } from "../src/engine/timers/overlay";

// timerToOverlay is now slot-shaped: the shell CALLS it rather than
// hand-rolling the same mapping, so the look travels with the timer.
const LOOK = {
  position: "top-right" as const, scale: 1, showLabel: true,
  leadingZeros: false, colorTriggers: [] as Array<{ atSec: number; color: string }>,
};
// expandMessageTokens + resolveTargetMs are PURE and now live in the engine
// (resolveTargetMs in engine/timers, expandMessageTokens in engine/timers/
// messages), so the stress suite imports the REAL functions directly — no more
// byte-copies drifting from source (stress 🟡2 fixed in the Wave-7 fix pass).
import { expandMessageTokens } from "../src/engine/timers/messages";
import {
  isValidTimerOverlay,
  isValidMessageOverlay,
  isValidLiveMessage,
  coerceLiveMessage,
} from "../src/lib/broadcast";

// These stress cases deliberately drive timers PAST zero, so they opt into
// ProPresenter's "Allows Overrun" (off by default since 2026-09-21). The
// clamped default is covered in test/engine-timers.test.ts.
const cd = (durationSec: number): TimerDefinition => ({ id: "t1", name: "T", type: "countdown", durationSec, allowsOverrun: true });
const el = (): TimerDefinition => ({ id: "t2", name: "E", type: "elapsed", durationSec: 0 });
const cto = (targetMs: number): TimerDefinition => ({ id: "t3", name: "C", type: "countdown_to", durationSec: 0, targetMs, allowsOverrun: true });

// ---------------------------------------------------------------- (1) anchor+banked

test("STRESS: 1000 rapid start/stop/start cycles never drift the banked value", () => {
  const def = cd(600); // 10 min
  let rt = initialRuntime(def);
  let now = 1_000_000;
  // Each cycle: run 3s, pause 7s. Banked remaining must drop by exactly 3s/cycle.
  for (let i = 0; i < 1000; i++) {
    rt = startTimer(def, rt, now);
    now += 3000;
    rt = stopTimer(def, rt, now);
    now += 7000; // paused — must NOT count
    // After i+1 cycles, 3*(i+1) seconds consumed.
    const expected = 600 - 3 * (i + 1);
    assert.ok(Math.abs(rt.baseSec - expected) < 1e-6, `cycle ${i}: baseSec=${rt.baseSec} expected≈${expected}`);
  }
  // Value only moved by the RUNNING 3s slices, never the paused 7s.
  assert.equal(rt.running, false);
});

test("STRESS: reset while running fully detaches the anchor (no zombie tick)", () => {
  const def = cd(120);
  let now = 5000;
  let rt = startTimer(def, cd(120) && initialRuntime(def), now);
  now += 40_000;
  assert.ok(computeRemainingSec(def, rt, now) < 120);
  rt = resetTimer(def);
  assert.deepEqual(rt, { running: false, anchorMs: null, baseSec: 120 });
  // Advancing the clock a further hour must not move a reset timer.
  assert.equal(computeRemainingSec(def, rt, now + 3_600_000), 120);
});

test("STRESS: deep overrun far past zero displays -10h correctly (signed)", () => {
  const def = cd(5);
  let rt = startTimer(def, initialRuntime(def), 0);
  const now = 10 * 3600 * 1000 + 5000; // 10h5s later
  const rem = computeRemainingSec(def, rt, now);
  assert.ok(rem < 0);
  assert.ok(isOverrun(def, rt, now));
  // 5 - (36005) = -36000s = -10:00:00
  assert.equal(Math.round(rem), -36000);
  assert.equal(formatTimerClock(rem), "-10:00:00");
});

test("STRESS: countdown_to target in the PAST shows negative immediately, running via overlay", () => {
  const now = 2_000_000;
  const def = cto(now - 90_000); // 90s in the past
  const rt = startTimer(def, initialRuntime(def), now);
  const rem = computeRemainingSec(def, rt, now);
  assert.equal(Math.round(rem), -90);
  assert.ok(isOverrun(def, rt, now));
  // `running` follows the OPERATOR, not the wall clock. This used to report
  // true unconditionally for countdown_to, which is why Stop appeared to do
  // nothing: the flag flipped and the number kept ticking (fixed 2026-09-21).
  const ov = timerToOverlay({ def, runtime: rt, appearance: LOOK }, now);
  assert.equal(ov.running, true, "started ⇒ running");
  assert.equal(ov.remainingSec, -90);

  const stoppedOv = timerToOverlay({ def, runtime: initialRuntime(def), appearance: LOOK }, now);
  assert.equal(stoppedOv.running, false, "never started ⇒ NOT running");
});

test("STRESS: countdown_to across midnight resolves to NEXT occurrence (not negative day)", () => {
  // 23:30 local, target 00:05 → resolves to tomorrow (~35 min out), positive.
  const base = new Date();
  base.setHours(23, 30, 0, 0);
  const now = base.getTime();
  const target = resolveTargetMs("00:05", now);
  assert.ok(target != null && target > now, "midnight target must roll to tomorrow");
  const def = cto(target!);
  const rem = computeRemainingSec(def, initialRuntime(def), now);
  assert.ok(rem > 0 && rem <= 24 * 3600, `expected ~35min positive, got ${rem}`);
});

test("STRESS: resolveTargetMs is DST-robust (wall-clock hour preserved via setHours)", () => {
  // setHours works in local wall-clock, so the resolved instant always reads back
  // as the requested H:MM regardless of a DST jump between now and target.
  const now = Date.now();
  const t = resolveTargetMs("09:00", now);
  assert.ok(t != null);
  const d = new Date(t!);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 0);
});

test("STRESS: elapsed with banked base + long run keeps counting up, never overruns", () => {
  const def = el();
  let rt = startTimer(def, initialRuntime(def), 0);
  rt = stopTimer(def, rt, 100_000); // banked 100s
  rt = startTimer(def, rt, 200_000); // resume
  const rem = computeRemainingSec(def, rt, 200_000 + 50_000); // +50s running
  assert.equal(Math.round(rem), 150);
  assert.equal(isOverrun(def, rt, 999_999_999), false);
});

// ---------------------------------------------------------------- (2) 50 timers

test("STRESS: 50 timers tick + map to valid overlays every 1Hz push", () => {
  const defs: TimerDefinition[] = Array.from({ length: 50 }, (_, i) => ({
    id: `t${i}`, name: `Timer ${i}`, type: (["countdown", "elapsed", "countdown_to"] as const)[i % 3],
    durationSec: 60 + i, targetMs: i % 3 === 2 ? 3_000_000 + i * 1000 : null,
  }));
  const rts: Record<string, TimerRuntime> = {};
  for (const d of defs) rts[d.id] = startTimer(d, initialRuntime(d), 1_000_000);
  // Simulate 60 one-second pushes; each must produce a wire-valid overlay for all 50.
  for (let s = 0; s < 60; s++) {
    const now = 1_000_000 + s * 1000;
    for (const d of defs) {
      const ov = timerToOverlay({ def: d, runtime: rts[d.id], appearance: LOOK }, now);
      assert.ok(isValidTimerOverlay(ov), `timer ${d.id} @${s}s produced invalid overlay: ${JSON.stringify(ov)}`);
    }
  }
});

test("STRESS: stale sweep — clear overlays for 50 ids are all wire-valid", () => {
  for (let i = 0; i < 50; i++) {
    const ov = timerClearOverlay(`t${i}`);
    assert.ok(isValidTimerOverlay(ov));
  }
});

// ---------------------------------------------------------------- (3) messages[]

test("STRESS: 20 simultaneous messages — array >16 is REJECTED by the wire", () => {
  const one = { text: "Hi", position: "lower-third" as const };
  const twenty = Array.from({ length: 20 }, () => ({ ...one }));
  const msg = { type: "message", overlay: one, messages: twenty };
  // The wire caps messages[] at 16 (isValidLiveMessage). 20 must fail closed.
  assert.equal(isValidLiveMessage(msg), false);
  // 16 is the boundary — accepted.
  assert.equal(isValidLiveMessage({ type: "message", overlay: one, messages: twenty.slice(0, 16) }), true);
  // REAL receiver path (coerceLiveMessage) salvages: it keeps the legacy overlay
  // and slices messages[] to 16 rather than dropping the whole post. So 20
  // simultaneous degrades gracefully — the authoritative slot is never lost.
  const coerced = coerceLiveMessage({ type: "message", overlay: one, messages: twenty });
  assert.ok(coerced && coerced.type === "message");
  assert.equal((coerced as { messages?: unknown[] }).messages!.length, 16);
  assert.deepEqual((coerced as { overlay: unknown }).overlay, one);
});

test("STRESS: coerce keeps legacy overlay + valid extras when some extras are garbage", () => {
  const legacy = { text: "Welcome", position: "lower-third" as const };
  const mixed = [
    { id: "ok1", text: "Good", position: "top-left" as const },
    { text: "" }, // invalid (empty)
    { id: "bad id!!", text: "Bad key", position: "top-left" as const }, // invalid id charset
    { id: "ok2", text: "Also good", position: "top-right" as const },
  ];
  const c = coerceLiveMessage({ type: "message", overlay: legacy, messages: mixed }) as { messages: unknown[]; overlay: unknown };
  assert.deepEqual(c.overlay, legacy);
  assert.equal(c.messages.length, 2); // only ok1 + ok2 survive
});

test("STRESS: 5000-char message is REJECTED (2000-char cap)", () => {
  const big = { text: "x".repeat(5000), position: "lower-third" as const };
  assert.equal(isValidMessageOverlay(big), false);
  // 2000 is the max accepted; 2001 fails.
  assert.equal(isValidMessageOverlay({ text: "x".repeat(2000) }), true);
  assert.equal(isValidMessageOverlay({ text: "x".repeat(2001) }), false);
});

test("STRESS: {{timer}} bound to a DELETED timer renders empty, not the raw token", () => {
  // Operator deleted timer 'gone' but a template still references it.
  const rendered = expandMessageTokens("Service starts in {{timer:gone}} !", { timers: {}, firstTimer: undefined });
  assert.equal(rendered, "Service starts in  !");
  // bare {{timer}} with no shown timer → empty, and the RESULT is still wire-valid
  // (non-empty surrounding text keeps length ≥ 1).
  const bare = expandMessageTokens("Countdown: {{timer}}", { timers: {} });
  assert.equal(bare, "Countdown: ");
  assert.equal(isValidMessageOverlay({ text: bare, position: "lower-third" }), true);
});

test("STRESS: {{timer}}-only template that resolves EMPTY produces empty text → wire rejects (fail-safe)", () => {
  // A template whose entire body is a token for a deleted timer collapses to "".
  const rendered = expandMessageTokens("{{timer:gone}}", { timers: {} });
  assert.equal(rendered, "");
  // Empty text is rejected by the overlay validator — so a blank bubble never ships.
  assert.equal(isValidMessageOverlay({ text: rendered, position: "lower-third" }), false);
});

test("STRESS: template CRUD storm — expand stays pure & correct across 1000 varied inputs", () => {
  for (let i = 0; i < 1000; i++) {
    const timers = { a: formatTimerClock(i), b: formatTimerClock(-i) };
    const out = expandMessageTokens(`#${i} {{timer:a}} / {{timer:b}} / {{timer:missing}}`, { timers, firstTimer: timers.a });
    assert.equal(out, `#${i} ${formatTimerClock(i)} / ${formatTimerClock(-i)} / `);
  }
});

test("STRESS: token injection — malformed/nested tokens don't crash or over-match", () => {
  // Adversarial: unbalanced braces, id-charset violations, nested.
  assert.equal(expandMessageTokens("{{timer:has space}}", { timers: { "has space": "X" } }), "{{timer:has space}}"); // space not in id charset → left literal
  assert.equal(expandMessageTokens("{{timer:{{timer}}}}", { timers: {}, firstTimer: "5:00" }), "{{timer:5:00}}"); // id regex can't match `{`, inner bare resolves → no crash
  assert.equal(expandMessageTokens("{{{{time}}}}", { now: new Date(0) }).includes("{"), true); // surrounding braces survive, no throw
});

// ---------------------------------------------------------------- (4) tab-background throttle self-heal

test("STRESS: 1Hz interval suspended 60s then resumes — anchor math self-heals", () => {
  const def = cd(300); // 5 min
  let rt = startTimer(def, initialRuntime(def), 0);
  // Simulate the tick firing every 1s for 10s, then the tab is backgrounded:
  // the interval is SUSPENDED for 60s (no ticks), then resumes.
  let now = 10_000;
  const beforeSuspend = computeRemainingSec(def, rt, now);
  assert.equal(Math.round(beforeSuspend), 290);
  // 60s of NO ticks — state is unchanged (anchor+base is tick-free)...
  now += 60_000;
  const afterResume = computeRemainingSec(def, rt, now); // first tick after resume
  // ...yet the displayed value jumps straight to the correct 230, no accumulation error.
  assert.equal(Math.round(afterResume), 230);
});

test("STRESS: countdown_to is fully clock-derived — background throttle is a non-event", () => {
  const now = 1_000_000;
  const def = cto(now + 100_000);
  const rt = startTimer(def, initialRuntime(def), now);
  // No ticks for 90s; recompute at resume.
  assert.equal(Math.round(computeRemainingSec(def, rt, now + 90_000)), 10);
});

// ---------------------------------------------------------------- (5) legacy projector sanitize

test("STRESS: legacy projector receiving messages[] ignores it gracefully via validator", () => {
  // A newer operator sends {type:message, overlay(legacy), messages[]}. An OLD
  // renderer only reads .overlay; the wire validator still ACCEPTS the whole
  // payload (messages[] is additive & bounded) so nothing is dropped/crashed.
  const legacyOverlay = { text: "Welcome", position: "lower-third" as const };
  const payload = { type: "message", overlay: legacyOverlay, messages: [{ id: "m1", text: "Extra", position: "top-left" as const }] };
  assert.equal(isValidLiveMessage(payload), true);
  // If ANY element of messages[] is garbage, the whole payload fails closed
  // (legacy .overlay would still be safe, but we prefer reject-on-doubt).
  const poisoned = { type: "message", overlay: legacyOverlay, messages: [{ text: "" /* empty → invalid */ }] };
  assert.equal(isValidLiveMessage(poisoned), false);
});

test("STRESS: timer overlay clamps out-of-range remaining to wire bounds", () => {
  // 100h countdown overrun would be -360000s; overlay must clamp to -3600 floor.
  const def = cd(1);
  const rt = startTimer(def, initialRuntime(def), 0);
  const ov = timerToOverlay({ def, runtime: rt, appearance: LOOK }, 100 * 3600 * 1000);
  assert.equal(ov.remainingSec, -3600);
  assert.ok(isValidTimerOverlay(ov));
  // 100h positive elapsed clamps to the 24h ceiling.
  const eDef = el();
  const eRt = startTimer(eDef, initialRuntime(eDef), 0);
  const eOv = timerToOverlay({ def: eDef, runtime: eRt, appearance: LOOK }, 100 * 3600 * 1000);
  assert.equal(eOv.remainingSec, 24 * 3600);
  assert.ok(isValidTimerOverlay(eOv));
});

test("STRESS: parseDurationToSec resists garbage / overflow inputs", () => {
  assert.equal(parseDurationToSec("abc"), 0);
  assert.equal(parseDurationToSec("-5"), 0); // clamped
  assert.equal(parseDurationToSec(""), 0);
  assert.equal(parseDurationToSec("1:2:3:4"), 3723); // >3 parts uses first three
  assert.equal(parseDurationToSec("90"), 90);
  assert.equal(parseDurationToSec("  2:30  "), 150);
});
