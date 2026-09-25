/**
 * Bible tab verse cards stay in SCRIPTURE order.
 *
 * Field report (Victor, 2026-09-22, with a screenshot): the cards read
 * 24, 28, 26. He looked up Exodus 4:28, said "can we go back four" (-> 4:24),
 * then "can we go forward two verses" (-> 4:26). He accepted the navigation was
 * correct — the complaint was that the LIST should stay in verse order.
 *
 * Cause: applyAdvancedVerse appended on forward nav and prepended on reverse,
 * wherever the verse actually belonged.
 *
 * Run: npx tsx test/verse-order.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { insertVerseCard, verseKeyOf, compareVerseKeys, isSortedByVerse } from "../src/lib/verse-order";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const card = (label: string, verse: number) => ({ label, verses: [{ verse }] });
const labels = (cs: Array<{ label: string }>) => cs.map((c) => c.label);

console.log("Victor's exact sequence:");
check("Exodus 4:28, back four, forward two → 24, 26, 28 (was 24, 28, 26)", () => {
  let cards = [card("Exodus 4:28 (KJV)", 28)];                       // lookup
  let r = insertVerseCard(cards, card("Exodus 4:24 (KJV)", 24), -1); // "go back four"
  cards = r.cards;
  assert.deepEqual(labels(cards), ["Exodus 4:24 (KJV)", "Exodus 4:28 (KJV)"]);
  assert.equal(r.index, 0, "selection must follow the card to index 0");
  r = insertVerseCard(cards, card("Exodus 4:26 (KJV)", 26), 1);      // "go forward two"
  cards = r.cards;
  assert.deepEqual(labels(cards), ["Exodus 4:24 (KJV)", "Exodus 4:26 (KJV)", "Exodus 4:28 (KJV)"],
    "the reported bug: 26 appended to the END instead of slotting between 24 and 28");
  assert.equal(r.index, 1, "selection must point at 4:26, which landed in the MIDDLE");
});

console.log("\na straight read-through still lands contiguous:");
check("16 → 17 → 18 stays in order, selection tracks the new card", () => {
  let cards = [card("John 3:16 (KJV)", 16)];
  for (const v of [17, 18]) {
    const r = insertVerseCard(cards, card(`John 3:${v} (KJV)`, v), 1);
    cards = r.cards;
    assert.equal(r.index, cards.length - 1, `verse ${v} should land last`);
  }
  assert.deepEqual(labels(cards), ["John 3:16 (KJV)", "John 3:17 (KJV)", "John 3:18 (KJV)"]);
});
check("reading BACKWARD 18 → 17 → 16 also ends sorted", () => {
  let cards = [card("John 3:18 (KJV)", 18)];
  for (const v of [17, 16]) cards = insertVerseCard(cards, card(`John 3:${v} (KJV)`, v), -1).cards;
  assert.deepEqual(labels(cards), ["John 3:16 (KJV)", "John 3:17 (KJV)", "John 3:18 (KJV)"]);
});

console.log("\nordering is by book → chapter → verse, never by string:");
check("verse 9 sorts BEFORE verse 10 (string compare would invert it)", () => {
  const r = insertVerseCard([card("John 3:10 (KJV)", 10)], card("John 3:9 (KJV)", 9), 1);
  assert.deepEqual(labels(r.cards), ["John 3:9 (KJV)", "John 3:10 (KJV)"]);
});
check("chapters order numerically across a chapter boundary", () => {
  const r = insertVerseCard([card("Exodus 5:1 (KJV)", 1)], card("Exodus 4:31 (KJV)", 31), -1);
  assert.deepEqual(labels(r.cards), ["Exodus 4:31 (KJV)", "Exodus 5:1 (KJV)"],
    "Exodus 5:1 must follow 4:31, not sort by verse number alone");
});
check("books order canonically, not alphabetically", () => {
  // Alphabetically: "1 John" < "Acts" < "Genesis". Canonically the reverse.
  let cards = [card("Genesis 1:1 (KJV)", 1)];
  cards = insertVerseCard(cards, card("Acts 1:1 (KJV)", 1), 1).cards;
  cards = insertVerseCard(cards, card("1 John 1:1 (KJV)", 1), 1).cards;
  assert.deepEqual(labels(cards), ["Genesis 1:1 (KJV)", "Acts 1:1 (KJV)", "1 John 1:1 (KJV)"]);
});
check("verseKeyOf / compareVerseKeys agree with that", () => {
  const g = verseKeyOf(card("Genesis 1:1", 1))!, r = verseKeyOf(card("Revelation 1:1", 1))!;
  assert.ok(compareVerseKeys(g, r) < 0, "Genesis must sort before Revelation");
  assert.equal(verseKeyOf({ label: "not a reference" }), null);
});

console.log("\na hand-arranged list is NEVER re-sorted:");
check("an out-of-order list keeps the old append/prepend behaviour", () => {
  // The Bible tab has up/down buttons (moveCard) so the operator can arrange
  // cards deliberately. Re-sorting that would be its own regression.
  const arranged = [card("John 3:18 (KJV)", 18), card("John 3:16 (KJV)", 16)];
  assert.equal(isSortedByVerse(arranged), false);
  const fwd = insertVerseCard(arranged, card("John 3:17 (KJV)", 17), 1);
  assert.deepEqual(labels(fwd.cards), ["John 3:18 (KJV)", "John 3:16 (KJV)", "John 3:17 (KJV)"]);
  assert.equal(fwd.index, 2);
  const back = insertVerseCard(arranged, card("John 3:17 (KJV)", 17), -1);
  assert.equal(back.index, 0);
});

console.log("\nunparseable cards are safe:");
check("a placeholder card doesn't disable ordering or get lost", () => {
  const withPlaceholder = [card("Exodus 4:24 (KJV)", 24), { label: "Looking up…" } as never, card("Exodus 4:28 (KJV)", 28)];
  assert.equal(isSortedByVerse(withPlaceholder), true, "the placeholder must be skipped, not treated as out of order");
  const r = insertVerseCard(withPlaceholder, card("Exodus 4:26 (KJV)", 26), 1);
  assert.equal(r.cards.length, 4, "no card was dropped");
  assert.deepEqual(labels(r.cards).filter((l) => l.startsWith("Exodus")),
    ["Exodus 4:24 (KJV)", "Exodus 4:26 (KJV)", "Exodus 4:28 (KJV)"]);
});
check("a card whose own label won't parse is appended, never dropped", () => {
  const r = insertVerseCard([card("Exodus 4:24 (KJV)", 24)], { label: "???" } as never, 1);
  assert.equal(r.cards.length, 2);
  assert.equal(r.index, 1);
});

console.log("\nwiring — both insert sites use it:");
check("applyAdvancedVerse inserts in order and derives the selection", () => {
  const src = readFileSync(new URL("../src/components/operator/pro/ProOperatorShell.tsx", import.meta.url), "utf8");
  assert.match(src, /const \{ cards: next, index \} = insertVerseCard\(existing, card, dir\);/, "verse-nav still appends/prepends");
  assert.ok(!/const next = dir > 0 \? \[\.\.\.existing, card\] : \[card, \.\.\.existing\];/.test(src), "the old insert came back");
  assert.match(src, /bibleSession\.setSelectedIdx\(index\);/, "selection is not derived from the insert position");
});
check("the spoken 'from verse N' path uses it too", () => {
  const src = readFileSync(new URL("../src/components/operator/pro/ProOperatorShell.tsx", import.meta.url), "utf8");
  assert.match(src, /insertVerseCard\(existing, card, 1\)/, "goto_bible_verse still appends out of order");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
