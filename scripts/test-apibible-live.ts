// Live end-to-end test of the API.Bible fetch/parse against the REAL API.
// Run: API_BIBLE_KEY=<key> npx tsx scripts/test-apibible-live.ts
//
// Critical pre-Sunday check: every licensed translation must return REAL verse
// TEXT (not just a reference label) for single verses, ranges, cross-chapter,
// poetry, and must correctly report invalid verses as empty.
import { fetchApiBibleVerses, API_BIBLE_TRANSLATIONS } from "../src/lib/server/api-bible";

const KEY = process.env.API_BIBLE_KEY;
if (!KEY) { console.error("Set API_BIBLE_KEY env var"); process.exit(1); }

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? ""); }
}

// Expected substrings (translation-distinct wording) to prove we got the RIGHT
// translation's real text, not an empty slide or the wrong Bible.
const CASES: Array<{ code: string; book: string; ch: number; vs: number; ve: number; chEndVerse?: number; expect: RegExp; label: string }> = [
  { code: "NIV",  book: "John",    ch: 3, vs: 16, ve: 16, expect: /one and only Son/i,      label: "NIV John 3:16" },
  { code: "NKJV", book: "John",    ch: 3, vs: 16, ve: 16, expect: /only begotten Son/i,      label: "NKJV John 3:16" },
  { code: "NLT",  book: "John",    ch: 3, vs: 16, ve: 16, expect: /this is how God loved/i,  label: "NLT John 3:16" },
  { code: "NIV",  book: "John",    ch: 3, vs: 16, ve: 17, expect: /did not send his Son/i,   label: "NIV John 3:16-17 (range)" },
  { code: "NKJV", book: "Psalms",  ch: 23, vs: 1, ve: 1,  expect: /shepherd/i,               label: "NKJV Psalm 23:1 (poetry)" },
  { code: "NLT",  book: "Genesis", ch: 1, vs: 1, ve: 1,   expect: /created the heavens/i,     label: "NLT Genesis 1:1 (OT)" },
  { code: "NIV",  book: "Matthew", ch: 7, vs: 5, ve: 5,   expect: /brother's eye|own eye/i,  label: "NIV Matthew 7:5" },
  { code: "NKJV", book: "Revelation", ch: 22, vs: 21, ve: 21, expect: /grace/i,              label: "NKJV Revelation 22:21 (last verse)" },
  { code: "NLT",  book: "1 Corinthians", ch: 13, vs: 4, ve: 7, expect: /love is patient/i,   label: "NLT 1 Cor 13:4-7 (multi-verse)" },
];

async function main() {
  const byCode = new Map(API_BIBLE_TRANSLATIONS.map((t) => [t.code, t.bibleId]));
  console.log(`Testing ${API_BIBLE_TRANSLATIONS.length} translations: ${API_BIBLE_TRANSLATIONS.map((t) => t.code).join(", ")}\n`);

  for (const c of CASES) {
    const bibleId = byCode.get(c.code);
    if (!bibleId) { check(c.label, false, `no bibleId for ${c.code}`); continue; }
    const verses = await fetchApiBibleVerses(bibleId, KEY!, c.book, c.ch, c.vs, c.ve, `test-${c.code}`);
    if (!verses || verses.length === 0) { check(c.label, false, "returned no verses"); continue; }
    const joined = verses.map((v) => v.text).join(" ");
    const expectedCount = c.ve - c.vs + 1;
    const textOk = c.expect.test(joined);
    const countOk = verses.length === expectedCount;
    const numbersOk = verses.every((v) => v.verse >= c.vs && v.verse <= c.ve);
    const noBracketLeak = !/\[\d+\]/.test(joined); // parser must strip [N] markers
    check(c.label, textOk && countOk && numbersOk && noBracketLeak,
      { got: verses.length, expected: expectedCount, textOk, numbersOk, noBracketLeak, sample: joined.slice(0, 70) });
  }

  // Invalid verse must come back EMPTY (not throw, not fabricate).
  const invalid = await fetchApiBibleVerses(byCode.get("NIV")!, KEY!, "Genesis", 1, 102, 102, "test-invalid");
  check("Invalid verse Genesis 1:102 → empty array (not null, not text)", Array.isArray(invalid) && invalid.length === 0, invalid);

  const invalidBook = await fetchApiBibleVerses(byCode.get("NIV")!, KEY!, "Hesitations", 1, 1, 1, "test-badbook");
  check("Invalid book → null (unmapped book code)", invalidBook === null, invalidBook);

  console.log(`\n${pass} passed · ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
