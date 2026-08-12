/**
 * Verse-detection v2 — multi-word book mishears + translation-name mishears.
 * Run: npx tsx test/verse-v2-mishears.test.ts
 *
 * #1 Book mishears: ASR garbles book names into multi-word phrases the
 *    single-token fuzzyBookMatch can't reach ("first salvo"→1 Samuel,
 *    "habba cook"→Habakkuk, "fill a man"→Philemon). Added as explicit
 *    variants; only parse as a book in a chapter:verse shape.
 * #2 Translation-name mishears ("cage v"→KJV, "knive"→NIV) — intent-gated so
 *    real English ("naive", "cage") never false-fires.
 */
import assert from "node:assert/strict";
import { parseReference } from "../src/lib/bible-parser";
import { detectTranslationSwitch } from "../src/lib/translation-commands";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}
function ref(s: string) { const r = parseReference(s); return r ? `${r.book} ${r.chapter}:${r.verseStart}` : null; }

console.log("#1 Multi-word book mishears — STRICT two-number shape:");
test('"first salvo three five" → 1 Samuel 3:5', () => assert.equal(ref("first salvo three five"), "1 Samuel 3:5"));
test('"second salvo one one" → 2 Samuel 1:1', () => assert.equal(ref("second salvo one one"), "2 Samuel 1:1"));
test('"habba cook two four" → Habakkuk 2:4 (nonsense variant, any shape)', () => assert.equal(ref("habba cook two four"), "Habakkuk 2:4"));
test('"have a cook three verse two" → Habakkuk 3:2', () => assert.equal(ref("have a cook three verse two"), "Habakkuk 3:2"));
test('"have a cook two four" → Habakkuk 2:4', () => assert.equal(ref("have a cook two four"), "Habakkuk 2:4"));
test('"fill a man one six" → Philemon 1:6 (single-chapter, 2nd num = verse)', () => {
  const r = parseReference("fill a man one six");
  assert.ok(r); assert.equal(r!.book, "Philemon"); assert.equal(r!.verseStart, 6);
});
test('"filippians four thirteen" → Philippians 4:13', () => assert.equal(ref("filippians four thirteen"), "Philippians 4:13"));
test('"philippines four thirteen" → Philippians 4:13 (fuzzy)', () => assert.equal(ref("philippines four thirteen"), "Philippians 4:13"));

console.log("\n#1 No false books on ordinary speech — incl. ONE trailing number (review 🔴):");
test('"the first salvo three years ago" → null', () => assert.equal(parseReference("the first salvo three years ago"), null));
test('"have a cook, two of them" → null', () => assert.equal(parseReference("have a cook, two of them"), null));
test('"have a cook one day a week" → null', () => assert.equal(parseReference("have a cook one day a week"), null));
test('"feel a man six feet tall" → null', () => assert.equal(parseReference("feel a man six feet tall"), null));
test('"fill a man with hope" → null', () => assert.equal(parseReference("fill a man with hope"), null));
test('"we went to the philippines" → null', () => assert.equal(parseReference("we went to the philippines"), null));

console.log("\n#2 Translation-name mishears (intent-gated). Times advance past the 10s cooldown:");
const avail = ["KJV", "NIV", "ESV", "NASB"];
let t = 0;
const tr = (s: string) => { t += 11000; return detectTranslationSwitch(s, avail, { now: t })?.code ?? null; };
test('"can we read it in cage v" → KJV', () => assert.equal(tr("can we read it in cage v"), "KJV"));
test('"let us use knive" → NIV', () => assert.equal(tr("let us use knive"), "NIV"));
test('"give me easy v" → ESV', () => assert.equal(tr("give me easy v"), "ESV"));
test('"can we get nasa bee" → NASB', () => assert.equal(tr("can we get nasa bee"), "NASB"));
test('"read it in new inter national" → NIV', () => assert.equal(tr("read it in new inter national"), "NIV"));

console.log("\n#2 No false translation switch — incl. intent-word + 'naive' (review 🔴):");
test('"the bird flew into the cage over there" → null', () => assert.equal(tr("the bird flew into the cage over there"), null));
test('"she was so naive back then" → null', () => assert.equal(tr("she was so naive back then"), null));
test('"the bible tells us not to be naive" → null (naive dropped)', () => assert.equal(tr("the bible tells us not to be naive"), null));
test('"read the room, don\'t be naive" → null', () => assert.equal(tr("read the room, don't be naive"), null));
test('"the bible reminds us nasa be praised" → null (needs full nasa bee)', () => assert.equal(tr("the bible reminds us nasa be praised"), null));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
