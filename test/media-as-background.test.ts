/**
 * media → Background Template ("Set as background", Decoupling Wave 4).
 *
 * Covers:
 *  - buildMediaBackground maps an image/video asset to a valid PFBackground that
 *    yields a valid BackgroundSpec (rides the existing wire contract).
 *  - setMediaAsBackground persists as the active custom background (not coerced
 *    to none) and produces a valid, enabled background layer.
 *  - background PERSISTS across a slide advance (changing the slide does not
 *    alter the derived background layer).
 *  - clear-background leaves the slide untouched.
 *  - set-as-background respects camera-wins (a live camera suppresses the
 *    background layer, exactly like every other Background Template).
 *
 * Run: npx tsx test/media-as-background.test.ts
 */
import assert from "node:assert";

// ── localStorage + window shim (store reads these at call time) ──────────────
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const g = globalThis as unknown as { localStorage: MemStore; window: { localStorage: MemStore; dispatchEvent: () => boolean } };
const mem = new MemStore();
g.localStorage = mem;
g.window = { localStorage: mem, dispatchEvent: () => true };

import { buildMediaBackground, setMediaAsBackground, normalizeMediaKind, type MediaBgAsset } from "../src/backgrounds/mediaAsBackground";
import { readActiveBackgroundId, readActiveBackground, setActiveBackgroundId, snapshotBackgroundState, restoreBackgroundState } from "../src/backgrounds/store/backgroundStore";
import { toBackgroundSpec } from "../src/backgrounds/models/BackgroundTypes";
import { isValidBackgroundSpec, type OutputState, type SlidePayload } from "../src/lib/broadcast";
import { outputStateToLayers } from "../src/lib/output-layers";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${(e as Error).message}`); failed++; }
}

const IMG: MediaBgAsset = { id: "asset-1", url: "https://cdn.example.com/pic.jpg", fileName: "Sunset.jpg", kind: "image" };
const VID: MediaBgAsset = { id: "asset-2", url: "https://cdn.example.com/clip.mp4", fileName: "Waves.mp4", kind: "video" };

function textSlide(text: string): SlidePayload {
  return { kind: "text", text, bgColor: "#000" } as SlidePayload;
}
function baseState(over?: Partial<OutputState>): OutputState {
  return {
    live: textSlide("Verse one"),
    next: null, itemTitle: "", slideNumber: "", aspectRatio: "16:9",
    fitMode: "contain", safeArea: false, operatorMessage: null, lowerThird: null,
    countdownEndsAt: null, background: null, appearance: null, videoInput: null,
    ...over,
  } as OutputState;
}

test("image asset → valid PFBackground + valid BackgroundSpec", () => {
  const bg = buildMediaBackground(IMG);
  assert.equal(bg.type, "image");
  assert.equal(bg.imageUrl, IMG.url);
  assert.equal(bg.isBuiltIn, false);
  assert.equal(bg.id, "media-bg-asset-1");
  assert.ok(isValidBackgroundSpec(toBackgroundSpec(bg)), "spec must validate");
});

test("video asset → type video, videoUrl, valid spec", () => {
  const bg = buildMediaBackground(VID);
  assert.equal(bg.type, "video");
  assert.equal(bg.videoUrl, VID.url);
  assert.ok(isValidBackgroundSpec(toBackgroundSpec(bg)), "video spec must validate");
});

test("re-setting the SAME asset yields a stable id (de-dupes)", () => {
  assert.equal(buildMediaBackground(IMG).id, buildMediaBackground({ ...IMG, fileName: "renamed.jpg" }).id);
});

test("setMediaAsBackground persists as active (not coerced to none)", () => {
  mem.clear();
  const bg = setMediaAsBackground(IMG);
  assert.equal(readActiveBackgroundId(), bg.id);
  const active = readActiveBackground();
  assert.equal(active.type, "image");
  assert.equal(active.imageUrl, IMG.url);
});

test("derived background layer is ENABLED + painting after set", () => {
  mem.clear();
  const bg = setMediaAsBackground(IMG);
  const state = baseState({ background: toBackgroundSpec(bg) });
  const layers = outputStateToLayers(state, { mode: "live" });
  const bgLayer = layers.find((l) => l.kind === "background")!;
  assert.equal(bgLayer.enabled, true, "background layer must be enabled");
});

test("background PERSISTS across a slide advance (slide change doesn't touch bg)", () => {
  mem.clear();
  const bg = setMediaAsBackground(IMG);
  const spec = toBackgroundSpec(bg);
  const before = outputStateToLayers(baseState({ background: spec, live: textSlide("Verse one") }), { mode: "live" });
  const after = outputStateToLayers(baseState({ background: spec, live: textSlide("Verse TWO — advanced") }), { mode: "live" });
  const b1 = before.find((l) => l.kind === "background")!;
  const b2 = after.find((l) => l.kind === "background")!;
  // The background layer is byte-identical across the slide advance.
  assert.deepEqual(b1, b2, "background layer must be unchanged by a slide advance");
  // …and the slide layer DID change (advance actually happened).
  const s1 = before.find((l) => l.kind === "slide")!.payload as SlidePayload;
  const s2 = after.find((l) => l.kind === "slide")!.payload as SlidePayload;
  assert.notDeepEqual(s1, s2, "slide layer should reflect the advance");
});

test("clear-background leaves the slide intact", () => {
  mem.clear();
  setMediaAsBackground(IMG);
  setActiveBackgroundId("none"); // the clear the panel/rail perform
  assert.equal(readActiveBackgroundId(), "none");
  const layers = outputStateToLayers(baseState({ background: toBackgroundSpec(readActiveBackground()) }), { mode: "live" });
  const bgLayer = layers.find((l) => l.kind === "background")!;
  const slide = layers.find((l) => l.kind === "slide")!;
  assert.equal(bgLayer.enabled, false, "background gone");
  assert.equal(slide.enabled, true, "slide still live");
  assert.deepEqual(slide.payload, textSlide("Verse one"), "slide untouched by the clear");
});

test("set-as-background respects camera-wins (live camera suppresses it)", () => {
  mem.clear();
  const bg = setMediaAsBackground(IMG);
  const state = baseState({
    background: toBackgroundSpec(bg),
    videoInput: { deviceId: "cam-1", label: "Cam" } as OutputState["videoInput"],
  });
  const layers = outputStateToLayers(state, { mode: "live" });
  const bgLayer = layers.find((l) => l.kind === "background")!;
  assert.equal(bgLayer.enabled, false, "camera-wins: background suppressed while a camera is live");
});

test("normalizeMediaKind collapses loose/MIME kinds to the image|video union", () => {
  assert.equal(normalizeMediaKind("image"), "image");
  assert.equal(normalizeMediaKind("image/png"), "image");
  assert.equal(normalizeMediaKind("video"), "video");
  assert.equal(normalizeMediaKind("video/mp4"), "video");
  assert.equal(normalizeMediaKind("application/octet-stream"), "image", "non-video defaults to image (safe still bg)");
});

test("mediaKey threads onto the built background when the asset carries it", () => {
  const withKey = buildMediaBackground({ ...IMG, mediaKey: "church-1/media/uuid.jpg" });
  assert.equal(withKey.mediaKey, "church-1/media/uuid.jpg", "mediaKey present → re-mint path works across restarts");
  const withoutKey = buildMediaBackground(IMG);
  assert.equal(withoutKey.mediaKey, undefined, "no key → field omitted (stored url used until it expires)");
});

test("undo round-trip: snapshot → set → undo restores the EXACT prior state (id + stamps)", () => {
  mem.clear();
  // Prior state: an image already active (so undo must restore a real prior, not just none).
  setMediaAsBackground(IMG);
  const prior = snapshotBackgroundState();
  assert.equal(prior.activeId, "media-bg-asset-1");
  assert.ok(prior.pickedAt > 0, "the prior set stamped pickedAt");
  // Operator sets a DIFFERENT media background (the action MediaBrowser undoes).
  const t = Date.now(); while (Date.now() === t) { /* spin < 1ms so stamps differ */ }
  setMediaAsBackground(VID);
  assert.equal(readActiveBackgroundId(), "media-bg-asset-2");
  assert.notEqual(snapshotBackgroundState().pickedAt, prior.pickedAt, "the new set moved pickedAt forward");
  // Undo (restoreBackgroundState with the captured snapshot).
  restoreBackgroundState(prior);
  const now = snapshotBackgroundState();
  assert.deepEqual(now, prior, "undo restores activeId + pickedAt + themeBgPickedAt EXACTLY");
  assert.equal(readActiveBackground().type, "image", "the prior image is active again");
});

test("theme-apply replaces the media background (mutual exclusivity)", () => {
  mem.clear();
  const bg = setMediaAsBackground(IMG);
  assert.equal(readActiveBackgroundId(), bg.id, "media bg active");
  // Applying a theme that carries its own background clears the active template
  // (the existing mutual-exclusivity rule: setActiveBackgroundId("none")).
  setActiveBackgroundId("none");
  assert.equal(readActiveBackgroundId(), "none", "theme apply cleared the media background");
  const layers = outputStateToLayers(baseState({ background: toBackgroundSpec(readActiveBackground()) }), { mode: "live" });
  const bgLayer = layers.find((l) => l.kind === "background")!;
  assert.equal(bgLayer.enabled, false, "media background no longer paints once the theme took over");
});

console.log(`\n=== media-as-background: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
