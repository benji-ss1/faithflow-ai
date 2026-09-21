import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeStageLayout, clampRect, resolveWidgetColor, formatStageClock,
  resolveWidgetText, STAGE_MAX_WIDGETS, STAGE_SCALE_MIN, STAGE_SCALE_MAX,
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

test("🟢 sanitizeStageLayout: colorTriggers atSec is floored and clamped to >= 0, capped at STAGE_MAX_TRIGGERS count", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ atSec: -i - 0.7, color: `c${i}` }));
  const out = sanitizeStageLayout({ widgets: [{ id: "a", kind: "timer", rect: {}, colorTriggers: many }] });
  const triggers = out.widgets[0].colorTriggers!;
  assert.ok(triggers.length <= 8);
  for (const t of triggers) assert.ok(t.atSec >= 0 && Number.isInteger(t.atSec));
});

test("🟢 sanitizeStageLayout: colorTriggers entries that are not well-formed objects are filtered out, not crashing", () => {
  const out = sanitizeStageLayout({
    widgets: [{
      id: "a", kind: "timer", rect: {},
      // FIXED 2026-09-21: colours are now #rrggbb-validated, because a colour
      // string is written straight into a style attribute by the renderer —
      // "ok" / "red" / "red; background:url(...)" must never survive.
      colorTriggers: [null, 42, "red", { atSec: NaN, color: "x" }, { atSec: 5 }, { atSec: 5, color: 5 },
        { atSec: 5, color: "ok" }, { atSec: 5, color: "red; background:url(javascript:alert(1))" },
        { atSec: 7, color: "#aabbcc" }],
    }],
  });
  assert.deepEqual(out.widgets[0].colorTriggers, [{ atSec: 7, color: "#aabbcc" }],
    "only well-formed hex triggers survive");
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

test("🟡 formatStageClock and formatTimerClock disagree on minute padding when showHours is forced true but hours are 0", () => {
  // formatStageClock forces 2-digit minute (pad) whenever leadingZeros OR
  // showHours is true, even for the non-hour path — check consistency at h=0.
  const s = formatStageClock(65, { showHours: true });
  assert.equal(s, "0:01:05");
});

test("🟢 resolveWidgetText: an unbound timer widget renders the STAGE_UNBOUND dash instead of vanishing", () => {
  const text = resolveWidgetText(
    { id: "t", kind: "timer", rect: { x: 0, y: 0, w: 1, h: 1 }, scale: 1, align: "center", zIndex: 0, timerId: "missing" },
    { nowMs: 0, timers: {} },
  );
  assert.equal(text, "—");
});

test("🟢 resolveWidgetText: clock widget with showHours=false wraps 0 hour to 12, not 0", () => {
  const d = new Date(2026, 0, 1, 0, 15, 0);
  const text = resolveWidgetText(
    { id: "c", kind: "clock", rect: { x: 0, y: 0, w: 1, h: 1 }, scale: 1, align: "center", zIndex: 0, showHours: false },
    { nowMs: d.getTime(), timers: {} },
  );
  assert.equal(text, "12:15");
});

test("🟢 duplicateStageLayout deep-copies rect/colorTriggers so mutating the copy never touches the built-in preset", () => {
  const src = BUILT_IN_STAGE_LAYOUTS.find((l) => l.id === "builtin-current-timer")!;
  const dup = duplicateStageLayout(src, "dup-id");
  dup.widgets[1].rect.x = 0.99;
  dup.widgets[1].colorTriggers![0].atSec = 9999;
  const freshSrc = BUILT_IN_STAGE_LAYOUTS.find((l) => l.id === "builtin-current-timer")!;
  assert.notEqual(freshSrc.widgets[1].rect.x, 0.99);
  assert.notEqual(freshSrc.widgets[1].colorTriggers![0].atSec, 9999);
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
