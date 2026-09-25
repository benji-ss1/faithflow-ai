/**
 * src/engine/stage — pure stage-layout model tests.
 * Run: npx tsx --test test/stage-layout-engine.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampRect,
  sanitizeStageLayout, STAGE_MAX_WIDGETS,
  STAGE_SCALE_MIN, STAGE_SCALE_MAX, STAGE_WIDGET_KINDS, STAGE_WIDGET_LABELS,
  type StageWidget,
} from "../src/engine/stage";
import { BUILT_IN_STAGE_LAYOUTS, isBuiltInStageLayout, duplicateStageLayout } from "../src/engine/stage/presets";

const W = (p: Partial<StageWidget> & Pick<StageWidget, "kind">): StageWidget => ({
  id: "w", rect: { x: 0, y: 0, w: 0.5, h: 0.2 }, scale: 1, align: "center", zIndex: 0, ...p,
});

// ── clampRect ──────────────────────────────────────────────────────────────
test("clampRect keeps a widget on canvas", () => {
  assert.deepEqual(clampRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }), { w: 0.5, h: 0.5, x: 0.5, y: 0.5 });
  assert.deepEqual(clampRect({ x: -1, y: -1, w: 0.2, h: 0.2 }), { w: 0.2, h: 0.2, x: 0, y: 0 });
});

test("clampRect survives NaN/Infinity instead of producing an invisible widget", () => {
  const r = clampRect({ x: NaN, y: Infinity, w: NaN, h: -5 });
  for (const v of Object.values(r)) assert.ok(Number.isFinite(v), "no NaN may escape");
  assert.ok(r.w >= 0.01 && r.h >= 0.01);
});

// ── colour triggers (the ProPresenter-documented example) ──────────────────



// ── formatting ─────────────────────────────────────────────────────────────


// ── widget resolution ──────────────────────────────────────────────────────




// ── sanitize (untrusted input) ─────────────────────────────────────────────
test("sanitize drops unknown widget kinds but keeps the rest", () => {
  const l = sanitizeStageLayout({ widgets: [{ kind: "nope" }, { kind: "clock", rect: { x: 0, y: 0, w: 0.2, h: 0.1 } }] });
  assert.equal(l.widgets.length, 1);
  assert.equal(l.widgets[0].kind, "clock");
});

test("sanitize bounds widget count and scale", () => {
  const many = Array.from({ length: 100 }, () => ({ kind: "clock", rect: { x: 0, y: 0, w: 0.1, h: 0.1 } }));
  assert.equal(sanitizeStageLayout({ widgets: many }).widgets.length, STAGE_MAX_WIDGETS);
  const s = sanitizeStageLayout({ widgets: [{ kind: "clock", scale: 999, rect: {} }] }).widgets[0];
  assert.ok(s.scale <= STAGE_SCALE_MAX && s.scale >= STAGE_SCALE_MIN);
});

test("a widget cannot carry its own colour triggers — the TIMER owns them", () => {
  // 2026-09-25: widget-level colorTriggers/overrunColor were sanitised,
  // persisted, and set by four of five built-in presets, while the renderer
  // read the TIMER's. Two sources for one answer is how the stage screen and
  // the operator panel drift apart, so the widget copy is gone. If it ever
  // comes back, this fails.
  const w = sanitizeStageLayout({
    widgets: [{ kind: "timer", rect: {}, colorTriggers: [{ atSec: 5, color: "#ff0000" }], overrunColor: "#ff0000" }],
  }).widgets[0] as unknown as Record<string, unknown>;
  assert.equal(w.colorTriggers, undefined);
  assert.equal(w.overrunColor, undefined);
});

test("sanitize de-duplicates widget ids (React keys must be unique)", () => {
  const l = sanitizeStageLayout({ widgets: [{ id: "a", kind: "clock", rect: {} }, { id: "a", kind: "clock", rect: {} }] });
  assert.equal(new Set(l.widgets.map((x) => x.id)).size, l.widgets.length);
});

test("sanitize fails open on junk rather than blanking the stage screen", () => {
  for (const junk of [null, undefined, 42, "x", [], { widgets: "no" }]) {
    const l = sanitizeStageLayout(junk);
    assert.ok(typeof l.name === "string" && l.name.length > 0);
    assert.ok(Array.isArray(l.widgets));
  }
});

test("sanitize strips prototype-pollution keys without crashing", () => {
  const l = sanitizeStageLayout(JSON.parse('{"name":"x","__proto__":{"polluted":true},"widgets":[]}'));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(l.name, "x");
});

test("sanitize orders widgets by zIndex", () => {
  const l = sanitizeStageLayout({
    widgets: [{ id: "b", kind: "clock", rect: {}, zIndex: 5 }, { id: "a", kind: "clock", rect: {}, zIndex: 1 }],
  });
  assert.deepEqual(l.widgets.map((x) => x.id), ["a", "b"]);
});

// ── built-in presets ───────────────────────────────────────────────────────
test("built-ins are unique, sane and survive sanitize unchanged", () => {
  const ids = BUILT_IN_STAGE_LAYOUTS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const l of BUILT_IN_STAGE_LAYOUTS) {
    assert.ok(l.name.trim().length > 0);
    assert.ok(l.widgets.length > 0, `${l.id} must not be empty`);
    assert.deepEqual(sanitizeStageLayout(l), sanitizeStageLayout(sanitizeStageLayout(l)), `${l.id} sanitize is idempotent`);
    for (const w of l.widgets) {
      const r = w.rect;
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, `${l.id}/${w.id} must fit the canvas`);
    }
    assert.ok(isBuiltInStageLayout(l.id));
  }
  assert.equal(isBuiltInStageLayout("nope"), false);
});

test("built-in widgets never overlap within a layout", () => {
  // Stage screens are read at a glance; overlapping boxes would be unreadable.
  for (const l of BUILT_IN_STAGE_LAYOUTS) {
    for (let i = 0; i < l.widgets.length; i++) {
      for (let j = i + 1; j < l.widgets.length; j++) {
        const a = l.widgets[i].rect, b = l.widgets[j].rect;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.equal(overlap, false, `${l.id}: ${l.widgets[i].id} overlaps ${l.widgets[j].id}`);
      }
    }
  }
});

test("every timer widget in a built-in is explicitly unbound, not bound to a fake id", () => {
  for (const l of BUILT_IN_STAGE_LAYOUTS) {
    for (const w of l.widgets) {
      if (w.kind === "timer") assert.equal(w.timerId, null, `${l.id}/${w.id} must not ship a fabricated timer id`);
    }
  }
});

test("duplicate produces an independent, editable copy", () => {
  const src = BUILT_IN_STAGE_LAYOUTS.find((l) => l.widgets.some((w) => w.kind === "timer"))!;
  const copy = duplicateStageLayout(src, "church-1", "My layout");
  assert.equal(copy.id, "church-1");
  assert.equal(copy.name, "My layout");
  assert.equal(isBuiltInStageLayout(copy.id), false, "a copy must not be a built-in");
  copy.widgets[0].rect.x = 0.42;
  copy.widgets.find((w) => w.kind === "timer")!.rect.h = 0.31;
  assert.notEqual(src.widgets[0].rect.x, 0.42, "editing a copy must not mutate the built-in");
  assert.notEqual(src.widgets.find((w) => w.kind === "timer")!.rect.h, 0.31, "nested rects must deep-copy");
});

test("every widget kind has a label (the editor palette needs one)", () => {
  for (const k of STAGE_WIDGET_KINDS) assert.ok(STAGE_WIDGET_LABELS[k], `missing label for ${k}`);
});

// NOTE 2026-09-22: the tests for resolveWidgetColor / formatStageClock /
// resolveWidgetText / STAGE_UNBOUND were removed with those functions. They
// were a SECOND implementation that nothing called, and formatStageClock had
// already drifted from formatTimerClock on minute padding. The same behaviour
// is covered against the single implementation in test/engine-timers.test.ts
// (formatTimerClock options, resolveTimerColor triggers, cross-resolver
// parity) and the unbound-timer dash is covered in
// test/stage-layout-render.test.ts.
