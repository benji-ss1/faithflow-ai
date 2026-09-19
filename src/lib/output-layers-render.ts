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
import type { ScreenMask } from "@/lib/scenes";

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
  mask?: ScreenMask | null,
  /** PP7 draw order: the camera is its OWN plan layer (`camera`), below the
   *  media, instead of being fused into the slide's over-video render — so its
   *  opacity must land on that layer, NOT on the slide (which would dim the
   *  words too, and dim them twice). Off ⇒ the legacy fold, byte-identical. */
  pp7DrawOrder?: boolean,
): Record<string, number> {
  const map = toOverrideMap(overrides);
  const out: Record<string, number> = {};
  // Scene opacity is the FLOOR; an explicit operator opacity always wins (same
  // precedence as visibility below).
  // A scene's opacity applies ONLY where the operator has no override for that
  // layer — the same "operator always wins" rule visibility uses. Without the
  // map.has() guard a scene would dim a layer whose opacity the operator had
  // deliberately set back to full (an override with opacity:1/undefined writes
  // nothing, so the scene's value would have survived).
  const putMask = (planId: string, sourceId: string, v?: number) => {
    if (map.has(sourceId)) return;
    if (typeof v === "number" && v >= 0 && v < 1) out[planId] = v;
  };
  if (mask?.opacity) {
    putMask("background", "background", mask.opacity.background);
    // Camera opacity folds onto the slide layer (planOutput fuses the camera
    // into the slide's over-video render); an explicit slide value wins.
    // The camera folds onto the SLIDE plan layer, so an operator override on
    // EITHER id must beat it (cross-id guard, not just same-id).
    if (pp7DrawOrder) putMask("camera", "camera", mask.opacity.camera);
    else if (!map.has("slide")) putMask("slide", "camera", mask.opacity.camera);
    putMask("slide", "slide", mask.opacity.slide);
    putMask("theme-logo", "logo", mask.opacity.logo);
  }
  const put = (planId: string, l?: LayerWire) => {
    if (l && typeof l.opacity === "number" && l.opacity >= 0 && l.opacity < 1) out[planId] = l.opacity;
  };
  put("background", map.get("background"));
  if (pp7DrawOrder) put("camera", map.get("camera"));
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
  mask?: ScreenMask | null,
): PlanInput {
  const map = toOverrideMap(overrides);
  // SCENES (2026-09-16): a per-screen routing mask, applied HERE so it reuses
  // every one of planOutput's proven precedence rules instead of re-deriving
  // them, and so it composes with the operator's overrides rather than fighting
  // them. Precedence is absolute: an explicit override for a layer id WINS, so
  // a scene can never force-show what the operator cleared, and can never
  // restore a layer the operator hid. (A pre-pass over `base` would break the
  // Wave-5A non-destructive-hide contract, because a SHOW override carries a
  // null payload and restores from `base`.)
  const maskLayers = mask?.layers;
  const hides = (id: "background" | "camera" | "slide" | "logo"): boolean =>
    maskLayers?.[id] === false && !map.has(id);
  if (map.size === 0 && !maskLayers) return base;

  // Shallow copy — we only ever replace whole fields, never mutate `base`.
  let slide: SlidePayload = base.slide;
  let background = base.background ?? null;
  let videoInput = base.videoInput ?? null;
  let showThemeLogoOverride = base.showThemeLogoOverride;

  // ── background ────────────────────────────────────────────────────────────
  if (hides("background")) background = null;
  if (hides("camera")) videoInput = null;
  if (hides("slide")) slide = blankSlide();
  if (hides("logo")) showThemeLogoOverride = false;

  const bg = map.get("background");
  if (bg && bg.kind === "background") {
    if (!bg.enabled) background = null;                 // hide/clear the template
    // SHOW/swap: only a REAL payload (non-null) overrides the base. A re-enable
    // that carries a null/undefined payload means "no swap" — keep the base
    // background so SHOW after a hide restores exactly what was there, even if a
    // prior reconcile left the override payload null (Wave 5A non-destructive
    // hide guarantee). `?? null` USED to force null here and restore nothing.
    else if (bg.payload != null) background = bg.payload;
  }

  // ── camera ────────────────────────────────────────────────────────────────
  const cam = map.get("camera");
  if (cam && cam.kind === "camera") {
    if (!cam.enabled) videoInput = null;                // clear the camera feed
    else if (cam.payload != null) videoInput = cam.payload; // swap only on real payload; else keep base
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
    // Media: a "full" zone un-bands a banded image/video (layout:"third") back to
    // full-screen, mirroring the text un-lower-third above. lowerThird is not
    // applied to media here (media banding comes only from an explicit per-slide editor layout).
    if (sl.zone && sl.zone.kind === "full" && (slide.kind === "image" || slide.kind === "video") && (slide.layout || slide.band)) {
      const { layout: _l, band: _b, bandMode: _m, caption: _c, ...rest } = slide;
      void _l; void _b; void _m; void _c;
      slide = rest as SlidePayload;
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
  mask?: ScreenMask | null,
): OutputPlan {
  return planOutput(resolveLayeredInput(base, overrides, mask));
}
