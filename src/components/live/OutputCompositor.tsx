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
import { usePp7DrawOrder } from "@/lib/pp7-draw-order";
import { usePp7KeepThemeBg, isKeepThemeBgSlide } from "@/lib/pp7-keep-theme-bg";
import { SlideRenderer } from "./SlideRenderer";
import { OutputSlide } from "./OutputSlide";
import { TransitionWrapper } from "./TransitionWrapper";
import { ThemeLogoLayer, themeLogoPaints } from "./ThemeLayers";
import { ThemeDecorLayer } from "./ThemeDecorLayer";
import { themeDecorPlan } from "@/lib/theme-decor-plan";
import { PresentationCanvas } from "./PresentationCanvas";
import { BackgroundLayer } from "@/backgrounds/components/BackgroundLayer";
import { LiveVideoLayer } from "./LiveVideoLayer";
import { AnnouncementLayer } from "./AnnouncementLayer";
import {
  slideOutputIdentity,
  type AnnouncementPayload,
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
  BackgroundLayerPlan, ThemeDecorLayerPlan, SlideLayerPlan, ThemeLogoLayerPlan, CanvasPlan,
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
  /** Theme → Projector (PR 2): ignore the theme's text boxes (full-screen).
   *  Always on for mode="stage" (the stage display stays full-screen). */
  ignoreThemeLayout?: boolean;
  /**
   * The announcement overlay for this surface, or null. Under the PP7 draw order
   * the compositor paints it BELOW the props (theme logo) — PP7 draws Props above
   * Announcements. With the draw-order flag OFF it is painted LAST, exactly where
   * the routes used to paint it themselves, so the output is unchanged.
   * The routes must NOT also render an AnnouncementLayer.
   */
  announcement?: AnnouncementPayload | null;
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
  /**
   * True once this surface knows Scenes is enabled for the church (the operator
   * sends the `scene` field — even as null — whenever it is). It pre-arms the
   * layer wrapper below so the FIRST scene of a service can't flip it mid-service
   * and remount the stack. A church without Scenes never sets it ⇒ legacy DOM.
   */
  scenesPossible?: boolean;
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
    obsBandExtras, obsOverlay, backgroundDim, scene, screen, scenesPossible,
    announcement = null,
  } = props;
  // Theme → Projector (PR 2): the stage display always stays full-screen.
  const ignoreLayout = props.mode === "stage" || props.ignoreThemeLayout === true;

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
  if (scene || scenesPossible) sceneSeenRef.current = true;
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
  // ProPresenter 7 draw order — Media above Video Input, Props above
  // Announcements (src/lib/pp7-draw-order.ts). Read after mount so server and
  // first client render match; both kill switches are live on this machine.
  // Deliberately INDEPENDENT of `layersEnabled`: the stack order is an output
  // rule, not a layer-override feature, so it must not depend on NEXT_PUBLIC_LAYERS_V2.
  const pp7Order = usePp7DrawOrder();
  const plan = planOutput(
    pp7Order ? { ...resolvedInput, pp7DrawOrder: true, announcementLive: !!announcement } : resolvedInput,
  );
  // PP7 "Clear Slide keeps the theme's media" (src/lib/pp7-keep-theme-bg.ts).
  // Receiver-side half of the kill switch: with it off, a slide carrying the
  // keep flag is rendered as a plain empty slide — byte-identical to before.
  const keepThemeBgOn = usePp7KeepThemeBg();
  const slide = isKeepThemeBgSlide(resolvedInput.slide) && !keepThemeBgOn ? ({ kind: "empty" } as SlidePayload) : resolvedInput.slide;
  const opacities = layersEnabled || sceneActive
    ? layerOpacities(layersEnabled ? layerOverrides : undefined, mask, pp7Order)
    : {};

  // OBS lower-third band transform (livestream lower_third capture mode).
  const effectiveSlide: SlidePayload = obsBand ? overlayBandSlide(slide, obsBand, obsThemeColors, obsBandExtras) : slide;

  // Theme gaps (PR A): when the persistent theme-decor layer is active, the
  // slide stops painting its own theme bg/decor (only for slides the shared
  // themeDecorPlan says carry decor). Absent layer ⇒ nothing changes.
  const decorLayer = plan.layers.find((l) => l.id === "theme-decor" && l.enabled);
  const decorPlan = decorLayer && decorLayer.id === "theme-decor"
    ? themeDecorPlan(effectiveSlide, appearance, { overVideo: decorLayer.props.overVideo, transparentBg: decorLayer.props.transparentBg, ignoreThemeLayout: decorLayer.props.ignoreThemeLayout })
    : null;
  const chromeHosted = !!decorLayer;

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
      // Decor was part of the slide before PR A, so it follows the slide opacity.
      const op = opacities[layer.id] ?? (layer.id === "theme-decor" ? opacities.slide : undefined) ?? 1;
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
      case "camera":
        // PP7 draw order: Video Input is the back wall, painted BELOW Media. In
        // the legacy order there is no such layer — OutputSlide paints the camera
        // itself (see `cameraExternal` on the slide layer).
        return <LiveVideoLayer key="camera" input={layer.props.videoInput} />;
      case "announcement":
        // PP7 draw order: Announcements draw BELOW Props (the theme logo).
        return <AnnouncementLayer key="announcement" ann={announcement} />;
      case "theme-decor":
        // Theme chrome, drawn with the slide: above the media AND above the PP7
        // camera layer (both are below it in the plan), below the words.
        return <ThemeDecorLayer key="theme-decor" appearance={appearance} plan={decorPlan} overVideo={layer.props.overVideo} frozen={previewFrozen} />;
      case "slide": {
        const { renderMode, overVideo, transparentBg, videoInput, cameraExternal } = layer.props;
        if (renderMode === "over-video") {
          return (
            <OutputSlide
              key="slide"
              slide={effectiveSlide}
              videoInput={videoInput}
              cameraExternal={cameraExternal}
              appearance={appearance}
              fontScale={fontScale}
              referenceScale={referenceScale}
              referenceColor={referenceColor}
              projectorFit
              previewFrozen={previewFrozen}
              {...(ignoreLayout ? { ignoreThemeLayout: true } : {})}
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
            {...(chromeHosted ? { themeChromeHosted: true } : {})}
            {...(obsOverlay ? { obsOverlay } : {})}
            {...(ignoreLayout ? { ignoreThemeLayout: true } : {})}
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
        // Nothing configured ⇒ nothing paints. Returned as null (rather than an
        // element that renders null) so the announcement split below can tell
        // whether the props layer really needs to sit above the announcement.
        if (!themeLogoPaints(appearance)) return null;
        return <ThemeLogoLayer key="theme-logo" appearance={appearance} />;
    }
  }

  const nodes = plan.layers.map((l) => ({ id: l.id, node: renderLayer(l) }));
  // Where the announcement sits in the stack. PP7 draw order puts it in the plan
  // (below the props); legacy has no announcement layer, so it is painted LAST —
  // byte-identical to the routes painting it themselves, which is what they did
  // before this prop existed.
  const annIdx = nodes.findIndex((n) => n.id === "announcement");
  const legacyAnnouncement = annIdx < 0 && announcement ? <AnnouncementLayer key="announcement" ann={announcement} /> : null;

  if (!plan.canvas.enabled) {
    // livestream renders full-bleed (no PresentationCanvas), so plain paint order
    // already gives PP7's Props-above-Announcements with nothing else to do.
    return <>{nodes.map((n) => n.node)}{legacyAnnouncement}</>;
  }

  const canvas = (children: ReactNode, key?: string) => (
    <PresentationCanvas key={key} canvasW={plan.canvas.w} canvasH={plan.canvas.h} zone={zone}>
      {children}
    </PresentationCanvas>
  );

  // Nothing actually paints above the announcement (no theme logo configured, or
  // transparent keying suppressed it) → no reason to split the canvas. Keeps the
  // DOM identical to the legacy path for every surface whose only PP7 change
  // would have been an empty second canvas.
  const paintsAboveAnnouncement = nodes.slice(annIdx + 1).some((n) => n.node !== null);
  if (annIdx < 0 || !paintsAboveAnnouncement) {
    return <>{canvas(nodes.filter((n) => n.id !== "announcement").map((n) => n.node))}{legacyAnnouncement ?? (annIdx >= 0 ? nodes[annIdx].node : null)}</>;
  }

  // PP7 draw order WITH a live announcement. The announcement is sized in real
  // pixels against the WINDOW (the routes always drew it outside the fixed
  // 1920×1080 presentation canvas), so folding it into the canvas would rescale
  // an operator's announcement on any non-1080p output — a regression nobody
  // asked for. Instead the stack is split around it: everything below it in one
  // canvas, the announcement in its original window-relative box, and the layers
  // ABOVE it (the props / theme logo) in a second, identical canvas on top. Both
  // canvases have the same dims + zone, so every layer keeps exactly the geometry
  // it had — only the paint order changes.
  return (
    <>
      {canvas(nodes.slice(0, annIdx).map((n) => n.node), "canvas-below-announcement")}
      {nodes[annIdx].node}
      <div className="absolute inset-0 pointer-events-none">
        {canvas(nodes.slice(annIdx + 1).map((n) => n.node), "canvas-above-announcement")}
      </div>
    </>
  );
}
