/**
 * outputStateToLayers adapter agreement tests (Decoupling Phase 2).
 *
 * The adapter derives the additive LayerWire[] model from legacy OutputState
 * fields. It is NOT yet consumed at render time, so these tests lock it against
 * the SAME precedence decisions the live compositor already makes via
 * planOutput() — the golden record from Phase 1. If the two ever disagree, the
 * Phase 3 render-swap would change the picture, which is exactly what must not
 * happen. Same fixture matrix shape as test/output-compositor.test.ts.
 *
 * Run: npx tsx test/output-layers.test.ts
 */
import assert from "node:assert/strict";
import { outputStateToLayers } from "../src/lib/output-layers";
import { planOutput } from "../src/lib/output-plan";
import { isValidLayerWire, EMPTY_OUTPUT, type OutputState, type SlidePayload, type ThemeAppearance, type VideoInputState, type BackgroundSpec } from "../src/lib/broadcast";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

// ---- fixtures (mirror output-compositor.test.ts) ---------------------------
const textSlide: SlidePayload = { kind: "text", text: "In the beginning" };
const imageSlide: SlidePayload = { kind: "image", url: "https://x/i.jpg" };
const bandScriptureSlide: SlidePayload = { kind: "text", text: "The LORD is my shepherd", reference: "Psalm 23:1", scriptureLayout: "lowerThird" };
const shaderBg: BackgroundSpec = { type: "shader", shaderPreset: "gentle-waves" } as BackgroundSpec;
const noneBg: BackgroundSpec = { type: "none" } as BackgroundSpec;
const camera: VideoInputState = { deviceId: "cam-1", label: "HDMI", overlay: "full" } as VideoInputState;
const themeVideo: ThemeAppearance = { bgType: "video", bgVideoUrl: "https://x/bg.mp4", bgColor: "#000000", textColor: "#fff" } as ThemeAppearance;

function state(over: Partial<OutputState>): OutputState {
  return { ...EMPTY_OUTPUT, live: textSlide, ...over };
}
function layerById(ls: ReturnType<typeof outputStateToLayers>, id: string) {
  return ls.find((l) => l.id === id);
}

// Every combination of {no bg | none bg | active bg} × {no camera | camera}.
const bgOptions: Array<[string, BackgroundSpec | null]> = [["nobg", null], ["nonebg", noneBg], ["shader", shaderBg]];
const camOptions: Array<[string, VideoInputState | null]> = [["nocam", null], ["cam", camera]];

console.log("outputStateToLayers adapter agreement");

// ---- 1. background-enabled agreement with planOutput(live) ------------------
check("background layer enabled ⇔ planOutput(live) enables its background", () => {
  for (const [bn, bg] of bgOptions) {
    for (const [cn, cam] of camOptions) {
      const st = state({ background: bg, videoInput: cam });
      const layers = outputStateToLayers(st);
      const plan = planOutput({ mode: "live", slide: st.live, background: bg, videoInput: cam });
      const planBg = plan.layers.find((l) => l.id === "background")!;
      const adapterBg = layerById(layers, "background")!;
      assert.equal(adapterBg.enabled, planBg.enabled, `${bn}/${cn}: background.enabled must agree with plan (${planBg.enabled})`);
    }
  }
});

// ---- 2. camera layer ⇔ videoInput, and plan routes slide over-video ---------
check("camera layer present+enabled iff videoInput set (plan fuses it into over-video)", () => {
  const withCam = outputStateToLayers(state({ videoInput: camera }));
  const cam = layerById(withCam, "camera")!;
  assert.equal(cam.enabled, true, "camera enabled when set");
  assert.equal(cam.transportScope, "local", "camera is same-machine only");
  // The legacy plan encodes the same camera as an over-video slide composite.
  assert.equal(planOutput({ mode: "live", slide: textSlide, videoInput: camera }).layers.find((l) => l.id === "slide")!.enabled, true);

  const noCam = outputStateToLayers(state({}));
  assert.equal(layerById(noCam, "camera")!.enabled, false, "camera disabled when absent");
});

// ---- 3. camera-wins-over-background-template -------------------------------
check("active template + camera → background layer disabled (camera wins), matches plan", () => {
  const st = state({ background: shaderBg, videoInput: camera });
  const layers = outputStateToLayers(st);
  assert.equal(layerById(layers, "background")!.enabled, false, "adapter: camera suppresses template");
  const plan = planOutput({ mode: "live", slide: textSlide, background: shaderBg, videoInput: camera });
  assert.equal(plan.layers.find((l) => l.id === "background")!.enabled, false, "plan agrees");
});

// ---- 4. slide layer always present + enabled -------------------------------
check("slide layer always present and enabled, for every slide kind", () => {
  for (const s of [textSlide, imageSlide, bandScriptureSlide]) {
    const slide = layerById(outputStateToLayers(state({ live: s })), "slide")!;
    assert.ok(slide, "slide layer present");
    assert.equal(slide.enabled, true, "slide layer enabled");
  }
});

// ---- 5. lower-third scripture → lowerThird zone -----------------------------
check("lower-third scripture slide surfaces as a lowerThird zone; plain text is full", () => {
  const band = layerById(outputStateToLayers(state({ live: bandScriptureSlide })), "slide")!;
  assert.deepEqual(band.zone, { kind: "lowerThird" });
  const plain = layerById(outputStateToLayers(state({ live: textSlide })), "slide")!;
  assert.deepEqual(plain.zone, { kind: "full" });
});

// ---- 6. announcement layer only when present -------------------------------
check("announcement layer present iff an announcement is set", () => {
  assert.equal(layerById(outputStateToLayers(state({})), "announcement"), undefined, "no announcement → no layer");
  const withA = outputStateToLayers(state({ announcement: { line1: "Welcome", position: "lower_third", style: { fontFamily: "Inter", fontSizePx: 40, fontWeight: 700, textColor: "#fff", bgColor: "#000", bgOpacity: 80, padding: 12, borderRadius: 8, align: "center" } } }));
  assert.ok(layerById(withA, "announcement"), "announcement present");
});

// ---- 7. z-order is strictly ascending --------------------------------------
check("derived layers are strictly z-ascending", () => {
  const layers = outputStateToLayers(state({ background: shaderBg, videoInput: null, announcement: { line1: "Hi", position: "lower_third", style: { fontFamily: "Inter", fontSizePx: 40, fontWeight: 700, textColor: "#fff", bgColor: "#000", bgOpacity: 80, padding: 12, borderRadius: 8, align: "center" } } }));
  for (let i = 1; i < layers.length; i++) assert.ok(layers[i].z > layers[i - 1].z, "strictly ascending z");
});

// ---- 8. round-trip hardening: every derived layer is wire-valid -------------
check("every derived layer passes isValidLayerWire (round-trips through the wire)", () => {
  const themeVideoState = state({ appearance: themeVideo, background: shaderBg, live: bandScriptureSlide, videoInput: camera });
  for (const st of [state({}), state({ background: shaderBg }), themeVideoState, state({ live: imageSlide, videoInput: camera })]) {
    for (const l of outputStateToLayers(st)) assert.ok(isValidLayerWire(l), `derived ${l.id} must be wire-valid`);
  }
});

console.log(`\noutputStateToLayers: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
