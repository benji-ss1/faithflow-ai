/**
 * Context-gated English number-homophone repair.
 * Run: npx tsx test/bible-homophones.test.ts
 *
 * Verifies that Deepgram's phonetic number mishears are corrected ONLY inside a
 * Bible-reference slot (book + adjacent number), and that ordinary English that
 * merely contains those same words is left completely alone (no false positives).
 */
import assert from "node:assert/strict";
import { parseReference } from "../src/lib/bible-parser";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}

function expectRef(input: string, book: string, chapter: number, verseStart: number | null) {
  const r = parseReference(input);
  assert.ok(r, `expected a reference for "${input}", got null`);
  assert.equal(r!.book, book, `book for "${input}"`);
  assert.equal(r!.chapter, chapter, `chapter for "${input}"`);
  assert.equal(r!.verseStart, verseStart, `verseStart for "${input}"`);
}

console.log("Homophone correction — the real field examples:");
// Directly from the reported failures. Left = what Deepgram wrote.
test('"Judges eleven floor" → Judges 11:4', () => expectRef("Judges eleven floor", "Judges", 11, 4));
test('"John ten tree" → John 10:3', () => expectRef("John ten tree", "John", 10, 3));
test('"Mark five nein" → Mark 5:9', () => expectRef("Mark five nein", "Mark", 5, 9));
test('"Romans eight twenty ate" → Romans 8:28', () => expectRef("Romans eight twenty ate", "Romans", 8, 28));
test('"Genesis won won" → Genesis 1:1', () => expectRef("Genesis won won", "Genesis", 1, 1));
test('"Acts too thirty ate" → Acts 2:38', () => expectRef("Acts too thirty ate", "Acts", 2, 38));
test('"Luke to ten" → Luke 2:10 (leading chapter slot)', () => expectRef("Luke to ten", "Luke", 2, 10));
test('"First Corinthians thirteen fore" → 1 Cor 13:4', () => expectRef("First Corinthians thirteen fore", "1 Corinthians", 13, 4));
test('"Psalm twenty tree" → Psalm 23 (TH path, whole chapter)', () => {
  const r = parseReference("Psalm twenty tree");
  assert.ok(r); assert.equal(r!.book, "Psalms"); assert.equal(r!.chapter, 23); assert.equal(r!.verseEnd, null);
});

console.log("\nNo false positives — ordinary speech must be untouched:");
// "for"/"to"/"floor"/"door" etc. in normal sentences must NOT become numbers.
test('"open the door" → no reference', () => assert.equal(parseReference("open the door"), null));
test('"Romans eight for us who can be against us" → Romans 8 (NOT 8:4)', () => {
  const r = parseReference("Romans eight for us who can be against us");
  assert.ok(r); assert.equal(r!.book, "Romans"); assert.equal(r!.chapter, 8);
  // "for" (preceded by a number, followed by "us") must stay a preposition —
  // whole-chapter ref is verseStart=1/verseEnd=null, NOT verse 4.
  assert.equal(r!.verseStart, 1, "must be whole-chapter, not verse 4");
  assert.equal(r!.verseEnd, null);
});
test('"the truth shall set you free" → no reference', () => assert.equal(parseReference("the truth shall set you free"), null));
test('"he ate the bread" → no reference', () => assert.equal(parseReference("he ate the bread"), null));
test('"Mark the door was open" → Mark only, no verse (door not after a number)', () => {
  // "Mark" is a book AND a name; "door" here has no numeric neighbour.
  const r = parseReference("Mark the door was open");
  assert.equal(r, null, "no chapter number present → not a reference");
});

console.log("\nRanges and connectors must survive (to/through between numbers):");
test('"John three sixteen to eighteen" → John 3:16-18 (range, not 3:16:2:18)', () => {
  const r = parseReference("John three sixteen to eighteen");
  assert.ok(r); assert.equal(r!.book, "John"); assert.equal(r!.chapter, 3);
  assert.equal(r!.verseStart, 16); assert.equal(r!.verseEnd, 18);
});

console.log("\nRegression guard — clean input still parses identically:");
test('"John three sixteen" → John 3:16', () => expectRef("John three sixteen", "John", 3, 16));
test('"Romans 8:28" → Romans 8:28', () => expectRef("Romans 8:28", "Romans", 8, 28));
test('"Psalm 23" → Psalm 23 whole chapter', () => {
  const r = parseReference("Psalm 23"); assert.ok(r); assert.equal(r!.chapter, 23); assert.equal(r!.verseEnd, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
