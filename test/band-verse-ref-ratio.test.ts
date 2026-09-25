/**
 * The band's Verse/Reference size relationship, and the help text that states it.
 *
 * Field report (Victor, 2026-09-22): on the lower-third band the reference reads
 * much smaller than the verse, and the operator could not make them match. The
 * editor's help text said "set the verse to 100% to match the reference line
 * exactly" — which is WRONG, and an operator following it would never get a match.
 *
 * Verified from source: the verse factor is 0.22 and the reference factor 0.11,
 * so the verse renders at exactly TWICE the reference at default scales. They
 * match at Verse size 50%, or at Reference size 200% (which keeps the verse big).
 *
 * This test EXECUTES both formulas rather than trusting either code comment, so
 * changing a factor fails here instead of silently making the UI lie again.
 *
 * Run: npx tsx test/band-verse-ref-ratio.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bandVersePx, BAND_VERSE_PX_FACTOR } from "../src/lib/band-media";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };

/** The reference px expression as SlideRenderer computes it (kept in step by the source check below). */
const REF_FACTOR = 0.11;
const refPx = (bandH: number, referenceScale = 1, refScale = 1) =>
  Math.round((bandH / 100) * 1080 * REF_FACTOR * referenceScale * refScale);

console.log("the real ratio, computed not assumed:");
check("the verse is exactly TWICE the reference at default scales", () => {
  // Both sides are Math.round()ed to whole px, so at small band heights the
  // displayed ratio reads ~1.97 (e.g. 71px vs 36px at band 30%) even though the
  // FACTORS are exactly 2x. Compare with a +/-1px rounding allowance on each
  // side rather than pretending the integers divide cleanly.
  for (const h of [16, 20, 30, 40, 48]) {
    const v = bandVersePx(h, 1, 1);
    const r = refPx(h);
    assert.ok(Math.abs(v - 2 * r) <= 2, `band ${h}%: verse ${v}px vs 2x ref ${2 * r}px — beyond rounding`);
  }
});
check("they MATCH at Verse size 50%", () => {
  for (const h of [16, 30, 48]) {
    const v = bandVersePx(h, 0.5, 1);
    const r = refPx(h);
    assert.ok(Math.abs(v - r) <= 1, `band ${h}%: verse ${v}px vs ref ${r}px at Verse 50% — should be equal`);
  }
});
check("they MATCH at Reference size 200% (verse stays full size)", () => {
  for (const h of [16, 30, 48]) {
    const v = bandVersePx(h, 1, 1);
    const r = refPx(h, 1, 2);
    assert.ok(Math.abs(v - r) <= 1, `band ${h}%: verse ${v}px vs ref ${r}px at Reference 200% — should be equal`);
  }
});
check("Verse size 100% does NOT match — the old help text was wrong", () => {
  const v = bandVersePx(30, 1, 1), r = refPx(30);
  assert.ok(v !== r, "if these are equal the factors changed and the help text needs rewriting again");
});

console.log("\nthe factors the help text depends on:");
check("BAND_VERSE_PX_FACTOR is still exactly 2x the reference factor", () => {
  assert.equal(BAND_VERSE_PX_FACTOR, REF_FACTOR * 2,
    "the verse/reference factors diverged — the help text's 50% / 200% is now wrong");
});
check("SlideRenderer still uses 0.11 for the reference", () => {
  const src = readFileSync(new URL("../src/components/live/SlideRenderer.tsx", import.meta.url), "utf8");
  assert.match(src, /const refPx = Math\.round\(\(bandH \/ 100\) \* 1080 \* 0\.11 \*/,
    "the reference px formula changed — re-derive the help text numbers before shipping");
});

console.log("\nthe help text tells the truth:");
check("it no longer claims 100% matches", () => {
  const src = readFileSync(new URL("../src/components/operator/scripture/ScriptureSlideEditor.tsx", import.meta.url), "utf8");
  assert.ok(!/set the verse to 100% to match the reference/.test(src),
    "the incorrect 100% guidance came back — an operator following it can never get a match");
});
check("it states BOTH correct routes (50% verse, or 200% reference)", () => {
  const src = readFileSync(new URL("../src/components/operator/scripture/ScriptureSlideEditor.tsx", import.meta.url), "utf8");
  assert.match(src, /Verse size 50%/, "the 50% route is missing");
  assert.match(src, /Reference size 200%/, "the 200% route is missing (the one that keeps the verse big)");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
