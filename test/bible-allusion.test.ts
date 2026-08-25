/**
 * Bible allusion detection (Increment 1) — the curated phrase corpus must catch
 * famous phrases preachers quote WITHOUT a reference, and must NOT false-fire on
 * generic worship vocabulary. Run: npx tsx --test test/bible-allusion.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { topPhraseForSpeech, phraseSearch, normalizeForAllusion } from "../src/services/bible/phraseSearch";

function detect(text: string) {
  return topPhraseForSpeech(text);
}

test("catches 'the author and finisher of our faith' → Hebrews 12:2", () => {
  const hit = detect("brothers and sisters we must keep looking unto Jesus the author and finisher of our faith today");
  assert.ok(hit, "should detect an allusion");
  assert.equal(hit!.entry.reference, "Hebrews 12:2");
});

test("catches 'I am that I am' → Exodus 3:14", () => {
  const hit = detect("when Moses asked his name God simply said I am that I am");
  assert.ok(hit, "should detect an allusion");
  assert.equal(hit!.entry.reference, "Exodus 3:14");
});

test("catches modern paraphrase 'author and perfecter of our faith' → Hebrews 12:2", () => {
  const hit = detect("Jesus is the author and perfecter of our faith");
  assert.ok(hit);
  assert.equal(hit!.entry.reference, "Hebrews 12:2");
});

test("catches idiom 'a friend that sticketh closer than a brother' → Proverbs 18:24", () => {
  const hit = detect("you need a friend that sticketh closer than a brother");
  assert.ok(hit);
  assert.equal(hit!.entry.reference, "Proverbs 18:24");
});

test("catches 'no weapon formed against thee shall prosper' → Isaiah 54:17", () => {
  const hit = detect("declare it that no weapon formed against thee shall prosper");
  assert.ok(hit);
  assert.equal(hit!.entry.reference, "Isaiah 54:17");
});

test("does NOT false-fire on generic worship vocabulary with no distinctive phrase", () => {
  // Only worship stopwords (lift/higher/worthy/love), no distinctive scripture —
  // the WORSHIP_STOPWORDS distinctiveness guard must suppress it.
  const hit = detect("we lift you higher and higher lord you are so worthy we love you");
  assert.ok(!hit, `themeless worship vocab should not match: ${hit?.entry.reference}`);
});

// False-positive regressions (found by the stress gate): common English clauses
// that happen to be a verse's alt-phrase must NOT fire — the reverse/normalized
// match is anchored on a distinctive token, and these entries have none.
test("FP: 'for ever and ever amen' does not fire Psalm 10:16", () => {
  const hit = detect("we give you all the glory and honour for ever and ever amen");
  assert.ok(!hit || hit.entry.reference !== "Psalms 10:16", `false-fired: ${hit?.entry.reference}`);
});
test("FP: 'God bless you and your children' does not fire Psalm 115:14", () => {
  const hit = detect("may God bless you and your children this morning");
  assert.ok(!hit || hit.entry.reference !== "Psalms 115:14", `false-fired: ${hit?.entry.reference}`);
});
test("FP: 'you shall live' does not fire Ezekiel 37:5", () => {
  const hit = detect("just believe in him and you shall live");
  assert.ok(!hit || hit.entry.reference !== "Ezekiel 37:5", `false-fired: ${hit?.entry.reference}`);
});

test("ordinary conversation does not match a verse", () => {
  const hit = detect("thanks everyone for coming today please take your seats and turn off your phones");
  assert.ok(!hit, `ordinary speech should not match: ${hit?.entry.reference}`);
});

// Modern-English wording (the user's key ask): preachers paraphrase in modern
// words, not KJV archaic forms. KJV↔modern normalization must bridge them.
test("modern wording: 'in the bible it says iron sharpens iron' → Proverbs 27:17", () => {
  const hit = detect("in the bible it says iron sharpens iron so we need each other");
  assert.ok(hit, "should detect the modern paraphrase");
  assert.equal(hit!.entry.reference, "Proverbs 27:17");
});

test("modern wording: 'a friend that sticks closer than a brother' → Proverbs 18:24", () => {
  const hit = detect("you know the bible talks about a friend that sticks closer than a brother");
  assert.ok(hit);
  assert.equal(hit!.entry.reference, "Proverbs 18:24");
});

test("modern wording: 'faith comes by hearing' → Romans 10:17", () => {
  const hit = detect("remember that faith comes by hearing and hearing by the word of God");
  assert.ok(hit);
  assert.equal(hit!.entry.reference, "Romans 10:17");
});

test("normalizeForAllusion folds archaic verbs to modern", () => {
  assert.equal(normalizeForAllusion("iron sharpeneth iron"), "iron sharpens iron");
  assert.equal(normalizeForAllusion("faith cometh by hearing"), "faith comes by hearing");
});

test("phraseSearch indexes altPhrases (modern forms) for the new entries", () => {
  const results = phraseSearch("author and finisher of our faith");
  assert.ok(results.length > 0 && results[0].entry.reference === "Hebrews 12:2");
});
