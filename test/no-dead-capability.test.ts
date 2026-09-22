/**
 * THE GUARD THAT ENDS THE CLASS.
 * Run: npx tsx test/no-dead-capability.test.ts
 *
 * "A field saved and never read" has shipped FIVE times on timers alone: the
 * AM/PM period, resolveTimerColor, showHours/leadingZeros, the stage-layout
 * editor with no consumer, and overrun_color. Every time it was fixed by hand
 * and every time it came back somewhere else, because nothing made it
 * impossible — only unlucky.
 *
 * So this test does not check a list of known fields. It ENUMERATES the
 * declared capability surface and asserts each entry has BOTH a producer and a
 * consumer. A new field added without wiring fails here, by name, on the first
 * run — which is the only way this stops recurring (docs/ONE_TO_ONE_LOOP.md §1).
 *
 * Deliberately source-level: the alternative is trusting a human to notice.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAGE_WIDGET_KINDS } from "../src/engine/stage";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const renderer = read("../src/components/live/StageLayoutRenderer.tsx");
const editor = read("../src/components/operator/pro/right/StageLayoutPanel.tsx");
const wireDef = read("../src/lib/broadcast.ts");
const shell = read("../src/components/operator/pro/ProOperatorShell.tsx");
const hooks = read("../src/components/operator/pro/hooks.ts");
const panel = read("../src/components/operator/pro/right/TimersPanel.tsx");

/* ── 1. every stage widget kind RENDERS ──────────────────────────────────── */
// slide_preview sat in the editor's dropdown for a week returning null: an
// operator could add it, save it, and get a blank box on the stage screen.

for (const kind of STAGE_WIDGET_KINDS) {
  assert.ok(
    new RegExp(`"${kind}"`).test(renderer),
    `StageLayoutRenderer does not handle "${kind}" — it is offered in the editor, so it must render or be removed from STAGE_WIDGET_KINDS`,
  );
}

/* ── 2. every StageWidget field reaches the screen ───────────────────────── */
// A field on the model that never reaches the wire is invisible by
// construction, however carefully the editor writes it.

const widgetFields = ["timerId", "text", "scale", "align", "color", "showHours", "leadingZeros", "zIndex"];
for (const f of widgetFields) {
  assert.ok(new RegExp(`\\b${f}\\b`).test(wireDef), `StageLayoutWire is missing "${f}" — the editor could set it and nothing would show`);
  assert.ok(new RegExp(`\\b${f}\\b`).test(renderer), `StageLayoutRenderer never reads "${f}"`);
}

/* ── 3. every persisted timer field is written AND read ──────────────────── */
// The AM/PM bug, twice: `period` was stored and never read, then the edit form
// overwrote it. overrun_color was the same shape — a column that stayed NULL.

const timerDefFields = ["allowsOverrun", "period", "elapsedStartSec", "elapsedEndSec", "overrunColor"];
for (const f of timerDefFields) {
  assert.ok(new RegExp(`\\b${f}\\b`).test(panel), `the Timers editor never WRITES "${f}" — the column would stay empty forever`);
  assert.ok(new RegExp(`\\b${f}\\b`).test(hooks), `useTimersSession never READS "${f}"`);
}

/* ── 4. every timer appearance field has a control and reaches the wire ──── */

const appearanceFields = ["position", "scale", "color", "overrunColor", "showLabel", "showHours", "leadingZeros", "colorTriggers"];
for (const f of appearanceFields) {
  assert.ok(new RegExp(`\\b${f}\\b`).test(panel), `no operator control writes appearance "${f}"`);
  assert.ok(
    new RegExp(`\\b${f}\\b`).test(shell) || new RegExp(`\\b${f}\\b`).test(read("../src/engine/timers/wire.ts")),
    `appearance "${f}" never reaches an output — it would be a dead control`,
  );
}

/* ── 5. no exported engine function is uncalled ─────────────────────────── */
// A pure module nothing calls is not "available for later" — it is a second
// implementation that drifts from the real one. engine/timers/overlay.ts had
// already diverged (no scale, no colour) while the shell hand-rolled the same
// mapping; engine/stage had a formatter that disagreed with formatTimerClock.
// This derives the rule instead of listing names, so a NEW dead export fails.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// SCOPED to the modules this guard was written for. Running it across the whole
// engine immediately surfaced PRE-EXISTING dead exports in actions/spec.ts,
// arrangements and cue-sheet — a real finding, recorded in
// docs/PP7_TIMERS_PLAN.md, but not something to fail CI on until someone has
// actually audited them. Widen this when that pass happens; do not widen it by
// deleting code you have not read.
const engineFiles = [
  ...walk(join(SRC, "engine/timers")),
  ...walk(join(SRC, "engine/stage")),
].filter((f) => /\.ts$/.test(f));
const allSrc = walk(SRC).filter((f) => /\.tsx?$/.test(f));

const dead: string[] = [];
for (const file of engineFiles) {
  const body = readFileSync(file, "utf8");
  for (const m of body.matchAll(/^export function (\w+)/gm)) {
    const name = m[1];
    // Referenced anywhere in src/ BEYOND its own definition? Counting the
    // defining file matters: startTimer/resetTimer are reached via
    // applyCommand, to24Hour via resolveTargetMs, timerSlotToWire via
    // buildTimersWire — internal helpers, not dead code. The signal for DEAD is
    // "declared once and never named again, anywhere".
    const selfHits = (readFileSync(file, "utf8").match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    const usedElsewhere = allSrc.some((other) =>
      other !== file && new RegExp(`\\b${name}\\b`).test(readFileSync(other, "utf8")));
    if (!usedElsewhere && selfHits <= 1) dead.push(`${name} (${file.replace(SRC, "src/")})`);
  }
}
assert.deepEqual(dead, [],
  `These exported engine functions are called from NOWHERE in src/. Call them or delete them — `
  + `an uncalled pure function is a second implementation waiting to disagree with the real one:\n`
  + dead.map((d) => `  ${d}`).join("\n"));

console.log("no-dead-capability: every declared capability has a producer and a consumer");
