/**
 * PP7 DRAW ORDER (spec item 1, Victor sign-off 2026-09-18) — the pure half.
 *
 * ProPresenter's stack, top→bottom:
 *   Mask · Messages · Props · Announcements · Slide ·
 *   slide background colour · Media · Video Input · Screen Color
 *
 * Ours had two layers in the wrong place, and the second one was patched at
 * RENDER time instead of in the order (a `mediaOverCamera` special case plus a
 * three-way OR in the clear rail's media live-state — one rule expressed twice).
 * This suite pins:
 *
 *   1. FLAG OFF ⇒ byte-identical to `main`. `planOutput()` over 22,400 fixtures
 *      must reproduce `test/fixtures/output-plan-main.golden.json` exactly.
 *   2. FLAG ON ⇒ Media above Video Input, Props above Announcements, and
 *      nothing else moves.
 *   3. The compensation is GONE: no `mediaOverCamera`, and the rail's media
 *      live-state is a single rule again.
 *
 * The rendered-DOM half is `test/pp7-draw-order-dom.test.tsx`.
 * Run: npx tsx test/pp7-draw-order.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planOutput, type OutputPlan, type PlanInput, type SlideLayerPlan } from "../src/lib/output-plan";
import { outputStateToLayers } from "../src/lib/output-layers";
import { layerOpacities } from "../src/lib/output-layers-render";
import { pp7LayerActive, type Pp7LayerInputs } from "../src/lib/pp7-layer-model";
import { matrix, keyOf } from "./pp7-draw-order-matrix";
import type { BackgroundSpec, LayerWire, OutputState, SlidePayload, VideoInputState } from "../src/lib/broadcast";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const ids = (p: OutputPlan) => p.layers.map((l) => l.id);
const enabledIds = (p: OutputPlan) => p.layers.filter((l) => l.enabled).map((l) => l.id);
const slideLayer = (p: OutputPlan) => p.layers.find((l) => l.id === "slide") as SlideLayerPlan;
const bgEnabled = (p: OutputPlan) => !!p.layers.find((l) => l.id === "background")?.enabled;

const cam = { deviceId: "cam-1" } as VideoInputState;
const camBand = { deviceId: "cam-1", overlay: "lower_third" } as unknown as VideoInputState;
const media = { type: "image", imageUrl: "https://x/bg.png" } as BackgroundSpec;
const text: SlidePayload = { kind: "text", text: "Amazing grace" };
const pp7 = (i: Partial<PlanInput>) => planOutput({ mode: "live", slide: text, pp7DrawOrder: true, ...i } as PlanInput);
const legacy = (i: Partial<PlanInput>) => planOutput({ mode: "live", slide: text, ...i } as PlanInput);

// ── 1. FLAG OFF = main, byte for byte ────────────────────────────────────────
check("flag OFF: planOutput over 22,400 fixtures is byte-identical to main", () => {
  const golden = JSON.parse(readFileSync(new URL("./fixtures/output-plan-main.golden.json", import.meta.url), "utf8")) as {
    fixtures: number; plans: OutputPlan[]; order: number[];
  };
  const inputs = matrix();
  assert.equal(inputs.length, golden.fixtures, "the fixture matrix itself must not have changed");
  let checked = 0;
  for (let n = 0; n < inputs.length; n++) {
    const got = JSON.stringify(planOutput(inputs[n]));
    const want = JSON.stringify(golden.plans[golden.order[n]]);
    if (got !== want) assert.fail(`fixture ${keyOf(inputs[n])}\n          want ${want}\n          got  ${got}`);
    checked++;
  }
  assert.equal(checked, 22400);
});

check("flag OFF: an explicit pp7DrawOrder:false is also byte-identical", () => {
  for (const i of matrix().slice(0, 500)) {
    assert.deepEqual(planOutput({ ...i, pp7DrawOrder: false }), planOutput(i), keyOf(i));
  }
});

check("flag OFF: announcementLive is inert (the route still paints it)", () => {
  for (const i of matrix().slice(0, 500)) {
    assert.deepEqual(planOutput({ ...i, announcementLive: true }), planOutput(i), keyOf(i));
  }
});

// ── 2. The two swaps ─────────────────────────────────────────────────────────
check("SWAP 1 — Props (theme logo) draw ABOVE Announcements", () => {
  const p = pp7({ announcementLive: true, appearance: { logoUrl: "x" } as never });
  assert.deepEqual(ids(p), ["background", "slide", "announcement", "theme-logo"]);
  const ann = p.layers.findIndex((l) => l.id === "announcement");
  const logo = p.layers.findIndex((l) => l.id === "theme-logo");
  assert.ok(logo > ann, "props must paint after (above) announcements");
});

check("SWAP 2 — Media draws ABOVE Video Input (camera no longer hides the media)", () => {
  const before = legacy({ background: media, videoInput: cam });
  assert.equal(bgEnabled(before), false, "legacy: camera-wins-over-background-template");
  assert.deepEqual(ids(before), ["background", "slide", "theme-logo"], "legacy has no camera layer");

  const after = pp7({ background: media, videoInput: cam });
  assert.deepEqual(ids(after), ["camera", "background", "slide", "theme-logo"]);
  assert.equal(bgEnabled(after), true, "the media paints…");
  assert.ok(after.layers.findIndex((l) => l.id === "camera") < after.layers.findIndex((l) => l.id === "background"), "…above the camera");
});

check("the camera is z-BELOW the media and strictly z-ascending throughout", () => {
  const p = pp7({ background: media, videoInput: cam, announcementLive: true, appearance: { logoUrl: "x" } as never });
  for (let i = 1; i < p.layers.length; i++) {
    assert.ok(p.layers[i].z > p.layers[i - 1].z, `${p.layers[i - 1].id}→${p.layers[i].id} must ascend`);
  }
  assert.equal(p.layers.find((l) => l.id === "camera")!.z, -10);
});

check("the mediaOverCamera compensation is gone from the plan", () => {
  for (const p of [pp7({ background: media, videoInput: cam }), legacy({ background: media, videoInput: cam })]) {
    for (const l of p.layers) {
      assert.ok(!("mediaOverCamera" in (l as { props: object }).props), `${l.id} still carries mediaOverCamera`);
    }
  }
});

check("PP7: the slide layer stops painting the camera (cameraExternal), legacy still does", () => {
  assert.equal(slideLayer(pp7({ videoInput: cam })).props.cameraExternal, true);
  assert.equal(slideLayer(pp7({ videoInput: cam })).props.videoInput, cam, "kept for the word layout (scrim / band)");
  assert.equal(slideLayer(legacy({ videoInput: cam })).props.cameraExternal, undefined, "legacy fuses the camera in");
});

check("PP7: camera + media together still route the words through the over-video composite", () => {
  const p = pp7({ background: media, videoInput: cam });
  assert.equal(slideLayer(p).props.renderMode, "over-video", "the words must stay transparent-backed over the pair");
  assert.equal(slideLayer(p).props.cameraExternal, true);
});

check("PP7: camera overlay modes survive — full-screen AND lower-third band", () => {
  for (const c of [cam, { ...cam, overlay: "full" } as VideoInputState, camBand]) {
    const p = pp7({ background: media, videoInput: c });
    assert.equal(slideLayer(p).props.videoInput, c, "OutputSlide still gets the overlay mode");
    assert.equal(ids(p)[0], "camera");
  }
});

// ── 3. Everything else must not move ─────────────────────────────────────────
check("stage never gets a camera layer (confidence monitor), flag on or off", () => {
  const p = pp7({ mode: "stage", background: media, videoInput: cam });
  assert.ok(!ids(p).includes("camera"));
  assert.equal(slideLayer(p).props.videoInput, null);
});

check("transparent OBS/NDI keying still suppresses media, camera and logo", () => {
  for (const mode of ["livestream", "ndi"] as const) {
    const p = planOutput({ mode, slide: text, background: media, videoInput: cam, transparent: true, pp7DrawOrder: true, announcementLive: true } as PlanInput);
    assert.equal(bgEnabled(p), false, `${mode}: keyed output must not paint media`);
    assert.ok(!ids(p).includes("camera"), `${mode}: the camera comes from OBS itself`);
    assert.ok(!enabledIds(p).includes("theme-logo"), `${mode}: no logo on a keyed overlay`);
    assert.equal(slideLayer(p).props.transparentBg, true);
  }
});

check("theme VIDEO background still loses to a media template (unchanged rule)", () => {
  const themeVideo = { bgType: "video", bgVideoUrl: "https://x/t.mp4" } as never;
  assert.equal(pp7({ appearance: themeVideo, background: media }).layers.find((l) => l.id === "slide")!.enabled, true);
  assert.equal(slideLayer(pp7({ appearance: themeVideo, background: media })).props.renderMode, "transition", "template wins → no over-video composite");
  assert.equal(slideLayer(pp7({ appearance: themeVideo })).props.renderMode, "over-video", "no template → theme video composites");
});

check("media-as-background (an image/video SLIDE) is untouched by the draw order", () => {
  const img: SlidePayload = { kind: "image", url: "https://x/i.png" };
  for (const p of [pp7({ slide: img, background: media }), legacy({ slide: img, background: media })]) {
    assert.equal(slideLayer(p).props.renderMode, "transition");
    assert.equal(bgEnabled(p), true);
  }
});

check("canvas dims (aspect / ndi / livestream full-bleed) are untouched", () => {
  for (const i of matrix().slice(0, 800)) {
    assert.deepEqual(planOutput({ ...i, pp7DrawOrder: true, announcementLive: true }).canvas, planOutput(i).canvas, keyOf(i));
  }
});

// ── 3b. Theme decor (theme gaps PR A) must not be disturbed ─────────────────
const decorTheme = {
  textColor: "#fff", bgColor: "#101010",
  layout: { lyrics: { decor: [{ id: "d1", type: "image", url: "https://x/decor.png", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] } },
} as never;

check("theme decor sits ABOVE the media and the new camera layer, BELOW the words", () => {
  const p = pp7({ appearance: decorTheme, background: media });
  const at = (id: string) => p.layers.findIndex((l) => l.id === id);
  assert.ok(at("theme-decor") > at("background"), "decor above the media");
  assert.ok(at("theme-decor") < at("slide"), "decor below the words");
  assert.equal(p.layers.find((l) => l.id === "theme-decor")!.z, 5, "decor keeps z 5");
  // …and with a camera live it is STILL above it — the camera is z -10, and in
  // the over-video branch the decor is hosted inside the slide layer, which is
  // above the camera layer either way. The camera can never cover decor.
  const withCam = pp7({ appearance: decorTheme, background: media, videoInput: cam });
  const camAt = withCam.layers.findIndex((l) => l.id === "camera");
  assert.equal(camAt, 0, "the camera is the back wall");
  assert.equal(withCam.layers.find((l) => l.id === "camera")!.z, -10);
  assert.ok(withCam.layers.every((l) => l.id === "camera" || l.z > -10));
});

check("theme decor's enable rule is IDENTICAL with the draw order on and off", () => {
  for (const i of matrix()) {
    if (!i.appearance || !(i.appearance as { layout?: unknown }).layout) continue;
    const a = planOutput(i).layers.find((l) => l.id === "theme-decor");
    const b = planOutput({ ...i, pp7DrawOrder: true, announcementLive: true }).layers.find((l) => l.id === "theme-decor");
    assert.equal(!!a, !!b, `${keyOf(i)}: decor layer presence must match`);
    if (a && b) {
      assert.equal(a.enabled, b.enabled, `${keyOf(i)}: decor enabled must match`);
      assert.equal(a.z, b.z, `${keyOf(i)}: decor z must match`);
      // Props only matter when the layer paints. The ONE case where they differ
      // is camera + media, where PP7 makes `overVideo` true because the media
      // now shows — and there the decor layer is DISABLED in both orders (the
      // over-video branch hosts decor inside the slide render instead), so the
      // compositor never reads it. Asserting it only when enabled keeps the test
      // honest instead of pinning a value nothing uses.
      if (a.enabled) assert.deepEqual(a.props, b.props, `${keyOf(i)}: decor props must match while it paints`);
      else assert.equal(b.enabled, false);
    }
  }
});

// ── 4. The operator side: the rail's media live-state loses its compensation ──
const railInputs = (o: Partial<Pp7LayerInputs>): Pp7LayerInputs => ({
  kind: "text", rowActive: () => false, announcementActive: false,
  backgroundSpecActive: false, videoInputActive: false, messagesActive: false, ...o,
});

check("rail: with the draw order ON the media dot reads the background row alone", () => {
  // Camera live + media live. The derived background row now stays ON (media is
  // above the camera), so the dot needs no second clause.
  const on = pp7LayerActive(railInputs({ pp7DrawOrder: true, rowActive: (id) => id === "background" || id === "camera", backgroundSpecActive: true, videoInputActive: true }));
  assert.equal(on.media, true);
  assert.equal(on.videoInput, true);
  // …and the compensation is genuinely gone: raw spec + camera with the row OFF
  // (i.e. the operator cleared the media) must now read DARK, not live.
  const cleared = pp7LayerActive(railInputs({ pp7DrawOrder: true, rowActive: (id) => id === "camera", backgroundSpecActive: true, videoInputActive: true }));
  assert.equal(cleared.media, false, "a cleared media layer must not light up just because a camera is on");
});

check("rail: with the draw order OFF the legacy three-way OR is untouched", () => {
  const off = pp7LayerActive(railInputs({ rowActive: (id) => id === "camera", backgroundSpecActive: true, videoInputActive: true }));
  assert.equal(off.media, true, "legacy compensation must still fire (camera suppresses the row)");
});

check("rail: a media SLIDE still lights the media dot in both modes", () => {
  for (const pp7DrawOrder of [false, true]) {
    const a = pp7LayerActive(railInputs({ pp7DrawOrder, kind: "image", rowActive: (id) => id === "slide" }));
    assert.equal(a.media, true);
    assert.equal(a.slide, false, "a media slide is the Media layer, not the Slide layer");
  }
});

check("rail: props / announcements / slide / messages states are unchanged by the flag", () => {
  for (const pp7DrawOrder of [false, true]) {
    const a = pp7LayerActive(railInputs({ pp7DrawOrder, announcementActive: true, messagesActive: true, rowActive: (id) => id === "logo" || id === "slide" }));
    assert.equal(a.props, true);
    assert.equal(a.announcements, true);
    assert.equal(a.slide, true);
    assert.equal(a.messages, true);
    assert.equal(a.audio, false);
  }
});

// ── 5. The derived layer stack the operator panel reads ──────────────────────
function state(o: Partial<OutputState>): OutputState {
  return {
    live: text, next: null, itemTitle: "", slideNumber: "", aspectRatio: "16:9", fitMode: "contain",
    safeArea: false, operatorMessage: null, lowerThird: null, countdownEndsAt: null,
    background: null, appearance: null, videoInput: null, ...o,
  } as OutputState;
}
const row = (ls: LayerWire[], id: string) => ls.find((l) => l.id === id)!;

check("adapter: flag OFF is byte-identical for the camera/media matrix", () => {
  for (const background of [null, media]) {
    for (const videoInput of [null, cam]) {
      for (const mode of ["live", "stage", "livestream", "ndi"] as const) {
        for (const transparent of [false, true]) {
          const s = state({ background, videoInput });
          assert.deepEqual(
            outputStateToLayers(s, { mode, transparent, pp7DrawOrder: false }),
            outputStateToLayers(s, { mode, transparent }),
            `${mode}/${transparent}`,
          );
        }
      }
    }
  }
});

check("adapter: flag ON keeps the media row live under a camera, and re-stacks z", () => {
  const s = state({ background: media, videoInput: cam, announcement: { line1: "hi" } as never });
  const before = outputStateToLayers(s, { mode: "live" });
  const after = outputStateToLayers(s, { mode: "live", pp7DrawOrder: true });
  assert.equal(row(before, "background").enabled, false, "legacy: camera wins");
  assert.equal(row(after, "background").enabled, true, "PP7: media covers the camera");
  assert.ok(row(after, "camera").z < row(after, "background").z, "camera below media");
  assert.ok(row(after, "announcement").z < row(after, "logo").z, "announcements below props");
  assert.equal(row(after, "slide").enabled, true);
});

check("opacity: the camera's opacity lands on the camera layer under PP7, the slide under legacy", () => {
  const camPatch: LayerWire = { id: "camera", kind: "camera", z: 5, enabled: true, opacity: 0.4, payload: cam } as LayerWire;
  assert.deepEqual(layerOpacities([camPatch], null, true), { camera: 0.4 }, "PP7: dims the camera only");
  assert.deepEqual(layerOpacities([camPatch], null, false), {}, "legacy behaviour unchanged (no camera plan layer)");
  const mask = { opacity: { camera: 0.5 } } as never;
  assert.deepEqual(layerOpacities(undefined, mask, true), { camera: 0.5 });
  assert.deepEqual(layerOpacities(undefined, mask, false), { slide: 0.5 }, "legacy folds camera opacity onto the slide");
  assert.deepEqual(layerOpacities(undefined, mask), { slide: 0.5 }, "omitted flag = legacy");
});

console.log(`\nPP7 draw order (pure): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
