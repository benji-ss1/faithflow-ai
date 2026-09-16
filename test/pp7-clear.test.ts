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

// ── PP7 layer order: Video Input < Media < Slide (planOutput) ─────────────────
import { planOutput } from "../src/lib/output-plan";
{
  const cam = { deviceId: "cam1", label: "Cam" };
  const bg = { type: "image" as const, imageUrl: "https://example.com/a.jpg" };
  const text = { kind: "text" as const, text: "Amazing grace" };
  const layer = (p: ReturnType<typeof planOutput>, id: string) => p.layers.find((l) => l.id === id);

  // Legacy (flag off): camera hides the media; no camera layer.
  const legacy = planOutput({ mode: "live", slide: text, videoInput: cam, background: bg } as never);
  assert.equal(layer(legacy, "camera"), undefined, "legacy: no separate camera layer");
  assert.equal(layer(legacy, "background")!.enabled, false, "legacy: camera hides media");
  assert.equal((layer(legacy, "slide")!.props as { renderMode: string }).renderMode, "over-video");

  // PP7: camera layer below media, media stays on the background layer, slide over both.
  const pp7 = planOutput({ mode: "live", slide: text, videoInput: cam, background: bg, mediaOverCamera: true } as never);
  const camL = layer(pp7, "camera")!, bgL = layer(pp7, "background")!, slideL = layer(pp7, "slide")!;
  assert.ok(camL && camL.enabled, "PP7: camera layer present");
  assert.equal(bgL.enabled, true, "PP7: media shows over the camera");
  assert.ok(camL.z < bgL.z && bgL.z < slideL.z, "PP7 z-order: camera < media < slide");
  assert.equal((slideL.props as { renderMode: string }).renderMode, "transition", "slide not fused with camera (no remount on camera toggle)");
  assert.equal((slideL.props as { overVideo: boolean }).overVideo, true, "slide background transparent over media");

  // Camera toggle with media: media layer and slide render mode stay identical (no restart/remount).
  const pp7NoCam = planOutput({ mode: "live", slide: text, background: bg, mediaOverCamera: true } as never);
  assert.deepEqual(layer(pp7NoCam, "background"), bgL, "media layer identical whether camera is on or off");
  assert.deepEqual(layer(pp7NoCam, "slide")!.props, slideL.props, "slide layer identical whether camera is on or off");

  // No media: PP7 flag changes nothing (camera stays fused over-video).
  const camOnly = planOutput({ mode: "live", slide: text, videoInput: cam, mediaOverCamera: true } as never);
  assert.deepEqual(camOnly, planOutput({ mode: "live", slide: text, videoInput: cam } as never), "no media: identical to legacy");

  // Transparent keying and stage unchanged.
  const keyed = planOutput({ mode: "livestream", slide: text, videoInput: cam, background: bg, transparent: true, mediaOverCamera: true } as never);
  assert.deepEqual(keyed, planOutput({ mode: "livestream", slide: text, videoInput: cam, background: bg, transparent: true } as never), "transparent keying unchanged");
  const stage = planOutput({ mode: "stage", slide: text, videoInput: cam, background: bg, mediaOverCamera: true } as never);
  assert.deepEqual(stage, planOutput({ mode: "stage", slide: text, videoInput: cam, background: bg } as never), "stage unchanged");
  console.log("pp7 layer order plan: all passed");
}
