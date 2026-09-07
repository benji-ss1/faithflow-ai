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
 * We assert on the pure plan rather than a rendered DOM because BackgroundLayer
 * pulls in WebGL/three, which will not render under tsx/node — and the plan IS
 * the layer stack (the component renders straight from it). Uses plain
 * node:assert (matching test/projector-output.test.ts).
 */
import assert from "node:assert/strict";
import { planOutput, type CompositorMode } from "../src/lib/output-plan";
import type { SlidePayload, ThemeAppearance, VideoInputState, BackgroundSpec } from "../src/lib/broadcast";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
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

const ALL_MODES: CompositorMode[] = ["live", "stage", "livestream", "ndi"];

// ---- 1. plain text slide, nothing else --------------------------------------
check("text slide, no bg/camera → plain-ish stack per mode", () => {
  const live = planOutput({ mode: "live", slide: textSlide });
  assert.equal(live.showBackground, false);
  assert.equal(live.slideRender, "transition");
  assert.equal(live.overVideo, false);
  assert.equal(live.transparentBg, false);
  assert.equal(live.showThemeLogo, true);
  assert.equal(live.useCanvas, true);
  assert.deepEqual([live.canvasW, live.canvasH], [1920, 1080]);

  const stage = planOutput({ mode: "stage", slide: textSlide });
  assert.equal(stage.slideRender, "transition");
  assert.equal(stage.useCanvas, true);
  assert.deepEqual([stage.canvasW, stage.canvasH], [undefined, undefined], "stage uses PresentationCanvas default dims");

  const ls = planOutput({ mode: "livestream", slide: textSlide });
  assert.equal(ls.slideRender, "plain", "livestream defaults to no transition");
  assert.equal(ls.useCanvas, false, "livestream renders full-bleed");

  const ndi = planOutput({ mode: "ndi", slide: textSlide });
  assert.equal(ndi.slideRender, "plain", "ndi never transitions");
  assert.deepEqual([ndi.canvasW, ndi.canvasH], [1920, 1080]);
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
check("background template active → showBackground + overVideo, no camera", () => {
  for (const mode of ["live", "stage", "ndi"] as CompositorMode[]) {
    const p = planOutput({ mode, slide: textSlide, background: shaderBg });
    assert.equal(p.showBackground, true, `${mode}: template renders`);
    assert.equal(p.overVideo, true, `${mode}: slide goes over the template`);
    assert.notEqual(p.slideRender, "over-video", `${mode}: template does NOT route through the camera composite`);
  }
});

check("type:none background is inert", () => {
  const p = planOutput({ mode: "live", slide: textSlide, background: noneBg });
  assert.equal(p.showBackground, false);
  assert.equal(p.overVideo, false);
});

// ---- 4. camera-wins-over-background-template --------------------------------
check("live camera wins over an active Background Template", () => {
  const p = planOutput({ mode: "live", slide: textSlide, background: shaderBg, videoInput: camera });
  assert.equal(p.showBackground, false, "template suppressed by the camera");
  assert.equal(p.overVideo, false, "no overVideo when the camera is the backdrop");
  assert.equal(p.slideRender, "over-video", "slide composites over the camera");
});

check("camera alone → over-video (live), and stage ignores camera entirely", () => {
  const live = planOutput({ mode: "live", slide: textSlide, videoInput: camera });
  assert.equal(live.slideRender, "over-video");
  const stage = planOutput({ mode: "stage", slide: textSlide, videoInput: camera });
  assert.equal(stage.slideRender, "transition", "stage confidence monitor never composites a camera");
  assert.equal(stage.showBackground, false);
});

// ---- 5. theme video background ----------------------------------------------
check("theme video background → over-video, but a template still wins over it", () => {
  const p = planOutput({ mode: "live", slide: textSlide, appearance: themeVideoAppearance });
  assert.equal(p.slideRender, "over-video", "theme video sits behind the slide");

  const withTemplate = planOutput({ mode: "live", slide: textSlide, appearance: themeVideoAppearance, background: shaderBg });
  assert.equal(withTemplate.showBackground, true, "template renders");
  assert.equal(withTemplate.slideRender, "transition", "template wins over the theme video → no over-video composite");
});

// ---- 6. transparent modes (livestream / ndi OBS-key) -----------------------
check("transparent livestream/ndi: no bg, no over-video, no logo, transparentBg on", () => {
  for (const mode of ["livestream", "ndi"] as CompositorMode[]) {
    const p = planOutput({ mode, slide: textSlide, background: shaderBg, videoInput: camera, appearance: themeVideoAppearance, transparent: true });
    assert.equal(p.showBackground, false, `${mode}: no background layer in transparent key mode`);
    assert.equal(p.transparentBg, true, `${mode}: slide renders with alpha`);
    assert.equal(p.showThemeLogo, false, `${mode}: no theme logo over the key`);
    assert.notEqual(p.slideRender, "over-video", `${mode}: camera comes from OBS, never our composite, in transparent mode`);
  }
});

check("transparent is ignored for live/stage (no keying there)", () => {
  const live = planOutput({ mode: "live", slide: textSlide, background: shaderBg, transparent: true });
  assert.equal(live.transparentBg, false, "live never keys transparent");
  assert.equal(live.showBackground, true, "live still shows the template");
  assert.equal(live.showThemeLogo, true);
});

// ---- 7. livestream transitions gate ----------------------------------------
check("livestream transitions only when enabled", () => {
  const off = planOutput({ mode: "livestream", slide: textSlide });
  assert.equal(off.slideRender, "plain");
  const on = planOutput({ mode: "livestream", slide: textSlide, transitionsEnabled: true });
  assert.equal(on.slideRender, "transition");
  // transitionsEnabled is moot when a camera composite is active.
  const cam = planOutput({ mode: "livestream", slide: textSlide, videoInput: camera, transitionsEnabled: true });
  assert.equal(cam.slideRender, "over-video");
});

// ---- 8. live aspect ratio drives canvas width ------------------------------
check("live canvas width follows aspect ratio", () => {
  assert.equal(planOutput({ mode: "live", slide: textSlide, aspectRatio: "16:9" }).canvasW, 1920);
  assert.equal(planOutput({ mode: "live", slide: textSlide, aspectRatio: "4:3" }).canvasW, 1440);
  assert.equal(planOutput({ mode: "live", slide: textSlide }).canvasW, 1920, "default 16:9");
});

// ---- 9. theme logo always on for non-transparent modes ----------------------
check("theme logo on for live/stage/livestream(non-transparent)/ndi(non-transparent)", () => {
  for (const mode of ALL_MODES) {
    assert.equal(planOutput({ mode, slide: textSlide, appearance: solidAppearance }).showThemeLogo, true, `${mode} shows logo`);
  }
});

// ---- 10. blank/empty over a template still goes over-video via overVideo ----
check("blank slide over a template keeps overVideo (template shows through)", () => {
  const p = planOutput({ mode: "live", slide: blankSlide, background: shaderBg });
  assert.equal(p.overVideo, true);
  assert.equal(p.showBackground, true);
});

console.log(`\nOutputCompositor plan: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
