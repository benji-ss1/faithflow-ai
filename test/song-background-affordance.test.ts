/**
 * Per-slide song backgrounds were REACHABLE but INVISIBLE (owner, 2026-09-20: "you can't
 * edit the songs one unless you change the whole theme"). The capability already existed
 * — drag from the Media bin onto a slide, or right-click → Background — but no button
 * advertised it, and the only visible background button ("BG" in the Media bin) is the
 * GLOBAL one, which is exactly the change-everything behaviour he was objecting to.
 *
 * This locks the two additions: a visible per-card Background button, and a "Choose
 * image…" entry so you no longer have to drag one in first.
 * Run: npx tsx test/song-background-affordance.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const grid = readFileSync(new URL("../src/components/operator/pro/center/SlideGrid.tsx", import.meta.url), "utf8");

console.log("the visible affordance:");
check("each song slide card carries a Background button", () => {
  assert.match(grid, /aria-label="Background for this slide"/);
});
check("it is gated to items that can actually take one (songs with a songId)", () => {
  const i = grid.indexOf('aria-label="Background for this slide"');
  const before = grid.slice(Math.max(0, i - 800), i);
  assert.match(before, /bgMenu && bgMenu\.canEdit/);
  assert.match(grid, /canEdit: item\?\.type === "song" && !!\(item as \{ songId\?: string \}\)\.songId/);
});
check("it opens the EXISTING menu rather than duplicating the logic", () => {
  const i = grid.indexOf('aria-label="Background for this slide"');
  const block = grid.slice(i, i + 900);
  assert.match(block, /openContextMenuAt\(e\.currentTarget\.closest\("button"\)\)/);
});
check("clicking it never selects or fires the slide", () => {
  const i = grid.indexOf('aria-label="Background for this slide"');
  const block = grid.slice(i, i + 900);
  assert.match(block, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(block, /onDoubleClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(block, /e\.preventDefault\(\); e\.stopPropagation\(\);/);
});

console.log("choosing an image without dragging one in:");
check("the Background submenu offers Choose image…", () => {
  assert.match(grid, /Choose image…/);
  assert.match(grid, /onSelect=\{\(\) => bgMenu\.onChooseImage\(\)\}/);
});
check("it opens the media library picker and applies the pick to THAT slide", () => {
  assert.match(grid, /onChooseImage: \(\) => setBgPickIdx\(idx\)/);
  assert.match(grid, /<MediaLibraryPicker[\s\S]{0,200}kind="image"/);
  assert.match(grid, /if \(i !== null\) applyChosenBackground\(i, url\)/);
});
check("applying reuses the existing per-slide persistence, not a new path", () => {
  const fn = grid.slice(grid.indexOf("const applyChosenBackground"), grid.indexOf("const dropMediaOnSlide"));
  assert.match(fn, /setSongSlideBackgroundImage\(slideId, url\)/, "songs -> song_slides");
  assert.match(fn, /setServiceItemSlideBackground\(itemId, idx, url\)/, "other items -> service item payload");
});
check("it paints instantly and re-sends live when that slide is the one on the projector", () => {
  const fn = grid.slice(grid.indexOf("const applyChosenBackground"), grid.indexOf("const dropMediaOnSlide"));
  assert.match(fn, /setOptimisticBg/);
  assert.match(fn, /idx === liveSlideIdx/);
  assert.match(fn, /carryLiveOrigin: true/, "keeps origin so anti-replay still identifies the slide");
});
check("a failed save rolls the optimistic paint back", () => {
  const fn = grid.slice(grid.indexOf("const applyChosenBackground"), grid.indexOf("const dropMediaOnSlide"));
  assert.match(fn, /const revert = \(\) => setOptimisticBg/);
  assert.equal((fn.match(/revert\(\);/g) ?? []).length >= 3, true, "reverts on every failure path");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
