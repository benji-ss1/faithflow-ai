/**
 * Context-gated English number-homophone repair.
 * Run: npx tsx test/bible-homophones.test.ts
 *
 * Verifies that Deepgram's phonetic number mishears are corrected ONLY inside a
 * Bible-reference slot (book + adjacent number), and that ordinary English that
 * merely contains those same words is left completely alone (no false positives).
 */
import assert from "node:assert/strict";
import { parseReference, parseReferences, parseTypedReference } from "../src/lib/bible-parser";

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
test('"First Corinthians thirteen fore" → 1 Cor 13:4', () => expectRef("First Corinthians thirteen fore", "1 Corinthians", 13, 4));
test('"Mark chapter five verse ate" → Mark 5:8 (explicit verse slot)', () => expectRef("Mark chapter five verse ate", "Mark", 5, 8));
test('"Romans eight verse twenty ate" → Romans 8:28', () => expectRef("Romans eight verse twenty ate", "Romans", 8, 28));
test('"Psalm twenty tree" → Psalm 23 (TH path, whole chapter)', () => {
  const r = parseReference("Psalm twenty tree");
  assert.ok(r); assert.equal(r!.book, "Psalms"); assert.equal(r!.chapter, 23); assert.equal(r!.verseEnd, null);
});

console.log("\nEphesians ASR mishears (field 2026-08-21 — 'Efficeans 4 6'):");
test('"Efficeans 4 6" → Ephesians 4:6', () => expectRef("Efficeans 4 6", "Ephesians", 4, 6));
test('"efficeans 4:6" → Ephesians 4:6', () => expectRef("efficeans 4:6", "Ephesians", 4, 6));
test('"efesians 2 8" → Ephesians 2:8', () => expectRef("efesians 2 8", "Ephesians", 2, 8));
// The real-English guard: "efficient" must NEVER map to Ephesians.
test('"efficient 4 6" → no reference (English word, not a mishear)', () => assert.equal(parseReference("efficient 4 6"), null));
test('"be efficient in all things" → no reference', () => assert.equal(parseReference("be efficient in all things"), null));

console.log("\nMark vs Micah ASR mishear (field 2026-08-21 — accented 'Mark' → 'Micah'):");
test('"Mica 4:1" → Mark 4:1 (missing-h phonetic → Mark)', () => expectRef("Mica 4:1", "Mark", 4, 1));
test('"Mika 4:1" → Mark 4:1', () => expectRef("Mika 4:1", "Mark", 4, 1));
test('"Mica 16:15" → Mark 16:15', () => expectRef("Mica 16:15", "Mark", 16, 15));
test('"Micah 11:4" → Mark 11:4 (Micah has 7 chapters — must be Mark)', () => expectRef("Micah 11:4", "Mark", 11, 4));
test('"Micah chapter 16 verse 15" → Mark 16:15', () => expectRef("Micah chapter 16 verse 15", "Mark", 16, 15));
// Real Micah (valid chapters 1-7, correctly spelled) must be preserved.
test('"Micah 4:1" → Micah 4:1 (real Micah untouched)', () => expectRef("Micah 4:1", "Micah", 4, 1));
test('"Micah 7:7" → Micah 7:7 (real Micah untouched)', () => expectRef("Micah 7:7", "Micah", 7, 7));

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
test('"Mark the door was open" → no reference', () => assert.equal(parseReference("Mark the door was open"), null));
// The review-🔴 chaining class: book-that's-a-common-word + homophone + number.
test('"Mark ate five apples" → no reference (ate not anchored by a real number)', () => assert.equal(parseReference("Mark ate five apples"), null));
test('"Mark ate too much" → no reference', () => assert.equal(parseReference("Mark ate too much"), null));
test('"John ate ten fish" → no reference', () => assert.equal(parseReference("John ate ten fish"), null));
test('"Ruth won ten pounds" → no reference', () => assert.equal(parseReference("Ruth won ten pounds"), null));
test('"Romans eight won by grace" → Romans 8 (won not verse 1; next is content)', () => {
  const r = parseReference("Romans eight won by grace");
  assert.ok(r); assert.equal(r!.book, "Romans"); assert.equal(r!.chapter, 8); assert.equal(r!.verseStart, 1); assert.equal(r!.verseEnd, null);
});
test('"Mark to ten people" → no false verse (for/to excluded)', () => {
  const r = parseReference("Mark to ten people");
  assert.equal(r, null);
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

console.log("\n2026-08-16 — 'machu' → Matthew (Nigerian ASR) + lyric-corruption guards:");
test('"Machu five four" → Matthew 5:4', () => expectRef("Machu five four", "Matthew", 5, 4));
test('"Machu 5:4" → Matthew 5:4', () => expectRef("Machu 5:4", "Matthew", 5, 4));
test('"matchu chapter five verse four" → Matthew 5:4', () => expectRef("matchu chapter five verse four", "Matthew", 5, 4));
// The reported lyric-corruption cases — these must NOT parse to a book.
test('"sing like never before" → no reference (not Song of Solomon / Luke)', () => assert.equal(parseReference("sing like never before"), null));
test('"worship his holy name" → no reference', () => assert.equal(parseReference("worship his holy name"), null));
test('"I will sing" → no reference', () => assert.equal(parseReference("I will sing"), null));
test('"songs of praise" → no reference (bare song/songs no longer a book alias)', () => assert.equal(parseReference("songs of praise"), null));
// But the genuine full name still detects — "strong to Song of Solomon".
test('"Song of Solomon 3:1" → Song of Solomon 3:1', () => expectRef("Song of Solomon 3:1", "Song of Solomon", 3, 1));
test('"Song of Songs two one" → Song of Solomon 2:1', () => expectRef("Song of Songs two one", "Song of Solomon", 2, 1));

console.log("\n2026-09-16 — 'mic' is a microphone, not Micah (sound-check false positive):");
// Field data: of 107,593 real transcript segments, 151 contain mic/mike/mics and
// every sampled one means a microphone. "mic two" was scoring Micah 2:1 @72 (a
// suggest toast) and "testing mic 1 2" @85 — ABOVE the 75 auto-fire bar, so a
// sound check could PROJECT a verse in AUTO mode.
function expectNoRefAtAll(input: string) {
  const all = parseReferences(input);
  assert.equal(
    all.length, 0,
    `expected NO reference at any confidence for "${input}", got ${JSON.stringify(all.map((r) => `${r.book} ${r.chapter}:${r.verseStart}@${r.confidence}`))}`,
  );
}

// ── must NOT detect at ANY confidence ──
for (const s of [
  "check mic two please", "mic two", "mic 2", "mi two", "mic one",
  "check mic one two", "testing mic 1 2", "mic 7 5", "give me mic 3",
  "mic two is too loud", "can you check mic two", "Mic 10 12",
  "mike two", "mike 6 8",
]) {
  test(`sound check: ${JSON.stringify(s)} → no reference`, () => expectNoRefAtAll(s));
}

// The scripture evidence must be ADJACENT to the book token, not merely present
// somewhere in the utterance. These are ordinary pre-service sentences that a
// whole-utterance test let through — an unrelated clock time, or a stray
// "verse"/"chapter"/"book of" elsewhere in the sentence, re-opened the hole
// (the 6:30 + "mic 1 2" case leaked at 85, ABOVE the auto-fire bar).
for (const s of [
  "meeting at 6:30, check mic two",
  "we start at 6:30 can you check mic 1 2",
  "next verse, check mic one two",
  "verse check mic two",
  "the book of life, check mic two",
  "we'll read chapter three later, check mic two",
]) {
  test(`distant keyword must not re-open it: ${JSON.stringify(s)} → no reference`, () => expectNoRefAtAll(s));
}

// The auto-fire guard: the 🔴 cases must not survive at or above the 75 bar
// (src/lib/audio-thresholds.ts) at which AUTO mode projects without a click.
for (const s of ["testing mic 1 2", "we start at 6:30 can you check mic 1 2", "next verse, check mic one two"]) {
  test(`${JSON.stringify(s)} yields nothing at or above the 75 auto-fire bar`, () => {
    const hot = parseReferences(s).filter((r) => r.confidence >= 75);
    assert.deepStrictEqual(hot, [], "a sound check must never reach the auto-fire bar");
  });
}

// ── adjacent scripture evidence still resolves the short alias ──
test('"turn to mic 6 8" → Micah 6:8 (cue immediately before)', () => expectRef("turn to mic 6 8", "Micah", 6, 8));
test('"the bible says in mic 6 8" → Micah 6:8', () => expectRef("the bible says in mic 6 8", "Micah", 6, 8));
test('"in the book of mic 6" → Micah 6 (whole chapter)', () => expectRef("in the book of mic 6", "Micah", 6, 1));
test('"mic chapter 6 verse 8" → Micah 6:8', () => expectRef("mic chapter 6 verse 8", "Micah", 6, 8));
test('"mic 6 verse 8" → Micah 6:8', () => expectRef("mic 6 verse 8", "Micah", 6, 8));
test('"mic 6:8" → Micah 6:8', () => expectRef("mic 6:8", "Micah", 6, 8));

// ── TYPED input bypasses the guard entirely (deliberate operator intent) ──
// Nobody types "mic 6 8" to adjust a microphone; the BibleMode reference box and
// the ⌘K palette both resolve through parseTypedReference.
function expectTypedRef(input: string, book: string, chapter: number, verseStart: number) {
  const r = parseTypedReference(input);
  assert.ok(r.length > 0, `expected a typed reference for "${input}", got none`);
  assert.equal(r[0].book, book, `book for typed "${input}"`);
  assert.equal(r[0].chapter, chapter, `chapter for typed "${input}"`);
  assert.equal(r[0].verseStart, verseStart, `verseStart for typed "${input}"`);
}
test('typed "Mic 6" → Micah 6', () => expectTypedRef("Mic 6", "Micah", 6, 1));
test('typed "Mic 6 8" → Micah 6:8', () => expectTypedRef("Mic 6 8", "Micah", 6, 8));
test('typed "Mi 6" → Micah 6', () => expectTypedRef("Mi 6", "Micah", 6, 1));
test('typed "Mic 6:8" → Micah 6:8', () => expectTypedRef("Mic 6:8", "Micah", 6, 8));
// ...but the SPOKEN path for those same strings stays blocked.
test('spoken "mic 6" (no cue) → still no reference', () => expectNoRefAtAll("mic 6"));
test('spoken "mic 6 8" (no cue) → still no reference', () => expectNoRefAtAll("mic 6 8"));

// The accent/ASR repairs must be untouched (CLAUDE.md rule 9).
test('"micah tree" → Micah 3 (TH-fronting repair survives)', () => expectRef("micah tree", "Micah", 3, 1));
test('"mica 6 8" → Mark 6:8 (Mark remap survives)', () => expectRef("mica 6 8", "Mark", 6, 8));

// ── genuine Micah must still detect (incl. the typed "Mic 6:8" shape) ──
test('"Micah 6:8" → Micah 6:8', () => expectRef("Micah 6:8", "Micah", 6, 8));
test('"Micah chapter 6 verse 8" → Micah 6:8', () => expectRef("Micah chapter 6 verse 8", "Micah", 6, 8));
test('"Micah 1 verse 2" → Micah 1:2', () => expectRef("Micah 1 verse 2", "Micah", 1, 2));
test('"In the book of Micah 1 verse 2" → Micah 1:2', () => expectRef("In the book of Micah 1 verse 2", "Micah", 1, 2));
test('"Micah 1 2" → Micah 1:2', () => expectRef("Micah 1 2", "Micah", 1, 2));
test('"Micah two" → Micah 2 (whole chapter)', () => expectRef("Micah two", "Micah", 2, 1));
test('"Micah chapter two" → Micah 2 (whole chapter)', () => expectRef("Micah chapter two", "Micah", 2, 1));
test('"turn to Micah 6" → Micah 6 (whole chapter)', () => expectRef("turn to Micah 6", "Micah", 6, 1));
// Typed shorthand in the BibleMode reference box — the colon carries the
// scripture shape, so the ambiguous alias is still allowed through.
test('"Mic 6:8" → Micah 6:8 (typed shorthand still resolves)', () => expectRef("Mic 6:8", "Micah", 6, 8));
test('"Mi 6:8" → Micah 6:8 (typed shorthand still resolves)', () => expectRef("Mi 6:8", "Micah", 6, 8));
test('"mic chapter 2" → Micah 2 (explicit "chapter" cue)', () => expectRef("mic chapter 2", "Micah", 2, 1));
// The existing Micah↔Mark accent remap must be untouched (CLAUDE.md rule 9).
test('"Micah 11:4" → Mark 11:4 (remap survives)', () => expectRef("Micah 11:4", "Mark", 11, 4));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
