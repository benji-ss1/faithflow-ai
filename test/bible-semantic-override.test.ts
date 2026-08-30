/**
 * Semantic-override decision (2026-08-30 Revelation → Romans field bug).
 * The live bridge used to let a pgvector hit overwrite the parser's BOOK when
 * parser confidence was low — so "Revelation 21:4" (parsed correctly but at
 * conf 55) got relabelled Romans because a Romans verse containing the word
 * "revelation" was the top vector hit. decideSemanticOverride() now preserves a
 * valid parser book and only refines chapter/verse when the hit AGREES on book.
 *
 * Run: npx tsx test/bible-semantic-override.test.ts
 */
import assert from "node:assert/strict";
import { decideSemanticOverride, type SemanticHit, type ParserPosition } from "../src/lib/bible-semantic-override";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}
// distance for a desired similarity: sim = round((1-distance)*100) → distance = 1 - sim/100
const dist = (sim: number) => 1 - sim / 100;
const parser = (book: string, chapter: number, v: number, confidence: number): ParserPosition =>
  ({ book, chapter, verseStart: v, verseEnd: v, confidence });
const hit = (book: string, chapter: number, verse: number, sim: number): SemanticHit =>
  ({ book, chapter, verse, distance: dist(sim) });

console.log("The field bug: a cross-book vector hit must NOT relabel the book:");
test('Revelation 21:4 (conf 55) + Romans top hit (sim 60) → stays Revelation 21:4', () => {
  const r = decideSemanticOverride(parser("Revelation", 21, 4, 55), hit("Romans", 16, 25, 60));
  assert.equal(r.book, "Revelation");
  assert.equal(r.chapter, 21);
  assert.equal(r.vs, 4);
  assert.equal(r.action, "keep-parser-book");
});

console.log("\nSame-book vector hit may refine chapter/verse:");
test('Romans 4:4 (conf 55) + Romans 4:18 hit (sim 60) → refined to Romans 4:18', () => {
  const r = decideSemanticOverride(parser("Romans", 4, 4, 55), hit("Romans", 4, 18, 60));
  assert.equal(r.book, "Romans");
  assert.equal(r.chapter, 4);
  assert.equal(r.vs, 18);
  assert.equal(r.action, "refine-position");
});

console.log("\nParser had NO valid book → trust the vector hit fully:");
test('unknown book (conf 50) + Romans 8:28 hit (sim 60) → full override to Romans 8:28', () => {
  const r = decideSemanticOverride(parser("Zxqbook", 1, 1, 50), hit("Romans", 8, 28, 60));
  assert.equal(r.book, "Romans");
  assert.equal(r.chapter, 8);
  assert.equal(r.vs, 28);
  assert.equal(r.action, "full-override");
});

console.log("\nOverride gates unchanged (weak hit / confident parser / no hit):");
test('weak semantic hit (sim 40) → no override, position kept', () => {
  const r = decideSemanticOverride(parser("Revelation", 21, 4, 55), hit("Romans", 16, 25, 40));
  assert.equal(r.book, "Revelation");
  assert.equal(r.action, "none");
});
test('confident parser (conf 80) → no override even on strong same-issue hit', () => {
  const r = decideSemanticOverride(parser("Revelation", 21, 4, 80), hit("Romans", 16, 25, 90));
  assert.equal(r.book, "Revelation");
  assert.equal(r.action, "none");
});
test('no vector hit (undefined) → unchanged', () => {
  const r = decideSemanticOverride(parser("Revelation", 21, 4, 55), undefined);
  assert.equal(r.book, "Revelation");
  assert.equal(r.confidence, 55);
  assert.equal(r.action, "none");
});

console.log("\nConfidence blend preserved (never lower, capped at 95):");
test('conf 55 + sim 60 hit blends up but stays <= 95', () => {
  const r = decideSemanticOverride(parser("Revelation", 21, 4, 55), hit("Romans", 16, 25, 60));
  assert.ok(r.confidence >= 55, "never lowers confidence");
  assert.ok(r.confidence <= 95, "capped at 95");
});
test('blend runs even when the position is NOT overridden (action "none")', () => {
  // conf 80 (>=75 so no position override) + sim 90 → confidence still blends up.
  const r = decideSemanticOverride(parser("Revelation", 21, 4, 80), hit("Romans", 16, 25, 90));
  assert.equal(r.action, "none");
  assert.equal(r.book, "Revelation", "book untouched");
  assert.equal(r.confidence, 86, "blend runs regardless: round(0.6*90 + 0.4*80) = 86");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
