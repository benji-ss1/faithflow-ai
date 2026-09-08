/**
 * Media-bin drop classification (field fix wave 6A). Pure logic that decides
 * whether a dropped media asset sets a slide's background or creates a new
 * full-screen image slide, plus payload parsing + image-kind gating.
 * Run: npx tsx test/media-drop.test.ts
 */
import assert from "node:assert/strict";
import {
  MEDIA_DROP_MIME,
  parseMediaDropPayload,
  isImageAsset,
  resolveMediaDrop,
} from "../src/lib/media-drop";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

check("MIME constant matches the MediaBin payload key", () => {
  assert.equal(MEDIA_DROP_MIME, "application/x-pf-library-item");
});

check("parses a well-formed media payload", () => {
  const p = parseMediaDropPayload(JSON.stringify({ pfType: "media", id: "a1", url: "https://x/y.png", kind: "image/png", title: "Y" }));
  assert.ok(p);
  assert.equal(p!.id, "a1");
  assert.equal(p!.url, "https://x/y.png");
  assert.equal(p!.kind, "image/png");
});

check("rejects non-media / malformed / empty payloads", () => {
  assert.equal(parseMediaDropPayload(null), null);
  assert.equal(parseMediaDropPayload(""), null);
  assert.equal(parseMediaDropPayload("not json"), null);
  assert.equal(parseMediaDropPayload(JSON.stringify({ pfType: "slide", id: "a", url: "u" })), null);
  assert.equal(parseMediaDropPayload(JSON.stringify({ pfType: "media", id: "", url: "u" })), null);
  assert.equal(parseMediaDropPayload(JSON.stringify({ pfType: "media", id: "a" })), null); // no url
});

check("image gating: image kinds accepted, video rejected", () => {
  assert.equal(isImageAsset({ kind: "image/jpeg", url: "u" }), true);
  assert.equal(isImageAsset({ kind: "image", url: "u" }), true);
  assert.equal(isImageAsset({ kind: "video/mp4", url: "u.mp4" }), false);
});

check("image gating: unknown kind sniffs the URL extension", () => {
  assert.equal(isImageAsset({ kind: undefined, url: "https://x/y.PNG" }), true);
  assert.equal(isImageAsset({ kind: "", url: "https://x/y.jpg?token=1" }), true);
  assert.equal(isImageAsset({ kind: undefined, url: "https://x/y.mov" }), false);
  assert.equal(isImageAsset({ kind: undefined, url: "https://x/no-ext" }), false);
});

check("drop ON a slide → set that slide's background", () => {
  const r = resolveMediaDrop({ over: "slide", slideIndex: 3 });
  assert.deepEqual(r, { action: "set-slide-background", slideIndex: 3 });
});

check("drop in empty space → new image slide at that index", () => {
  const r = resolveMediaDrop({ over: "empty", insertIndex: 5 });
  assert.deepEqual(r, { action: "new-image-slide", insertIndex: 5 });
});

check("negative insert index is clamped to 0", () => {
  const r = resolveMediaDrop({ over: "empty", insertIndex: -2 });
  assert.deepEqual(r, { action: "new-image-slide", insertIndex: 0 });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
