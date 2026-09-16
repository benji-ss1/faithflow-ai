"use client";
/**
 * OutputCompositor — the single shared output layer stack (Decoupling Phase 1).
 *
 * Before this component, the background / camera / slide / theme-logo composite
 * and ALL its precedence rules (camera-wins-over-background-template, per-slide
 * black bgColor suppressing the theme [owned inside SlideRenderer], transparent
 * OBS/NDI keying, transition-wrapped-vs-plain, theme video background, OBS
 * lower-third band) were hand-inlined and DUPLICATED — with drift — across the
 * four output routes: /live, /stage, /livestream, /ndi.
 *
 * This is a PURE EXTRACTION: the composed layer stack for a given OutputState +
 * mode is byte-identical to what each route rendered before. Where the four
 * routes genuinely differ, the difference is encoded via the `mode` prop and the
 * pure `planOutput()` decision function below — never left in the route.
 *
 * Scope (Phase 1): the core composited visual stack that lives inside (or in
 * place of) the PresentationCanvas — background template, live camera / theme
 * video, the slide (via OutputSlide or TransitionWrapper+SlideRenderer), and the
 * theme logo. The bespoke, non-duplicated per-route chrome (stage's two-panel
 * next-strip + clock, connection/pair badges, help pills, and the timer /
 * message / operator-message / lower-third overlays whose layout differs per
 * route) stays in the routes. Phase 3 folds the lower-third overlays into the
 * per-layer `zone` model per docs/DECOUPLING_PLAN.md.
 *
 * `planOutput()` is exported and unit-tested (test/output-compositor.test.ts) as
 * the golden record of the precedence rules.
 */
import { useRef, type ReactNode } from "react";
import { SlideRenderer } from "./SlideRenderer";
import { OutputSlide } from "./OutputSlide";
import { TransitionWrapper } from "./TransitionWrapper";
import { ThemeLogoLayer } from "./ThemeLayers";
import { PresentationCanvas } from "./PresentationCanvas";
import { BackgroundLayer } from "@/backgrounds/components/BackgroundLayer";
import {
  slideOutputIdentity,
  type SlidePayload,
  type ThemeAppearance,
  type VideoInputState,
  type BackgroundSpec,
  type TransitionSpec,
} from "@/lib/broadcast";
import type { ProjectionZone } from "@/lib/projection-zone";
import { overlayBandSlide, type ObsBandConfig, type ObsThemeColors, type ObsBandExtras } from "@/lib/obs-lowerthird";
import { planOutput, type CompositorMode, type OutputLayerPlan, type PlanInput } from "@/lib/output-plan";
import { resolveLayeredInput, layerOpacities } from "@/lib/output-layers-render";
import { maskFor, type SceneWire, type SceneScreen } from "@/lib/scenes";
import type { LayerWire } from "@/lib/broadcast";

export { planOutput, type CompositorMode } from "@/lib/output-plan";
export type {
  OutputPlan, SlideRenderMode, OutputLayerPlan, OutputLayerId,
  BackgroundLayerPlan, SlideLayerPlan, ThemeLogoLayerPlan, CanvasPlan,
} from "@/lib/output-plan";

export interface OutputCompositorProps {
  mode: CompositorMode;
  slide: SlidePayload;
  appearance?: ThemeAppearance | null;
  background?: BackgroundSpec | null;
  videoInput?: VideoInputState | null;
  transition?: TransitionSpec | null;
  fontScale?: number;
  referenceScale?: number;
  referenceColor?: string;
  zone?: ProjectionZone | null;
  aspectRatio?: "16:9" | "4:3" | "custom";
  /** livestream/ndi transparent (OBS alpha-key) mode. */
  transparent?: boolean;
  /** livestream ?transitions=1 gate. */
  transitionsEnabled?: boolean;
  /** livestream lower-third capture: when set, the slide is wrapped into the
   *  OBS band via overlayBandSlide (owns the "obsLowerThird only in livestream"
   *  precedence). Undefined → pass-through (full mode / other routes). */
  obsBand?: ObsBandConfig | null;
  obsThemeColors?: ObsThemeColors;
  /** OBS editor band extras (text colour / hide reference / operator lower
   *  third). Undefined ⇒ legacy band caption. Livestream + OBS preview only. */
  obsBandExtras?: ObsBandExtras;
  /** OBS editor "Over your camera" hints (only act with transparent). */
  obsOverlay?: { textColor?: string; textShadow?: string; verticalAlign?: "top" | "center" | "bottom"; scrim?: number };
  /** OBS editor "Full projector look" background-template dim (0..0.9). */
  backgroundDim?: number;
  videoMuted?: boolean;
  onVideoRef?: (el: HTMLVideoElement | null) => void;
  /**
   * Decoupling Phase 3 (flag-gated). When true, the compositor resolves the
   * render plan from the legacy fields AND the operator's id-keyed layer
   * overrides (background swap, slide clear, camera clear, zone, logo, opacity).
   * With NO overrides the output is byte-identical to the legacy path (parity
   * golden-test locked). The route gates this on NEXT_PUBLIC_LAYERS_V2; the
   * per-church opt-in is enforced operator-side (a church that never opts in
   * never emits overrides, so the map stays empty → identical output).
   */
  layersEnabled?: boolean;
  /** Id-keyed layer-patch overrides (from the route's layerOverridesRef). */
  layerOverrides?: LayerWire[] | Map<string, LayerWire> | null;
  /**
   * Y3: freeze the background layer (WebGL shaders show a static first frame; a
   * video background shows its first frame, no decode). Used ONLY by the operator
   * mini-preview so it doesn't spin up a SECOND live RAF WebGL loop / video decode
   * alongside the real projector. Projector routes leave it undefined ⇒ not frozen
   * ⇒ byte-identical live output.
   */
  previewFrozen?: boolean;
  /**
   * SCENES (2026-09-16): the active per-screen routing snapshot from
   * OutputState.scene, and WHICH screen this surface is. Both must be present
   * for a scene to affect anything — a route that passes neither renders exactly
   * as it did pre-Scenes. Deliberately independent of `layersEnabled`, because
   * NEXT_PUBLIC_LAYERS_V2 is off in production.
   */
  scene?: SceneWire | null;
  screen?: SceneScreen;
}

/**
 * Renders the composed layer stack for one output surface. The caller supplies
 * the OutputState pieces it holds in local state; the compositor owns the
 * z-ordering + precedence.
 */
export function OutputCompositor(props: OutputCompositorProps) {
  const {
    appearance: appearanceProp, transition, fontScale, referenceScale,
    referenceColor, zone, obsBand, obsThemeColors, videoMuted = false, onVideoRef,
    layersEnabled, layerOverrides, previewFrozen = false,
    obsBandExtras, obsOverlay, backgroundDim, scene, screen,
  } = props;

  // SCENES (2026-09-16): this screen's routing mask, if a scene is active.
  // Gated on DATA PRESENCE, never on NEXT_PUBLIC_LAYERS_V2 (off in production —
  // an env-gated scene would be dead code). No scene / unrouted screen ⇒ mask
  // undefined ⇒ every code path below behaves exactly as it did pre-Scenes
  // (parity locked by test/output-scenes.test.ts across the same ≥96 fixtures).
  const mask = screen ? maskFor(scene, screen) : undefined;
  // REMOUNT LATCH (review 🔴, 2026-09-16). The opacity wrapper below changes the
  // element type+key of every layer, so a boolean that FLIPS at runtime would
  // unmount/remount the whole layer stack on each scene switch — replaying the
  // enter transition on a held verse (the 2026-08-19 fade-pulse this repo
  // explicitly forbids, CLAUDE.md rule 7), restarting shader/video backgrounds,
  // and re-acquiring the camera (~200-800ms of black). So the latch is
  // MONOTONIC: once ANY scene has been seen on this surface it stays on for the
  // life of the window, and it keys on the SCENE being present at all (not on
  // whether THIS screen is routed), so switching between scenes that route
  // different screens never flips it. A church that never uses a scene keeps the
  // byte-identical legacy DOM (no wrapper at all).
  const sceneSeenRef = useRef(false);
  if (scene) sceneSeenRef.current = true;
  const wrapLayers = !!layersEnabled || sceneSeenRef.current;
  // Per-screen theme override. Resolved operator-side into a wire appearance, so
  // here it is a straight substitution — and because the local name shadows the
  // prop, every downstream renderer picks it up with no further plumbing.
  const appearance = mask?.appearance ?? appearanceProp;
  const sceneActive = !!mask;

  // Phase 3: when layers mode is on, resolve the render input from the operator's
  // id-keyed overrides (parity: empty overrides ⇒ input === props ⇒ same plan).
  // A scene mask joins the SAME resolver so it reuses planOutput's precedence and
  // always loses to an explicit operator override.
  const baseInput: PlanInput = appearance === appearanceProp ? props : { ...props, appearance };
  const resolvedInput: PlanInput = layersEnabled || sceneActive
    ? resolveLayeredInput(baseInput, layersEnabled ? layerOverrides : undefined, mask)
    : baseInput;
  const plan = planOutput(resolvedInput);
  const slide = resolvedInput.slide;
  const opacities = layersEnabled || sceneActive
    ? layerOpacities(layersEnabled ? layerOverrides : undefined, mask)
    : {};

  // OBS lower-third band transform (livestream lower_third capture mode).
  const effectiveSlide: SlidePayload = obsBand ? overlayBandSlide(slide, obsBand, obsThemeColors, obsBandExtras) : slide;

  // Render one plan layer by its stable id. The z-ordering + enable/disable is
  // owned by planOutput; the compositor just paints enabled layers in order.
  // (Same DOM as the pre-reshape switch — this is a repackaging, not a change.)
  function renderLayer(layer: OutputLayerPlan): ReactNode {
    if (!layer.enabled) return null;
    const node = renderLayerInner(layer);
    if (!node) return null;
    // Y7: in the LAYERS-ENABLED path the opacity wrapper is ALWAYS present with
    // `opacity: op ?? 1`, so the element identity is stable across a 1↔<1 opacity
    // change — a future opacity slider can never remount the camera/slide (which
    // would drop the video element / restart a transition). The flag-OFF legacy
    // path stays byte-identical (no wrapper at all), preserving 96-fixture parity.
    if (wrapLayers) {
      const op = opacities[layer.id] ?? 1;
      return (
        <div key={`op-${layer.id}`} className="absolute inset-0" style={{ opacity: op }}>
          {node}
        </div>
      );
    }
    return node;
  }

  function renderLayerInner(layer: OutputLayerPlan): ReactNode {
    switch (layer.id) {
      case "background": {
        if (!layer.props.background) return null;
        const bgNode = <BackgroundLayer key={layer.props.background.shaderPreset ?? layer.props.background.type} background={layer.props.background} frozen={previewFrozen} />;
        if (!(typeof backgroundDim === "number" && backgroundDim > 0)) return bgNode;
        // OBS editor full-look dim: a black veil over the template, under the words.
        return (
          <div key="bg-dim-wrap" className="absolute inset-0">
            {bgNode}
            <div className="absolute inset-0 pointer-events-none" data-obs-dim={backgroundDim} style={{ background: `rgba(0,0,0,${Math.min(0.9, backgroundDim)})` }} />
          </div>
        );
      }
      case "slide": {
        const { renderMode, overVideo, transparentBg, videoInput } = layer.props;
        if (renderMode === "over-video") {
          return (
            <OutputSlide
              key="slide"
              slide={effectiveSlide}
              videoInput={videoInput}
              appearance={appearance}
              fontScale={fontScale}
              referenceScale={referenceScale}
              referenceColor={referenceColor}
              projectorFit
            />
          );
        }
        const renderer = (key: string) => (
          <SlideRenderer
            key={key}
            slide={effectiveSlide}
            projectorFit
            fontScale={fontScale}
            referenceScale={referenceScale}
            referenceColor={referenceColor}
            appearance={appearance}
            overVideo={overVideo}
            transparentBg={transparentBg}
            videoMuted={videoMuted}
            onVideoRef={onVideoRef}
            {...(obsOverlay ? { obsOverlay } : {})}
          />
        );
        return renderMode === "transition" ? (
          <TransitionWrapper key="slide" identityKey={slideOutputIdentity(effectiveSlide)} transition={transition ?? null}>
            {renderer("slide-renderer")}
          </TransitionWrapper>
        ) : (
          renderer("slide")
        );
      }
      case "theme-logo":
        return <ThemeLogoLayer key="theme-logo" appearance={appearance} />;
    }
  }

  const stack: ReactNode = <>{plan.layers.map(renderLayer)}</>;

  if (!plan.canvas.enabled) return stack;
  return (
    <PresentationCanvas canvasW={plan.canvas.w} canvasH={plan.canvas.h} zone={zone}>
      {stack}
    </PresentationCanvas>
  );
}
