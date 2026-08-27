/**
 * OpenFlow Apply/Resolve pure helpers — song matching + scripture labels.
 * Run: npx tsx --test test/openflow-resolve-helpers.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSongIndex, formatScriptureLabel } from "../src/lib/openflow/resolve-helpers";

const LIB = ["Amazing Grace", "Great Is Thy Faithfulness", "Grace", "Waymaker"];

test("exact (normalized) title match wins", () => {
  assert.equal(matchSongIndex(LIB, "amazing grace"), 0);
  assert.equal(matchSongIndex(LIB, "Great Is Thy Faithfulness"), 1);
});

test("a truncated title matches via prefix", () => {
  assert.equal(matchSongIndex(LIB, "Great Is Thy"), 1);
});

test("does NOT bind a short query to a different longer song", () => {
  // "Amazing Grace" must never be matched by the bare word "grace" — that would
  // add the wrong real song. Exact "Grace" is index 2; "grace" hits it exactly.
  assert.equal(matchSongIndex(LIB, "grace"), 2);
  // A query not in the library at all returns -1 (reported, never guessed).
  assert.equal(matchSongIndex(LIB, "How Great Is Our God"), -1);
});

test("empty / punctuation-only query never matches (no accidental first-song bind)", () => {
  assert.equal(matchSongIndex(LIB, ""), -1);
  assert.equal(matchSongIndex(LIB, "---"), -1);
  assert.equal(matchSongIndex(LIB, "  "), -1);
});

test("scripture label: single verse", () => {
  assert.equal(formatScriptureLabel({ book: "John", chapter: 3, verseStart: 16, verseEnd: 16 }), "John 3:16");
});
test("scripture label: same-chapter range", () => {
  assert.equal(formatScriptureLabel({ book: "Romans", chapter: 8, verseStart: 28, verseEnd: 39 }), "Romans 8:28-39");
});
test("scripture label: cross-chapter range keeps the end chapter", () => {
  assert.equal(formatScriptureLabel({ book: "Romans", chapter: 8, verseStart: 28, verseEnd: 5, chapterEnd: 9 }), "Romans 8:28-9:5");
});
test("scripture label: whole chapter has no verse", () => {
  assert.equal(formatScriptureLabel({ book: "Psalm", chapter: 23, verseStart: 1, verseEnd: null }), "Psalm 23");
});
