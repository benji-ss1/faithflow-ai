/**
 * Pure-core tests for the media "remove flat background" keying.
 * Run: npx tsx --test test/logo-key.test.ts
 *
 * Covers the numeric core only (no DOM): flat-corner detection + per-pixel alpha
 * keying. The canvas wrapper (removeFlatBackground) is DOM-only and exercised by
 * hand in the editor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rgbDistance, pickFlatKeyColor, alphaForKey, MAX_RGB_DISTANCE, FLAT_CORNER_VARIANCE_MAX } from "../src/components/operator/pro/center/logoKey";

test("rgbDistance: identical is 0, black↔white is the max", () => {
  assert.equal(rgbDistance({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 }), 0);
  assert.ok(Math.abs(rgbDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - MAX_RGB_DISTANCE) < 1e-6);
});

test("pickFlatKeyColor: consistent black corners → flat, averaged key", () => {
  const res = pickFlatKeyColor([
    { r: 2, g: 2, b: 2 }, { r: 0, g: 1, b: 0 }, { r: 3, g: 2, b: 4 }, { r: 1, g: 0, b: 1 },
  ]);
  assert.equal(res.flat, true);
  assert.ok(res.color.r <= 3 && res.color.g <= 3 && res.color.b <= 3);
});

test("pickFlatKeyColor: white corners are also flat", () => {
  const res = pickFlatKeyColor([
    { r: 253, g: 255, b: 254 }, { r: 255, g: 255, b: 255 }, { r: 252, g: 253, b: 255 }, { r: 255, g: 254, b: 253 },
  ]);
  assert.equal(res.flat, true);
});

test("pickFlatKeyColor: disagreeing corners → NOT flat (a real photo)", () => {
  const res = pickFlatKeyColor([
    { r: 10, g: 10, b: 10 }, { r: 240, g: 30, b: 30 }, { r: 20, g: 200, b: 80 }, { r: 30, g: 40, b: 220 },
  ]);
  assert.equal(res.flat, false);
});

test("pickFlatKeyColor: variance boundary", () => {
  // Two corners exactly FLAT_CORNER_VARIANCE_MAX apart along one axis average to
  // the midpoint; each is half that distance from the average → flat.
  const d = FLAT_CORNER_VARIANCE_MAX;
  const res = pickFlatKeyColor([
    { r: 0, g: 0, b: 0 }, { r: d, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }, { r: d, g: 0, b: 0 },
  ]);
  assert.equal(res.flat, true);
});

test("alphaForKey: pixel on the key colour is fully transparent", () => {
  const key = { r: 0, g: 0, b: 0 };
  assert.equal(alphaForKey({ r: 0, g: 0, b: 0 }, 255, key, 40), 0);
});

test("alphaForKey: a clearly-different pixel stays fully opaque", () => {
  const key = { r: 0, g: 0, b: 0 };
  assert.equal(alphaForKey({ r: 255, g: 255, b: 255 }, 255, key, 40), 255);
});

test("alphaForKey: threshold 0 is a no-op (returns original alpha)", () => {
  const key = { r: 0, g: 0, b: 0 };
  assert.equal(alphaForKey({ r: 0, g: 0, b: 0 }, 200, key, 0), 200);
});

test("alphaForKey: feather band ramps between transparent and opaque", () => {
  const key = { r: 0, g: 0, b: 0 };
  const maxD = 0.4 * MAX_RGB_DISTANCE; // threshold 40
  // A grey whose distance sits inside the feather band (between maxD*0.65 and maxD).
  const dist = maxD * 0.85;
  const v = Math.round(dist / Math.sqrt(3)); // r=g=b=v → distance ≈ v*sqrt(3)
  const a = alphaForKey({ r: v, g: v, b: v }, 255, key, 40);
  assert.ok(a > 0 && a < 255, `expected partial alpha, got ${a}`);
});
