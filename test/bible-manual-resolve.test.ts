/**
 * Increment 2 of the Bible-detection rebuild (2026-08-25): manual typed-bar
 * resolution. Verifies book-less refs anchor to the open chapter (F1), chapter
 * ranges don't silently collapse (F2), mistyped books surface a "did you mean"
 * suggestion (DYM), and anything non-reference falls back to phrase search
 * (never a dead-end).
 *
 * Run: npx tsx test/bible-manual-resolve.test.ts
 */
import assert from "node:assert/strict";
import { resolveManualReference, type ManualContext } from "../src/lib/bible-manual-resolve";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}

const JOHN3: ManualContext = { book: "John", chapter: 3 };

function expectRef(input: string, ctx: ManualContext, book: string, ch: number, vS: number, vE: number) {
  const r = resolveManualReference(input, ctx);
  assert.equal(r.kind, "ref", `kind for ${JSON.stringify(input)} (got ${r.kind})`);
  if (r.kind !== "ref") return;
  assert.equal(r.ref.book, book, `book for ${JSON.stringify(input)}`);
  assert.equal(r.ref.chapter, ch, `chapter for ${JSON.stringify(input)}`);
  assert.equal(r.ref.verseStart, vS, `verseStart for ${JSON.stringify(input)}`);
  assert.equal(r.ref.verseEnd, vE, `verseEnd for ${JSON.stringify(input)}`);
}

console.log("Full references still parse (no regression):");
test('"John 3:16"', () => expectRef("John 3:16", null, "John", 3, 16, 16));
test('"Psalm 23"', () => expectRef("Psalm 23", null, "Psalms", 23, 1, 1));
test('"1 Cor 13:4-7"', () => expectRef("1 Cor 13:4-7", null, "1 Corinthians", 13, 4, 7));

console.log("F1 — book-less forms anchor to the open chapter:");
test('"verse 16" @ John 3 → John 3:16', () => expectRef("verse 16", JOHN3, "John", 3, 16, 16));
test('":16" @ John 3 → John 3:16', () => expectRef(":16", JOHN3, "John", 3, 16, 16));
test('"verses 16 to 18" @ John 3 → John 3:16-18', () => expectRef("verses 16 to 18", JOHN3, "John", 3, 16, 18));
test('"3:16" (no book) @ John 3 → John 3:16', () => expectRef("3:16", JOHN3, "John", 3, 16, 16));
test('"5:5-7" (no book) @ John 3 → John 5:5-7', () => expectRef("5:5-7", JOHN3, "John", 5, 5, 7));
test('":1-3" (leading-colon range) @ John 3 → John 3:1-3', () => expectRef(":1-3", JOHN3, "John", 3, 1, 3));
test('"verse 16" with NO context → phrase (cannot anchor)', () => {
  assert.equal(resolveManualReference("verse 16", null).kind, "phrase");
});

console.log("F2 — chapter range loads start chapter, not a silent collapse:");
test('"Matthew 5 to 7" → whole Matthew 5 + note', () => {
  const r = resolveManualReference("Matthew 5 to 7", null);
  assert.equal(r.kind, "ref");
  if (r.kind === "ref") {
    assert.equal(r.ref.book, "Matthew");
    assert.equal(r.ref.chapter, 5);
    assert.equal(r.ref.verseStart, 1);
    assert.ok(r.ref.verseEnd >= 999, "loads whole start chapter");
    assert.ok(r.note && /5.*7|range/i.test(r.note), "carries an explanatory note");
  }
});
test('"John 3:16 to 18" is a VERSE range, not a chapter range', () =>
  expectRef("John 3:16 to 18", null, "John", 3, 16, 18));

console.log("Mistyped single-word books resolve DIRECTLY (parser fuzzy path):");
test('"Jhn 3:16" → John 3:16', () => expectRef("Jhn 3:16", null, "John", 3, 16, 16));
test('"filipians 4:13" → Philippians 4:13', () => expectRef("filipians 4:13", null, "Philippians", 4, 13, 13));

console.log("DYM — book the inline parser can't reach → confirmable suggestion:");
test('"song of solmon 3:1" → suggest Song of Solomon 3:1', () => {
  const r = resolveManualReference("song of solmon 3:1", null);
  assert.equal(r.kind, "suggest", `got ${r.kind}`);
  if (r.kind === "suggest") { assert.equal(r.ref.book, "Song of Solomon"); assert.match(r.message, /did you mean/i); }
});

console.log("Fallback — plain phrases go to phrase search:");
for (const q of ["the good shepherd", "love is patient", "faith hope love"]) {
  test(`"${q}" → phrase`, () => assert.equal(resolveManualReference(q, JOHN3).kind, "phrase"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
