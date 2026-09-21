// Run: npx tsx test/timer-screen-parity.test.ts
//
// A timer must look the SAME on every screen unless the operator deliberately
// made them differ (user directive 2026-09-21), and no screen may lag another.
//
// This bit hard: /live, /stage and /livestream each had their OWN copy of the
// timer markup AND its own MM:SS formatter, and /ndi had no timer code at all.
// They had already drifted — all three printed "90:00" where the operator's
// panel printed "1:30:00", /stage and /livestream silently discarded the
// operator's `position`, and only /stage showed a paused timer as paused.
//
// The fix is ONE shared renderer. These are source-level guards that it stays
// that way, because the failure mode is silent and only visible on real screens.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const SURFACES = [
  ["live", "../src/app/live/page.tsx"],
  ["stage", "../src/app/stage/page.tsx"],
  ["livestream", "../src/app/livestream/page.tsx"],
  ["ndi", "../src/app/ndi/page.tsx"],
] as const;

/* ── 1. every surface renders timers through the shared component ────────── */

for (const [name, path] of SURFACES) {
  const src = read(path);
  assert.ok(/<TimerOverlayLayer/.test(src), `${name}: must render timers via the shared TimerOverlayLayer`);
  assert.ok(/from "@\/components\/live\/TimerOverlayLayer"/.test(src), `${name}: must import the shared renderer`);
}

/* ── 2. no surface may re-implement clock formatting ─────────────────────── */
// A local formatter is exactly how the "90:00" vs "1:30:00" split happened.

for (const [name, path] of SURFACES) {
  const src = read(path);
  assert.ok(!/function formatTimerMMSS/.test(src), `${name}: must not define its own timer formatter`);
  assert.ok(!/function formatStageTimer/.test(src), `${name}: must not define its own timer formatter`);
  // No surface may format a TIMER value itself. `formatCountdown` on /stage is
  // deliberately exempt: it renders the legacy service countdown
  // (OutputState.countdownEndsAt) in its own confidence-monitor chip, which is
  // a separate feature with no per-timer look.
  const timerFormatters = [...src.matchAll(/function (format\w*)/g)]
    .map((m) => m[1])
    .filter((n) => /timer/i.test(n));
  assert.deepEqual(timerFormatters, [], `${name}: defines its own timer formatter(s): ${timerFormatters.join(", ")}`);
  assert.ok(
    !/remainingSec[^\n]*padStart/.test(src),
    `${name}: inline formatting of a timer value found — use the shared renderer`,
  );
}

/* ── 3. every surface applies the scene mask for timers ──────────────────── */
// Otherwise one screen would ignore the operator's routing choice.

for (const [name, path] of SURFACES) {
  const src = read(path);
  assert.ok(
    /sceneHidesLayer\([^)]*"timer"\)/.test(src),
    `${name}: renders timers but never applies the timer scene mask`,
  );
}

/* ── 4. NDI actually handles the timer wire message ──────────────────────── */
// It previously received them on the shared channel and silently dropped them.

const ndi = read("../src/app/ndi/page.tsx");
assert.ok(/msg\.type === "timer"/.test(ndi), "ndi: must handle the timer wire message, not drop it");
assert.ok(/setNamedTimers/.test(ndi) && /setTimerOverlay/.test(ndi),
  "ndi: must track both keyed timers and the legacy slot, like every other surface");

/* ── 5. the shared renderer uses the ENGINE formatter ────────────────────── */
// So the operator panel and every screen print the same string for the same
// number — including hours, which the old per-surface formatters dropped.

const layer = read("../src/components/live/TimerOverlayLayer.tsx");
assert.ok(/formatTimerClock/.test(layer) && /from "@\/engine\/timers"/.test(layer),
  "the shared renderer must format via the engine, the same function the operator panel uses");
assert.ok(!/padStart\(2, "0"\)}:/.test(layer), "the shared renderer must not hand-roll MM:SS");

/* ── 6. surfaces differ ONLY through the sanctioned density switch ───────── */

assert.ok(/density/.test(layer), "the renderer must expose the one sanctioned per-surface difference");
const stage = read("../src/app/stage/page.tsx");
assert.ok(/density="compact"/.test(stage), 'stage should use the compact density (a confidence monitor shares space)');
for (const [name, path] of [["live", "../src/app/live/page.tsx"], ["livestream", "../src/app/livestream/page.tsx"], ["ndi", "../src/app/ndi/page.tsx"]] as const) {
  assert.ok(/density="full"/.test(read(path)), `${name}: full-frame surfaces must use the full density`);
}

/* ── 7. the paused state is shown, and shown the same way everywhere ─────── */
// Only /stage used to say "(paused)", so the projector could show a stalled
// timer with no indication it had stopped.

assert.ok(/\(paused\)/.test(layer), "the shared renderer must indicate a paused timer");
for (const [name, path] of SURFACES) {
  assert.ok(!/\(paused\)/.test(read(path)), `${name}: paused styling must live in the shared renderer, not here`);
}

console.log("timer-screen-parity: all guards passed");
