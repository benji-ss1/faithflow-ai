/**
 * output-layers-render tests (Decoupling Phase 3).
 *
 * The render-merge resolver is the parity-critical seam: with NO operator
 * overrides the layers render plan MUST equal the legacy planOutput plan for the
 * whole fixture matrix (golden parity). With overrides, exactly the targeted
 * layer changes and nothing else.
 *
 * Run: npx tsx test/output-layers-render.test.ts
 */
import assert from "node:assert/strict";
import { planOutput, type PlanInput, type CompositorMode } from "../src/lib/output-plan";
import { resolveLayeredPlan, resolveLayeredInput } from "../src/lib/output-layers-render";
import { projectableTextSlide, type BackgroundSpec, type SlidePayload, type ThemeAppearance, type VideoInputState, type LayerWire } from "../src/lib/broadcast";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const textSlide: SlidePayload = projectableTextSlide("John 3:16");
const shaderBg: BackgroundSpec = { type: "shader", shaderPreset: "cleanSlate" } as BackgroundSpec;
const imageBg: BackgroundSpec = { type: "image", imageUrl: "https://x/y.jpg" } as BackgroundSpec;
const camera: VideoInputState = { deviceId: "cam-1", label: "Cam" } as VideoInputState;
const videoAppearance: ThemeAppearance = { bgType: "video", bgVideoUrl: "https://x/v.mp4" } as ThemeAppearance;

const MODES: CompositorMode[] = ["live", "stage", "livestream", "ndi"];

// ── 1. Parity matrix: no overrides ⇒ identical to legacy plan ────────────────
check("parity: resolveLayeredPlan(input, []) deep-equals planOutput(input) for full matrix", () => {
  const bgs: (BackgroundSpec | null)[] = [null, shaderBg, imageBg];
  const cams: (VideoInputState | null)[] = [null, camera];
  const apps: (ThemeAppearance | null)[] = [null, videoAppearance];
  const transs = [false, true];
  let count = 0;
  for (const mode of MODES) for (const background of bgs) for (const videoInput of cams)
    for (const appearance of apps) for (const transparent of transs) {
      const input: PlanInput = { mode, slide: textSlide, background, videoInput, appearance, transparent };
      assert.deepEqual(resolveLayeredPlan(input, []), planOutput(input), `mismatch ${mode} bg=${background?.type} cam=${!!videoInput} app=${appearance?.bgType} tr=${transparent}`);
      assert.deepEqual(resolveLayeredPlan(input, undefined), planOutput(input), "undefined overrides parity");
      count++;
    }
  assert.ok(count >= 96, `expected ≥96 fixtures, ran ${count}`);
});

// resolveLayeredInput returns the SAME object identity when no overrides (cheap).
check("parity: resolveLayeredInput returns identical reference with no overrides", () => {
  const input: PlanInput = { mode: "live", slide: textSlide, background: shaderBg };
  assert.equal(resolveLayeredInput(input, []), input);
  assert.equal(resolveLayeredInput(input, new Map()), input);
});

// ── 2. Background swap changes ONLY the background layer ─────────────────────
check("patch: background swap changes only the background layer", () => {
  const input: PlanInput = { mode: "live", slide: textSlide, background: shaderBg };
  const overrides: LayerWire[] = [{ id: "background", kind: "background", z: 0, enabled: true, payload: imageBg }];
  const plan = resolveLayeredPlan(input, overrides);
  const bg = plan.layers.find((l) => l.id === "background")!;
  assert.equal((bg as { props: { background: BackgroundSpec | null } }).props.background, imageBg, "bg swapped");
  assert.equal(bg.enabled, true);
  // slide + logo untouched vs base.
  const base = planOutput(input);
  assert.deepEqual(plan.layers.find((l) => l.id === "slide"), base.layers.find((l) => l.id === "slide"), "slide untouched");
  assert.deepEqual(plan.layers.find((l) => l.id === "theme-logo"), base.layers.find((l) => l.id === "theme-logo"), "logo untouched");
});

// ── 3. Background disable clears the template (over-video only if video behind)
check("patch: background disable hides the template", () => {
  const input: PlanInput = { mode: "live", slide: textSlide, background: shaderBg };
  const plan = resolveLayeredPlan(input, [{ id: "background", kind: "background", z: 0, enabled: false }]);
  assert.equal(plan.layers.find((l) => l.id === "background")!.enabled, false, "bg disabled");
});

// ── 4. Slide clear leaves camera + background intact ─────────────────────────
check("patch: slide clear blanks slide, leaves background + camera", () => {
  const input: PlanInput = { mode: "live", slide: textSlide, background: shaderBg };
  const resolved = resolveLayeredInput(input, [{ id: "slide", kind: "slide", z: 10, enabled: false }]);
  assert.equal(resolved.slide.kind, "empty", "slide blanked to empty");
  assert.equal(resolved.background, shaderBg, "background untouched");
  // logo + background layers same as base.
  const plan = planOutput(resolved);
  assert.equal(plan.layers.find((l) => l.id === "background")!.enabled, true, "bg still on");
  assert.equal(plan.layers.find((l) => l.id === "theme-logo")!.enabled, true, "logo still on");
});

// ── 5. Camera clear removes the over-video composite ─────────────────────────
check("patch: camera clear drops the camera + over-video render", () => {
  const input: PlanInput = { mode: "live", slide: textSlide, videoInput: camera };
  // With a camera, base slide is over-video and background suppressed.
  const base = planOutput(input);
  assert.equal((base.layers.find((l) => l.id === "slide") as { props: { renderMode: string } }).props.renderMode, "over-video");
  const resolved = resolveLayeredInput(input, [{ id: "camera", kind: "camera", z: 5, enabled: false }]);
  assert.equal(resolved.videoInput, null, "camera cleared");
  const plan = planOutput(resolved);
  assert.notEqual((plan.layers.find((l) => l.id === "slide") as { props: { renderMode: string } }).props.renderMode, "over-video", "no longer over-video");
});

// ── 6. Logo disable turns off only the theme-logo layer ──────────────────────
check("patch: logo disable turns off theme-logo, nothing else", () => {
  const input: PlanInput = { mode: "live", slide: textSlide, background: shaderBg };
  const plan = resolveLayeredPlan(input, [{ id: "logo", kind: "logo", z: 20, enabled: false }]);
  assert.equal(plan.layers.find((l) => l.id === "theme-logo")!.enabled, false, "logo off");
  const base = planOutput(input);
  assert.deepEqual(plan.layers.find((l) => l.id === "background"), base.layers.find((l) => l.id === "background"), "bg untouched");
  assert.deepEqual(plan.layers.find((l) => l.id === "slide"), base.layers.find((l) => l.id === "slide"), "slide untouched");
});

// ── 7. Zone: lower-third sets scriptureLayout; full strips it ────────────────
check("patch: slide zone lowerThird/full toggles scriptureLayout", () => {
  const input: PlanInput = { mode: "live", slide: textSlide };
  const lower = resolveLayeredInput(input, [{ id: "slide", kind: "slide", z: 10, enabled: true, zone: { kind: "lowerThird" } }]);
  assert.equal((lower.slide as { scriptureLayout?: string }).scriptureLayout, "lowerThird", "lower-third set");
  const withBand: PlanInput = { mode: "live", slide: { ...textSlide, scriptureLayout: "lowerThird" } as SlidePayload };
  const full = resolveLayeredInput(withBand, [{ id: "slide", kind: "slide", z: 10, enabled: true, zone: { kind: "full" } }]);
  assert.equal((full.slide as { scriptureLayout?: string }).scriptureLayout, undefined, "full strips band");
});

// ── 8. Unknown override id is ignored (parity preserved) ─────────────────────
check("patch: unknown override id is a no-op", () => {
  const input: PlanInput = { mode: "live", slide: textSlide, background: shaderBg };
  const plan = resolveLayeredPlan(input, [{ id: "ghost", kind: "message", z: 30, enabled: true }]);
  assert.deepEqual(plan, planOutput(input), "unknown id leaves plan identical");
});

console.log(`\noutput-layers-render: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
