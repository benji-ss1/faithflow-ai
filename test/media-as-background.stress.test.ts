/**
 * media → Background Template — STRESS suite (Wave-4 six-agent gate, 3/6).
 *
 * Attacks the "Set as background" delta (commit 27cd80d) at its edges:
 *  (1) rapid set-background spam — custom list growth is BOUNDED + deduped, no
 *      unbounded localStorage growth (quota safety).
 *  (2) video → image → clear → undo — the state machine stays consistent and the
 *      snapshot Undo restores the pre-set state exactly (id + ordering stamps).
 *  (3) camera-wins: a background survives in the store while a camera suppresses
 *      it; turning the camera OFF reveals the SAME background (no data loss).
 *  (4) last-pick-wins chain: set media bg (stamps PICKED_AT) vs theme bg
 *      (stamps THEME_BG_PICKED_AT) — the most-recent explicit pick is kept.
 *  (5) mid-service asset deletion while it is the ACTIVE background — the derived
 *      layer must FAIL SAFE (documents the store-vs-DB divergence gap).
 *  (6) 20 slide advances with a video background — the derived background layer +
 *      its remount key stay byte-stable (no video restart/flicker).
 *
 * Run: npx tsx test/media-as-background.stress.test.ts
 */
import assert from "node:assert";

class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  get size() { return this.m.size; }
  rawLen() { let n = 0; for (const v of this.m.values()) n += v.length; return n; }
}
const g = globalThis as unknown as { localStorage: MemStore; window: { localStorage: MemStore; dispatchEvent: () => boolean } };
const mem = new MemStore();
g.localStorage = mem;
g.window = { localStorage: mem, dispatchEvent: () => true };

import { buildMediaBackground, setMediaAsBackground, type MediaBgAsset } from "../src/backgrounds/mediaAsBackground";
import {
  readActiveBackgroundId, readActiveBackground, setActiveBackgroundId,
  readCustomBackgrounds, snapshotBackgroundState, restoreBackgroundState,
  markThemeBackgroundPicked, shouldKeepTemplateOverThemeBg, removeCustomBackground,
} from "../src/backgrounds/store/backgroundStore";
import { toBackgroundSpec } from "../src/backgrounds/models/BackgroundTypes";
import { type OutputState, type SlidePayload } from "../src/lib/broadcast";
import { outputStateToLayers } from "../src/lib/output-layers";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${(e as Error).message}`); failed++; }
}

const img = (i: number): MediaBgAsset => ({ id: `img-${i}`, url: `https://cdn.example.com/pic-${i}.jpg`, fileName: `Pic ${i}.jpg`, kind: "image" });
const vid = (i: number): MediaBgAsset => ({ id: `vid-${i}`, url: `https://cdn.example.com/clip-${i}.mp4`, fileName: `Clip ${i}.mp4`, kind: "video" });

function textSlide(text: string): SlidePayload { return { kind: "text", text, bgColor: "#000" } as SlidePayload; }
function baseState(over?: Partial<OutputState>): OutputState {
  return {
    live: textSlide("Verse one"), next: null, itemTitle: "", slideNumber: "", aspectRatio: "16:9",
    fitMode: "contain", safeArea: false, operatorMessage: null, lowerThird: null,
    countdownEndsAt: null, background: null, appearance: null, videoInput: null, ...over,
  } as OutputState;
}
function bgLayer(state: OutputState) { return outputStateToLayers(state, { mode: "live" }).find((l) => l.kind === "background")!; }
/** Mirrors OutputCompositor.tsx:150 remount key: shaderPreset ?? type. */
function remountKey(spec: ReturnType<typeof toBackgroundSpec>) { return (spec as { shaderPreset?: string }).shaderPreset ?? spec.type; }

// ── (1) SPAM: bounded + deduped, no quota blowup ─────────────────────────────
test("spam 10 DIFFERENT images in a burst → newest active, list grows but each unique", () => {
  mem.clear();
  let lastId = "";
  for (let i = 0; i < 10; i++) lastId = setMediaAsBackground(img(i)).id;
  assert.equal(readActiveBackgroundId(), lastId, "the last spammed image is the active one");
  const custom = readCustomBackgrounds();
  const ids = new Set(custom.map((b) => b.id));
  assert.equal(ids.size, custom.length, "no duplicate ids in the custom list");
  assert.equal(custom.length, 10, "10 distinct images → 10 entries");
});

test("spam the SAME image 50x → de-dupes to ONE entry (id stable)", () => {
  mem.clear();
  for (let i = 0; i < 50; i++) setMediaAsBackground(img(7));
  const custom = readCustomBackgrounds();
  assert.equal(custom.filter((b) => b.id === "media-bg-img-7").length, 1, "same asset never stacks duplicates");
  assert.equal(custom.length, 1);
});

test("spam 200 distinct images → custom list is CAPPED at 60 (localStorage quota safety)", () => {
  mem.clear();
  for (let i = 0; i < 200; i++) setMediaAsBackground(img(1000 + i));
  const custom = readCustomBackgrounds();
  assert.ok(custom.length <= 60, `custom list bounded (was ${custom.length})`);
  // The most-recent (active) one is retained at the head (newest-first unshift).
  assert.equal(custom[0].id, "media-bg-img-1199", "newest retained at head");
  assert.equal(readActiveBackgroundId(), "media-bg-img-1199");
  // And the active id still resolves to a real background (not evicted).
  assert.equal(readActiveBackground().type, "image", "active never evicted from under itself");
});

// ── (2) video → image → clear → undo state machine ───────────────────────────
test("video → image → clear → undo restores the pre-image state (video active)", () => {
  mem.clear();
  setMediaAsBackground(vid(1));
  const beforeImage = snapshotBackgroundState();               // { activeId: media-bg-vid-1 }
  setMediaAsBackground(img(1));                                // now image active
  assert.equal(readActiveBackgroundId(), "media-bg-img-1");
  setActiveBackgroundId("none");                              // panel/rail clear
  assert.equal(readActiveBackgroundId(), "none", "cleared");
  restoreBackgroundState(beforeImage);                        // Undo the set-image
  assert.equal(readActiveBackgroundId(), "media-bg-vid-1", "undo restores the video that was active before the image");
  assert.equal(readActiveBackground().type, "video");
});

test("undo after clear restores ordering stamps too (pickedAt), not just the id", () => {
  mem.clear();
  setMediaAsBackground(img(2));
  const snap = snapshotBackgroundState();
  assert.ok(snap.pickedAt > 0, "a set stamps pickedAt");
  setActiveBackgroundId("none");
  restoreBackgroundState(snap);
  assert.equal(snapshotBackgroundState().pickedAt, snap.pickedAt, "pickedAt restored exactly");
});

// ── (3) camera-wins reveal ───────────────────────────────────────────────────
test("camera live suppresses bg; camera OFF reveals the SAME bg (no data loss)", () => {
  mem.clear();
  const bg = setMediaAsBackground(img(3));
  const spec = toBackgroundSpec(bg);
  const withCam = baseState({ background: spec, videoInput: { deviceId: "cam", label: "Cam" } as OutputState["videoInput"] });
  assert.equal(bgLayer(withCam).enabled, false, "camera-wins: bg suppressed while camera live");
  // Operator turns the camera off — store background is untouched, layer re-enables.
  const noCam = baseState({ background: spec, videoInput: null });
  assert.equal(bgLayer(noCam).enabled, true, "bg reappears when the camera goes off");
  assert.equal(readActiveBackgroundId(), bg.id, "store still holds the bg through the camera cycle");
});

// ── (4) last-pick-wins chain ─────────────────────────────────────────────────
test("set media bg AFTER a theme bg → template wins the restart tiebreak", () => {
  mem.clear();
  markThemeBackgroundPicked();                 // theme bg chosen first
  // ensure a later timestamp for the media pick
  const t = Date.now(); while (Date.now() === t) { /* spin < 1ms so stamps differ */ }
  setMediaAsBackground(img(4));                 // media bg chosen SECOND
  assert.equal(shouldKeepTemplateOverThemeBg(), true, "most-recent explicit pick (media template) wins");
});

test("theme bg AFTER a media bg → theme wins the restart tiebreak", () => {
  mem.clear();
  setMediaAsBackground(img(5));
  const t = Date.now(); while (Date.now() === t) { /* spin */ }
  markThemeBackgroundPicked();
  assert.equal(shouldKeepTemplateOverThemeBg(), false, "theme bg is now the most recent explicit pick");
});

// ── (5) mid-service deletion of the ACTIVE background — now cleaned up ────────
// Wave-4 fix pass: MediaBrowser.deleteAsset + bulkDelete now call
// removeCustomBackground(`media-bg-${id}`) after a successful delete, so deleting
// the ACTIVE background resets the store to None (no stale pointer, no dead entry
// in the Backgrounds picker). The render-layer <img onError> fail-safe remains as
// a second line of defence, but the store no longer diverges.
test("deleting the active bg asset resets the store to None (delete-honesty)", () => {
  mem.clear();
  const bg = setMediaAsBackground(img(6));
  assert.equal(readActiveBackgroundId(), bg.id, "active before delete");
  // MediaBrowser.deleteAsset's store cleanup, at the store level:
  removeCustomBackground(bg.id);
  assert.equal(readActiveBackgroundId(), "none", "active reset to None after the asset is deleted");
  assert.equal(readCustomBackgrounds().some((b) => b.id === bg.id), false, "no dead entry left in the custom list");
  // And the derived layer no longer paints a now-dead URL.
  const layer = bgLayer(baseState({ background: toBackgroundSpec(readActiveBackground()) }));
  assert.equal(layer.enabled, false, "background layer off once the asset (and active id) are gone");
});

// ── (6) 20 slide advances with a video bg — no restart/flicker ───────────────
test("20 slide advances hold a byte-stable video bg layer + stable remount key", () => {
  mem.clear();
  const bg = setMediaAsBackground(vid(2));
  const spec = toBackgroundSpec(bg);
  const key0 = remountKey(spec);
  let prev = bgLayer(baseState({ background: spec, live: textSlide("slide 0") }));
  for (let i = 1; i <= 20; i++) {
    const cur = bgLayer(baseState({ background: spec, live: textSlide(`slide ${i}`) }));
    assert.deepEqual(cur, prev, `bg layer byte-identical across advance ${i} (no re-fire)`);
    assert.equal(remountKey(spec), key0, "remount key unchanged → <video> element not remounted → no restart");
    prev = cur;
  }
  assert.equal(key0, "video", "all video bgs share the 'video' remount key (stable across advances)");
});

console.log(`\n=== media-as-background STRESS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
