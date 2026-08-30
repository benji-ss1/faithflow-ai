/**
 * Contextual Awareness Engine — grounded in a REAL JPD service transcript
 * (Deepgram nova-2). Verifies the six-class scorer + the rolling engine's
 * `isSpokenContext` signal, which is what lets the detection gate cap a
 * worship-adjacent SPOKEN phrase ("in the mighty name of Jesus") instead of
 * firing a song, while NEVER capping real songs during actual worship.
 *
 * Run: npx tsx test/context-engine.test.ts
 */
import assert from "node:assert/strict";
import { scoreSpeechClasses } from "../src/lib/ai-detection/context-lexicons";
import { ContextEngine } from "../src/lib/ai-detection/context-engine";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}
const dominant = (s: Record<string, number>) => Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];

// Real utterances from the JPD service (~scratchpad/jpd-transcript.json).
const PRAYER = "Lord Jesus Christ, we thank you again for your goodness and your mercies. You are worthy. You are holy forever.";
const PRAYER_SHORT = "in the mighty name of Jesus";
const SCRIPTURE = "In Isaiah chapter six, the prophet Isaiah sees a prophetic image of the Lord of hosts.";
const PREACH1 = "I got the privilege to go to a United game on Wednesday. There were about 80,000 of my United fans.";
const PREACH2 = "what happened was once we scored, they all celebrated. But they did not shout.";
const ANNOUNCE = "I want us to take about five seconds to look at your neighbor, congratulate them.";
const CLAP = "For the next ten seconds, let us offer up a clap offering to the king of kings.";
const LYRIC = "I need a rescue. My sin was heavy. But chains break at the weight of your glory.";

console.log("Per-utterance classification of REAL JPD speech:");
test("prayer utterance → prayer", () => assert.equal(dominant(scoreSpeechClasses(PRAYER)), "prayer"));
test('"in the mighty name of Jesus" → prayer (THE song-false-fire fix)', () => assert.equal(dominant(scoreSpeechClasses(PRAYER_SHORT)), "prayer"));
test("scripture reading (ref) → scripture_reading", () => assert.equal(dominant(scoreSpeechClasses(SCRIPTURE, { hasScriptureRef: true })), "scripture_reading"));
test("football story → preaching", () => assert.equal(dominant(scoreSpeechClasses(PREACH1)), "preaching"));
test("narrative → preaching", () => assert.equal(dominant(scoreSpeechClasses(PREACH2)), "preaching"));
test("neighbour greeting → announcement", () => assert.equal(dominant(scoreSpeechClasses(ANNOUNCE)), "announcement"));
test('clap-offering "king of kings" call → announcement, NOT worship/song', () => assert.equal(dominant(scoreSpeechClasses(CLAP)), "announcement"));
test("sung lyric WITH audio signal → worship", () => assert.equal(dominant(scoreSpeechClasses(LYRIC, { musicSuspected: true, lyricMatchScore: 70 })), "worship"));

console.log("\nisSpokenContext — cap songs when spoken, NEVER during real worship:");
test("prayer streak → isSpokenContext true (a song match here would be capped)", () => {
  const e = new ContextEngine();
  let snap = e.observe({ text: PRAYER, now: 1000 });
  snap = e.observe({ text: PRAYER_SHORT, now: 4000 });
  assert.equal(snap.isPrayerContext, true);
  assert.equal(snap.isSpokenContext, true);
});
test("preaching streak → isSpokenContext true", () => {
  const e = new ContextEngine();
  e.observe({ text: PREACH1, now: 1000 });
  const snap = e.observe({ text: PREACH2, now: 5000 });
  assert.equal(snap.isSpokenContext, true);
});
test("preaching streak → isStoryContext true (Phase 2 nav-suppression signal)", () => {
  const e = new ContextEngine();
  e.observe({ text: PREACH1, now: 1000 });
  const snap = e.observe({ text: PREACH2, now: 5000 });
  assert.equal(snap.isStoryContext, true, "story context is what suppresses mid-conf voice-nav mid-sermon");
});
test("scripture-reading is NOT story context (voice nav must still work while reading)", () => {
  const e = new ContextEngine();
  e.observe({ text: SCRIPTURE, now: 1000, signals: { hasScriptureRef: true } });
  const snap = e.observe({ text: "and it says in the next verse", now: 4000, signals: { hasScriptureRef: true } });
  assert.equal(snap.isStoryContext, false, "reading scripture must not suppress nav");
});
test("real worship (audio signal) → isSpokenContext FALSE, isWorshipContext TRUE (songs NOT capped)", () => {
  const e = new ContextEngine();
  e.observe({ text: LYRIC, now: 1000, signals: { musicSuspected: true, lyricMatchScore: 70 } });
  const snap = e.observe({ text: "chains break at the weight of your glory", now: 4000, signals: { musicSuspected: true, lyricMatchScore: 75 } });
  assert.equal(snap.isWorshipContext, true);
  assert.equal(snap.isSpokenContext, false, "must NOT cap songs during actual singing");
});
test("CLEAN-sung worship (musicSuspected FALSE) with testimony lyrics → protected from line 2 via lyric-match feedback", () => {
  // The adversarial case: clean singing that Deepgram transcribes well produces a
  // real song match but NO musicSuspected. The lyric-match score (fed back after
  // detectAll) must lift the worship guard so sustained worship isn't capped.
  const e = new ContextEngine();
  const lines = ["I was lost but you found me", "you saved me from the pit", "I was buried but you raised me up"];
  const snaps = lines.map((l, i) => e.observe({ text: l, now: 1000 + i * 3000, signals: { musicSuspected: false, lyricMatchScore: 88 } }));
  assert.equal(snaps[1].isSpokenContext, false, "line 2 onward must NOT cap a genuinely-matching sung song");
  assert.equal(snaps[2].isSpokenContext, false);
});

console.log("\nHysteresis — one stray word doesn't flip the context:");
test("a single 'hallelujah' amid a preaching streak stays preaching", () => {
  const e = new ContextEngine();
  e.observe({ text: PREACH1, now: 1000 });
  e.observe({ text: PREACH2, now: 4000 });
  e.observe({ text: "and there was such joy that filled their hearts", now: 7000 });
  const snap = e.observe({ text: "Hallelujah.", now: 10000 });
  assert.equal(snap.dominant, "preaching", "one stray worship word must not hijack the context");
});

console.log("\nrefJustRepeated — a repeat of the live verse in a spoken context holds:");
test("same ref live + not reading → incidental-repeat", () => {
  const e = new ContextEngine();
  e.observe({ text: PREACH1, now: 1000, live: { kind: "scripture", refKey: "john-3-16" } });
  e.noteRef("john-3-16", 1000);
  e.noteRef("john-3-16", 3000); // preacher restates it while telling the story
  assert.equal(e.refJustRepeated("john-3-16"), "incidental-repeat");
});
test("first mention → first", () => {
  const e = new ContextEngine();
  e.noteRef("psalm-23-1", 1000);
  assert.equal(e.refJustRepeated("psalm-23-1"), "first");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
