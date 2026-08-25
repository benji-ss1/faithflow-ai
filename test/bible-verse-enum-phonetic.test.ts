/**
 * Increment 1 of the Bible-detection rebuild (2026-08-25):
 *  (F3) verse-enumeration "verse(s) N and M" must resolve as a verse RANGE,
 *       not drop the second verse — while the spoken chapter:verse separator
 *       "and" ("John 3 and 16" → John 3:16) is preserved.
 *  (Phonetic) an accent-tuned Metaphone-lite fallback resolves book names that
 *       are 3+ edits from the correct spelling ("sekaraya" → Zechariah), with
 *       an unambiguous-key rule + stopwords so common speech never false-fires.
 *
 * Run: npx tsx test/bible-verse-enum-phonetic.test.ts
 */
import assert from "node:assert/strict";
import { parseReference, knownBook, extractCorrections } from "../src/lib/bible-parser";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}

function expectRef(input: string, book: string, chapter: number, vStart: number, vEnd: number | null) {
  const r = parseReference(input);
  assert.ok(r, `expected a reference for ${JSON.stringify(input)}, got null`);
  assert.equal(r!.book, book, `book for ${JSON.stringify(input)}`);
  assert.equal(r!.chapter, chapter, `chapter for ${JSON.stringify(input)}`);
  assert.equal(r!.verseStart, vStart, `verseStart for ${JSON.stringify(input)}`);
  if (vEnd !== null) assert.equal(r!.verseEnd, vEnd, `verseEnd for ${JSON.stringify(input)}`);
}

console.log("F3 — verse enumeration resolves as a range:");
test('"Psalm 23 verses 1 and 2" → Psalms 23:1-2', () => expectRef("Psalm 23 verses 1 and 2", "Psalms", 23, 1, 2));
test('"John 3 verses 16 and 17" → John 3:16-17', () => expectRef("John 3 verses 16 and 17", "John", 3, 16, 17));
test('"Psalm 23 verses one and two" (word form) → Psalms 23:1-2', () => expectRef("Psalm 23 verses one and two", "Psalms", 23, 1, 2));
test('"John 3 verse 16 and verse 17" (repeated word) → John 3:16-17', () => expectRef("John 3 verse 16 and verse 17", "John", 3, 16, 17));
test('"Genesis 1 verses 1 and 3" → Genesis 1:1-3', () => expectRef("Genesis 1 verses 1 and 3", "Genesis", 1, 1, 3));

test('"verses 2 and 1" (out of order) → 1-2, never inverted', () => expectRef("Psalm 23 verses 2 and 1", "Psalms", 23, 1, 2));

console.log("F3 — spoken chapter:verse 'and' separator is NOT a verse range:");
test('"John 3 and 16" stays John 3:16', () => expectRef("John 3 and 16", "John", 3, 16, 16));
test('"Romans 8 and 8" stays Romans 8:8', () => expectRef("Romans 8 and 8", "Romans", 8, 8, 8));

console.log("Phonetic-ONLY names resolve on the opt-in typed path, NOT by default:");
// These are 3+ edits from any variant — edit-distance misses them, so they
// resolve ONLY via the phonetic fallback (allowPhonetic:true). By default (the
// live path) they must return nothing — the 🔴 fix.
const phonOnly: Array<[string, string]> = [
  ["sekaraya", "Zechariah"], ["sakaria", "Zechariah"], ["koloshans", "Colossians"], ["filimon", "Philemon"],
];
for (const [w, book] of phonOnly) {
  test(`"${w}" → ${book} (typed, opt-in)`, () => assert.equal(knownBook(w, { allowPhonetic: true }), book));
  test(`"${w}" → no book by default (live path)`, () => assert.equal(knownBook(w), undefined));
}

console.log("Near-miss names still resolve via pre-existing edit-distance (both paths):");
// Within edit-distance of a variant — resolve on BOTH default and opt-in
// (unchanged, pre-existing behaviour; listed to document they are NOT phonetic).
const phonEdit: Array<[string, string]> = [
  ["filipiyans", "Philippians"], ["jenesis", "Genesis"], ["habakuk", "Habakkuk"], ["nyumbers", "Numbers"],
];
for (const [w, book] of phonEdit) {
  test(`"${w}" → ${book} (edit-distance, default)`, () => assert.equal(knownBook(w), book));
}

console.log("Live path is phonetic-free — ordinary speech never resolves to a book (default):");
// The reviewer/stress false-positive family: these resolve to a book ONLY via
// phonetic. With phonetic default-off, the live path (knownBook with no opts,
// the live fuzzy patterns, extractCorrections) must return nothing.
const negatives = [
  "sister", "sisters", "brother", "matter", "matters", "issachar", "history",
  "auditorium", "agency", "airman", "austere", "worship", "praise", "preacher",
  "message", "prophet", "believer", "salvation",
];
for (const w of negatives) {
  test(`"${w}" → no book (live/default)`, () => assert.equal(knownBook(w), undefined));
}
// "matter"/"sister"/"issachar" are stopworded, so they stay clean even on the
// opt-in typed path.
for (const w of ["matter", "matters", "sister", "issachar"]) {
  test(`"${w}" → no book even opt-in (stopword)`, () => assert.equal(knownBook(w, { allowPhonetic: true }), undefined));
}

console.log("extractCorrections (live correction chips) never false-fires on ordinary speech:");
test("preaching sentence yields no book corrections", () => {
  const corr = extractCorrections("the minister shared a testimony and the whole auditorium said amen no matter what");
  const books = corr.map((c) => c.corrected);
  assert.deepEqual(books, [], `unexpected corrections: ${JSON.stringify(corr)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
