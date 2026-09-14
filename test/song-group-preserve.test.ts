// Run: npx tsx --test test/song-group-preserve.test.ts
// Locks the "don't wipe my sections on a quick edit" invariant (wave 6G + fix pass):
// updateSongSlides carries prior group ids across a rewrite by EXACT prior-lyric
// text first (index as tiebreak) only when the slide count is unchanged;
// otherwise every slide comes back ungrouped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { preservedGroupIds, type PriorSlide } from "../src/lib/song-group-preserve";

const p = (lyrics: string, groupId: string | null): PriorSlide => ({ lyrics, groupId });

test("equal count, unchanged text → carried across", () => {
  assert.deepEqual(
    preservedGroupIds([p("A", "v"), p("B", "v"), p("C", null), p("D", "c")], ["A", "B", "C", "D"]),
    ["v", "v", null, "c"],
  );
});

test("swap two lines → labels follow the TEXT, not the index", () => {
  // Prior: A→verse, B→chorus. After swap the order is [B, A] but B must stay
  // chorus and A must stay verse — an index-only match would flip them.
  assert.deepEqual(
    preservedGroupIds([p("A", "verse"), p("B", "chorus")], ["B", "A"]),
    ["chorus", "verse"],
  );
});

test("duplicate lyrics consume prior group ids in original order", () => {
  assert.deepEqual(
    preservedGroupIds([p("Hallelujah", "v1"), p("Hallelujah", "c1")], ["Hallelujah", "Hallelujah"]),
    ["v1", "c1"],
  );
});

test("edited line with no text match falls back to its index group (tiebreak)", () => {
  // "B" was edited to "B!"; A and C still match by text, B! keeps index 1's group.
  assert.deepEqual(
    preservedGroupIds([p("A", "v"), p("B", "c"), p("C", "b")], ["A", "B!", "C"]),
    ["v", "c", "b"],
  );
});

test("count grew (line added) → all ungrouped (no ambiguous guess)", () => {
  assert.deepEqual(preservedGroupIds([p("A", "v"), p("B", "c")], ["A", "B", "C"]), [null, null, null]);
});

test("count shrank (line removed) → all ungrouped", () => {
  assert.deepEqual(preservedGroupIds([p("A", "v"), p("B", "c"), p("C", "b")], ["A", "B"]), [null, null]);
});

test("no prior groups → all null even at equal count (no-op)", () => {
  assert.deepEqual(preservedGroupIds([p("A", null), p("B", null)], ["A", "B"]), [null, null]);
});

test("empty song → empty result", () => {
  assert.deepEqual(preservedGroupIds([], []), []);
});

test("does not mutate the input", () => {
  const input = [p("A", "v"), p("B", "c")];
  const snapshot = JSON.parse(JSON.stringify(input));
  preservedGroupIds(input, ["A", "B"]);
  assert.deepEqual(input, snapshot);
});
