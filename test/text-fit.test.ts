/**
 * PP7 parity R1: designed text boxes scale to fit instead of clipping.
 *
 * The bug: a positioned text object rendered at a fixed size inside
 * `overflow: hidden`. One line too many and it silently vanished off the
 * projector mid-service. ProPresenter scales the text instead.
 *
 * Run: npx tsx test/text-fit.test.ts
 */
import assert from "node:assert/strict";
import { fitScale, overflows, clampScale, MIN_FIT_SCALE, MAX_FIT_SCALE, DEFAULT_TEXT_SCALE } from "../src/lib/text-fit";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => {
  try { fn(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; }
};

const box = { boxW: 1000, boxH: 200 };
const fits    = { ...box, contentW: 800,  contentH: 150 };
const tooTall = { ...box, contentW: 800,  contentH: 400 };  // 2x too tall
const tooWide = { ...box, contentW: 2000, contentH: 150 };  // 2x too wide

console.log("the default protects every existing slide:");
check("default mode is 'down'", () => {
  assert.equal(DEFAULT_TEXT_SCALE, "down");
});
check("text that already fits is NOT touched — byte-identical rendering", () => {
  assert.equal(fitScale(fits, "down"), 1, "an existing slide that fits must not change size");
});
check("text that would be CLIPPED shrinks instead of vanishing", () => {
  assert.equal(fitScale(tooTall, "down"), 0.5, "400px of content into a 200px box = half size");
  assert.equal(fitScale(tooWide, "down"), 0.5);
});
check("the tighter of the two axes wins", () => {
  assert.equal(fitScale({ boxW: 1000, boxH: 200, contentW: 2000, contentH: 800 }, "down"), 0.25);
});

console.log("the four ProPresenter modes behave as PP7 describes:");
check("'none' never scales, in either direction", () => {
  assert.equal(fitScale(tooTall, "none"), 1);
  assert.equal(fitScale(fits, "none"), 1);
});
check("'down' shrinks but never grows", () => {
  assert.equal(fitScale(tooTall, "down"), 0.5);
  assert.equal(fitScale(fits, "down"), 1, "must not grow to fill");
});
check("'up' grows but never shrinks", () => {
  assert.ok(fitScale(fits, "up") > 1, "should grow to fill the box");
  assert.equal(fitScale(tooTall, "up"), 1, "must not shrink");
});
check("'both' always fills the box", () => {
  assert.ok(fitScale(fits, "both") > 1);
  assert.equal(fitScale(tooTall, "both"), 0.5);
});

console.log("it cannot produce a broken slide:");
check("degenerate or unmeasured boxes are a no-op, never a guess", () => {
  for (const m of [
    { boxW: 0, boxH: 200, contentW: 100, contentH: 100 },
    { boxW: 100, boxH: 0, contentW: 100, contentH: 100 },
    { boxW: 100, boxH: 100, contentW: 0, contentH: 0 },
  ]) assert.equal(fitScale(m, "both"), 1);
});
check("NaN / Infinity can never reach the renderer", () => {
  assert.equal(fitScale({ boxW: NaN, boxH: 200, contentW: 10, contentH: 10 }, "both"), 1);
  assert.equal(fitScale({ boxW: Infinity, boxH: 200, contentW: 10, contentH: 10 }, "both"), 1);
  // Non-finite in means "no change", not "clamp to the max" — an unmeasurable
  // box must leave the authored size alone rather than guess a scale.
  assert.equal(clampScale(NaN), 1);
  assert.equal(clampScale(Infinity), 1);
  assert.equal(clampScale(5), MAX_FIT_SCALE, "a finite overshoot IS clamped");
});
check("scale is clamped so nothing becomes invisible or absurd", () => {
  // 1000x too much text must not scale to zero.
  const extreme = { boxW: 100, boxH: 100, contentW: 100, contentH: 100000 };
  assert.equal(fitScale(extreme, "down"), MIN_FIT_SCALE);
  assert.ok(clampScale(99) <= MAX_FIT_SCALE);
});

console.log("the renderer's loop terminates:");
check("overflows() has tolerance so sub-pixel rounding can't loop forever", () => {
  assert.equal(overflows({ boxW: 100, boxH: 100, contentW: 100.2, contentH: 100 }), false);
  assert.equal(overflows({ boxW: 100, boxH: 100, contentW: 105, contentH: 100 }), true);
});
check("the projector render path is bounded", () => {
  const src = require("node:fs").readFileSync(new URL("../src/components/live/FittedText.tsx", import.meta.url), "utf8");
  assert.match(src, /MAX_PASSES = 4/, "an unbounded fit loop would stall the projector");
  assert.doesNotMatch(src, /setTimeout/, "no arbitrary delays in the render path (AGENTS.md rule 3)");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
