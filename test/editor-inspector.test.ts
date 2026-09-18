// PR 4 — inspector regrouped into Shape / Text / Build.
//
// CONTROL INVENTORY. Written BEFORE the regrouping, from the Design panel as it
// stood, and asserted after: no control may be lost, and none may be renamed
// into something a volunteer wouldn't recognise. If this file fails, a control
// went missing in the move — fix the panel, don't relax the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INSPECTOR_CONTROLS, INSPECTOR_SECTIONS, controlsFor, sectionsForKind, DEAD_CONTROLS,
  type InspectorControl,
} from "../src/lib/editor-inspector";

const modalSrc = readFileSync(new URL("../src/components/operator/pro/DesktopSlideEditorModal.tsx", import.meta.url), "utf8");
// The whole inspector: the shared DesignPanel plus every per-kind block
// (TextProps / ShapeProps / ImageProps / VideoProps, which live further down the
// file, after AddPanel).
const panel = [
  modalSrc.slice(modalSrc.indexOf("function DesignPanel"), modalSrc.indexOf("function AddPanel")),
  modalSrc.slice(modalSrc.indexOf("function TextProps")),
].join("\n");

// ---------- the inventory itself -------------------------------------------

test("the inventory is the complete pre-move control list", () => {
  // 34 controls were enumerated from the panel before the regrouping. This
  // number only goes UP, and never silently.
  assert.equal(INSPECTOR_CONTROLS.length, 34);
  const labels = INSPECTOR_CONTROLS.map((c) => c.label);
  assert.equal(new Set(labels).size, labels.length, "duplicate label in the inventory");
});

test("every control declares what it writes, or is explicitly editor-only", () => {
  for (const c of INSPECTOR_CONTROLS) {
    if (c.writes.length === 0) {
      assert.equal(c.label, "Layer order", `${c.label} writes nothing — is it a fake control?`);
    }
    assert.ok(c.kinds.length > 0, `${c.label} applies to no object kind`);
  }
});

test("no control does nothing (no-fake-controls)", () => {
  assert.deepEqual(DEAD_CONTROLS, [], "dead controls must be reported to the owner, not shipped");
});

// ---------- NOTHING WAS LOST ------------------------------------------------

test("NO REGRESSION — every inventoried control still renders", () => {
  const missing: string[] = [];
  for (const c of INSPECTOR_CONTROLS) {
    // A control is present if its exact operator-facing label appears, either as
    // a row label or as a toggle/button label.
    const asRow = panel.includes(`>${c.label}<`) || panel.includes(`>${c.label} `) || panel.includes(`>${c.label} —`);
    const asLabel = panel.includes(`label="${c.label}"`);
    // Toggles whose label changes with their state are matched on their pattern.
    const asPattern = !!c.labelPattern && panel.includes(c.labelPattern);
    if (!asRow && !asLabel && !asPattern) missing.push(c.label);
  }
  assert.deepEqual(missing, [], `these controls disappeared in the regrouping: ${missing.join(", ")}`);
});

test("NO REGRESSION — every control still writes the same object field", () => {
  const broken: string[] = [];
  for (const c of INSPECTOR_CONTROLS) {
    for (const field of c.writes) {
      // The panel must still patch this field somewhere.
      const patches = new RegExp(`\\b${field}\\s*:`).test(panel) || panel.includes(`{ ${field}`);
      if (!patches) broken.push(`${c.label} -> ${field}`);
    }
  }
  assert.deepEqual(broken, [], `these controls no longer write their field: ${broken.join(", ")}`);
});

test("NO REGRESSION — the object-level actions survived the move", () => {
  // These sit in the panel header, not in any tab.
  for (const t of ["Hide from projector", "Unlock", "Copy object", "Duplicate", "Delete"]) {
    assert.ok(panel.includes(t), `the ${t} action was lost`);
  }
  // Multi-select tools.
  for (const t of ["Align X", "Align Y", "Distribute — even spacing", "Duplicate all", "Delete all"]) {
    assert.ok(panel.includes(t), `the multi-select ${t} tool was lost`);
  }
  // Theme-mode-only role picker.
  assert.ok(panel.includes("This text box shows"), "the theme text-box role picker was lost");
  // PR 1's additions.
  assert.ok(panel.includes("Lock size (keep its shape)"), "the size lock was lost");
});

// ---------- the new grouping ------------------------------------------------

test("sections are PP7's vocabulary, in PP7's order", () => {
  assert.deepEqual(INSPECTOR_SECTIONS.map((s) => s.id), ["shape", "text", "build"]);
  assert.deepEqual(INSPECTOR_SECTIONS.map((s) => s.label), ["Shape", "Text", "Build"]);
});

test("every control lands in exactly one section, and no section is empty", () => {
  for (const s of INSPECTOR_SECTIONS) {
    assert.ok(controlsFor(s.id).length > 0, `${s.label} has no controls`);
  }
  const total = INSPECTOR_SECTIONS.reduce((n, s) => n + controlsFor(s.id).length, 0);
  assert.equal(total, INSPECTOR_CONTROLS.length);
});

test("a tab that would be empty for the selected object is not offered", () => {
  // Text objects get all three.
  assert.deepEqual(sectionsForKind("text"), ["shape", "text", "build"]);
  // A shape/image/video has no typography, so no Text tab — an always-empty tab
  // would read as broken.
  for (const k of ["shape", "image", "video"] as const) {
    const s = sectionsForKind(k);
    assert.ok(!s.includes("text"), `${k} must not be offered an empty Text tab`);
    assert.deepEqual(s, ["shape", "build"]);
  }
});

test("labels stay plain enough for a volunteer", () => {
  for (const c of INSPECTOR_CONTROLS as InspectorControl[]) {
    assert.ok(c.label.length <= 24, `${c.label} is too long for the panel`);
    // No jargon that only a designer would parse, and no Mac-only glyphs.
    assert.ok(!/[⌘⇧⌥]/.test(c.label));
    assert.ok(!/^(Stroke|Kerning|Tracking|Z-index|Alpha)$/i.test(c.label), `${c.label} is jargon`);
  }
});

test("the panel renders the tabs from the shared section list", () => {
  assert.match(panel, /sectionsForKind\(/);
  assert.match(panel, /INSPECTOR_SECTIONS/);
});
