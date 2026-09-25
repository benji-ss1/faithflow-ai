import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeStageLayout, clampRect, STAGE_MAX_WIDGETS, STAGE_SCALE_MIN, STAGE_SCALE_MAX,
} from "../src/engine/stage/index";
import { BUILT_IN_STAGE_LAYOUTS, duplicateStageLayout } from "../src/engine/stage/presets";

test("🟢 sanitizeStageLayout survives non-object input entirely (null, string, number, array)", () => {
  for (const junk of [null, undefined, "hello", 42, [], true]) {
    assert.doesNotThrow(() => sanitizeStageLayout(junk, "fallback"));
    const out = sanitizeStageLayout(junk, "fallback");
    assert.equal(out.id, "fallback");
    assert.equal(out.widgets.length, 0);
  }
});

test("🟢 sanitizeStageLayout drops unknown widget kinds (string, number, null) without crashing", () => {
  const out = sanitizeStageLayout({
    widgets: [
      { id: "a", kind: "not_a_kind", rect: {} },
      { id: "b", kind: 42, rect: {} },
      { id: "c", kind: null, rect: {} },
      { id: "d", kind: "timer", rect: {} },
    ],
  });
  assert.equal(out.widgets.length, 1);
  assert.equal(out.widgets[0].id, "d");
});

test("🟢 sanitizeStageLayout caps widget count at STAGE_MAX_WIDGETS even given 10,000 entries", () => {
  const rawWidgets = Array.from({ length: 10_000 }, (_, i) => ({ id: `w${i}`, kind: "clock", rect: {} }));
  const out = sanitizeStageLayout({ widgets: rawWidgets });
  assert.equal(out.widgets.length, STAGE_MAX_WIDGETS);
});

test("🟢 sanitizeStageLayout de-duplicates colliding widget ids deterministically", () => {
  const out = sanitizeStageLayout({
    widgets: [
      { id: "dup", kind: "clock", rect: {} },
      { id: "dup", kind: "clock", rect: {} },
      { id: "dup", kind: "clock", rect: {} },
    ],
  });
  const ids = out.widgets.map((w) => w.id);
  assert.equal(new Set(ids).size, 3, "all ids must be unique after sanitize");
});

test("🟢 sanitizeStageLayout: NaN/Infinity in every numeric rect field falls back to sane defaults, never NaN/Infinity leaks through", () => {
  const out = sanitizeStageLayout({
    widgets: [
      { id: "a", kind: "clock", rect: { x: NaN, y: Infinity, w: -Infinity, h: NaN }, scale: NaN, zIndex: Infinity },
    ],
  });
  const wgt = out.widgets[0];
  assert.ok(Number.isFinite(wgt.rect.x));
  assert.ok(Number.isFinite(wgt.rect.y));
  assert.ok(Number.isFinite(wgt.rect.w));
  assert.ok(Number.isFinite(wgt.rect.h));
  assert.ok(Number.isFinite(wgt.scale));
  assert.ok(Number.isFinite(wgt.zIndex), "zIndex Infinity should not leak through — see next test for whether it actually does");
});

test("sanitizeStageLayout: zIndex is clamped like every other numeric field", () => {
  // FIXED 2026-09-21 — zIndex previously accepted any finite value while every
  // other numeric field was bounded. Now clamped to +/-9999.
  const out = sanitizeStageLayout({
    widgets: [
      { id: "a", kind: "clock", rect: {}, zIndex: 987654321 },
      { id: "b", kind: "clock", rect: {}, zIndex: -987654321 },
    ],
  });
  for (const w of out.widgets) {
    assert.ok(Number.isFinite(w.zIndex), "zIndex must stay finite");
    assert.ok(Math.abs(w.zIndex) <= 9999, `zIndex must be bounded, got ${w.zIndex}`);
  }
  // Order must still be preserved after clamping.
  assert.deepEqual(out.widgets.map((w) => w.id), ["b", "a"]);
});

test("🔴 sanitizeStageLayout: zIndex sort comparator can produce NaN/undefined ordering with Infinity-adjacent magnitudes", () => {
  // a.zIndex - b.zIndex with huge but finite values close to MAX_SAFE_INTEGER
  // does not overflow to NaN (JS numbers are doubles), so this specific attack
  // does not break sort. Included to document that this WAS checked and is fine.
  const big = Number.MAX_SAFE_INTEGER;
  const out = sanitizeStageLayout({
    widgets: [
      { id: "a", kind: "clock", rect: {}, zIndex: big },
      { id: "b", kind: "clock", rect: {}, zIndex: -big },
    ],
  });
  assert.equal(out.widgets[0].id, "b");
  assert.equal(out.widgets[1].id, "a");
});

test("🟢 sanitizeStageLayout: __proto__ / constructor keys in JSON input do not pollute Object.prototype", () => {
  const evil = JSON.parse('{"widgets":[{"id":"a","kind":"clock","rect":{},"__proto__":{"polluted":true}}],"__proto__":{"polluted":true}}');
  sanitizeStageLayout(evil);
  assert.equal(({} as any).polluted, undefined, "Object.prototype must remain clean");
});

test("🟢 a widget can no longer smuggle colour triggers or an overrun colour", () => {
  // Both fields were removed 2026-09-25 — they were persisted and read by
  // nothing, while the renderer used the TIMER's. Hostile input that still
  // carries them must be dropped, not preserved, or the dead field quietly
  // returns through the DB.
  const out = sanitizeStageLayout({
    widgets: [{
      id: "a", kind: "timer", rect: {},
      colorTriggers: [{ atSec: 5, color: "#ff0000" }, { atSec: -3.7, color: "red; background:url(x)" }],
      overrunColor: "#ff0000; content:'x'",
    }],
  });
  const w = out.widgets[0] as unknown as Record<string, unknown>;
  assert.equal(w.colorTriggers, undefined);
  assert.equal(w.overrunColor, undefined);
  // And nothing unsafe survived onto any other field.
  assert.ok(!JSON.stringify(out).includes("url("));
  assert.ok(!JSON.stringify(out).includes("content:"));
});

test("🟢 clampRect keeps a widget fully on-canvas even with wildly out-of-range x/y/w/h", () => {
  const r = clampRect({ x: 999, y: -999, w: 5, h: -5 });
  assert.ok(r.x >= 0 && r.x <= 1 - r.w);
  assert.ok(r.y >= 0 && r.y <= 1 - r.h);
  assert.ok(r.w >= 0.01 && r.w <= 1);
  assert.ok(r.h >= 0.01 && r.h <= 1);
});

test("🟢 clampRect: NaN in every field falls back to sane 0.2x0.1 defaults rather than propagating NaN", () => {
  const r = clampRect({ x: NaN, y: NaN, w: NaN, h: NaN });
  assert.ok(Number.isFinite(r.x));
  assert.ok(Number.isFinite(r.y));
  assert.equal(r.w, 0.2);
  assert.equal(r.h, 0.1);
});




test("🟢 duplicateStageLayout deep-copies nested objects so mutating the copy never touches the built-in preset", () => {
  // The built-ins are CODE, not rows — a shallow copy would let one church's
  // edit rewrite the preset for every church in the process, and "restore
  // defaults" would quietly stop working.
  const src = BUILT_IN_STAGE_LAYOUTS.find((l) => l.id === "builtin-current-timer")!;
  const dup = duplicateStageLayout(src, "dup-id");
  dup.widgets[1].rect.x = 0.99;
  dup.widgets[1].rect.h = 0.77;
  dup.name = "mutated";
  const freshSrc = BUILT_IN_STAGE_LAYOUTS.find((l) => l.id === "builtin-current-timer")!;
  assert.notEqual(freshSrc.widgets[1].rect.x, 0.99);
  assert.notEqual(freshSrc.widgets[1].rect.h, 0.77);
  assert.notEqual(freshSrc.name, "mutated");
});

test("🟢 sanitizeStageLayout: very long name/text/id strings are truncated, not rejected outright", () => {
  const out = sanitizeStageLayout({
    id: "x".repeat(1000),
    name: "y".repeat(1000),
    widgets: [{ id: "a", kind: "static_text", rect: {}, text: "z".repeat(1000) }],
  });
  assert.equal(out.id.length, 64);
  assert.equal(out.name.length, 120);
  assert.equal(out.widgets[0].text!.length, 200);
});

test("🟢 sanitizeStageLayout: an id containing invalid characters (path traversal / injection attempt) is replaced with a safe generated id", () => {
  const out = sanitizeStageLayout({
    widgets: [{ id: "../../etc/passwd", kind: "clock", rect: {} }],
  });
  assert.equal(out.widgets[0].id, "w0");
});
