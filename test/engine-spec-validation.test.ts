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
  assert.equal(validateSpec({ type: "set_announcement", announcement: { line1: "Welcome", position: "lower_third", style: { fontFamily: "Inter", fontSizePx: 32, align: "left" } } }).ok, true);
});

test("set_announcement: position must be in its enum and style a well-typed plain object", () => {
  const ok = { line1: "Welcome", position: "center_card", style: { fontFamily: "Inter", fontSizePx: 32, fontWeight: 700, textColor: "#fff", bgColor: "#000", bgOpacity: 70, padding: 12, borderRadius: 8, align: "center" } };
  assert.equal(validateSpec({ type: "set_announcement", announcement: ok }).ok, true);
  const bad = (a: unknown) => validateSpec({ type: "set_announcement", announcement: a }).reason;
  assert.equal(bad({ line1: "Welcome" }), "bad-announcement", "missing position+style");
  assert.equal(bad({ ...ok, style: undefined }), "bad-announcement", "missing style");
  assert.equal(bad({ ...ok, position: undefined }), "bad-announcement", "missing position");
  assert.equal(bad({ ...ok, position: "sideways" }), "bad-announcement");
  assert.equal(bad({ ...ok, style: [] }), "bad-announcement", "array style");
  assert.equal(bad({ ...ok, style: "big" }), "bad-announcement");
  assert.equal(bad({ ...ok, style: { ...ok.style, fontSizePx: "32" } }), "bad-announcement");
  assert.equal(bad({ ...ok, style: { ...ok.style, bgOpacity: NaN } }), "bad-announcement");
  assert.equal(bad({ ...ok, style: { ...ok.style, textColor: 5 } }), "bad-announcement");
  assert.equal(bad({ ...ok, style: { ...ok.style, align: "justify" } }), "bad-announcement");
  assert.equal(sanitizeSpec({ type: "set_announcement", announcement: { line1: "x" } }), null);
});

test("sanitizeOutputState drops an announcement with bad style/position but keeps the slide (fail-open)", async () => {
  const { sanitizeOutputState } = await import("../src/lib/broadcast");
  const live = { kind: "text", text: "Hello" };
  const out = sanitizeOutputState({ live, announcement: { line1: "Hi", position: "lower_third" } });
  assert.ok(out, "state survives");
  assert.equal(out!.announcement, null);
  assert.equal((out!.live as { text?: string }).text, "Hello");
  const good = { line1: "Hi", position: "lower_third", style: { fontSizePx: 30 } };
  assert.deepEqual(sanitizeOutputState({ live, announcement: good })!.announcement, good);
});

test("set_transition: null allowed; malformed rejected; valid accepted", () => {
  assert.equal(validateSpec({ type: "set_transition", transition: null }).ok, true);
  assert.equal(validateSpec({ type: "set_transition", transition: { name: "definitely-not-a-transition" } }).reason, "bad-transition");
  assert.equal(validateSpec({ type: "set_transition", transition: { name: "Fade", durationMs: 300, easing: "ease-out" } }).ok, true);
});

// ── Review-fix hardening: finite numbers, media kinds, lower-third, whitelist ──
import { sanitizeSpec, MAX_ACTION_LIST_BYTES } from "../src/engine/actions/spec";

test("show_message: dismissAfterMs must be finite", () => {
  assert.equal(validateSpec({ type: "show_message", text: "x", dismissAfterMs: NaN }).reason, "bad-dismiss");
  assert.equal(validateSpec({ type: "show_message", text: "x", dismissAfterMs: Infinity }).reason, "bad-dismiss");
  assert.equal(validateSpec({ type: "show_message", text: "x", dismissAfterMs: 5000 }).ok, true);
});

test("set_background_media: kind restricted to image/video (bare or MIME)", () => {
  for (const k of ["image", "video", "image/png", "video/mp4"]) assert.equal(validateSpec({ type: "set_background_media", assetRef: { ...goodAsset, kind: k } }).ok, true, k);
  for (const k of ["audio", "script", "text/html", "image/<svg>"]) assert.equal(validateSpec({ type: "set_background_media", assetRef: { ...goodAsset, kind: k } }).reason, "bad-kind", k);
});

test("send_lower_third: at least one non-empty line", () => {
  assert.equal(validateSpec({ type: "send_lower_third", line1: "", line2: "  " }).reason, "empty-lines");
  assert.equal(validateSpec({ type: "send_lower_third", line1: "", line2: "Pastor" }).ok, true);
});

test("sanitizeSpec rebuilds from whitelisted fields only (extra keys, __proto__, nested junk dropped)", () => {
  const polluted = JSON.parse('{"type":"timer","timerId":"t","command":"start","junk":"x","__proto__":{"a":1}}');
  const out = sanitizeSpec(polluted);
  assert.deepEqual(out, { type: "timer", timerId: "t", command: "start" });
  assert.equal(Object.prototype.hasOwnProperty.call(out, "__proto__"), false);
  const media = sanitizeSpec({ type: "set_background_media", assetRef: { ...goodAsset, extra: "y", mediaKey: "k" }, pad: 1 });
  assert.deepEqual(media, { type: "set_background_media", assetRef: { ...goodAsset, mediaKey: "k" } });
  const bg = sanitizeSpec({ type: "set_background", spec: { type: "image", imageUrl: "https://cdn.example.com/bg.jpg", hack: "z" } });
  assert.deepEqual(bg, { type: "set_background", spec: { type: "image", imageUrl: "https://cdn.example.com/bg.jpg" } });
  const tr = sanitizeSpec({ type: "set_transition", transition: { name: "Fade", durationMs: 300, easing: "ease-out", x: 1 } });
  assert.deepEqual(tr, { type: "set_transition", transition: { name: "Fade", durationMs: 300, easing: "ease-out" } });
  const an = sanitizeSpec({ type: "set_announcement", announcement: { line1: "Hi", position: "ticker", junk: 1, style: { fontFamily: "Inter", evil: { nested: 1 } } } });
  assert.deepEqual(an, { type: "set_announcement", announcement: { line1: "Hi", position: "ticker", style: { fontFamily: "Inter" } } });
  assert.equal(sanitizeSpec({ type: "kill", extra: 1 })?.type, "kill");
  assert.deepEqual(sanitizeSpec({ type: "kill", extra: 1 }), { type: "kill" });
  assert.equal(sanitizeSpec({ type: "nope" }), null);
  // Never returns the caller's object by reference.
  const input = { type: "clear_message" };
  assert.notEqual(sanitizeSpec(input), input);
  assert.ok(MAX_ACTION_LIST_BYTES === 32 * 1024);
});

test("MAX_ACTION_LIST_BYTES counts real UTF-8 bytes, not UTF-16 code units (boundary)", async () => {
  const { sanitizeActionList, rebuiltListBytes } = await import("../src/engine/actions/spec");
  const enc = new TextEncoder();
  const bytesOf = (v: unknown) => enc.encode(JSON.stringify(v)).length;
  // "é" = 1 UTF-16 unit but 2 UTF-8 bytes.
  const item = { type: "show_message", text: "é".repeat(2000) };
  assert.equal(rebuiltListBytes([item]), bytesOf([item]));
  assert.ok(rebuiltListBytes([item]) > JSON.stringify([item]).length, "multibyte counted as bytes");
  const list = Array.from({ length: 40 }, () => item);
  const kept = sanitizeActionList(list, validateSpec, 1000);
  assert.ok(bytesOf(kept) <= MAX_ACTION_LIST_BYTES, "kept list fits in UTF-8 bytes");
  assert.ok(bytesOf([...kept, item]) > MAX_ACTION_LIST_BYTES, "one more item would cross the byte cap");
  // The old UTF-16 count would have admitted more items than the byte count does.
  assert.ok(JSON.stringify([...kept, item]).length <= MAX_ACTION_LIST_BYTES, "boundary is one UTF-16 would have missed");
  // Exact boundary: an ASCII list at exactly the cap is kept, cap+1 is not.
  const pad = (n: number) => ({ type: "show_message", text: "a".repeat(n) });
  const base = Array.from({ length: 16 }, () => pad(2000));
  const used = bytesOf(base);
  const room = MAX_ACTION_LIST_BYTES - used - 1 /* comma */ - bytesOf(pad(0));
  assert.ok(room > 0 && room <= 2000, `room=${room}`);
  assert.equal(sanitizeActionList([...base, pad(room)], validateSpec, 1000).length, 17, "exactly at cap kept");
  assert.equal(sanitizeActionList([...base, pad(room + 1)], validateSpec, 1000).length, 16, "cap+1 byte dropped");
});
