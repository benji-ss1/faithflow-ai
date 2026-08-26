/**
 * PDF→images pure-helper tests (Increment B2). The render itself is browser-only
 * (canvas) and verified on the dummy app; these lock the deterministic helpers.
 * Run: npx tsx --test test/pdf-to-images.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deckPageName,
  renderScale,
  clampPageCount,
  isPdfFile,
  MAX_DECK_PAGES,
  DECK_TARGET_WIDTH,
  DECK_MAX_SCALE,
} from "../src/lib/pdf-to-images";

test("deckPageName: zero-pads to page count width, min 2, strips extension", () => {
  assert.equal(deckPageName("sermon.pdf", 3, 12), "sermon — p03.jpg");
  assert.equal(deckPageName("Deck.PDF", 3, 120), "Deck — p003.jpg");
  assert.equal(deckPageName("a.pdf", 1, 5), "a — p01.jpg");
  assert.equal(deckPageName("", 1, 1), "deck — p01.jpg"); // fallback stem
});

test("renderScale: scales to target width, never upscales past max, safe on 0", () => {
  assert.equal(renderScale(960, 1920), 2);          // 1920/960
  assert.equal(renderScale(1920, 1920), 1);
  assert.equal(renderScale(100, 1920, 3), 3);       // capped, not 19.2
  assert.equal(renderScale(0), 1);                  // guard
  assert.equal(renderScale(-5), 1);                 // guard
  assert.ok(renderScale(200) <= DECK_MAX_SCALE);
});

test("clampPageCount: caps at MAX_DECK_PAGES and reports truncation", () => {
  assert.deepEqual(clampPageCount(10), { count: 10, truncated: false });
  assert.deepEqual(clampPageCount(MAX_DECK_PAGES), { count: MAX_DECK_PAGES, truncated: false });
  assert.deepEqual(clampPageCount(MAX_DECK_PAGES + 50), { count: MAX_DECK_PAGES, truncated: true });
  assert.deepEqual(clampPageCount(0), { count: 0, truncated: false });
  assert.deepEqual(clampPageCount(-3), { count: 0, truncated: false });
});

test("isPdfFile: matches by mime OR extension", () => {
  assert.ok(isPdfFile({ name: "x.pdf", type: "application/pdf" }));
  assert.ok(isPdfFile({ name: "x.PDF", type: "" }));
  assert.ok(isPdfFile({ name: "noext", type: "application/pdf" }));
  assert.ok(!isPdfFile({ name: "x.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
  assert.ok(!isPdfFile({ name: "x.png", type: "image/png" }));
});

test("constants are sane", () => {
  assert.ok(MAX_DECK_PAGES > 0 && DECK_TARGET_WIDTH > 0 && DECK_MAX_SCALE >= 1);
});
