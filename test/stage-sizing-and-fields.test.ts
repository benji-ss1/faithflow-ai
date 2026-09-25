/**
 * The two 🔴 findings from the 2026-09-25 ten-angle audit.
 * Run: npx tsx --test test/stage-sizing-and-fields.test.ts
 *
 * 1. The Size slider changed nothing an operator could SEE. The renderer sized
 *    text as `rect.h * 60 * scale`, the editing canvas as `rect.h * 58` and
 *    the thumbnail as `rect.h * 46` — neither of the last two applied `scale`.
 *    You moved the slider, nothing moved, and you found out what it did on the
 *    confidence monitor mid-service.
 *
 * 2. Four widget fields were sanitised, persisted and set by the built-in
 *    presets while being read by nothing: `uppercase`, `showLabel`,
 *    `overrunColor`, `colorTriggers`. Four of five presets advertised an
 *    amber→yellow→red countdown that could never happen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { stageTextFraction, stageTextCss, sanitizeStageLayout } from "../src/engine/stage";
import { BUILT_IN_STAGE_LAYOUTS } from "../src/engine/stage/presets";

// DERIVED, not a hard-coded trio (2026-09-25): a hard-coded path silently
// passes VACUOUSLY once the code it was watching moves to another file. Any
// stage surface that paints widget text must use the shared formula, so the
// list is every file that renders one.
const SURFACES: Record<string, string> = Object.fromEntries(
  [
    "src/components/live/StageLayoutRenderer.tsx",
    ...readdirSync("src/components/operator/pro/right")
      .filter((f) => /^Stage.*\.tsx$/.test(f))
      .map((f) => `src/components/operator/pro/right/${f}`),
  ]
    .filter((p) => /w\.rect\.h|rect: \{ h:/.test(readFileSync(p, "utf8")))
    .map((p) => [p.split("/").pop()!, p]),
);

test("scale actually changes the text size", () => {
  const at = (scale: number) => stageTextFraction({ rect: { h: 0.2 }, scale });
  assert.ok(at(2) > at(1), "doubling scale must grow the text");
  assert.ok(at(0.5) < at(1), "halving scale must shrink it");
  assert.equal(at(2) / at(1), 2, "scale must be linear, so the slider reads true");
});

test("every surface that paints widget text uses the SHARED formula", () => {
  assert.ok(Object.keys(SURFACES).length >= 3, `only found ${Object.keys(SURFACES).length} stage text surfaces — the derivation has broken`);
  // Three copies is how the editor and the screen disagree. The canvas and the
  // thumbnail each had their own, and both silently dropped `scale`.
  for (const [name, path] of Object.entries(SURFACES)) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /stageTextCss\(/, `${name} no longer uses the shared text sizing`);
    assert.doesNotMatch(src, /rect\.h \* \d+(\.\d+)? *\*? *(w\.scale)?\)?\}px/,
      `${name} has grown its own px sizing formula again`);
  }
});

test("each surface declares a size container, or cqh means nothing", () => {
  // stageTextCss returns cqh. Without `container-type: size` on the canvas the
  // unit silently resolves against the viewport and every layout is wrong.
  for (const [name, path] of Object.entries(SURFACES)) {
    assert.match(readFileSync(path, "utf8"), /containerType: "size"/,
      `${name} uses cqh sizing without a size container`);
  }
  assert.match(stageTextCss({ rect: { h: 0.2 }, scale: 1 }), /cqh$/);
});

test("a widget can no longer carry the timer's colour settings", () => {
  const w = sanitizeStageLayout({
    widgets: [{ kind: "timer", rect: {}, colorTriggers: [{ atSec: 5, color: "#ff0000" }], overrunColor: "#00ff00" }],
  }).widgets[0] as unknown as Record<string, unknown>;
  assert.equal(w.colorTriggers, undefined, "the TIMER owns its triggers — two sources drift apart");
  assert.equal(w.overrunColor, undefined);
});

test("no built-in preset advertises a behaviour it cannot deliver", () => {
  // Four of five shipped presets declared 60/30/10 colour triggers that the
  // renderer never read. A preset that promises something it cannot do is
  // worse than a plain one.
  for (const layout of BUILT_IN_STAGE_LAYOUTS) {
    for (const w of layout.widgets) {
      const raw = w as unknown as Record<string, unknown>;
      assert.equal(raw.colorTriggers, undefined, `${layout.name} still declares inert colour triggers`);
      assert.equal(raw.overrunColor, undefined, `${layout.name} still declares an inert overrun colour`);
    }
  }
});

test("showLabel and uppercase now reach the screen", () => {
  const wire = readFileSync("src/lib/broadcast.ts", "utf8");
  const shell = readFileSync("src/components/operator/pro/ProOperatorShell.tsx", "utf8");
  const renderer = readFileSync("src/components/live/StageLayoutRenderer.tsx", "utf8");
  for (const f of ["uppercase", "showLabel"]) {
    assert.match(wire, new RegExp(`${f}\\?: boolean`), `StageLayoutWire is missing ${f}`);
    assert.match(shell, new RegExp(`${f}: w\\.${f}`), `toWire drops ${f} on the floor`);
    assert.match(renderer, new RegExp(`w\\.${f}`), `the renderer never reads ${f}`);
  }
  assert.match(renderer, /textTransform/, "uppercase must actually transform the text");
});
