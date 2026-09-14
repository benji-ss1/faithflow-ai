/**
 * Groups & Arrangements pure-model tests (ProPresenter §12 / MVP §9).
 * Run: npx tsx --test test/arrangements.test.ts
 *
 * Locks the two load-bearing invariants:
 *   - NO-REGRESSION: a song with no groups (or an undefined/unknown pin) expands
 *     to its natural slide order, byte-identical to today.
 *   - EDIT-ONCE-UPDATE-EVERYWHERE: a repeated group yields the SAME slide
 *     identities, so one edit propagates to every arrangement instance.
 * Plus cue-sheet agreement: an arranged expansion drives buildCueSheet in order.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expandArrangement,
  masterOrder,
  hasGroups,
  slidesInGroup,
  groupColor,
  GROUP_KIND_COLORS,
  type ArrangedSong,
  type SlideRef,
} from "../src/engine/arrangements";
import { buildCueSheet } from "../src/engine/cue-sheet";
import type { ExpandedPlan } from "../src/lib/server/services";

type Body = { lyrics: string };

// A song: 5 slides. Verse 1 (v1a,v1b), Chorus (c1,c2), Verse 2 (v2a).
function makeSong(): ArrangedSong<Body> {
  const slides: SlideRef<Body>[] = [
    { id: "v1a", groupId: "gV1", lyrics: "verse one line a" },
    { id: "v1b", groupId: "gV1", lyrics: "verse one line b" },
    { id: "c1", groupId: "gC", lyrics: "chorus line 1" },
    { id: "c2", groupId: "gC", lyrics: "chorus line 2" },
    { id: "v2a", groupId: "gV2", lyrics: "verse two line a" },
  ];
  return {
    songId: "song1",
    slides,
    groups: [
      { id: "gV1", name: "Verse 1", kind: "verse", color: null, order: 0 },
      { id: "gC", name: "Chorus", kind: "chorus", color: null, order: 1 },
      { id: "gV2", name: "Verse 2", kind: "verse", color: null, order: 2 },
    ],
    arrangements: [
      // V1, C, V2, C, C — chorus repeats 3x total
      { id: "arrLong", name: "Worship Night", isDefault: false, sort: 0, order: ["gV1", "gC", "gV2", "gC", "gC"] },
      // C, V1 only
      { id: "arrShort", name: "Reprise", isDefault: false, sort: 1, order: ["gC", "gV1"] },
    ],
  };
}

test("no-regression: undefined pin returns natural order unchanged (same identity)", () => {
  const s = makeSong();
  const out = expandArrangement(s, undefined);
  assert.strictEqual(out, s.slides, "must return the exact slides array reference");
  assert.deepEqual(out.map((x) => x.id), ["v1a", "v1b", "c1", "c2", "v2a"]);
});

test("no-regression: a song with NO groups/arrangements expands natural even with a pin", () => {
  const s: ArrangedSong<Body> = {
    songId: "plain",
    slides: [
      { id: "s0", groupId: null, lyrics: "a" },
      { id: "s1", groupId: null, lyrics: "b" },
    ],
    groups: [],
    arrangements: [],
  };
  assert.deepEqual(expandArrangement(s, "whatever").map((x) => x.id), ["s0", "s1"]);
  assert.equal(hasGroups(s), false);
});

test("unknown arrangement id falls back to master order (no dead-end)", () => {
  const s = makeSong();
  assert.deepEqual(expandArrangement(s, "does-not-exist").map((x) => x.id), ["v1a", "v1b", "c1", "c2", "v2a"]);
});

test("custom arrangement expands groups in order, repeatable", () => {
  const s = makeSong();
  const out = expandArrangement(s, "arrLong");
  assert.deepEqual(out.map((x) => x.id), [
    "v1a", "v1b", // V1
    "c1", "c2",   // C
    "v2a",        // V2
    "c1", "c2",   // C again
    "c1", "c2",   // C again
  ]);
});

test("edit-once: repeated group yields the SAME slide identities", () => {
  const s = makeSong();
  const out = expandArrangement(s, "arrLong");
  const firstChorus = out[2]; // c1
  const secondChorus = out[5]; // c1 again
  const thirdChorus = out[7]; // c1 again
  assert.strictEqual(firstChorus, secondChorus, "same physical slide object");
  assert.strictEqual(firstChorus, thirdChorus);
  // Mutating (as an edit would, in-place) is visible at every instance.
  (firstChorus as Body).lyrics = "EDITED";
  assert.equal((out[5] as Body).lyrics, "EDITED");
  assert.equal((out[7] as Body).lyrics, "EDITED");
});

test("short arrangement selects + reorders groups", () => {
  const s = makeSong();
  assert.deepEqual(expandArrangement(s, "arrShort").map((x) => x.id), ["c1", "c2", "v1a", "v1b"]);
});

test("deleted group id in an arrangement order is skipped, not fatal", () => {
  const s = makeSong();
  s.arrangements.push({ id: "arrGap", name: "Gap", isDefault: false, sort: 2, order: ["gV1", "ghost", "gC"] });
  assert.deepEqual(expandArrangement(s, "arrGap").map((x) => x.id), ["v1a", "v1b", "c1", "c2"]);
});

test("slidesInGroup + masterOrder + hasGroups", () => {
  const s = makeSong();
  assert.deepEqual(slidesInGroup(s, "gC").map((x) => x.id), ["c1", "c2"]);
  assert.deepEqual(masterOrder(s), ["gV1", "gC", "gV2"]);
  assert.equal(hasGroups(s), true);
});

test("groupColor: explicit override wins, else palette-by-kind, else custom", () => {
  assert.equal(groupColor({ kind: "chorus", color: "#123456" }), "#123456");
  assert.equal(groupColor({ kind: "chorus", color: null }), GROUP_KIND_COLORS.chorus);
  assert.equal(groupColor({ kind: "weird", color: null }), GROUP_KIND_COLORS.custom);
  assert.equal(groupColor({ kind: "chorus", color: "not-a-hex" }), GROUP_KIND_COLORS.chorus);
});

test("groupColor: name-aware disambiguation of same-kind sections", () => {
  // Regression: omitting name == the old palette-by-kind result (unchanged).
  assert.equal(groupColor({ kind: "verse", color: null }), GROUP_KIND_COLORS.verse);
  assert.equal(groupColor({ kind: "verse", color: null, name: "Verse 1" }), GROUP_KIND_COLORS.verse);

  // Verse 1/2/3 (all kind:"verse") must render DISTINCT colours now.
  const v1 = groupColor({ kind: "verse", color: null, name: "Verse 1" });
  const v2 = groupColor({ kind: "verse", color: null, name: "Verse 2" });
  const v3 = groupColor({ kind: "verse", color: null, name: "Verse 3" });
  assert.notEqual(v1, v2);
  assert.notEqual(v2, v3);
  assert.notEqual(v1, v3);

  // Pre-Chorus (stored kind:"chorus") must NOT be the same red as Chorus.
  const chorus = groupColor({ kind: "chorus", color: null, name: "Chorus" });
  const pre = groupColor({ kind: "chorus", color: null, name: "Pre-Chorus" });
  assert.equal(chorus, GROUP_KIND_COLORS.chorus);
  assert.notEqual(pre, chorus);
  assert.equal(pre, groupColor({ kind: "chorus", color: null, name: "Pre Chorus" })); // spacing variant
  assert.equal(pre, groupColor({ kind: "chorus", color: null, name: "prechorus" }));  // no-hyphen variant

  // Explicit override still wins even when a name is present.
  assert.equal(groupColor({ kind: "verse", color: "#abcdef", name: "Verse 2" }), "#abcdef");
});

test("cue-sheet agreement: an arranged expansion drives buildCueSheet in order", () => {
  const s = makeSong();
  const arrangedSlides = expandArrangement(s, "arrLong").map((r) => ({ kind: "text" as const, text: (r as Body).lyrics }));
  // Simulate the loader having produced a plan item whose slides are the arranged list.
  const plan: ExpandedPlan = {
    id: "plan1",
    title: "Sunday",
    blankBgColor: "#000000",
    items: [{ id: "item1", order: 0, type: "song", title: "Yes I Will", slides: arrangedSlides }],
  };
  const sheet = buildCueSheet(plan);
  assert.equal(sheet.length, 9, "9 cues = 9 arranged slides (chorus x3)");
  assert.deepEqual(sheet.map((c) => (c.slide as { text?: string }).text), [
    "verse one line a", "verse one line b",
    "chorus line 1", "chorus line 2",
    "verse two line a",
    "chorus line 1", "chorus line 2",
    "chorus line 1", "chorus line 2",
  ]);
  // Every cue points at the arranged song item.
  assert.ok(sheet.every((c) => c.itemType === "song"));
});
