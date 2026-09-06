/**
 * matchBestSlide — pick the slide a singer is currently on (SUGGEST-only).
 *
 * Confidence must be HIGH only when the match is strong AND unambiguous, and
 * LOW for near-duplicate worship slides — so the operator is never shown a
 * misleading "go to slide N" suggestion.
 *
 * Run: npx tsx test/song-best-slide.test.ts
 */
import assert from "node:assert";
import { matchBestSlide } from "../src/lib/ai-detection/lyric-position";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${(e as Error).message}`); failed++; }
}
const words = (s: string) => s.split(/\s+/);

const SONG = [
  "Amazing grace how sweet the sound",           // 0
  "That saved a wretch like me",                  // 1
  "I once was lost but now am found",             // 2
  "Was blind but now I see",                      // 3
];

test("empty inputs → no match", () => {
  assert.equal(matchBestSlide([], SONG).index, -1);
  assert.equal(matchBestSlide(words("hello"), []).index, -1);
});

test("clear opening-run match picks the right slide with high confidence", () => {
  const r = matchBestSlide(words("i once was lost but now am found"), SONG);
  assert.equal(r.index, 2);
  assert.ok(r.confidence >= 90, `expected high confidence, got ${r.confidence}`);
});

test("picks a MID-song slide, not slide 0", () => {
  const r = matchBestSlide(words("that saved a wretch like me"), SONG);
  assert.equal(r.index, 1);
  assert.ok(r.confidence >= 80, `got ${r.confidence}`);
});

test("gibberish / unrelated speech → no confident match", () => {
  const r = matchBestSlide(words("the preacher said welcome everybody today"), SONG);
  assert.ok(r.index === -1 || r.confidence < 60, `should not confidently match, got idx=${r.index} conf=${r.confidence}`);
});

test("near-duplicate slides → ambiguous → low confidence (no misleading suggestion)", () => {
  const DUP = [
    "lifted high lifted high the name of Jesus",
    "lifted high lifted high in this place",
  ];
  const r = matchBestSlide(words("lifted high lifted high"), DUP);
  assert.ok(r.confidence <= 60, `ambiguous near-duplicates should stay low, got ${r.confidence}`);
});

test("stopword-only overlap does not create a false confident match", () => {
  const r = matchBestSlide(words("and the a to of in it"), SONG);
  assert.ok(r.index === -1 || r.confidence < 60, `got idx=${r.index} conf=${r.confidence}`);
});

console.log(`\n=== song-best-slide: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
