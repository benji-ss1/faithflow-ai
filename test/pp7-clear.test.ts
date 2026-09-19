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

// Second Clear All binding (2026-09-17) — F1 is brightness on a default Mac.
assert.equal(decodePp7ClearKey({ key: "C", metaKey: true, shiftKey: true }), "all", "⌘⇧C = Clear All");
assert.equal(decodePp7ClearKey({ key: "c", ctrlKey: true, shiftKey: true }), "all", "Ctrl+Shift+C = Clear All (lower case too)");
assert.equal(decodePp7ClearKey({ key: "C", metaKey: true }), null, "⌘C (copy) is NOT a clear");
assert.equal(decodePp7ClearKey({ key: "C", shiftKey: true }), null, "Shift+C alone is not a clear");
assert.equal(decodePp7ClearKey({ key: "C", metaKey: true, shiftKey: true, altKey: true }), null, "no Alt variant");

assert.equal(isMediaSlideKind("image"), true);
assert.equal(isMediaSlideKind("video"), true);
assert.equal(isMediaSlideKind("text"), false);
assert.equal(isEmptySlideKind("empty"), true);
assert.equal(isEmptySlideKind("blank"), true);
assert.equal(isEmptySlideKind("text"), false);
console.log("pp7-clear: all passed");

// ── PP7 layer order: Media above a live camera (planOutput) ──────────────────
// The full draw-order suite is test/pp7-draw-order.test.ts (+ the DOM half).
// This keeps the rail's own view of the rule next to the rail's own tests.
import { planOutput } from "../src/lib/output-plan";
{
  const cam = { deviceId: "cam1", label: "Cam" };
  const bg = { type: "image" as const, imageUrl: "https://example.com/a.jpg" };
  const text = { kind: "text" as const, text: "Amazing grace" };
  const ids = (p: ReturnType<typeof planOutput>) => p.layers.map((l) => l.id);
  const bgEnabled = (p: ReturnType<typeof planOutput>) => p.layers.find((l) => l.id === "background")!.enabled;

  const legacy = planOutput({ mode: "live", slide: text, videoInput: cam, background: bg } as never);
  assert.deepEqual(ids(legacy), ["background", "slide", "theme-logo"], "legacy: the camera is fused into the slide layer");
  assert.equal(bgEnabled(legacy), false, "legacy: camera hides media");

  const pp7 = planOutput({ mode: "live", slide: text, videoInput: cam, background: bg, pp7DrawOrder: true } as never);
  assert.deepEqual(ids(pp7), ["camera", "background", "slide", "theme-logo"], "PP7: Media draws ABOVE Video Input");
  assert.equal(bgEnabled(pp7), true, "PP7: the media paints over the camera");

  const noCam = planOutput({ mode: "live", slide: text, background: bg, pp7DrawOrder: true } as never);
  assert.deepEqual(ids(noCam), ["background", "slide", "theme-logo"], "no camera: no camera layer");
  assert.equal(bgEnabled(noCam), true);

  const keyed = planOutput({ mode: "livestream", slide: text, videoInput: cam, background: bg, transparent: true, pp7DrawOrder: true } as never);
  assert.equal(bgEnabled(keyed), false, "transparent keying never paints media");
  assert.ok(!ids(keyed).includes("camera"), "transparent keying never paints the camera");

  const stage = planOutput({ mode: "stage", slide: text, videoInput: cam, background: bg, pp7DrawOrder: true } as never);
  assert.ok(!ids(stage).includes("camera"), "stage has no camera");
  console.log("pp7 draw order (rail view): all passed");
}
