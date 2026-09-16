/**
 * Operator text-size freedom (2026-09-16). Pure / DOM-free.
 *
 * Contract:
 *  - scale 1.0 (AUTO) shows EXACTLY the auto-fitted size — the default never cuts
 *    text off, because the fit is the largest size that fits the screen.
 *  - SMALLER shrinks freely with no readability floor (smaller can never clip).
 *  - BIGGER is honoured past the fit (the operator's deliberate choice), bounded by
 *    a scaled ceiling so a runaway value can't produce an absurd size.
 *  - Short text is not scaled twice (the auto fit uses the UNSCALED ceiling).
 *
 * Run: npx tsx test/text-size-freedom.test.ts
 */
import assert from "node:assert/strict";
import { resolveShownSize } from "../src/components/live/AutoFitText";
import { FONT_SCALE_MIN, FONT_SCALE_MAX } from "../src/components/operator/pro/operatorConstants";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const CEIL = 324; // base ceiling at 1080p (projectorCeilingPx)

check("AUTO (1.0) shows exactly the fitted size — the never-clip default", () => {
  for (const best of [30, 72, 140, 324]) assert.equal(resolveShownSize(best, 1, CEIL), best);
});

check("SMALLER shrinks freely, with no readability floor", () => {
  assert.equal(resolveShownSize(100, 0.5, CEIL), 50);
  assert.equal(resolveShownSize(40, 0.3, CEIL), 12);   // below the old ~30px floor
  assert.ok(resolveShownSize(100, 0.5, CEIL) <= 100, "never larger than the fit when shrinking");
});

check("SMALLER never produces an unusable size (hard 8px minimum)", () => {
  assert.equal(resolveShownSize(10, 0.3, CEIL), 8);
});

check("BIGGER is honoured past the fit — the operator's choice", () => {
  // A long slide already filling the screen at 72px can now go bigger.
  assert.equal(resolveShownSize(72, 1.5, CEIL), 108);
  assert.ok(resolveShownSize(72, 1.5, CEIL) > 72);
});

check("BIGGER is bounded by the scaled ceiling (no runaway sizes)", () => {
  assert.equal(resolveShownSize(324, 2.5, CEIL), Math.round(CEIL * 2.5));
  assert.ok(resolveShownSize(324, 2.5, CEIL) <= Math.round(CEIL * 2.5));
});

check("short text at the ceiling is scaled once, not twice", () => {
  // best == base ceiling (short text); x2 should give 2x ceiling, not 4x.
  assert.equal(resolveShownSize(CEIL, 2, CEIL), CEIL * 2);
});

check("junk scale falls back to AUTO", () => {
  for (const bad of [0, -1, NaN, Infinity]) assert.equal(resolveShownSize(90, bad as number, CEIL), 90);
});

check("operator range gives real room both ways and still includes AUTO", () => {
  assert.ok(FONT_SCALE_MIN <= 0.3, `min ${FONT_SCALE_MIN}`);
  assert.ok(FONT_SCALE_MAX >= 2.5, `max ${FONT_SCALE_MAX}`);
  assert.ok(FONT_SCALE_MIN < 1 && FONT_SCALE_MAX > 1);
});

console.log(`\ntext-size-freedom: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
