// Run: npx tsx --test test/song-group-preserve.test.ts
// Locks the "don't wipe my sections on a quick edit" invariant (wave 6G):
// updateSongSlides carries prior group ids across a rewrite BY INDEX only when
// the slide count is unchanged; otherwise every slide comes back ungrouped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { preservedGroupIds } from "../src/lib/song-group-preserve";

test("equal count + some grouped → carried across by index", () => {
  assert.deepEqual(
    preservedGroupIds(["v", "v", null, "c"], 4),
    ["v", "v", null, "c"],
  );
});

test("count grew (line added) → all ungrouped (no ambiguous guess)", () => {
  assert.deepEqual(preservedGroupIds(["v", "c"], 3), [null, null, null]);
});

test("count shrank (line removed) → all ungrouped", () => {
  assert.deepEqual(preservedGroupIds(["v", "c", "b"], 2), [null, null]);
});

test("no prior groups → all null even at equal count (no-op)", () => {
  assert.deepEqual(preservedGroupIds([null, null], 2), [null, null]);
});

test("empty song → empty result", () => {
  assert.deepEqual(preservedGroupIds([], 0), []);
});

test("does not mutate the input array", () => {
  const input = ["v", "c"];
  preservedGroupIds(input, 2);
  assert.deepEqual(input, ["v", "c"]);
});
