/**
 * "The preview is quivering / fighting itself" — field report 2026-09-22 (Victor).
 *
 * ONE element, not two: its font size alternated between a collapsed value and
 * the correct one, re-wrapping every line on each flip, which reads as ghosted
 * or duplicated text. It happened on EVERY theme (not theme-specific) and never
 * reached the projector.
 *
 * Cause: `pad` is React STATE, so `setPad(padPx)` lands on the NEXT commit — but
 * the fit measures the LIVE DOM, whose usable width comes from the padding
 * currently painted (initially the useState(4) seed). The binary search tested
 * against the NEW padding while the text was laid out against the OLD one, so
 * nothing "fit" and the size collapsed toward the floor; the next pass, with the
 * padding settled, fitted far larger. The projector branch is immune because it
 * PINS `t.style.width` before measuring.
 *
 * jsdom has no layout engine, so these are source contracts on the invariants
 * that make the bug impossible, not pixel assertions.
 *
 * Run: npx tsx test/autofit-quiver.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const AF = read("../src/components/live/AutoFitText.tsx");
const FT = read("../src/components/live/FittedText.tsx");

console.log("the fit must measure against the padding it assumes:");
check("padding is written to the DOM imperatively, not left to React state", () => {
  assert.match(AF, /box\.style\.paddingLeft = `\$\{padPx\}px`/,
    "the fit sets padding via setPad only — it will measure against the PREVIOUS frame's padding and collapse the size");
  assert.match(AF, /box\.style\.paddingRight = `\$\{padPx\}px`/);
});
check("it honours the top/bottom doubling used for camera-aligned text", () => {
  assert.match(AF, /box\.style\.paddingTop = `\$\{padPx \+ \(verticalAlign === "top" \? padPx : 0\)\}px`/,
    "imperative padding disagrees with the JSX padding, so the two would fight");
  assert.match(AF, /box\.style\.paddingBottom = `\$\{padPx \+ \(verticalAlign === "bottom" \? padPx : 0\)\}px`/);
});
check("the imperative write happens BEFORE bw/bh are derived", () => {
  const i = AF.indexOf("box.style.paddingLeft");
  const j = AF.indexOf("const bw = measW - padPx * 2;");
  assert.ok(i > 0 && j > 0 && i < j, "padding is applied after the box maths — the fit still measures stale padding");
});
check("React state and the imperative write agree on the same value", () => {
  // Both must derive from padPx; a divergence reintroduces the oscillation.
  assert.match(AF, /const padPx = Math\.max\(4, Math\.min\(48, Math\.round\(Math\.min\(measW, measH\) \* paddingRatio\)\)\);/);
  assert.match(AF, /setPad\(padPx\);/);
});
check("the projector branch still pins its width (why it never had this bug)", () => {
  assert.match(AF, /t\.style\.width = /, "the projector's width pin is gone — it would become vulnerable too");
});
check("the projector cache guard is untouched", () => {
  assert.match(AF, /if \(cachedProj !== undefined && cachedProj > 8 && !fitsAt\(cachedProj\)\)/,
    "the projector's never-trust-a-stale-cached-size guard was removed");
});

console.log("\nFittedText: a resize must RE-FIT, not discard the fit:");
check("the ResizeObserver bumps a tick instead of resetting the scale", () => {
  assert.ok(!/setScale\(\(s\) => \(s === 1 \? 1\.0000001 : 1\)\)/.test(FT),
    "the resize handler still THROWS AWAY the fitted multiplier and never re-fits");
  assert.match(FT, /setResizeTick\(\(n\) => n \+ 1\)/, "no re-fit trigger on resize");
});
check("the fit effect actually depends on that tick", () => {
  assert.match(FT, /\}, \[key, mode, resizeTick\]\);/,
    "resizeTick is not a dep, so bumping it does nothing and the fit never recomputes");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
