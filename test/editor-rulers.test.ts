// PR 2 — rulers + View toggles.
//
// The headline risk the owner named: rulers change the canvas box, so every
// %-positioned overlay could move. The design avoids that rather than testing
// around it — the rulers are SIBLINGS of `[data-canvas-inner]`, drawn into the
// padding that already surrounded the canvas, and the canvas box keeps
// `absolute inset-0`. These tests lock that structure in, plus the prefs
// behaviour and the height budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_VIEW_PREFS, normalizeViewPrefs, loadViewPrefs, saveViewPrefs, VIEW_PREFS_KEY,
  rulerTicks, markerPct, rulersVisible, RULER_SIZE, RULER_PAD, RULER_MIN_VIEWPORT_H,
} from "../src/lib/editor-view-prefs";
import { CANVAS_W, CANVAS_H } from "../src/lib/slide-objects";

const canvasSrc = readFileSync(new URL("../src/components/operator/editor/SlideCanvas.tsx", import.meta.url), "utf8");
const modalSrc = readFileSync(new URL("../src/components/operator/pro/DesktopSlideEditorModal.tsx", import.meta.url), "utf8");

// ---------- defaults --------------------------------------------------------

test("rulers, grid and the transparency grid are OFF by default", () => {
  assert.equal(DEFAULT_VIEW_PREFS.rulers, false);
  assert.equal(DEFAULT_VIEW_PREFS.grid, false);
  assert.equal(DEFAULT_VIEW_PREFS.transparencyGrid, false);
});

test("NO REGRESSION — snap guides stay ON by default (they already shipped on)", () => {
  assert.equal(DEFAULT_VIEW_PREFS.snapGuides, true);
});

// ---------- prefs storage ---------------------------------------------------

test("a corrupt, partial or hostile stored value can never trap the operator", () => {
  assert.deepEqual(normalizeViewPrefs(null), DEFAULT_VIEW_PREFS);
  assert.deepEqual(normalizeViewPrefs("nonsense"), DEFAULT_VIEW_PREFS);
  assert.deepEqual(normalizeViewPrefs({ rulers: "yes" }), DEFAULT_VIEW_PREFS);
  // Unknown keys are dropped; known ones are honoured.
  assert.deepEqual(
    normalizeViewPrefs({ rulers: true, somethingElse: 1 }),
    { ...DEFAULT_VIEW_PREFS, rulers: true },
  );
});

test("prefs round-trip through storage, and a throwing storage degrades quietly", () => {
  const mem = new Map<string, string>();
  const ok = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
  };
  const prefs = { ...DEFAULT_VIEW_PREFS, rulers: true, grid: true };
  saveViewPrefs(prefs, ok);
  assert.equal(mem.has(VIEW_PREFS_KEY), true);
  assert.deepEqual(loadViewPrefs(ok), prefs);

  const boom = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  assert.deepEqual(loadViewPrefs(boom), DEFAULT_VIEW_PREFS);
  assert.doesNotThrow(() => saveViewPrefs(prefs, boom));
  // Unparseable JSON falls back rather than throwing into the render.
  mem.set(VIEW_PREFS_KEY, "{not json");
  assert.deepEqual(loadViewPrefs(ok), DEFAULT_VIEW_PREFS);
});

// ---------- ruler geometry --------------------------------------------------

test("ruler ticks are percentages, so they stay true at every zoom", () => {
  const ticks = rulerTicks(CANVAS_W);
  assert.equal(ticks.length, 17);           // 16 divisions, inclusive
  assert.equal(ticks[0].pct, 0);
  assert.equal(ticks[16].pct, 100);
  for (const t of ticks) assert.ok(t.pct >= 0 && t.pct <= 100);
  // Majors every quarter.
  assert.deepEqual(ticks.filter((t) => t.major).map((t) => t.pct), [0, 25, 50, 75, 100]);
});

test("ruler labels are canvas units, with the 0 and end labels omitted", () => {
  assert.deepEqual(rulerTicks(CANVAS_W).filter((t) => t.label).map((t) => t.label), ["480", "960", "1440"]);
  assert.deepEqual(rulerTicks(CANVAS_H).filter((t) => t.label).map((t) => t.label), ["270", "540", "810"]);
});

test("the pointer marker clamps to the canvas and survives junk input", () => {
  assert.equal(markerPct(960, CANVAS_W), 50);
  assert.equal(markerPct(-500, CANVAS_W), 0);
  assert.equal(markerPct(99999, CANVAS_W), 100);
  assert.equal(markerPct(Number.NaN, CANVAS_W), 0);
  assert.equal(markerPct(100, 0), 0);
});

// ---------- height budget ---------------------------------------------------

test("rulers auto-hide at 1366x768 @150% (911x512 CSS px) even when switched on", () => {
  const on = { ...DEFAULT_VIEW_PREFS, rulers: true };
  assert.equal(rulersVisible(on, 512), false, "must hide at the worst realistic Windows size");
  assert.equal(rulersVisible(on, 614), false, "1366x768 @125% is still too short");
  assert.equal(rulersVisible(on, 864), true, "1920x1080 @125% has room");
  // Off is off, whatever the height.
  assert.equal(rulersVisible(DEFAULT_VIEW_PREFS, 1080), false);
  assert.ok(RULER_MIN_VIEWPORT_H > 614);
});

test("a ruler gutter fits inside the padding, so the canvas box is not shrunk", () => {
  // The canvas column always had 16px of padding. Rulers widen it by only
  // RULER_PAD-16 px, and the gutter itself fits within RULER_PAD.
  assert.ok(RULER_SIZE <= RULER_PAD, "a gutter must fit in the padding it sits in");
  assert.ok(RULER_PAD - 16 <= 8, "rulers must not cost the canvas more than 8px");
});

// ---------- STRUCTURAL PARITY: overlays cannot move -------------------------
// Every overlay inside the canvas is positioned in % of `[data-canvas-inner]`.
// As long as that element keeps `absolute inset-0` of the aspect box, and the
// rulers are drawn OUTSIDE it, no overlay can shift when rulers are toggled.

test("PARITY — the canvas box is still absolute inset-0 of the aspect wrapper", () => {
  assert.match(canvasSrc, /data-canvas-inner\s*\n\s*className="absolute inset-0/);
});

test("PARITY — rulers render OUTSIDE the canvas box, never inside it", () => {
  // The JSX attribute (not the querySelector string near the top of the file).
  const inner = canvasSrc.indexOf("\n          data-canvas-inner");
  assert.ok(inner > 0, "the canvas box must still be rendered");
  const rulersAt = canvasSrc.indexOf("{showRulers && <CanvasRulers");
  assert.ok(rulersAt > 0, "rulers must be rendered");
  assert.ok(rulersAt < inner, "rulers must be a sibling BEFORE the canvas box, not a child");
  // They are pulled into the padding with negative offsets.
  assert.match(canvasSrc, /top: -RULER_SIZE/);
  assert.match(canvasSrc, /left: -RULER_SIZE/);
});

test("PARITY — every in-canvas overlay is still positioned in percent", () => {
  // Projection-Zone preview (outer + inner rects).
  assert.match(canvasSrc, /pct\(zoneRects\.outer\.x, CANVAS_W\)/);
  assert.match(canvasSrc, /pct\(zoneRects\.inner\.x, CANVAS_W\)/);
  // Snap guides.
  assert.match(canvasSrc, /guides\.x \/ CANVAS_W\) \* 100/);
  assert.match(canvasSrc, /guides\.y \/ CANVAS_H\) \* 100/);
  // Marquee.
  assert.match(canvasSrc, /marquee\.x \/ CANVAS_W\) \* 100/);
  // Object badges.
  assert.match(canvasSrc, /left: `\$\{\(o\.x \/ CANVAS_W\) \* 100\}%`/);
  // The objects themselves.
  assert.match(canvasSrc, /left: `\$\{\(obj\.x \/ CANVAS_W\) \* 100\}%`/);
});

test("PARITY — the grid and checker paint inside the canvas without laying anything out", () => {
  for (const frag of ["view.transparencyGrid", "view.grid"]) {
    const at = canvasSrc.indexOf(frag);
    assert.ok(at > canvasSrc.indexOf("data-canvas-inner"), `${frag} must render inside the canvas box`);
  }
  // Both are click-through and sit under every object.
  const gridBlock = canvasSrc.slice(canvasSrc.indexOf("view.grid"), canvasSrc.indexOf("view.grid") + 400);
  assert.match(gridBlock, /pointer-events-none absolute inset-0 z-0/);
  // The checker never covers a background the operator set.
  assert.match(canvasSrc, /view\.transparencyGrid && !slide\.bgColor && !slide\.bgImageUrl && !backgroundNode/);
});

test("PARITY — with no view prop the canvas behaves exactly as before", () => {
  assert.match(canvasSrc, /view = DEFAULT_VIEW_PREFS/);
  // Snapping is only disabled when the operator turns guides off.
  assert.match(canvasSrc, /const T = snapRef\.current \? 20 : 0;/);
});

// ---------- Windows ---------------------------------------------------------

test("the View menu is a labelled button, scrollable, and height-capped", () => {
  const menu = modalSrc.slice(modalSrc.indexOf("function ViewMenu"), modalSrc.indexOf("// ── Status bar"));
  assert.match(menu, /Ruler className="w-3 h-3" \/> View/);   // visible text label, not icon-only
  assert.match(menu, /max-h-\[60vh\] overflow-y-auto/);        // fits a 512px tall screen
  assert.match(menu, /max-w-\[calc\(100vw-24px\)\]/);
  assert.match(menu, /role="checkbox"/);
  assert.match(menu, /aria-checked=\{on\}/);
  assert.ok(!/[⌘⇧⌥]/.test(menu), "no Mac-only modifier glyphs");
});

test("prefs load after mount, so the server and first client render agree", () => {
  assert.match(modalSrc, /useState<EditorViewPrefs>\(DEFAULT_VIEW_PREFS\)/);
  assert.match(modalSrc, /useEffect\(\(\) => \{ setViewPrefs\(loadViewPrefs\(\)\); \}, \[\]\)/);
});

// ---------- RENDER MATRIX: the projector cannot see any of this -------------
// PR 2 is editor-only. The proof is structural: no view/ruler concept reaches
// any output renderer, and nothing about the published slide changes.

test("PARITY — no output renderer imports the editor's view prefs", () => {
  const outputs = [
    "src/components/live/SlideObjectsLayer.tsx",
    "src/components/live/SlideRenderer.tsx",
    "src/lib/broadcast.ts",
  ];
  for (const f of outputs) {
    const out = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    for (const banned of ["editor-view-prefs", "rulerTicks", "transparencyGrid", "snapGuides", "RULER_"]) {
      assert.ok(!out.includes(banned), `${f} must not know about ${banned}`);
    }
  }
});

test("PARITY — view prefs never reach the DB or the wire", () => {
  // They live in localStorage under a versioned key and nowhere else.
  assert.match(VIEW_PREFS_KEY, /^presentflow\.editor\.view\./);
  // No server action knows the concept at all.
  const actions = readFileSync(new URL("../src/lib/actions.ts", import.meta.url), "utf8");
  for (const banned of ["viewPrefs", "editor-view-prefs", "rulers"]) {
    assert.ok(!actions.includes(banned), `actions.ts must not know about ${banned}`);
  }
  // The prefs module talks to nothing but localStorage — no imports at all.
  const prefsSrc = readFileSync(new URL("../src/lib/editor-view-prefs.ts", import.meta.url), "utf8");
  assert.ok(!/^import /m.test(prefsSrc), "view prefs must stay dependency-free");
  for (const banned of ["fetch(", "supabase", "publishOutput", "BroadcastChannel"]) {
    assert.ok(!prefsSrc.includes(banned), `view prefs must not use ${banned}`);
  }
});

test("NO REGRESSION — the canvas column keeps its zone controls and warnings", () => {
  assert.match(modalSrc, /<CanvasWarnings slide=\{editor\.currentSlide\}/);
  assert.match(modalSrc, /<ProjectionZoneControls className="shrink-0 border-t"/);
});
