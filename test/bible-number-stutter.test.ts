/**
 * Number STUTTER collapse (2026-08-30 field service). African-Pentecostal
 * preachers restate a reference and stutter the number — "Romans four four
 * eighteen" (the "four" repeated). The parser used to bind the first two number
 * atoms as chapter:verse → Romans 4:4, stranding the "18", and that WRONG ref
 * then overwrote the correct live verse. normalize() now collapses a run of THREE
 * adjacent number tokens whose first two are numerically equal down to two
 * ("four four eighteen" → "four eighteen" → 4:18). Critically, a genuine
 * two-token chapter:verse ("Genesis one one" = 1:1) and an explicit-marker
 * repeat ("Romans four verse four" = 4:4) must be UNTOUCHED.
 *
 * Run: npx tsx test/bible-number-stutter.test.ts
 */
import assert from "node:assert/strict";
import { parseReference } from "../src/lib/bible-parser";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}
function expect(input: string, book: string, chapter: number, verse: number) {
  const r = parseReference(input);
  assert.ok(r, `expected a reference for ${JSON.stringify(input)}, got null`);
  assert.equal(r!.book, book, `book for ${JSON.stringify(input)}`);
  assert.equal(r!.chapter, chapter, `chapter for ${JSON.stringify(input)}`);
  assert.equal(r!.verseStart, verse, `verse for ${JSON.stringify(input)}`);
}
function expectNotChapterVerse(input: string, book: string, chapter: number, verse: number) {
  // The parse must NOT resolve to this specific (wrong) reference. Null is fine;
  // any OTHER reference is fine; only the named wrong ref is a failure.
  const r = parseReference(input);
  const isWrong = !!r && r.book === book && r.chapter === chapter && r.verseStart === verse;
  assert.ok(!isWrong, `${JSON.stringify(input)} must NOT resolve to ${book} ${chapter}:${verse}, but did`);
}
function expectRange(input: string, book: string, chapter: number, vStart: number, vEnd: number) {
  const r = parseReference(input);
  assert.ok(r, `expected a reference for ${JSON.stringify(input)}, got null`);
  assert.equal(r!.book, book, `book for ${JSON.stringify(input)}`);
  assert.equal(r!.chapter, chapter, `chapter for ${JSON.stringify(input)}`);
  assert.equal(r!.verseStart, vStart, `verseStart for ${JSON.stringify(input)}`);
  assert.equal(r!.verseEnd, vEnd, `verseEnd for ${JSON.stringify(input)}`);
}

console.log("Stuttered number collapses to the intended reference:");
test('"Romans four four eighteen" → Romans 4:18 (the field bug)', () => expect("Romans four four eighteen", "Romans", 4, 18));
test('"Romans 4 4 18" (digit form) → Romans 4:18', () => expect("Romans 4 4 18", "Romans", 4, 18));
test('"Romans chapter four four eighteen" → Romans 4:18', () => expect("Romans chapter four four eighteen", "Romans", 4, 18));
test('"John three three sixteen" → John 3:16', () => expect("John three three sixteen", "John", 3, 16));
test('"Romans four four four eighteen" (triple stutter) → Romans 4:18', () => expect("Romans four four four eighteen", "Romans", 4, 18));
test('in a sentence: "so let\'s go to Romans four four eighteen" → Romans 4:18', () => expect("so let's go to Romans four four eighteen", "Romans", 4, 18));

console.log("\nGenuine two-token chapter:verse must NOT be collapsed:");
test('"Genesis one one" → Genesis 1:1', () => expect("Genesis one one", "Genesis", 1, 1));
test('"Genesis 1 1" → Genesis 1:1', () => expect("Genesis 1 1", "Genesis", 1, 1));
test('"Matthew 5 5" → Matthew 5:5', () => expect("Matthew 5 5", "Matthew", 5, 5));
test('"John 3 16" → John 3:16', () => expect("John 3 16", "John", 3, 16));
test('"Romans four verse four" → Romans 4:4 (explicit marker blocks collapse)', () => expect("Romans four verse four", "Romans", 4, 4));

console.log("\nLegit 3-token chapters (already fused elsewhere) stay correct:");
test('"Psalm one one nine" → Psalms 119', () => expect("Psalm one one nine", "Psalms", 119, 1));
test('"Psalm 1 1 9 verse 105" → Psalms 119:105', () => expect("Psalm 1 1 9 verse 105", "Psalms", 119, 105));
test('"Revelation 2 1 verse 4" → Revelation 21:4', () => expect("Revelation 2 1 verse 4", "Revelation", 21, 4));

console.log("\nAfrican whole-reference repetition unaffected:");
test('"John three sixteen, John three sixteen" → John 3:16', () => expect("John three sixteen, John three sixteen", "John", 3, 16));

console.log("\nDocumented safe limits (must never produce the WRONG ref):");
test('single-digit-verse stutter "Romans four four seven" does NOT become Romans 4:4', () => expectNotChapterVerse("Romans four four seven", "Romans", 4, 4));
test('connective range "Genesis eleven eleven to eighteen" stays the 11:11-18 range (not collapsed)', () => expectRange("Genesis eleven eleven to eighteen", "Genesis", 11, 11, 18));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
