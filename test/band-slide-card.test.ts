/**
 * Lower-third BAND slides (verse/song text slides banded by the church default, or a
 * per-slide "third" image/video) size their reference + caption in fixed 1920x1080
 * canvas px. The operator cards (ThemedSlideCard) rendered them raw in a ~500px box, so the
 * reference came out ~4x too big and overlapped the verse (2026-09-19). Cards now compose
 * band slides in a PresentationCanvas; every other slide renders exactly as before.
 * Run: npx tsx test/band-slide-card.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBandSlide } from "../src/lib/band-media";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const card = readFileSync(new URL("../src/components/operator/pro/center/ThemedSlideCard.tsx", import.meta.url), "utf8");

console.log("isBandSlide:");
check("lower-third text slide is a band slide", () => assert.equal(isBandSlide({ kind: "text", scriptureLayout: "lowerThird" }), true));
check("full-screen text slide is not", () => assert.equal(isBandSlide({ kind: "text" }), false));
check("text slide with other layout is not", () => assert.equal(isBandSlide({ kind: "text", scriptureLayout: "full" }), false));
check("image/video with layout third are band slides", () => {
  assert.equal(isBandSlide({ kind: "image", layout: "third" }), true);
  assert.equal(isBandSlide({ kind: "video", layout: "third" }), true);
});
check("image/video full-bleed are not", () => {
  assert.equal(isBandSlide({ kind: "image" }), false);
  assert.equal(isBandSlide({ kind: "video", layout: "full" }), false);
});
check("a text slide's layout field does not band it (only scriptureLayout does)", () => assert.equal(isBandSlide({ kind: "text", layout: "third" }), false));
check("blank / logo / other kinds are never band slides", () => {
  assert.equal(isBandSlide({ kind: "blank" }), false);
  assert.equal(isBandSlide({ kind: "logo", layout: "third" }), false);
});

console.log("ThemedSlideCard wiring:");
check("band slides are wrapped in PresentationCanvas", () => {
  assert.match(card, /isBandSlide\([^)]*\)\s*\?\s*<PresentationCanvas>\{renderer\}<\/PresentationCanvas>/);
});
check("non-band slides render the SlideRenderer directly (unchanged)", () => {
  assert.match(card, /:\s*renderer\}/);
  assert.match(card, /const renderer = <SlideRenderer slide=\{slide\} appearance=\{appearance\} overVideo=\{showBg\} \{\.\.\.rest\} \/>/);
});
check("background layer still renders outside the canvas wrapper", () => {
  assert.ok(card.indexOf("<CardBackground") < card.indexOf("<PresentationCanvas>"));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
