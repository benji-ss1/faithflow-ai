/**
 * Operator text-size freedom (2026-09-16). Pure / DOM-free.
 *
 * Contract — lyrics are NEVER cut off, at any operator size:
 *  - AUTO (1.0) shows exactly the fitted size.
 *  - BIGGER raises the SEARCH ceiling, so short text grows, but the shown size is
 *    always the largest that still fits — bigger can never push text off the screen.
 *  - SMALLER shrinks freely with no readability floor (smaller can never clip),
 *    with an 8px hard minimum.
 *  - The operator range gives real room both ways.
 *
 * Run: npx tsx test/text-size-freedom.test.ts
 */
import assert from "node:assert/strict";
import { resolveShownSize, searchCeilingPx } from "../src/components/live/AutoFitText";
import { FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_KEY } from "../src/components/operator/pro/operatorConstants";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const CEIL = 324; // base ceiling at 1080p

check("AUTO (1.0) shows exactly the fitted size", () => {
  for (const best of [30, 72, 140, 324]) assert.equal(resolveShownSize(best, 1), best);
});

check("BIGGER never shows more than the fitted size (never cut off)", () => {
  for (const best of [30, 72, 140, 324]) for (const s of [1.1, 1.5, 2, 2.5]) {
    assert.equal(resolveShownSize(best, s), best, `best=${best} scale=${s}`);
  }
});

check("BIGGER raises the search ceiling so SHORT text can grow", () => {
  assert.equal(searchCeilingPx(CEIL, 1), CEIL);
  assert.equal(searchCeilingPx(CEIL, 2), CEIL * 2);
  assert.equal(searchCeilingPx(CEIL, 2.5), Math.round(CEIL * 2.5));
  assert.equal(searchCeilingPx(CEIL, 0.5), CEIL, "smaller never lowers the search ceiling");
});

check("SMALLER shrinks freely, with no readability floor", () => {
  assert.equal(resolveShownSize(100, 0.5), 50);
  assert.equal(resolveShownSize(40, 0.3), 12); // below the old ~30px floor
});

check("SMALLER never produces an unusable size (hard 8px minimum)", () => {
  assert.equal(resolveShownSize(10, 0.3), 8);
});

check("junk scale falls back to AUTO", () => {
  for (const bad of [0, -1, NaN, Infinity]) assert.equal(resolveShownSize(90, bad as number), 90);
  assert.equal(searchCeilingPx(CEIL, NaN), CEIL);
});

check("operator range gives real room both ways and includes AUTO", () => {
  assert.ok(FONT_SCALE_MIN <= 0.3 && FONT_SCALE_MAX >= 2.5);
});

check("saved operator setting is preserved (key unchanged)", () => {
  assert.equal(FONT_SCALE_KEY, "presentflow.pro.fontScale.v1");
});

console.log(`\ntext-size-freedom: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
