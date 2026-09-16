/**
 * layer-store tests (Decoupling Phase 3, Wave 5A field-bug fix).
 *
 * STORE-LEVEL coverage for the two pure operator-store decisions that drive the
 * hide↔show round-trip and the R1b slide re-arm:
 *   - reconcileBackgroundOnBaseChange: a HIDDEN background override is never
 *     clobbered when the base store resets to none (the reported one-way toggle);
 *     a real new pick shows; a clear is followed only while actively showing.
 *   - shouldRearmSlideOnSend: any disabled slide override (T hide or CLEAR)
 *     re-arms on send (2026-09-16); an enabled/absent override is a no-op.
 *
 * ALSO an end-to-end hide→show round-trip through the FULL wire pipeline
 * (operator patch build → projector applyLayerPatchBounded → heartbeat rebuild →
 * resolveLayeredInput) for every layer, asserting SHOW restores exactly the base.
 *
 * Run: npx tsx test/layer-store.test.ts
 */
import assert from "node:assert/strict";
import { reconcileBackgroundOnBaseChange, shouldRearmSlideOnSend, liveContentKey } from "../src/lib/layer-store";
import { resolveLayeredInput } from "../src/lib/output-layers-render";
import { outputStateToLayers, applyLayerPatchBounded, rebuildOverridesFromSnapshot, type EpochRef } from "../src/lib/output-layers";
import { projectableTextSlide, type BackgroundSpec, type LayerWire, type OutputState, type VideoInputState } from "../src/lib/broadcast";
import type { PlanInput } from "../src/lib/output-plan";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const shaderBg: BackgroundSpec = { type: "shader", shaderPreset: "cleanSlate" } as BackgroundSpec;
const imageBg: BackgroundSpec = { type: "image", imageUrl: "https://x/y.jpg" } as BackgroundSpec;

function bgLayer(enabled: boolean, payload: BackgroundSpec | null): LayerWire {
  return { id: "background", kind: "background", z: 0, enabled, zone: { kind: "full" }, opacity: 1, payload };
}
function slideOverride(enabled: boolean): LayerWire {
  return { id: "slide", kind: "slide", z: 10, enabled, zone: { kind: "full" }, opacity: 1 };
}

// ── 1. reconcileBackgroundOnBaseChange ───────────────────────────────────────
check("reconcile: no override → never emits (derived base tracks the store)", () => {
  assert.deepEqual(reconcileBackgroundOnBaseChange(undefined, shaderBg), { emitSwap: false, spec: null });
  assert.deepEqual(reconcileBackgroundOnBaseChange(undefined, null), { emitSwap: false, spec: null });
});

check("reconcile: real new base pick shows over a stale override (swap-after-clear fix)", () => {
  // hidden override, but a real new template arrives → show it.
  assert.deepEqual(reconcileBackgroundOnBaseChange(bgLayer(false, shaderBg), imageBg), { emitSwap: true, spec: imageBg });
  // showing override, new pick → show it.
  assert.deepEqual(reconcileBackgroundOnBaseChange(bgLayer(true, shaderBg), imageBg), { emitSwap: true, spec: imageBg });
});

check("reconcile: base cleared to none while HIDDEN → DO NOTHING (preserve payload)", () => {
  // THE bug: theme-with-bg apply resets the store to none; a hidden bg override
  // must NOT be clobbered to null, or SHOW restores nothing.
  const d = reconcileBackgroundOnBaseChange(bgLayer(false, shaderBg), null);
  assert.deepEqual(d, { emitSwap: false, spec: null });
});

check("reconcile: base cleared to none while SHOWING → follow the clear", () => {
  const d = reconcileBackgroundOnBaseChange(bgLayer(true, shaderBg), null);
  assert.deepEqual(d, { emitSwap: true, spec: null });
});

// ── 2. shouldRearmSlideOnSend ────────────────────────────────────────────────
check("rearm: no override / enabled override → no-op", () => {
  assert.equal(shouldRearmSlideOnSend(undefined), false);
  assert.equal(shouldRearmSlideOnSend(slideOverride(true)), false);
});

check("rearm: T/Clear-Lyrics (eye-hidden) slide RE-ARMS on the next send (2026-09-16)", () => {
  assert.equal(shouldRearmSlideOnSend(slideOverride(false)), true);
});

check("contentKey: a theme/style restyle of the same words is NOT a content change (Victor 2026-09-16)", () => {
  const a = { kind: "text", text: "Amazing grace", reference: "Hymn" } as const;
  const styled = { ...a, bgColor: "#123456", bgImageUrl: "https://x/bg.jpg" };
  assert.equal(liveContentKey(styled as never), liveContentKey(a as never));
  assert.notEqual(liveContentKey({ kind: "text", text: "How sweet the sound" } as never), liveContentKey(a as never));
  assert.notEqual(liveContentKey(a as never), liveContentKey({ kind: "empty" } as never));
});

// ── 3. End-to-end hide→show round-trip through the FULL wire pipeline ─────────
// Replicates the hook's visibility-toggle patch build (buildPatch) so a SHOW
// restores exactly the base content on the projector, for every layer.
function buildPatch(base: LayerWire, enabled: boolean, clearPayload = false): LayerWire {
  const common = { id: base.id, z: base.z, enabled, zone: base.zone, opacity: base.opacity, transportScope: base.transportScope };
  switch (base.kind) {
    case "slide": case "media": return { ...common, kind: base.kind } as LayerWire;
    case "background": return { ...common, kind: "background", payload: clearPayload ? null : base.payload } as LayerWire;
    case "camera": return { ...common, kind: "camera", payload: clearPayload ? null : base.payload } as LayerWire;
    case "logo": return { ...common, kind: "logo" } as LayerWire;
    default: return base;
  }
}

const textSlide = projectableTextSlide("John 3:16");
const camera: VideoInputState = { deviceId: "cam-1", label: "Cam" } as VideoInputState;
const logoApp = { logoUrl: "https://x/logo.png", logoPosition: "top-left" } as unknown as OutputState["appearance"];

function deriveBase(state: Partial<OutputState>): LayerWire[] {
  const full = {
    live: textSlide, next: null, itemTitle: "", slideNumber: "", aspectRatio: "16:9",
    fitMode: "contain", safeArea: false, operatorMessage: null, lowerThird: null, countdownEndsAt: null,
    background: null, appearance: null, videoInput: null, ...state,
  } as OutputState;
  return outputStateToLayers(full, { mode: "live" });
}

function roundTrip(name: string, stateProps: Partial<OutputState>, id: string) {
  check(`round-trip: ${name} hide→show restores base (full wire)`, () => {
    const base = deriveBase(stateProps);
    const baseLayer = base.find((l) => l.id === id)!;
    const opMap = new Map<string, LayerWire>();
    const projMap = new Map<string, LayerWire>();
    const epochRef: EpochRef = { current: undefined };
    const epoch = Date.now();
    let rev = epoch;
    const input: PlanInput = {
      mode: "live",
      slide: (stateProps.live ?? textSlide) as PlanInput["slide"],
      background: stateProps.background ?? null,
      videoInput: stateProps.videoInput ?? null,
      appearance: stateProps.appearance ?? null,
    };
    const emit = (p: LayerWire) => { const s = { ...p, rev: ++rev }; opMap.set(s.id, s); applyLayerPatchBounded(projMap, s); };
    const heartbeat = () => rebuildOverridesFromSnapshot(projMap, Array.from(opMap.values()), { snapEpoch: epoch, epochRef });
    const resolved = () => resolveLayeredInput(input, Array.from(projMap.values()));
    const fieldOf = (r: PlanInput) =>
      id === "background" ? r.background : id === "camera" ? r.videoInput : id === "logo" ? r.showThemeLogoOverride : r.slide;

    heartbeat();
    const before = fieldOf(resolved());
    // HIDE (eye off): seed = base layer.
    emit(buildPatch(baseLayer, false));
    heartbeat();
    const hidden = resolved();
    if (id === "slide") assert.equal(hidden.slide.kind, "empty", "slide blanked");
    else if (id === "background") assert.equal(hidden.background, null, "bg hidden");
    else if (id === "camera") assert.equal(hidden.videoInput, null, "camera hidden");
    else if (id === "logo") assert.equal(hidden.showThemeLogoOverride, false, "logo hidden");
    // SHOW (eye on): seed = existing override.
    emit(buildPatch(opMap.get(id)!, true));
    heartbeat();
    const after = fieldOf(resolved());
    if (id === "logo") assert.equal(after, true, "logo shown");
    else assert.deepEqual(after, before, "SHOW restores exactly the base content");
  });
}

roundTrip("slide (text)", { live: textSlide }, "slide");
roundTrip("background (shader)", { background: shaderBg }, "background");
roundTrip("background (image)", { background: imageBg }, "background");
roundTrip("camera", { videoInput: camera }, "camera");
roundTrip("logo", { appearance: logoApp }, "logo");

// ── 4. Regression: hidden-bg payload clobbered to null still restores base ────
// Simulates the reconcile bug's WORST case reaching the resolver: an enabled
// SHOW override carrying a null payload must fall back to the base background.
check("resolver: SHOW with null payload falls back to base (clobber-proof)", () => {
  const input: PlanInput = { mode: "live", slide: textSlide, background: shaderBg };
  const showNull: LayerWire = { id: "background", kind: "background", z: 0, enabled: true, zone: { kind: "full" }, opacity: 1, payload: null };
  const r = resolveLayeredInput(input, [showNull]);
  assert.equal(r.background, shaderBg, "null-payload SHOW keeps the base background");
});

console.log(`\nlayer-store: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
