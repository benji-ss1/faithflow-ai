/**
 * Regression: two field bugs (2026-09-06).
 *
 * BUG A — "the first-Corinthians red herring": the fuzzy book matcher defaulted
 * ANY numberless numbered-book name to its "1 " form. "second Corinthians" showed
 * as "second 1 Corinthians" (a correction chip rewrote the bare "corinthians" →
 * "1 Corinthians"), and a stuttered "2 Corinthians" collapsed to "1 Corinthians".
 * The number must be RESPECTED (2 Corinthians stays 2) and a genuinely numberless
 * name must stay AMBIGUOUS — never invented to "1 ".
 *
 * BUG B — natural spoken hundreds: "Psalm a hundred and five verse seven" /
 * "one hundred and forty five" must read as 105 / 145 (the connective "and" and a
 * leading "a" are filler), alongside the already-working digit forms.
 *
 * Run: npx tsx test/bible-second-corinthians-hundreds.test.ts
 */
import assert from "node:assert/strict";
import {
  parseReferences,
  extractCorrections,
  knownBook,
  wordsToNumber,
} from "../src/lib/bible-parser";

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  try {
    assert.deepEqual(got, want);
    passed++;
  } catch {
    failed++;
    console.error(`FAIL: ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  }
}
const ref = (s: string) =>
  parseReferences(s).map((r) => `${r.book} ${r.chapter}:${r.verseStart}${r.verseEnd && r.verseEnd !== r.verseStart ? "-" + r.verseEnd : ""}`);

// ── BUG A: numbered books respect their number, never default to "1 " ─────────
check("second Corinthians parses to 2", ref("second Corinthians 5 17"), ["2 Corinthians 5:17"]);
check("2 Corinthians digit form", ref("2 Corinthians 5:17"), ["2 Corinthians 5:17"]);
check("first Corinthians still 1", ref("first corinthians 13 4"), ["1 Corinthians 13:4"]);
check("second Samuel", ref("second samuel 3 4"), ["2 Samuel 3:4"]);
check("third John", ref("third john 5"), ["3 John 1:5"]);

// No correction chip may INVENT a book number the speaker never said.
check("no chip: bare corinthians", extractCorrections("corinthians"), []);
check("no chip: second corinthians", extractCorrections("in second corinthians we read"), []);

// A numberless numbered-book name is AMBIGUOUS → resolves to nothing (not 1).
check("bare corinthians ambiguous", knownBook("corinthians"), undefined);
check("bare samuel ambiguous", knownBook("samuel"), undefined);
// Single-name books still fuzzy-correct (unchanged behaviour).
check("filippians still Philippians", knownBook("filippians"), "Philippians");
check("isaia still Isaiah", knownBook("isaia"), "Isaiah");
check("john still John", knownBook("john"), "John");

// ── BUG B: natural spoken hundreds ────────────────────────────────────────────
check("wtn a hundred and five", wordsToNumber("a hundred and five"), 105);
check("wtn one hundred and forty five", wordsToNumber("one hundred and forty five"), 145);
check("Psalm a hundred and five verse seven", ref("Psalm a hundred and five verse seven"), ["Psalms 105:7"]);
check("Psalm one hundred and forty five verse one", ref("Psalm one hundred and forty five verse one"), ["Psalms 145:1"]);
// Digit forms the field already relied on stay working.
check("Psalm one four five verse seven", ref("Psalm one four five verse seven"), ["Psalms 145:7"]);
check("Psalm one oh five verse seven", ref("Psalm one oh five verse seven"), ["Psalms 105:7"]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
