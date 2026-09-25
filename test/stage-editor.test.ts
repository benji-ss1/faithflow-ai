/**
 * Stage layout editing — reachable, draggable, and joined to timers.
 * Run: npx tsx --test test/stage-editor.test.ts
 *
 * User direction 2026-09-22: "we should be able to click into these layouts
 * and pick the ones we want… there should be an option to create it… make it
 * intertwined with the timers section."
 *
 * The model was complete before this; what was missing was every way of
 * reaching it. So these assert REACHABILITY, which is the class of bug this
 * subsystem keeps producing (docs/ONE_TO_ONE_LOOP.md — a capability an
 * operator cannot reach does not exist).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clampRect, sanitizeStageLayout, STAGE_WIDGET_KINDS } from "../src/engine/stage";

const panel = readFileSync("src/components/operator/pro/right/StageLayoutPanel.tsx", "utf8");
const canvas = readFileSync("src/components/operator/pro/right/StageCanvas.tsx", "utf8");
const hook = readFileSync("src/components/operator/pro/right/useStageLayouts.ts", "utf8");
const timersPanel = readFileSync("src/components/operator/pro/right/TimersPanel.tsx", "utf8");
const bar = readFileSync("src/components/operator/pro/right/RightIconBar.tsx", "utf8");

test("a layout can be put on the stage in ONE click", () => {
  assert.match(hook, /use: \(layoutId/, "the hook must expose a one-click use()");
  assert.match(panel, /onClick=\{\(\) => api\.use\(l\.id\)\}/,
    "the thumbnail itself must be the button — picking a design is the commonest action here");
});

test("choosing a layout does not require understanding stage screens first", () => {
  // use() creates the screen when none exists. Without this an operator has to
  // discover that a "stage screen" is a separate object before any design can
  // be applied at all.
  const fn = hook.slice(hook.indexOf("const use = useCallback"));
  assert.match(fn.slice(0, 900), /createStageScreen/);
});

test("the operator can see which layout is live", () => {
  assert.match(hook, /activeLayoutId/);
  assert.match(panel, /On stage/);
});

test("a blank layout can be created", () => {
  assert.match(hook, /createBlank/, "there must be a way to start from nothing");
  assert.match(panel, /New layout/);
});

test("the editor is a DRAGGABLE canvas, not a coordinate form", () => {
  assert.match(panel, /<StageCanvas/);
  assert.match(canvas, /onPointerDown/, "must support pointer drag");
  assert.match(canvas, /setPointerCapture/, "a fast drag leaving the canvas must still track");
  assert.match(canvas, /touchAction: "none"/, "a touchscreen operator machine must not scroll the page while dragging");
  assert.match(canvas, /cursor-nwse-resize/, "there must be a resize handle");
});

test("the canvas is not mouse-only", () => {
  assert.match(canvas, /ArrowLeft/, "keyboard nudge keeps it usable without a pointer");
});

test("a widget can never be dragged off the canvas", () => {
  // clampRect is what the drag calls on every move; if it stopped bounding,
  // a box could be lost somewhere the operator cannot click it back from.
  assert.match(canvas, /clampRect\(/);
  const off = clampRect({ x: 5, y: -3, w: 0.5, h: 0.5 });
  assert.ok(off.x >= 0 && off.x <= 0.5 && off.y >= 0 && off.y <= 0.5, JSON.stringify(off));
  const huge = clampRect({ x: 0, y: 0, w: 99, h: 99 });
  assert.ok(huge.w <= 1 && huge.h <= 1);
});

test("timers and stage layouts reference each other", () => {
  assert.match(timersPanel, /StageUsage/, "a timer must say which stage layouts place it");
  assert.match(bar, /onOpenStage=\{\(\) => setOpenKey\("stage"\)\}/,
    "the timers panel must be able to open the stage panel");
  assert.match(panel, /have not made any timers yet/,
    "a timer box with no timers to bind must explain itself, not silently render a dash");
});

test("the canvas and the thumbnails show the same thing", () => {
  // Two sample-text implementations is how the small picture and the editor
  // start disagreeing about what a box is.
  assert.match(panel, /function sampleText\(/);
  assert.equal((panel.match(/function sampleText\(/g) ?? []).length, 1);
  assert.match(panel, /preview=\{sampleText\}/);
});

test("an empty layout survives a round trip", () => {
  // createBlank writes {widgets: []}; sanitize must not turn that into junk.
  const out = sanitizeStageLayout({ id: "x", name: "My layout", background: "#000000", widgets: [] });
  assert.deepEqual(out.widgets, []);
  assert.equal(out.name, "My layout");
  assert.equal(out.background, "#000000");
});

test("an unknown widget kind is dropped, not rendered blank", () => {
  const out = sanitizeStageLayout({ widgets: [{ kind: "hologram" }, { kind: STAGE_WIDGET_KINDS[0] }] });
  assert.equal(out.widgets.length, 1);
});
