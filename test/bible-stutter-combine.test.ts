// Cross-segment stutter combine — a preacher pausing between the book name and
// the numbers splits into two ASR segments; combineStutteredReference re-joins
// them. Verifies real splits combine AND ordinary speech never false-fires.
import { combineStutteredReference } from "../src/lib/bible-parser";

let passed = 0;
let failed = 0;

function refKey(prev: string, cur: string): string {
  const refs = combineStutteredReference(prev, cur);
  if (refs.length === 0) return "";
  const r = refs[0];
  return `${r.book} ${r.chapter}:${r.verseStart}${r.verseEnd !== r.verseStart ? "-" + r.verseEnd : ""}`;
}

function expect(prev: string, cur: string, want: string) {
  const got = refKey(prev, cur);
  if (got === want) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: combine("${prev}", "${cur}") => "${got}" (expected "${want}")`);
  }
}

// ── Real stuttered splits SHOULD combine ─────────────────────────────────────
expect("First Corinthians", "2 4", "1 Corinthians 2:4");
expect("1 Corinthians", "2:4", "1 Corinthians 2:4");
expect("first corinthians", "two four", "1 Corinthians 2:4");
expect("Romans", "chapter eight verse one", "Romans 8:1");
expect("in Romans", "8 28", "Romans 8:28");
expect("the book of John", "3 16", "John 3:16");
expect("Genesis", "1 1", "Genesis 1:1");
expect("Psalm", "23", "Psalms 23:1"); // whole-chapter → verse 1
expect("corintians", "two four", "1 Corinthians 2:4"); // ASR misheard book

// ── Ordinary speech / invalid combos MUST NOT fire ───────────────────────────
expect("my brother John", "25 years old", ""); // prev not a bare book
expect("the umbrella", "2 4", ""); // "umbrella" isn't a book
expect("Mark", "25 years old", ""); // Mark has 16 chapters → invalid, rejected
expect("Romans", "he was faithful", ""); // cur doesn't lead with a number
expect("we continue", "in a moment", ""); // neither is a reference
expect("John", "loves everyone", ""); // cur not numeric
expect("", "2 4", ""); // empty prev
expect("Romans", "", ""); // empty cur

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
