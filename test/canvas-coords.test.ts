/**
 * THE canvas coordinate contract (src/lib/canvas-coords.ts).
 *
 * Background (2026-09-22 audit): 1920/1080 was declared in THREE files with no
 * cross-import, and the logical->percent conversion was hand-copied ~28 times
 * across SlideObjectsLayer.tsx (projector) and SlideCanvas.tsx (editor) with a
 * comment as the only contract. It had ALREADY drifted:
 *   - the projector scaled letterSpacing by the font scale, the editor did not
 *   - the projector clamped the font scale to 1.6, the editor did not (so the
 *     editor previewed designed text LARGER than it projects)
 *
 * These tests pin the contract AND the drift, since there is no pixel-level
 * visual-regression harness to catch it.
 *
 * Run: npx tsx test/canvas-coords.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SLIDE_W, SLIDE_H, OBJECT_FONT_SCALE_MAX, objectFontScale,
  pctX, pctY, cqh, cqw, canvasScaleFor, editorToLogical, logicalToEditor,
} from "../src/lib/canvas-coords";
import { CANVAS_W, CANVAS_H } from "../src/lib/slide-objects";
import { SLIDE_CANVAS_W, SLIDE_CANVAS_H } from "../src/lib/broadcast";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

console.log("one canvas, everywhere:");
check("all three historic declarations now agree", () => {
  assert.equal(CANVAS_W, SLIDE_W); assert.equal(CANVAS_H, SLIDE_H);
  assert.equal(SLIDE_CANVAS_W, SLIDE_W); assert.equal(SLIDE_CANVAS_H, SLIDE_H);
  assert.equal(SLIDE_W, 1920); assert.equal(SLIDE_H, 1080);
});
check("PresentationCanvas still declares the same canvas", () => {
  const src = read("../src/components/live/PresentationCanvas.tsx");
  assert.match(src, /CANVAS_W\s*=\s*1920/); assert.match(src, /CANVAS_H\s*=\s*1080/);
});

console.log("\nconversions:");
check("pctX/pctY map the canvas onto 0-100", () => {
  assert.equal(pctX(0), 0); assert.equal(pctX(SLIDE_W), 100); assert.equal(pctX(960), 50);
  assert.equal(pctY(0), 0); assert.equal(pctY(SLIDE_H), 100); assert.equal(pctY(540), 50);
});
check("pctX/pctY equal the hand-written formula they replace", () => {
  for (const v of [0, 1, 123.456, 960, 1920, -40, 2400]) {
    assert.equal(pctX(v), (v / 1920) * 100);
    assert.equal(pctY(v), (v / 1080) * 100);
  }
});
check("cqh/cqw equal the hand-written formula they replace", () => {
  for (const v of [12, 96, 250.5]) for (const s of [0.3, 1, 1.6]) {
    assert.equal(cqh(v, s), ((v * s) / 1080) * 100);
    assert.equal(cqw(v, s), ((v * s) / 1920) * 100);
  }
});
check("cqh defaults to scale 1", () => { assert.equal(cqh(96), cqh(96, 1)); });

console.log("\nround trip (no cumulative drift):");
check("logical -> editor -> logical returns the original", () => {
  for (const w of [1440, 1280, 960, 800, 640.5]) {
    const s = canvasScaleFor({ width: w, height: w * 9 / 16 })!;
    for (const [dx, dy] of [[100, 50], [0, 0], [-37.25, 912.5], [1920, 1080]]) {
      const there = editorToLogical(dx, dy, s);
      const back = logicalToEditor(there.dx, there.dy, s);
      assert.ok(Math.abs(back.dx - dx) < 1e-9, `x ${dx} -> ${back.dx} at width ${w}`);
      assert.ok(Math.abs(back.dy - dy) < 1e-9, `y ${dy} -> ${back.dy} at width ${w}`);
    }
  }
});
check("a 75% editor matches the worked example (960 logical <-> 720 editor)", () => {
  const s = canvasScaleFor({ width: 1440, height: 810 })!;
  assert.equal(s.scaleX, 1920 / 1440);
  assert.equal(editorToLogical(720, 0, s).dx, 960);
  assert.equal(logicalToEditor(960, 0, s).dx, 720);
});

console.log("\nthe NaN guard (a zero-sized canvas must not produce geometry):");
check("a zero / negative / NaN / missing rect yields null, never Infinity", () => {
  for (const bad of [null, undefined, { width: 0, height: 100 }, { width: 100, height: 0 },
                     { width: -5, height: 10 }, { width: NaN, height: 100 }, { width: Infinity, height: 100 }]) {
    assert.equal(canvasScaleFor(bad as never), null, `accepted ${JSON.stringify(bad)}`);
  }
});
check("a valid rect yields finite, positive scales", () => {
  const s = canvasScaleFor({ width: 640, height: 360 })!;
  assert.ok(Number.isFinite(s.scaleX) && s.scaleX > 0);
  assert.ok(Number.isFinite(s.scaleY) && s.scaleY > 0);
});

console.log("\nobject font scale (editor must not overstate the projector):");
check("clamped to OBJECT_FONT_SCALE_MAX", () => {
  assert.equal(OBJECT_FONT_SCALE_MAX, 1.6);
  assert.equal(objectFontScale(2.5), 1.6);
  assert.equal(objectFontScale(1.6), 1.6);
  assert.equal(objectFontScale(1), 1);
  assert.equal(objectFontScale(0.3), 0.3);
});
check("a missing / invalid scale falls back to 1, never 0 or NaN", () => {
  for (const bad of [undefined, NaN, Infinity, 0, -1]) assert.equal(objectFontScale(bad as never), 1, `bad: ${bad}`);
});
check("it matches the projector's own clamp, read from source", () => {
  const src = read("../src/components/live/SlideObjectsLayer.tsx");
  const m = src.match(/Math\.min\(fontScale,\s*([0-9.]+)\)/);
  assert.ok(m, "SlideObjectsLayer no longer clamps fontScale the way this test assumes");
  assert.equal(Number(m![1]), OBJECT_FONT_SCALE_MAX, "projector clamp drifted from OBJECT_FONT_SCALE_MAX");
});

console.log("\nthe drift that was actually found:");
check("the EDITOR now scales letterSpacing, as the projector always has", () => {
  const ed = read("../src/components/operator/editor/SlideCanvas.tsx");
  assert.match(ed, /letterSpacing:\s*obj\.letterSpacing\s*\?\s*`\$\{toCqh\(obj\.letterSpacing,\s*objectFontScale\(textScale\)\)\}cqh`/,
    "editor letterSpacing is not scaled by the font scale — it will drift from the projector again");
});
check("the EDITOR now clamps its font scale, as the projector always has", () => {
  const ed = read("../src/components/operator/editor/SlideCanvas.tsx");
  assert.match(ed, /fontSize:\s*`\$\{toCqh\(obj\.fontSize \?\? 96,\s*objectFontScale\(textScale\)\)\}cqh`/,
    "editor font size is unclamped — designed text will preview larger than it projects");
});
check("the editor no longer hand-rolls the /CANVAS_H*100 font formula", () => {
  const ed = read("../src/components/operator/editor/SlideCanvas.tsx");
  assert.ok(!/\(obj\.fontSize \?\? 96\) \* textScale \/ CANVAS_H\) \* 100/.test(ed), "an inline copy survived the refactor");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
