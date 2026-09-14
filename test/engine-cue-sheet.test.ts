/**
 * engine/cue-sheet tests — build + navigation over a fixture plan, incl. the
 * header-skip invariant (headers carry slides:[] and must never become cues,
 * and next/prev must step over them via the shared nextPreviewPosition walk).
 *
 * Run: npx tsx --test test/engine-cue-sheet.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCueSheet, cueAt, nextCue, prevCue } from "../src/engine/cue-sheet";
import type { ExpandedPlan } from "../src/lib/server/services";
import type { SlidePayload } from "../src/lib/broadcast";

const txt = (t: string): SlidePayload => ({ kind: "text", text: t });

const PLAN: ExpandedPlan = {
  id: "plan-1",
  title: "Sunday",
  blankBgColor: "#000000",
  items: [
    { id: "i0", order: 0, type: "song", title: "Way Maker", slides: [txt("v1"), txt("v2")] },
    // Header divider — no slides, must be skipped everywhere.
    { id: "i1", order: 1, type: "header", title: "SERMON", slides: [], color: "#ff0000" },
    { id: "i2", order: 2, type: "scripture", title: "John 3:16", slides: [txt("s1"), txt("s2")] },
  ],
};

test("buildCueSheet flattens content slides and excludes headers", () => {
  const sheet = buildCueSheet(PLAN);
  assert.equal(sheet.length, 4, "2 song + 2 scripture slides, header contributes 0");
  assert.ok(!sheet.some((e) => e.itemType === "header"), "no header cue exists");
  assert.ok(!sheet.some((e) => e.isHeader), "isHeader is never true in a built sheet");
});

test("cue entries carry real item metadata + stable slideId", () => {
  const sheet = buildCueSheet(PLAN);
  assert.equal(sheet[0].itemId, "i0");
  assert.equal(sheet[0].itemTitle, "Way Maker");
  assert.equal(sheet[0].itemType, "song");
  assert.equal(sheet[0].slideId, "i0-0");
  assert.equal(sheet[3].slideId, "i2-1");
  assert.equal(sheet[3].itemType, "scripture");
});

test("cueAt resolves an exact position", () => {
  const sheet = buildCueSheet(PLAN);
  assert.equal(cueAt(sheet, { itemIdx: 2, slideIdx: 1 })?.slide, PLAN.items[2].slides[1]);
  assert.equal(cueAt(sheet, { itemIdx: 1, slideIdx: 0 }), null, "header pos has no cue");
});

test("nextCue steps within an item", () => {
  const sheet = buildCueSheet(PLAN);
  const n = nextCue(PLAN, sheet, { itemIdx: 0, slideIdx: 0 });
  assert.deepEqual([n?.itemIdx, n?.slideIdx], [0, 1]);
});

test("nextCue SKIPS the header item when crossing item boundary", () => {
  const sheet = buildCueSheet(PLAN);
  const n = nextCue(PLAN, sheet, { itemIdx: 0, slideIdx: 1 });
  assert.deepEqual([n?.itemIdx, n?.slideIdx], [2, 0], "song end → scripture start, header skipped");
});

test("nextCue returns null at the end of the sheet", () => {
  const sheet = buildCueSheet(PLAN);
  assert.equal(nextCue(PLAN, sheet, { itemIdx: 2, slideIdx: 1 }), null);
});

test("prevCue SKIPS the header going backwards", () => {
  const sheet = buildCueSheet(PLAN);
  const p = prevCue(PLAN, sheet, { itemIdx: 2, slideIdx: 0 });
  assert.deepEqual([p?.itemIdx, p?.slideIdx], [0, 1], "scripture start → song end, header skipped");
});

test("prevCue returns null at the start of the sheet", () => {
  const sheet = buildCueSheet(PLAN);
  assert.equal(prevCue(PLAN, sheet, { itemIdx: 0, slideIdx: 0 }), null);
});

test("empty plan yields an empty sheet and null navigation", () => {
  const empty: ExpandedPlan = { id: "p", title: "", blankBgColor: "#000", items: [] };
  const sheet = buildCueSheet(empty);
  assert.equal(sheet.length, 0);
  assert.equal(nextCue(empty, sheet, { itemIdx: 0, slideIdx: 0 }), null);
});
