/**
 * output-layers-render — the PURE Phase 3 render-merge resolver.
 *
 * Phase 2 shipped `outputStateToLayers()` (the legacy→layers adapter) and the
 * `layer-patch` wire message. Phase 3 makes the projector RENDER from operator
 * layer overrides. This module is the parity-critical seam: it takes the exact
 * PlanInput the legacy compositor already feeds `planOutput()` plus the route's
 * id-keyed layer overrides, applies each override to a RESOLVED PlanInput, and
 * returns a normal `OutputPlan` via the unchanged `planOutput()`.
 *
 * PARITY GUARANTEE (golden-test locked): with NO overrides the resolved input is
 * `===`-shaped to the base input, so `resolveLayeredPlan(base, [])` deep-equals
 * `planOutput(base)`. Nothing renders differently until the operator actually
 * patches a layer. This reuses ALL of planOutput's proven precedence
 * (camera-wins, template-vs-video, transparent keying, stage-never-camera) —
 * an override only mutates the INPUT fields, never re-implements precedence.
 *
 * No React / no browser APIs — pure + deterministic, node-testable.
 */
import type { LayerWire, SlidePayload } from "@/lib/broadcast";
import { planOutput, type OutputPlan, type PlanInput } from "@/lib/output-plan";

/** The empty (black) slide — the layer-model expression of "clear the slide".
 *  Matches the routes' own clear (`applyLive({ kind: "empty" })`). */
function blankSlide(): SlidePayload {
  return { kind: "empty" };
}

/** Normalise overrides (array or Map) → a first-wins id→LayerWire map. */
export function toOverrideMap(
  overrides?: LayerWire[] | Map<string, LayerWire> | null,
): Map<string, LayerWire> {
  if (!overrides) return new Map();
  if (overrides instanceof Map) return overrides;
  const m = new Map<string, LayerWire>();
  for (const l of overrides) if (!m.has(l.id)) m.set(l.id, l);
  return m;
}

/**
 * Per-layer opacity extracted from the overrides, keyed by the PLAN layer id
 * ("background" | "slide" | "theme-logo"). The compositor applies these as a
 * wrapper only when < 1 (so parity holds when no opacity override is present).
 * Camera opacity folds onto the slide's over-video render (same as planOutput
 * fuses the camera into the slide layer), so it maps to "slide" too.
 */
export function layerOpacities(
  overrides?: LayerWire[] | Map<string, LayerWire> | null,
): Record<string, number> {
  const map = toOverrideMap(overrides);
  const out: Record<string, number> = {};
  const put = (planId: string, l?: LayerWire) => {
    if (l && typeof l.opacity === "number" && l.opacity >= 0 && l.opacity < 1) out[planId] = l.opacity;
  };
  put("background", map.get("background"));
  put("slide", map.get("slide"));
  put("theme-logo", map.get("logo"));
  return out;
}

/**
 * Apply id-keyed layer overrides to `base` and return the RESOLVED PlanInput
 * (resolved slide/background/videoInput/logo). The compositor renders from this
 * resolved input AND from `planOutput(resolved)` so the visible content matches
 * the plan's enable/precedence decisions.
 *
 * Recognised override ids (matching outputStateToLayers): background, camera,
 * slide, logo. Unknown ids are ignored. With NO overrides the SAME object is
 * returned (`resolveLayeredInput(base, []) === base`) → parity.
 */
export function resolveLayeredInput(
  base: PlanInput,
  overrides?: LayerWire[] | Map<string, LayerWire> | null,
): PlanInput {
  const map = toOverrideMap(overrides);
  if (map.size === 0) return base;

  // Shallow copy — we only ever replace whole fields, never mutate `base`.
  let slide: SlidePayload = base.slide;
  let background = base.background ?? null;
  let videoInput = base.videoInput ?? null;
  let showThemeLogoOverride = base.showThemeLogoOverride;

  // ── background ────────────────────────────────────────────────────────────
  const bg = map.get("background");
  if (bg && bg.kind === "background") {
    if (!bg.enabled) background = null;                 // clear/hide the template
    else if (bg.payload !== undefined) background = bg.payload ?? null; // swap
  }

  // ── camera ────────────────────────────────────────────────────────────────
  const cam = map.get("camera");
  if (cam && cam.kind === "camera") {
    if (!cam.enabled) videoInput = null;                // clear the camera feed
    else if (cam.payload !== undefined) videoInput = cam.payload ?? null; // swap
  }

  // ── slide ─────────────────────────────────────────────────────────────────
  const sl = map.get("slide");
  if (sl && (sl.kind === "slide" || sl.kind === "media")) {
    if (sl.payload !== undefined) slide = sl.payload ?? blankSlide();
    if (!sl.enabled) slide = blankSlide();              // clear the slide content
    // Zone control (Full / Lower third). Reuses SlideRenderer's proven
    // scriptureLayout:"lowerThird" band machinery for text slides; a "full"
    // zone strips any lower-third band back to full-bleed.
    if (sl.zone && slide.kind === "text") {
      if (sl.zone.kind === "lowerThird") slide = { ...slide, scriptureLayout: "lowerThird" };
      else if (sl.zone.kind === "full" && slide.scriptureLayout) {
        const { scriptureLayout: _drop, scriptureBand: _drop2, ...rest } = slide;
        void _drop; void _drop2;
        slide = rest;
      }
    }
  }

  // ── logo ──────────────────────────────────────────────────────────────────
  const logo = map.get("logo");
  if (logo && logo.kind === "logo") {
    showThemeLogoOverride = logo.enabled;
  }

  return { ...base, slide, background, videoInput, showThemeLogoOverride };
}

/**
 * Apply id-keyed layer overrides to `base` and resolve the OutputPlan. With NO
 * overrides this deep-equals `planOutput(base)` (parity — golden-test locked).
 */
export function resolveLayeredPlan(
  base: PlanInput,
  overrides?: LayerWire[] | Map<string, LayerWire> | null,
): OutputPlan {
  return planOutput(resolveLayeredInput(base, overrides));
}
