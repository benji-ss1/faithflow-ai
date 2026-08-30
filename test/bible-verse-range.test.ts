/**
 * Verse-range validity + sentence-boundary (2026-08-30 field bugs).
 *  A) Full stop: "…be like 2. John 4 7" must read the valid John 4:7, NOT glue
 *     the sentence-ending "2" onto "John" to make the invalid "2 John 4:7".
 *  B) Verse-range: an out-of-range verse ("Romans 8:80" — Romans 8 has 39 verses)
 *     must NOT parse to a detection. Data-driven across all 66 books.
 *
 * Run: npx tsx test/bible-verse-range.test.ts
 */
import assert from "node:assert/strict";
import { parseReference, parseReferences } from "../src/lib/bible-parser";
import { isValidVerse } from "../src/lib/bible-chapter-verses";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}
function expect(input: string, ref: string | null) {
  const r = parseReference(input);
  const got = r ? `${r.book} ${r.chapter}:${r.verseStart}` : null;
  assert.equal(got, ref, `${JSON.stringify(input)}`);
}

console.log("Sentence-boundary (full stop breaks number↔book glue):");
test('"be like 2. John 4 7" → John 4:7 (not 2 John)', () => expect("be like 2. John 4 7", "John 4:7"));
test('"go to 3. Corinthians 4 7" → the trailing 3 does not glue', () => {
  // "3 Corinthians" isn't a book; without the guard "3. Corinthians" could try to bind — must not produce a 3-Corinthians ref.
  const r = parseReference("go to 3. Corinthians 4 7");
  assert.ok(r === null || r.book !== "3 Corinthians", "must not form a bogus 3 Corinthians");
});
test('"1 Cor. 4:7" → 1 Corinthians 4:7 (abbreviation period kept)', () => expect("1 Cor. 4:7", "1 Corinthians 4:7"));
test('"2 John 1:7" → 2 John 1:7 (real numbered book, no interior period)', () => expect("2 John 1:7", "2 John 1:7"));
test('"John 3:16. Romans 8:1" → both refs survive', () => {
  const rs = parseReferences("John 3:16. Romans 8:1");
  const set = rs.map((r) => `${r.book} ${r.chapter}:${r.verseStart}`);
  assert.ok(set.includes("John 3:16"), "John 3:16 present");
  assert.ok(set.includes("Romans 8:1"), "Romans 8:1 present");
});

console.log("\nVerse-range validity (out-of-range verses rejected):");
test('"Romans 8:80" → null (Romans 8 has 39 verses)', () => expect("Romans 8:80", null));
test('"Romans 8:18" → Romans 8:18 (valid)', () => expect("Romans 8:18", "Romans 8:18"));
test('"Genesis 1:32" → null (Genesis 1 has 31 verses)', () => expect("Genesis 1:32", null));
test('"Genesis 1:31" → Genesis 1:31 (valid)', () => expect("Genesis 1:31", "Genesis 1:31"));
test('"Psalms 119:177" → null (Psalm 119 has 176 verses)', () => expect("Psalms 119:177", null));
test('"Psalms 119:176" → Psalms 119:176 (valid)', () => expect("Psalms 119:176", "Psalms 119:176"));

console.log("\nisValidVerse — data-driven, unknown fails open:");
test("isValidVerse: Romans 8:39 true, 8:40 false", () => {
  assert.equal(isValidVerse("Romans", 8, 39), true);
  assert.equal(isValidVerse("Romans", 8, 40), false);
});
test("isValidVerse: verse <= 0 always false", () => assert.equal(isValidVerse("John", 3, 0), false));
test("isValidVerse: unknown book fails open (true)", () => assert.equal(isValidVerse("Nonexistent", 1, 999), true));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
