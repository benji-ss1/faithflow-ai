/**
 * Scripture verse chunker — pure, layout-aware, text-preserving.
 *
 * Run: npx tsx test/scripture-chunk.test.ts
 */
import assert from "node:assert/strict";
import { chunkScripture, needsChunking } from "../src/lib/scripture-chunk";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}

const wc = (s: string) => s.split(" ").filter(Boolean).length;
// A genuinely long verse (Esther 8:9-ish length).
const LONG = "Then were the king's scribes called at that time in the third month, that is, the month Sivan, on the three and twentieth day thereof; and it was written according to all that Mordecai commanded unto the Jews, and to the lieutenants, and the deputies and rulers of the provinces which are from India unto Ethiopia, an hundred twenty and seven provinces, unto every province according to the writing thereof, and unto every people after their language, and to the Jews according to their writing, and according to their language.";
const JOHN316 = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

console.log("empty / short input:");
test("empty → []", () => { assert.deepEqual(chunkScripture("", "lowerThird"), []); assert.deepEqual(chunkScripture("   ", "fullscreen"), []); });
test("non-string → []", () => { assert.deepEqual(chunkScripture(undefined as unknown as string, "fullscreen"), []); });
test("short verse → single card (never split needlessly)", () => {
  assert.deepEqual(chunkScripture("Jesus wept.", "lowerThird"), ["Jesus wept."]);
});

console.log("layout-aware sizing (the toggle changes chunking):");
test("lower-third makes MORE cards than full-screen for the same long verse", () => {
  const lt = chunkScripture(LONG, "lowerThird");
  const fs = chunkScripture(LONG, "fullscreen");
  assert.ok(lt.length > 1, "long verse must split in lower-third");
  assert.ok(fs.length >= 1);
  assert.ok(lt.length > fs.length, `lower-third (${lt.length}) should have more cards than full-screen (${fs.length})`);
});
test("every card respects the layout word cap", () => {
  for (const c of chunkScripture(LONG, "lowerThird")) assert.ok(wc(c) <= 20, `lower-third card too long: ${wc(c)}`);
  for (const c of chunkScripture(LONG, "fullscreen")) assert.ok(wc(c) <= 48, `full-screen card too long: ${wc(c)}`);
});
test("explicit maxWords override wins", () => {
  const cards = chunkScripture(LONG, "fullscreen", { maxWords: 10, softWords: 6 });
  for (const c of cards) assert.ok(wc(c) <= 10);
  assert.ok(cards.length > chunkScripture(LONG, "fullscreen").length);
});

console.log("text is preserved EXACTLY (scripture is immutable):");
test("rejoining the cards reproduces the verse (whitespace-normalised)", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const cards = chunkScripture(LONG, "lowerThird");
  assert.equal(norm(cards.join(" ")), norm(LONG));
});
test("no card is empty and none splits a word", () => {
  const cards = chunkScripture(LONG, "lowerThird");
  for (const c of cards) { assert.ok(c.trim().length > 0); assert.ok(!/\s{2,}/.test(c)); }
});
test("punctuation/casing untouched (no grammar pass)", () => {
  const cards = chunkScripture(JOHN316, "lowerThird");
  assert.ok(cards.join(" ").includes("For God so loved the world,"));
  assert.ok(cards.join(" ").endsWith("everlasting life."));
});

console.log("break-point preference:");
test("prefers to end cards at sentence/clause boundaries where possible", () => {
  const cards = chunkScripture(JOHN316, "lowerThird");
  // At least one internal card should end on a comma/period (clause/sentence).
  const endsWell = cards.slice(0, -1).some((c) => /[,.;:]$/.test(c));
  assert.ok(endsWell || cards.length === 1, "expected a clause/sentence-ending card");
});
test("no lonely 1-word final card", () => {
  const cards = chunkScripture(LONG, "lowerThird");
  assert.ok(wc(cards[cards.length - 1]) >= 2 || cards.length === 1);
});

console.log("needsChunking helper:");
test("true for long, false for short", () => {
  assert.equal(needsChunking(LONG, "lowerThird"), true);
  assert.equal(needsChunking("Jesus wept.", "lowerThird"), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
