/**
 * 3-digit chapter glitch (2026-08-25 field video). Speakers spell out a 3-digit
 * chapter (Psalms go to 150) with GAPS — "Psalm 1 4 3 verse 9", "Psalm one forty
 * three" — and Deepgram transcribes the digits separated. The parser used to grab
 * the first two digits ("1 5" → chapter 1 verse 5) and strand the third, or sum a
 * word form wrong ("one forty three" → 44). Two fixes: normalize() concatenates a
 * run of EXACTLY 3 single digits ("1 4 3"→"143"), and wordsToNumber() reads the
 * colloquial "one forty three" as 1|43 = 143. Critically, a NORMAL chapter+verse
 * (2 tokens, e.g. "John 3 16", "Isaiah 5 3") must be untouched.
 *
 * Run: npx tsx test/bible-multidigit-chapter.test.ts
 */
import assert from "node:assert/strict";
import { parseReference, wordsToNumber } from "../src/lib/bible-parser";

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
function expectNull(input: string) {
  assert.equal(parseReference(input), null, `${JSON.stringify(input)} should not resolve`);
}

console.log("wordsToNumber — colloquial 3-digit reading:");
test('"one forty three" → 143', () => assert.equal(wordsToNumber("one forty three"), 143));
test('"one nineteen" → 119', () => assert.equal(wordsToNumber("one nineteen"), 119));
test('"one four three" (digit-spell) → 143', () => assert.equal(wordsToNumber("one four three"), 143));
test('"one hundred forty three" → 143 (compound untouched)', () => assert.equal(wordsToNumber("one hundred forty three"), 143));
test('"twenty three" → 23 (not a leading single digit)', () => assert.equal(wordsToNumber("twenty three"), 23));
test('"one fifty" → 150', () => assert.equal(wordsToNumber("one fifty"), 150));

console.log("3-digit chapter spoken with gaps resolves correctly:");
test('"Psalm 1 4 3 verse 9" → Psalms 143:9', () => expect("Psalm 1 4 3 verse 9", "Psalms", 143, 9));
test('"Psalm 1 5 0" → Psalms 150 (whole chapter)', () => expect("Psalm 1 5 0", "Psalms", 150, 1));
test('"Psalm 1 0 7" → Psalms 107', () => expect("Psalm 1 0 7", "Psalms", 107, 1));
test('"Psalm one forty three verse nine" → Psalms 143:9', () => expect("Psalm one forty three verse nine", "Psalms", 143, 9));
test('"Psalm 1 1 9 verse 105" → Psalms 119:105', () => expect("Psalm 1 1 9 verse 105", "Psalms", 119, 105));
test('"Psalm one four three" → Psalms 143', () => expect("Psalm one four three", "Psalms", 143, 1));
test('"let us turn to Psalm 1 4 3 verse 9" (in a sentence)', () => expect("let us turn to Psalm 1 4 3 verse 9", "Psalms", 143, 9));

console.log("Normal chapter+verse (2 tokens) must NOT be fused:");
test('"John 3 16" → John 3:16 (not John 316)', () => expect("John 3 16", "John", 3, 16));
test('"Isaiah 5 3" → Isaiah 5:3 (not Isaiah 53)', () => expect("Isaiah 5 3", "Isaiah", 5, 3));
test('"Genesis 1 1" → Genesis 1:1', () => expect("Genesis 1 1", "Genesis", 1, 1));
test('"Matthew 5 5" → Matthew 5:5', () => expect("Matthew 5 5", "Matthew", 5, 5));
test('"Psalm 1 verse 4" → Psalms 1:4 (explicit verse preserved)', () => expect("Psalm 1 verse 4", "Psalms", 1, 4));
test('"Revelation 2 1 verse 4" → Revelation 21:4', () => expect("Revelation 2 1 verse 4", "Revelation", 21, 4));

console.log("Garbage / invalid multi-digit rejected (no false projection):");
test('"Psalm 1425627" (garbage fusion) → no reference', () => expectNull("Psalm 1425627"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
