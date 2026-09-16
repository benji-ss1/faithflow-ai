/**
 * ProPresenter 7 clear rail model: rail order, F-key mapping, media vs slide kinds.
 * Run: npx tsx test/pp7-clear.test.ts
 */
import assert from "node:assert/strict";
import { PP7_CLEAR_ORDER, decodePp7ClearKey, isMediaSlideKind, isEmptySlideKind, PP7_CLEAR_KEY } from "../src/lib/pp7-clear";

assert.deepEqual([...PP7_CLEAR_ORDER], ["audio", "messages", "props", "announcements", "slide", "media", "videoInput"], "PP7 rail order top→bottom");

assert.equal(decodePp7ClearKey({ key: "F1" }), "all");
assert.equal(decodePp7ClearKey({ key: "F2" }), "slide");
assert.equal(decodePp7ClearKey({ key: "F3" }), "media");
assert.equal(decodePp7ClearKey({ key: "F4" }), "props");
assert.equal(decodePp7ClearKey({ key: "F5" }), "audio");
assert.equal(decodePp7ClearKey({ key: "F6" }), "messages");
assert.equal(decodePp7ClearKey({ key: "F7" }), "announcements");
assert.equal(decodePp7ClearKey({ key: "F8" }), null);
assert.equal(decodePp7ClearKey({ key: "Escape" }), null, "Esc is not a PP7 clear key (kept as today)");
assert.equal(decodePp7ClearKey({ key: "F10", shiftKey: true }), null, "Shift+F10 context menu untouched");
assert.equal(decodePp7ClearKey({ key: "F5", metaKey: true }), null, "modifiers ignored");
assert.equal(PP7_CLEAR_KEY.slide, "F2");

assert.equal(isMediaSlideKind("image"), true);
assert.equal(isMediaSlideKind("video"), true);
assert.equal(isMediaSlideKind("text"), false);
assert.equal(isEmptySlideKind("empty"), true);
assert.equal(isEmptySlideKind("blank"), true);
assert.equal(isEmptySlideKind("text"), false);
console.log("pp7-clear: all passed");

// ── PP7 layer order: Media above a live camera (planOutput) ───────────────────
import { planOutput } from "../src/lib/output-plan";
{
  const cam = { deviceId: "cam1", label: "Cam" };
  const bg = { type: "image" as const, imageUrl: "https://example.com/a.jpg" };
  const text = { kind: "text" as const, text: "Amazing grace" };
  const slideLayer = (p: ReturnType<typeof planOutput>) => p.layers.find((l) => l.id === "slide")!;

  const legacy = planOutput({ mode: "live", slide: text, videoInput: cam, background: bg } as never);
  assert.equal((slideLayer(legacy).props as { mediaOverCamera?: unknown }).mediaOverCamera, undefined, "legacy: camera hides media (no key)");
  assert.equal(legacy.layers.find((l) => l.id === "background")!.enabled, false);

  const pp7 = planOutput({ mode: "live", slide: text, videoInput: cam, background: bg, mediaOverCamera: true } as never);
  assert.deepEqual((slideLayer(pp7).props as { mediaOverCamera?: unknown }).mediaOverCamera, bg, "PP7: media drawn over the camera");

  const noCam = planOutput({ mode: "live", slide: text, background: bg, mediaOverCamera: true } as never);
  assert.equal((slideLayer(noCam).props as { mediaOverCamera?: unknown }).mediaOverCamera, undefined, "no camera: normal background layer");
  assert.equal(noCam.layers.find((l) => l.id === "background")!.enabled, true);

  const keyed = planOutput({ mode: "livestream", slide: text, videoInput: cam, background: bg, transparent: true, mediaOverCamera: true } as never);
  assert.equal((slideLayer(keyed).props as { mediaOverCamera?: unknown }).mediaOverCamera, undefined, "transparent keying never paints media");

  const stage = planOutput({ mode: "stage", slide: text, videoInput: cam, background: bg, mediaOverCamera: true } as never);
  assert.equal((slideLayer(stage).props as { mediaOverCamera?: unknown }).mediaOverCamera, undefined, "stage has no camera");
  console.log("pp7 media-over-camera plan: all passed");
}
