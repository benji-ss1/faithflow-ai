/**
 * Two field bugs from the live transcript (JPD, 2026-09-24).
 *
 * 1. "Psalm 100 verse 5" reached the transcript as "Psalm a 100 verse 5" — Deepgram
 *    inserts a stray article — and matched NOTHING, because every pattern needs the book
 *    to butt straight up against its number.
 * 2. "longer sentences which have verses within them do not project": the reference was
 *    DETECTED (it showed in the transcript and the chips) but never auto-fired, because
 *    the blend multiplied the parser score by the whole-UTTERANCE confidence. A long
 *    sentence scores lower, so a perfectly-heard reference inside one was dragged under
 *    the 75 auto-fire bar.
 *
 * Run: npx tsx test/audio-verse-in-sentence.test.ts
 */
import assert from "node:assert/strict";
import { parseReferences } from "../src/lib/bible-parser";
import { spanWordConfidence, referenceConfidence, WEAK_WORD } from "../src/lib/ai-detection/word-confidence";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const ref = (t: string) => { const r = parseReferences(t)[0]; return r ? `${r.book} ${r.chapter}:${r.verseStart}` : null; };

console.log("1. the stray article Deepgram inserts:");
check('"Psalm a 100 verse 5" — the exact line from the transcript', () => {
  assert.equal(ref("Psalm a 100 verse 5"), "Psalms 100:5");
});
check("the same gap between chapter and verse, and both at once", () => {
  assert.equal(ref("Psalm 100 a 5"), "Psalms 100:5");
  assert.equal(ref("Psalm a 100 a 5"), "Psalms 100:5");
});
check("it is not specific to Psalms", () => {
  assert.equal(ref("John a 3 verse 16"), "John 3:16");
  assert.equal(ref("Genesis a 1 verse 9"), "Genesis 1:9");
  assert.equal(ref("1 Corinthians a 13 verse 4"), "1 Corinthians 13:4");
});
check('"verse a 5" / "chapter a 3" too', () => {
  assert.equal(ref("John chapter a 3 verse a 16"), "John 3:16");
});

console.log("   …without turning ordinary speech into references:");
for (const t of [
  "give Micah a 5 star review",
  "that took Job a 2 year wait",
  "he gave Ruth a 10 pound note",
  "John had a 3 hour meeting",
  "Mark a passage in your bible",
]) check(`still nothing: "${t}"`, () => assert.equal(ref(t), null));
check("a bare 'Book a N' with nothing after it is deliberately left alone", () => {
  // Indistinguishable from the speech above, so rule 0 says do nothing.
  assert.equal(ref("give Micah a 5"), null);
});
check("'a hundred' is part of the number, not filler", () => {
  assert.equal(ref("Psalm a hundred and five"), "Psalms 105:1");
  assert.equal(ref("Psalm a hundred verse 5"), "Psalms 100:5");
});

console.log("\n2. a reference inside a long sentence:");
const words = (text: string, inRef: number, outRef: number, span: { start: number; end: number }) =>
  (text.match(/\S+/g) ?? []).map((w) => {
    const i = text.indexOf(w);
    return { w, c: i >= span.start && i < span.end ? inRef : outRef };
  });
const SENT = "I want us to look at what the bible says in John 3 verse 16 this morning";
const SPAN = { start: SENT.toLowerCase().indexOf("john 3 verse 16"), end: SENT.toLowerCase().indexOf("john 3 verse 16") + "john 3 verse 16".length };

check("the reference's own words are used, not the whole sentence's average", () => {
  const scoped = spanWordConfidence(SENT, words(SENT, 0.93, 0.70, SPAN), SPAN)!;
  assert.ok(scoped.mean > 0.9, `mean=${scoped.mean}`);
  assert.equal(scoped.count, 4, "john / 3 / verse / 16");
  assert.ok(referenceConfidence(0.80, scoped)! > 0.9, "a clearly-heard reference is no longer penalised by its neighbours");
});
check("it can only ever RAISE the confidence, never lower it", () => {
  const scoped = spanWordConfidence(SENT, words(SENT, 0.72, 0.99, SPAN), SPAN)!;
  assert.equal(referenceConfidence(0.95, scoped), 0.95, "a high utterance score is kept");
});
check("a weakly-heard word inside the reference refuses the rescue", () => {
  const scoped = spanWordConfidence(SENT, words(SENT, 0.40, 0.99, SPAN), SPAN)!;
  assert.ok(scoped.floor < WEAK_WORD);
  assert.equal(referenceConfidence(0.80, scoped), 0.80, "falls back to the utterance score");
});
check("no words, no span, or a word list that doesn't line up → no opinion", () => {
  assert.equal(spanWordConfidence(SENT, undefined, SPAN), null);
  assert.equal(spanWordConfidence(SENT, words(SENT, 0.9, 0.9, SPAN), undefined), null);
  assert.equal(spanWordConfidence(SENT, [{ w: "john", c: 0.9 }], SPAN), null, "count mismatch (the bridge trims long utterances)");
  assert.equal(referenceConfidence(0.83, null), 0.83, "unchanged when we can't tell");
});
check("junk confidences are ignored rather than trusted", () => {
  const w = words(SENT, 0.93, 0.7, SPAN).map((x, i) => (i === 10 ? { ...x, c: NaN } : x));
  const scoped = spanWordConfidence(SENT, w, SPAN);
  assert.ok(scoped === null || Number.isFinite(scoped.mean));
});

console.log("\n   the spoken form counts as well-formed:");
const wellFormed = (m: string) => /\d+\s*:\s*\d+/.test(m) || /\d+\s+verses?\s+\d+/.test(m);
check('"3 verse 16" is as explicit as "3:16" and now gets the same boost', () => {
  assert.equal(wellFormed(parseReferences("John 3 verse 16")[0].matchedText), true);
  assert.equal(wellFormed(parseReferences("John 3:16")[0].matchedText), true);
});
check("a bare chapter is still not well-formed", () => {
  assert.equal(wellFormed(parseReferences("Psalm 23")[0].matchedText), false);
});

console.log("\n3. the auto-fire bar itself is untouched (CLAUDE.md rule 7):");
check("still 75 — nothing here lowers it", () => {
  const src = require("node:fs").readFileSync(new URL("../src/lib/audio-thresholds.ts", import.meta.url), "utf8");
  assert.match(src, /BIBLE_AUTOFIRE_CONFIDENCE = 75/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
