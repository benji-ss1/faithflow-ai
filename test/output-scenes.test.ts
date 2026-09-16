/**
 * Scenes render path (2026-09-16) — the two contracts that protect production:
 *
 *  1. PARITY: no mask (undefined OR null) ⇒ the resolved plan is identical to
 *     the pre-Scenes plan across the same fixture matrix the layers parity test
 *     uses, and the SAME base object is returned by reference when there are no
 *     overrides either. A church with no scene selected cannot see any change.
 *  2. OPERATOR WINS: a scene may hide a layer on a screen, but an explicit
 *     operator override for that layer id always beats the mask — a scene can
 *     never force-show what the operator cleared, nor restore what they hid.
 *
 * Run: npx tsx test/output-scenes.test.ts
 */
import assert from "node:assert/strict";
import type { LayerWire, SlidePayload, BackgroundSpec, ThemeAppearance, VideoInputState } from "../src/lib/broadcast";
import type { PlanInput } from "../src/lib/output-plan";
import type { ScreenMask } from "../src/lib/scenes";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

async function main() {
  const { planOutput } = await import("../src/lib/output-plan");
  const { resolveLayeredInput, resolveLayeredPlan, layerOpacities } = await import("../src/lib/output-layers-render");

  // ── fixture matrix (mirrors test/output-layers-render.test.ts) ─────────────
  const slides: SlidePayload[] = [
    { kind: "empty" },
    { kind: "text", text: "John 3:16" },
    { kind: "text", text: "band", scriptureLayout: "lowerThird" },
    { kind: "image", url: "https://x/i.png" },
    { kind: "video", url: "https://x/v.mp4" },
  ];
  const backgrounds: (BackgroundSpec | null)[] = [
    null,
    { type: "none" } as BackgroundSpec,
    { type: "shader", shaderPreset: "aurora" } as BackgroundSpec,
    { type: "video", videoUrl: "https://x/bg.mp4" } as BackgroundSpec,
  ];
  const appearances: (ThemeAppearance | null)[] = [
    null,
    { textColor: "#fff", bgColor: "#000" } as ThemeAppearance,
    { textColor: "#fff", bgType: "video", bgVideoUrl: "https://x/t.mp4" } as ThemeAppearance,
  ];
  const cameras: (VideoInputState | null)[] = [null, { deviceId: "cam-1" } as VideoInputState];
  const modes = ["live", "stage", "livestream", "ndi"] as const;

  const inputs: PlanInput[] = [];
  for (const mode of modes) {
    for (const slide of slides) {
      for (const background of backgrounds) {
        for (const appearance of appearances) {
          for (const videoInput of cameras) {
            inputs.push({ mode, slide, background, appearance, videoInput } as PlanInput);
            inputs.push({ mode, slide, background, appearance, videoInput, transparent: true } as PlanInput);
          }
        }
      }
    }
  }

  check(`parity: no mask ⇒ identical plan across ${inputs.length} fixtures (>=96)`, () => {
    assert.ok(inputs.length >= 96, `matrix too small: ${inputs.length}`);
    for (const input of inputs) {
      assert.deepEqual(resolveLayeredPlan(input, [], undefined), planOutput(input), `undefined mask: ${JSON.stringify(input.mode)}`);
      assert.deepEqual(resolveLayeredPlan(input, [], null), planOutput(input), "null mask");
      assert.deepEqual(resolveLayeredPlan(input, undefined, null), planOutput(input), "no overrides, null mask");
    }
  });

  check("parity: no overrides + no mask returns the SAME base object (reference)", () => {
    const base = inputs[1];
    assert.equal(resolveLayeredInput(base, [], undefined), base);
    assert.equal(resolveLayeredInput(base, [], null), base);
    assert.equal(resolveLayeredInput(base, undefined, undefined), base);
    // An empty layers object is still "nothing to do", but must not crash.
    assert.doesNotThrow(() => resolveLayeredInput(base, [], { layers: {} }));
  });

  const base: PlanInput = {
    mode: "live",
    slide: { kind: "text", text: "Psalm 23" },
    background: { type: "shader", shaderPreset: "aurora" } as BackgroundSpec,
    appearance: { textColor: "#fff", bgColor: "#000" } as ThemeAppearance,
    videoInput: { deviceId: "cam-1" } as VideoInputState,
    showThemeLogoOverride: true,
  } as PlanInput;

  check("a scene mask hides background / camera / words / logo on its screen", () => {
    const mask: ScreenMask = { layers: { background: false, camera: false, slide: false, logo: false } };
    const r = resolveLayeredInput(base, [], mask);
    assert.equal(r.background, null);
    assert.equal(r.videoInput, null);
    assert.deepEqual(r.slide, { kind: "empty" });
    assert.equal(r.showThemeLogoOverride, false);
    // base untouched
    assert.equal(base.background !== null, true);
    assert.equal(base.videoInput !== null, true);
  });

  check("layers:true (or absent) is NO CHANGE — a scene never force-shows", () => {
    const shown = resolveLayeredInput(base, [], { layers: { background: true, camera: true, slide: true, logo: true } });
    assert.deepEqual(resolveLayeredPlan(base, [], { layers: { background: true } }), planOutput(base));
    assert.equal(shown.background, base.background);
    assert.equal(shown.videoInput, base.videoInput);
    assert.deepEqual(shown.slide, base.slide);
  });

  check("OPERATOR WINS: an explicit override beats the scene mask, both ways", () => {
    // Operator SHOWs the background (enabled, null payload = restore from base)
    // while the scene hides it ⇒ the operator's show wins.
    const showBg: LayerWire[] = [{ id: "background", kind: "background", z: 0, enabled: true }];
    const r1 = resolveLayeredInput(base, showBg, { layers: { background: false } });
    assert.equal(r1.background, base.background, "operator SHOW beats scene hide");
    // Operator HIDEs the words while the scene says nothing ⇒ hidden.
    const hideSlide: LayerWire[] = [{ id: "slide", kind: "slide", z: 10, enabled: false }];
    const r2 = resolveLayeredInput(base, hideSlide, { layers: { slide: true } });
    assert.deepEqual(r2.slide, { kind: "empty" }, "operator HIDE survives a scene show");
    // Operator camera SHOW beats a scene camera hide.
    const showCam: LayerWire[] = [{ id: "camera", kind: "camera", z: 5, enabled: true }];
    assert.equal(resolveLayeredInput(base, showCam, { layers: { camera: false } }).videoInput, base.videoInput);
  });

  check("opacity: scene is the floor, operator opacity wins", () => {
    assert.deepEqual(layerOpacities([], { opacity: { background: 0.4, logo: 0.2 } }), { background: 0.4, "theme-logo": 0.2 });
    const op: LayerWire[] = [{ id: "background", kind: "background", z: 0, enabled: true, opacity: 0.9 }];
    assert.deepEqual(layerOpacities(op, { opacity: { background: 0.1 } }), { background: 0.9 });
    // camera opacity folds onto the slide layer; an explicit slide value wins
    assert.deepEqual(layerOpacities([], { opacity: { camera: 0.5 } }), { slide: 0.5 });
    assert.deepEqual(layerOpacities([], { opacity: { camera: 0.5, slide: 0.25 } }), { slide: 0.25 });
    // parity: no mask, no overrides ⇒ empty map (no opacity wrappers)
    assert.deepEqual(layerOpacities([], undefined), {});
    assert.deepEqual(layerOpacities(undefined, null), {});
  });

  check("scene opacity NEVER beats an operator override for that layer", () => {
    // An override that exists but writes no opacity (i.e. full brightness) must
    // still win: without the map.has() guard the scene's dimming survived.
    const fullBright: LayerWire[] = [{ id: "background", kind: "background", z: 0, enabled: true }];
    assert.deepEqual(layerOpacities(fullBright, { opacity: { background: 0.2 } }), {},
      "operator's full-brightness override beats the scene's dim");
    const camOverride: LayerWire[] = [{ id: "camera", kind: "camera", z: 5, enabled: true }];
    assert.deepEqual(layerOpacities(camOverride, { opacity: { camera: 0.3 } }), {});
    // With no override for that id the scene's value applies.
    assert.deepEqual(layerOpacities([], { opacity: { background: 0.2 } }), { background: 0.2 });
  });

  check("scene camera-dim never beats an operator override on the slide layer", () => {
    // The camera folds onto the SLIDE plan layer, so an override on either id wins.
    const slideOverride: LayerWire[] = [{ id: "slide", kind: "slide", z: 10, enabled: true }];
    assert.deepEqual(layerOpacities(slideOverride, { opacity: { camera: 0.2 } }), {},
      "operator's slide override beats a scene's camera dim (cross-id)");
  });

  check("a hidden-words scene still yields a renderable plan (never a crash/blank-state)", () => {
    for (const mode of modes) {
      const plan = resolveLayeredPlan({ ...base, mode } as PlanInput, [], { layers: { slide: false, background: false } });
      assert.ok(Array.isArray(plan.layers), `${mode} plan has layers`);
    }
  });

  console.log(`\nScenes render: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
