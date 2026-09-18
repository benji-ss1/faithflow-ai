// PR 3 — object toolbar. Discoverability, not a rewrite: the toolbar must expose
// exactly the object kinds the editor can create, and the right drawer's "Add"
// tab must STILL be there (CLAUDE.md rule 0 — never unwire a working path).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OBJECT_TOOLBAR_ITEMS, toolbarSources } from "../src/lib/editor-toolbar";

const MODAL = "src/components/operator/pro/DesktopSlideEditorModal.tsx";
const src = readFileSync(new URL(`../${MODAL}`, import.meta.url), "utf8");

test("the toolbar covers every object kind the editor can create", () => {
  assert.deepEqual(toolbarSources(), ["text", "rect", "ellipse", "image", "video"]);
});

test("only media entries open the media library", () => {
  const media = OBJECT_TOOLBAR_ITEMS.filter((i) => i.needsMedia).map((i) => i.source);
  assert.deepEqual(media, ["image", "video"]);
});

test("every label is a real word, never a glyph (Windows rule)", () => {
  for (const it of OBJECT_TOOLBAR_ITEMS) {
    assert.ok(/^[A-Z][a-z]+$/.test(it.label), `${it.label} is not a plain label`);
    // No Mac-only modifier glyphs anywhere in the visible name.
    assert.ok(!/[⌘⇧⌥]/.test(it.label));
  }
});

test("no fake controls — PP7's unsupported object kinds are absent", () => {
  const sources = new Set<string>(toolbarSources());
  // PP7 offers these; our renderers do not support them (plan §3).
  for (const banned of ["videoInput", "website", "web", "arrow", "star", "pen"]) {
    assert.equal(sources.has(banned), false, `${banned} must not be offered`);
  }
});

// ---------- no-regression: the drawer's Add tab survives -------------------

test("NO REGRESSION — the right drawer still has its Add tab", () => {
  assert.match(src, /id: "add", label: "Add"/);
  assert.match(src, /tab === "add" && <AddPanel/);
});

test("NO REGRESSION — AddPanel still offers Text, Rect, Ellipse, Image and Video", () => {
  const addPanel = src.slice(src.indexOf("function AddPanel"));
  for (const label of ["Text", "Rect", "Ellipse", "Image", "Video"]) {
    assert.ok(addPanel.includes(`label="${label}"`), `AddPanel lost its ${label} button`);
  }
});

test("the toolbar is driven by the shared list, not a second hardcoded one", () => {
  assert.match(src, /OBJECT_TOOLBAR_ITEMS\.map/);
  // It renders only when the slide is actually editable.
  assert.match(src, /isSong && <ObjectToolbar/);
});

test("toolbar buttons carry both a title and an accessible name", () => {
  const bar = src.slice(src.indexOf("function ObjectToolbar"), src.indexOf("function EditorStatusBar"));
  assert.match(bar, /title=\{it\.label\}/);
  assert.match(bar, /aria-label=\{it\.label\}/);
  assert.match(bar, /role="toolbar"/);
  // Labels may collapse on narrow WINDOWS viewports only — the Mac class list
  // must be untouched (docs/WINDOWS_DESIGN.md §9.2).
  assert.match(bar, /\[html\[data-platform=win\]_&\]:max-\[1180px\]:hidden/);
  // The row is a fixed, scrollable strip that shrinks to 28px on a short
  // viewport, so it can't squeeze the canvas at 1366x768 @150% (512 CSS px).
  assert.match(bar, /h-9 \[@media\(max-height:620px\)\]:h-7 overflow-x-auto/);
});
