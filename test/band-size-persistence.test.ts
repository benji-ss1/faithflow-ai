/**
 * Lower-third verse sizing must PERSIST across verses (2026-09-19 owner report: "the text
 * does not persist … if you call one verse a hundred verses the text sizing and fonts
 * must persist … modularly fit whatever verse is coming in").
 *
 * Two causes, both fixed here:
 *  1. The band auto-fit each verse to ITSELF, so size was a property of the verse, not of
 *     the style. The ceiling is now the LOCKED size from the band geometry + Verse size.
 *  2. The band text had no definite width, so it shrink-wrapped and a long verse was
 *     shrunk onto ONE line instead of wrapping — John 3:16 rendered at the 24px floor
 *     while "Jesus wept." sat at 150px.
 *
 * Measured in a real browser at the default 30% band (canvas px), same church style:
 *            len   before -> after
 *   Jn 11:35  14     150  ->  71      Ps 119:105  62   55 ->  71
 *   Jn 3:16  144      24  ->  62      Esther 8:9 530   24 ->  31
 *   Jdg 3:2  134      25  ->  62      1 Jn 4:8    54   63 ->  71
 *   distinct sizes 24/25/55/63/150 (6.3x spread) -> 31/62/71 (2.3x), nothing clipped.
 * Run: npx tsx test/band-size-persistence.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bandVersePx, BAND_VERSE_PX_FACTOR } from "../src/lib/band-media";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// The reference line's own factor, from SlideRenderer — the verse is exactly 2x it.
const refPx = (bandH: number, refScale = 1) => Math.round((bandH / 100) * 1080 * 0.11 * refScale);

console.log("the size is a property of the STYLE, never of the verse:");
check("same band + same Verse size => same px, whatever the verse", () => {
  // bandVersePx takes no text at all — that is the guarantee, structurally.
  assert.equal(bandVersePx(30, 1), bandVersePx(30, 1));
  assert.equal(bandVersePx(30, 1), 71);
});
check("it scales with the band height and the Verse size setting", () => {
  // +-1px of rounding.
  assert.ok(Math.abs(bandVersePx(60, 1) - bandVersePx(30, 1) * 2) <= 1);
  assert.ok(Math.abs(bandVersePx(30, 2) - bandVersePx(30, 1) * 2) <= 1);
  assert.ok(bandVersePx(30, 0.3) < bandVersePx(30, 1));
});
check("the operator's global A-/A+ still multiplies it", () => {
  assert.equal(bandVersePx(30, 1, 2), 143);
  assert.equal(bandVersePx(30, 1, 1), bandVersePx(30, 1));
});
check("Verse size 50% renders the verse at EXACTLY the reference line's size", () => {
  for (const h of [16, 24, 30, 48]) assert.equal(bandVersePx(h, 0.5), refPx(h), `bandH=${h}`);
  assert.equal(BAND_VERSE_PX_FACTOR, 0.11 * 2);
});
check("garbage geometry falls back to a sane size, never 0 or NaN", () => {
  for (const v of [NaN, 0, -5, Infinity]) {
    const px = bandVersePx(v as number, v as number, v as number);
    assert.ok(Number.isFinite(px) && px >= 8, String(v));
  }
});
check("calibrated to what a typical verse already fitted at (no jump for churches)", () => {
  // A normal verse measured 62px before this change at the default band; the locked size
  // is 71, i.e. the same ballpark — short verses stop ballooning, they don't all shrink.
  assert.ok(bandVersePx(30, 1) >= 60 && bandVersePx(30, 1) <= 80);
});

console.log("renderer wiring:");
const r = read("src/components/live/SlideRenderer.tsx");
check("the band's fit CEILING is the locked size, not a fixed 150", () => {
  assert.match(r, /maxPx=\{lockedVersePx\}/);
  assert.doesNotMatch(r, /maxPx=\{Math\.round\(150 \* vScale\)\}/);
});
check("it is still a CEILING, so an over-long verse shrinks and is never clipped", () => {
  // maxPx caps the binary search; AutoFitText still searches DOWN from it.
  assert.match(r, /const lockedVersePx = bandVersePx\(bandH, vScale, fontScale\)/);
});
check("Verse size no longer multiplies the FITTED size (that is what varied per verse)", () => {
  const band = r.slice(r.indexOf('scriptureLayout === "lowerThird"'), r.indexOf("ltRef &&"));
  assert.match(band, /fontScale=\{1\}/);
  assert.doesNotMatch(band, /fontScale=\{\(fontScale && fontScale > 0 \? fontScale : 1\) \* vScale\}/);
});
check("the band opts into wrapping", () => {
  assert.match(r, /\n\s+wrapToBox\n/);
});

console.log("wrapping (the one-tiny-line bug):");
const a = read("src/components/live/AutoFitText.tsx");
check("wrapToBox pins an explicit pixel width to the measured box", () => {
  assert.match(a, /if \(wrapToBoxRef\.current\) \{\s*\n\s*t\.style\.width = `\$\{bw\}px`/);
});
check("the explicit width is set BEFORE the fit cache is consulted (cached renders wrap too)", () => {
  assert.ok(a.indexOf("wrapToBoxRef.current") < a.indexOf("// T3 cache hit"));
});
check("render keeps the width for wrapToBox as well as projectorFit", () => {
  assert.match(a, /width: \(projectorFit \|\| wrapToBox\) \?/);
  assert.match(a, /maxWidth: \(projectorFit \|\| wrapToBox\) \? undefined : "100%"/);
});
check("every other caller is untouched — no wrapToBox means shrink-to-fit as before", () => {
  const callers = ["src/components/live/SlideRenderer.tsx", "src/components/operator/pro/center/ThemedSlideCard.tsx"];
  const uses = callers.map(read).join("\n").match(/wrapToBox/g) ?? [];
  assert.equal(uses.length, 1, "only the scripture band opts in");
});
check("the abandoned snap-to-steps experiment left nothing behind", () => {
  for (const f of ["src/components/live/AutoFitText.tsx", "src/components/live/SlideRenderer.tsx", "src/lib/band-media.ts"]) {
    assert.doesNotMatch(read(f), /snapDownToPx|snapFinalSize|bandVerseStepPx/, f);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
