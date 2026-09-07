/**
 * OutputCompositor golden/behavioral tests (Decoupling Phase 1).
 *
 * Run: npx tsx test/output-compositor.test.ts
 *
 * Phase 1 is a PURE EXTRACTION: the shared OutputCompositor must render a
 * byte-identical layer stack to what /live, /stage, /livestream and /ndi each
 * inlined before. These tests pin the precedence resolver `planOutput()` (the
 * single source of truth for the rules that were duplicated + drifting) against
 * a matrix of OutputState fixtures × mode, asserting the composed stack
 * (presence/order/props) each route produced.
 *
 * SHAPE (review reshape): planOutput now returns an ordered `layers` list +
 * `canvas`. These tests assert on layer ORDER, PRESENCE (enabled), and per-layer
 * PROPS — the layer list IS the rendered stack (the component iterates it, no
 * DOM node for disabled layers). Uses plain node:assert (matching
 * test/projector-output.test.ts).
 */
import assert from "node:assert/strict";
import { planOutput, type CompositorMode, type OutputPlan, type OutputLayerId, type SlideLayerPlan } from "../src/lib/output-plan";
import type { SlidePayload, ThemeAppearance, VideoInputState, BackgroundSpec } from "../src/lib/broadcast";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

// ---- layer-shape helpers ----------------------------------------------------
/** The always-present three layers in z-order — the stable identity contract. */
function layerOrder(p: OutputPlan): OutputLayerId[] {
  return p.layers.map((l) => l.id);
}
/** Ids of the layers that actually paint (enabled). */
function enabledIds(p: OutputPlan): OutputLayerId[] {
  return p.layers.filter((l) => l.enabled).map((l) => l.id);
}
function layer(p: OutputPlan, id: OutputLayerId) {
  const l = p.layers.find((x) => x.id === id);
  assert.ok(l, `layer ${id} must be present in the list`);
  return l!;
}
function slideLayer(p: OutputPlan): SlideLayerPlan {
  return layer(p, "slide") as SlideLayerPlan;
}
function assertZOrdered(p: OutputPlan) {
  for (let i = 1; i < p.layers.length; i++) {
    assert.ok(p.layers[i].z > p.layers[i - 1].z, `layers must be strictly z-ascending (${p.layers[i - 1].id}→${p.layers[i].id})`);
  }
}

// ---- fixtures ---------------------------------------------------------------
const textSlide: SlidePayload = { kind: "text", text: "In the beginning" };
const imageSlide: SlidePayload = { kind: "image", url: "https://x/i.jpg" };
const videoSlide: SlidePayload = { kind: "video", url: "https://x/v.mp4" };
const blankSlide: SlidePayload = { kind: "blank" };
const logoSlide: SlidePayload = { kind: "logo" };
const emptySlide: SlidePayload = { kind: "empty" };

const bandScriptureSlide: SlidePayload = {
  kind: "text", text: "The LORD is my shepherd", reference: "Psalm 23:1", scriptureLayout: "lowerThird",
};

const shaderBg: BackgroundSpec = { type: "shader", shaderPreset: "gentle-waves" } as BackgroundSpec;
const noneBg: BackgroundSpec = { type: "none" } as BackgroundSpec;
const camera: VideoInputState = { deviceId: "cam-1", label: "HDMI", overlay: "full" } as VideoInputState;
const themeVideoAppearance: ThemeAppearance = { bgType: "video", bgVideoUrl: "https://x/bg.mp4", bgColor: "#000000", textColor: "#fff" } as ThemeAppearance;
const solidAppearance: ThemeAppearance = { bgType: "solid", bgColor: "#101820", textColor: "#fff" } as ThemeAppearance;
const obsBand = { position: 80, opacity: 0.85, style: "band" } as unknown as Record<string, unknown>;

const ALL_MODES: CompositorMode[] = ["live", "stage", "livestream", "ndi"];

// ---- 0. the layer list is always the three stable layers, z-ordered ---------
check("every plan carries background→slide→theme-logo in z-order", () => {
  for (const mode of ALL_MODES) {
    const p = planOutput({ mode, slide: textSlide });
    assert.deepEqual(layerOrder(p), ["background", "slide", "theme-logo"], `${mode}: stable layer identity + order`);
    assertZOrdered(p);
    // The slide layer always paints.
    assert.equal(layer(p, "slide").enabled, true, `${mode}: slide layer always enabled`);
  }
});

// ---- 1. plain text slide, nothing else --------------------------------------
check("text slide, no bg/camera → plain-ish stack per mode", () => {
  const live = planOutput({ mode: "live", slide: textSlide });
  assert.equal(layer(live, "background").enabled, false);
  assert.equal(slideLayer(live).props.renderMode, "transition");
  assert.equal(slideLayer(live).props.overVideo, false);
  assert.equal(slideLayer(live).props.transparentBg, false);
  assert.equal(slideLayer(live).props.videoInput, null);
  assert.equal(layer(live, "theme-logo").enabled, true);
  assert.equal(live.canvas.enabled, true);
  assert.deepEqual([live.canvas.w, live.canvas.h], [1920, 1080]);
  assert.deepEqual(enabledIds(live), ["slide", "theme-logo"], "live: no background layer paints");

  const stage = planOutput({ mode: "stage", slide: textSlide });
  assert.equal(slideLayer(stage).props.renderMode, "transition");
  assert.equal(stage.canvas.enabled, true);
  assert.deepEqual([stage.canvas.w, stage.canvas.h], [undefined, undefined], "stage uses PresentationCanvas default dims");

  const ls = planOutput({ mode: "livestream", slide: textSlide });
  assert.equal(slideLayer(ls).props.renderMode, "plain", "livestream defaults to no transition");
  assert.equal(ls.canvas.enabled, false, "livestream renders full-bleed");

  const ndi = planOutput({ mode: "ndi", slide: textSlide });
  assert.equal(slideLayer(ndi).props.renderMode, "plain", "ndi never transitions");
  assert.deepEqual([ndi.canvas.w, ndi.canvas.h], [1920, 1080]);
});

// ---- 2. image / video / blank / logo / empty slides render the same stack ---
// The slide KIND does not change the layer plan (only the compositing context
// does) — SlideRenderer branches internally. Assert the plan is stable.
check("slide kind does not change the plan (live)", () => {
  const base = planOutput({ mode: "live", slide: textSlide });
  for (const s of [imageSlide, videoSlide, blankSlide, logoSlide, emptySlide, bandScriptureSlide]) {
    assert.deepEqual(planOutput({ mode: "live", slide: s }), base, `slide kind ${s.kind} must not alter the plan`);
  }
});

// ---- 3. Background Template active ------------------------------------------
check("background template active → background enabled + overVideo, no camera", () => {
  for (const mode of ["live", "stage", "ndi"] as CompositorMode[]) {
    const p = planOutput({ mode, slide: textSlide, background: shaderBg });
    assert.equal(layer(p, "background").enabled, true, `${mode}: template renders`);
    assert.equal(slideLayer(p).props.overVideo, true, `${mode}: slide goes over the template`);
    assert.notEqual(slideLayer(p).props.renderMode, "over-video", `${mode}: template does NOT route through the camera composite`);
    // Background layer carries the actual spec for the compositor to render.
    assert.equal((layer(p, "background") as { props: { background: unknown } }).props.background, shaderBg);
  }
});

check("type:none background is inert (layer present but disabled)", () => {
  const p = planOutput({ mode: "live", slide: textSlide, background: noneBg });
  assert.equal(layer(p, "background").enabled, false);
  assert.equal(slideLayer(p).props.overVideo, false);
});

// ---- 3b. background PRESENT but suppressed (showBackground=false) -----------
// Camera active → the background LAYER stays in the list (stable identity for
// Phase 2) but is DISABLED, so the compositor emits no BackgroundLayer DOM.
check("background present but suppressed by camera → layer disabled, absent from DOM set", () => {
  const p = planOutput({ mode: "live", slide: textSlide, background: shaderBg, videoInput: camera });
  const bg = layer(p, "background");
  assert.equal(bg.enabled, false, "camera-wins: background layer disabled");
  assert.ok(!enabledIds(p).includes("background"), "disabled background never paints");
  assert.deepEqual(layerOrder(p), ["background", "slide", "theme-logo"], "layer still present in the list (stable id)");
});

// ---- 4. camera-wins-over-background-template --------------------------------
check("live camera wins over an active Background Template", () => {
  const p = planOutput({ mode: "live", slide: textSlide, background: shaderBg, videoInput: camera });
  assert.equal(layer(p, "background").enabled, false, "template suppressed by the camera");
  assert.equal(slideLayer(p).props.overVideo, false, "no overVideo when the camera is the backdrop");
  assert.equal(slideLayer(p).props.renderMode, "over-video", "slide composites over the camera");
  assert.equal(slideLayer(p).props.videoInput, camera, "camera fused onto the slide layer (over-video)");
});

check("camera alone → over-video (live), and stage ignores camera entirely", () => {
  const live = planOutput({ mode: "live", slide: textSlide, videoInput: camera });
  assert.equal(slideLayer(live).props.renderMode, "over-video");
  assert.equal(slideLayer(live).props.videoInput, camera);
  const stage = planOutput({ mode: "stage", slide: textSlide, videoInput: camera });
  assert.equal(slideLayer(stage).props.renderMode, "transition", "stage confidence monitor never composites a camera");
  assert.equal(slideLayer(stage).props.videoInput, null, "stage nulls the camera in the plan (dedup lives here)");
  assert.equal(layer(stage, "background").enabled, false);
});

// ---- 5. theme video background ----------------------------------------------
check("theme video background → over-video, but a template still wins over it", () => {
  const p = planOutput({ mode: "live", slide: textSlide, appearance: themeVideoAppearance });
  assert.equal(slideLayer(p).props.renderMode, "over-video", "theme video sits behind the slide");
  // A theme video is NOT a live camera → slide layer videoInput stays null even
  // in over-video (OutputSlide derives the theme video from appearance).
  assert.equal(slideLayer(p).props.videoInput, null, "theme video is not a camera; no videoInput on the layer");

  const withTemplate = planOutput({ mode: "live", slide: textSlide, appearance: themeVideoAppearance, background: shaderBg });
  assert.equal(layer(withTemplate, "background").enabled, true, "template renders");
  assert.equal(slideLayer(withTemplate).props.renderMode, "transition", "template wins over the theme video → no over-video composite");

  // Regression (be6dcc2 / 00f9adf follow-up): the OLD /stage route NEVER
  // composited a theme video — it always used the transition-wrapped
  // SlideRenderer. A theme video background must NOT flip stage to over-video
  // (that would drop the transition wrapper and start compositing the looping
  // video on the confidence monitor — a divergence from the pre-extraction
  // render). This MUST stay the transition path.
  const stageThemeVideo = planOutput({ mode: "stage", slide: textSlide, appearance: themeVideoAppearance });
  assert.equal(slideLayer(stageThemeVideo).props.renderMode, "transition", "stage ignores theme video — parity with the pre-extraction /stage route (00f9adf)");
  assert.equal(layer(stageThemeVideo, "theme-logo").enabled, true, "stage theme-video still shows the logo");
  assert.deepEqual(enabledIds(stageThemeVideo), ["slide", "theme-logo"], "stage+theme-video: slide+logo only, no background layer");
  // NDI + livestream DO composite theme video (their old routes had the branch).
  assert.equal(slideLayer(planOutput({ mode: "ndi", slide: textSlide, appearance: themeVideoAppearance })).props.renderMode, "over-video", "ndi keeps theme-video composite");
  assert.equal(slideLayer(planOutput({ mode: "livestream", slide: textSlide, appearance: themeVideoAppearance })).props.renderMode, "over-video", "livestream keeps theme-video composite");
});

// ---- 5b. ndi + theme video (fixed 1920×1080 canvas, plain-over-video) --------
check("ndi + theme video → over-video on the fixed NDI canvas, logo on", () => {
  const p = planOutput({ mode: "ndi", slide: textSlide, appearance: themeVideoAppearance });
  assert.equal(slideLayer(p).props.renderMode, "over-video", "ndi composites the theme video");
  assert.equal(slideLayer(p).props.transparentBg, false, "non-transparent ndi");
  assert.equal(layer(p, "theme-logo").enabled, true, "ndi (non-transparent) shows the logo");
  assert.equal(p.canvas.enabled, true);
  assert.deepEqual([p.canvas.w, p.canvas.h], [1920, 1080], "ndi fixed canvas");
  assert.deepEqual(enabledIds(p), ["slide", "theme-logo"]);
});

// ---- 6. transparent modes (livestream / ndi OBS-key) -----------------------
check("transparent livestream/ndi: no bg, no over-video, no logo, transparentBg on", () => {
  for (const mode of ["livestream", "ndi"] as CompositorMode[]) {
    const p = planOutput({ mode, slide: textSlide, background: shaderBg, videoInput: camera, appearance: themeVideoAppearance, transparent: true });
    assert.equal(layer(p, "background").enabled, false, `${mode}: no background layer in transparent key mode`);
    assert.equal(slideLayer(p).props.transparentBg, true, `${mode}: slide renders with alpha`);
    assert.equal(layer(p, "theme-logo").enabled, false, `${mode}: no theme logo over the key`);
    assert.notEqual(slideLayer(p).props.renderMode, "over-video", `${mode}: camera comes from OBS, never our composite, in transparent mode`);
    assert.deepEqual(enabledIds(p), ["slide"], `${mode}: ONLY the slide layer paints in transparent key mode`);
  }
});

// ---- 6b. livestream lower_third + transparent + obsBand ---------------------
// The OBS lower-third band is a slide-transform (obsBand, applied in the
// compositor), NOT a plan layer — the plan for transparent lower_third capture
// must still be slide-only, transparentBg, full-bleed. The band lives in the
// slide layer's rendered content, not a new layer.
check("livestream lower_third + transparent: obsBand leaves the PLAN unchanged (slide-only transparent full-bleed)", () => {
  const p = planOutput({ mode: "livestream", slide: bandScriptureSlide, transparent: true });
  assert.deepEqual(enabledIds(p), ["slide"], "transparent lower_third: only the slide layer paints");
  assert.equal(slideLayer(p).props.transparentBg, true);
  assert.equal(slideLayer(p).props.renderMode, "plain", "no transition by default; band capture stays plain");
  assert.equal(p.canvas.enabled, false, "livestream full-bleed");
  // The obsBand transform is a compositor-level slide wrap, so it must NOT
  // change the plan vs a plain transparent slide.
  assert.deepEqual(p, planOutput({ mode: "livestream", slide: textSlide, transparent: true }), "obsBand does not alter the plan");
  void obsBand; // band config is consumed by the compositor, not planOutput
});

// ---- 7. livestream transitions gate ----------------------------------------
check("livestream transitions only when enabled", () => {
  const off = planOutput({ mode: "livestream", slide: textSlide });
  assert.equal(slideLayer(off).props.renderMode, "plain");
  const on = planOutput({ mode: "livestream", slide: textSlide, transitionsEnabled: true });
  assert.equal(slideLayer(on).props.renderMode, "transition");
  // transitionsEnabled is moot when a camera composite is active.
  const cam = planOutput({ mode: "livestream", slide: textSlide, videoInput: camera, transitionsEnabled: true });
  assert.equal(slideLayer(cam).props.renderMode, "over-video");
});

// ---- 7b. livestream transparent + transitionsEnabled=true -------------------
// PARITY LOCK (old livestream route, be6dcc2^ lines 421-428): when transparent
// AND transitionsEnabled, the first (over-video) branch is false (transparent),
// then `transitionsEnabled ?` was TRUE → it rendered the TransitionWrapper with
// transparentBg=true. So the transparent key does NOT suppress the transition
// gate — it composites the alpha slide THROUGH the transition wrapper. The
// theme logo is still suppressed (transparent), and no background layer paints.
check("livestream transparent + transitionsEnabled=true → transition wrapper WITH alpha (parity)", () => {
  const p = planOutput({ mode: "livestream", slide: textSlide, transparent: true, transitionsEnabled: true });
  assert.equal(slideLayer(p).props.renderMode, "transition", "transparent + ?transitions=1 still wraps in a transition (old route parity)");
  assert.equal(slideLayer(p).props.transparentBg, true, "…but with alpha keying on");
  assert.equal(layer(p, "theme-logo").enabled, false, "logo still suppressed in transparent mode");
  assert.deepEqual(enabledIds(p), ["slide"], "transparent: only the slide layer paints (no background)");
});

// ---- 8. live aspect ratio drives canvas width ------------------------------
check("live canvas width follows aspect ratio", () => {
  assert.equal(planOutput({ mode: "live", slide: textSlide, aspectRatio: "16:9" }).canvas.w, 1920);
  assert.equal(planOutput({ mode: "live", slide: textSlide, aspectRatio: "4:3" }).canvas.w, 1440);
  assert.equal(planOutput({ mode: "live", slide: textSlide }).canvas.w, 1920, "default 16:9");
});

// ---- 9. theme logo always on for non-transparent modes ----------------------
check("theme logo on for live/stage/livestream(non-transparent)/ndi(non-transparent)", () => {
  for (const mode of ALL_MODES) {
    assert.equal(layer(planOutput({ mode, slide: textSlide, appearance: solidAppearance }), "theme-logo").enabled, true, `${mode} shows logo`);
  }
});

// ---- 10. blank/empty over a template still goes over-video via overVideo ----
check("blank slide over a template keeps overVideo (template shows through)", () => {
  const p = planOutput({ mode: "live", slide: blankSlide, background: shaderBg });
  assert.equal(slideLayer(p).props.overVideo, true);
  assert.equal(layer(p, "background").enabled, true);
});

console.log(`\nOutputCompositor plan: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
