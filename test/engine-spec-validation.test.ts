/**
 * Phase-4 FINAL FIX PASS — spec validation hardening (item 1).
 * validateSpec now enforces: http(s)/loopback + bounds on set_background_media
 * assetRef.url, SAFE_TOKEN on assetRef.id, length caps on fileName/kind, and
 * shape validation (via the shared broadcast validators) for set_background /
 * set_announcement / set_transition.
 * Run: npx tsx --test test/engine-spec-validation.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSpec } from "../src/engine/actions/spec";

const goodAsset = { id: "asset_123-ABC", url: "https://cdn.example.com/a/b.jpg", fileName: "b.jpg", kind: "image" };

test("set_background_media: accepts a well-formed https asset", () => {
  assert.equal(validateSpec({ type: "set_background_media", assetRef: goodAsset }).ok, true);
});

test("set_background_media: rejects a non-http(s) / non-loopback url", () => {
  const r = validateSpec({ type: "set_background_media", assetRef: { ...goodAsset, url: "ftp://evil.example.com/x" } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-assetRef-url");
});

test("set_background_media: rejects a url with quote/whitespace breakout chars", () => {
  const r = validateSpec({ type: "set_background_media", assetRef: { ...goodAsset, url: 'https://x/a".jpg' } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-assetRef-url");
});

test("set_background_media: rejects a non-token id", () => {
  const r = validateSpec({ type: "set_background_media", assetRef: { ...goodAsset, id: "../../etc/passwd" } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-assetRef-id");
});

test("set_background_media: caps fileName + kind length", () => {
  assert.equal(validateSpec({ type: "set_background_media", assetRef: { ...goodAsset, fileName: "a".repeat(261) } }).reason, "bad-fileName");
  assert.equal(validateSpec({ type: "set_background_media", assetRef: { ...goodAsset, kind: "k".repeat(41) } }).reason, "bad-kind");
});

test("set_background_media: bounds mediaKey", () => {
  assert.equal(validateSpec({ type: "set_background_media", assetRef: { ...goodAsset, mediaKey: "x".repeat(513) } }).reason, "bad-mediaKey");
  assert.equal(validateSpec({ type: "set_background_media", assetRef: { ...goodAsset, mediaKey: "church/a/b.jpg" } }).ok, true);
});

test("set_background: null is allowed; a malformed spec is rejected", () => {
  assert.equal(validateSpec({ type: "set_background", spec: null }).ok, true);
  const r = validateSpec({ type: "set_background", spec: { type: "not-a-real-bg" } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-background");
});

test("set_background: accepts a well-formed image background", () => {
  assert.equal(validateSpec({ type: "set_background", spec: { type: "image", imageUrl: "https://cdn.example.com/bg.jpg", imageFit: "fill" } }).ok, true);
});

test("set_background: rejects an image bg with a bad url", () => {
  const r = validateSpec({ type: "set_background", spec: { type: "image", imageUrl: "http://evil.example.com/bg.jpg" } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-background");
});

test("set_announcement: null allowed; malformed rejected; valid accepted", () => {
  assert.equal(validateSpec({ type: "set_announcement", announcement: null }).ok, true);
  assert.equal(validateSpec({ type: "set_announcement", announcement: { line1: 42 } }).reason, "bad-announcement");
  assert.equal(validateSpec({ type: "set_announcement", announcement: { line1: "Welcome" } }).ok, true);
});

test("set_transition: null allowed; malformed rejected; valid accepted", () => {
  assert.equal(validateSpec({ type: "set_transition", transition: null }).ok, true);
  assert.equal(validateSpec({ type: "set_transition", transition: { name: "definitely-not-a-transition" } }).reason, "bad-transition");
  assert.equal(validateSpec({ type: "set_transition", transition: { name: "Fade", durationMs: 300, easing: "ease-out" } }).ok, true);
});
