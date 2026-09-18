/**
 * Fonts P1 — AutoFitText fit-cache keys carry the FONT STATE (2026-09-17).
 *
 * Regression: only the PROJECTOR cache key carried the font-state tokens. The
 * OTHER key — the one theme text boxes use (SlideRenderer :180 / :412, and
 * themes are default-on for every church) — did not. So a size measured against
 * the FALLBACK face was cached and then reused once the real face arrived. The
 * real face is wider, so the cached size was too large (reviewer measured up to
 * +23px) and the last line of a lyric got cut off — the exact class of bug that
 * "lyrics never clip" (PR #29, 2026-09-16) exists to prevent.
 *
 * Contract: a fitted size is only valid for the font it was measured with, so
 * BOTH keys must change when the font state changes.
 *
 * Run: npx tsx test/autofit-font-cache-key.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fontStateSuffix } from "../src/components/live/AutoFitText";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "src/components/live/AutoFitText.tsx"), "utf8");

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

check("a fallback-face measurement can never be reused for the real face", () => {
  // c0 = the element's face is NOT loaded yet; c1 = it is. Different state must
  // mean a different cache entry.
  const whileFallback = fontStateSuffix("Sora|700", "f0", "c0");
  const whenReal = fontStateSuffix("Sora|700", "f1", "c1");
  assert.notEqual(whileFallback, whenReal);
});

check("every distinct font state yields a distinct key segment", () => {
  const seen = new Set<string>();
  for (const settled of ["f0", "f1", "fx"]) {
    for (const face of ["c0", "c1", "cx", ""]) {
      for (const token of ["Sora|700", "Georgia|400"]) seen.add(fontStateSuffix(token, settled, face));
    }
  }
  assert.equal(seen.size, 3 * 4 * 2);
});

check("the same font state is stable (repeat slides still cache-hit)", () => {
  assert.equal(fontStateSuffix("Sora|700", "f1", "c1"), fontStateSuffix("Sora|700", "f1", "c1"));
});

check("BOTH cache keys are built through fontStateSuffix (neither path opts out)", () => {
  const uses = SRC.match(/fontStateSuffix\(fontToken, fontsSettledToken\(\), faceReadyToken\(/g) ?? [];
  assert.equal(uses.length, 2, `expected both cache keys to use the helper, found ${uses.length}`);
  // The projector key and the generic key are the only two fitCacheGet CALL
  // sites (the `function fitCacheGet(` definition is excluded).
  const reads = SRC.match(/(?<!function )fitCacheGet\(/g) ?? [];
  assert.equal(reads.length, 2, `fit-cache read sites changed (${reads.length}) — each new one needs the font state`);
});

check("the font-state tokens react to real font readiness, not just fonts.status", () => {
  // faceReadyToken exists and is per-ELEMENT: document.fonts.status can say
  // "loaded" while THIS slide's specific face is still missing, which is how the
  // fallback measurement slipped through before.
  assert.ok(/function faceReadyToken\(el: HTMLElement \| null, sample: string\)/.test(SRC));
  assert.ok(/document\.fonts\.check\(spec, sample/.test(SRC));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
