/**
 * output-plan — the PURE output-compositing precedence resolver (Decoupling
 * Phase 1). No React / no component imports (only erased type imports), so it is
 * directly unit-testable in node (test/output-compositor.test.ts) and importable
 * from the offscreen/SSR paths without dragging in WebGL.
 *
 * This is the single source of truth for the rules that used to be hand-inlined
 * and DUPLICATED — with drift — across /live, /stage, /livestream, /ndi:
 *   - camera-wins-over-background-template
 *   - background-template-wins-over-theme-video (no over-video composite then)
 *   - transparent OBS/NDI keying suppresses background, over-video and logo
 *   - transition-wrapped vs plain vs over-video slide render, per mode
 *   - canvas dims per mode (live aspect-driven, ndi 1920×1080, livestream none)
 *
 * The per-slide "default black bgColor suppresses the theme" rule lives INSIDE
 * SlideRenderer (isDefaultBlack) and is reached via the overVideo/appearance
 * props this plan sets — it is not re-implemented here.
 *
 * SHAPE (Phase 1 review reshape): planOutput returns an ORDERED layer list
 * (`layers`, ascending `z`) plus the `canvas` wrapper spec. The compositor
 * renders by iterating `layers` in order. Today's mutual exclusivities (camera
 * fused into the slide's over-video render, template-wins-over-theme-video,
 * transparent keying suppressing background+logo, stage-never-camera) are
 * encoded HERE as plan-construction logic — each produces the same DOM as
 * before. This is deliberately prep for Phase 2's additive LayerWire[] wire
 * model; it is NOT new runtime flexibility.
 */
import type { SlidePayload, ThemeAppearance, VideoInputState, BackgroundSpec } from "@/lib/broadcast";
import { themeHasDecor } from "@/lib/theme-decor-plan";

export type CompositorMode = "live" | "stage" | "livestream" | "ndi";

/**
 * How the slide layer is composed. Mutually exclusive; mirrors the exact
 * branches each route used.
 *   - "over-video": OutputSlide composites the slide over a live camera or theme
 *     video background (persistent video sibling, no slide-keyed wrapper).
 *   - "transition": TransitionWrapper + SlideRenderer (projector transitions).
 *   - "plain": SlideRenderer with no transition wrapper.
 */
export type SlideRenderMode = "over-video" | "transition" | "plain";

/** Stable per-layer identity. Phase 2's LayerWire[] will reuse these ids. */
export type OutputLayerId = "background" | "theme-decor" | "slide" | "theme-logo";
export type OutputLayerKind = "background" | "theme-decor" | "slide" | "theme-logo";

interface OutputLayerBase {
  /** Stable id (z-independent) — the seam Phase 2's wire model plugs into. */
  id: OutputLayerId;
  kind: OutputLayerKind;
  /** z-order; the compositor renders ascending. */
  z: number;
  /** Whether this layer paints. Disabled layers stay in the list (stable
   *  identity for Phase 2) but the compositor skips them → same DOM out. */
  enabled: boolean;
}

export interface BackgroundLayerPlan extends OutputLayerBase {
  id: "background";
  kind: "background";
  props: { background: BackgroundSpec | null };
}

export interface SlideLayerPlan extends OutputLayerBase {
  id: "slide";
  kind: "slide";
  props: {
    /** How the slide layer is composed. */
    renderMode: SlideRenderMode;
    /** overVideo flag passed to SlideRenderer (slide bg goes transparent). */
    overVideo: boolean;
    /** transparentBg flag passed to SlideRenderer (OBS / NDI alpha key). */
    transparentBg: boolean;
    /** The camera fused into the over-video render (stage-nulled here, once).
     *  null for the transition/plain branches. */
    videoInput: VideoInputState | null;
    /** ProPresenter 7 layer order: Media draws ABOVE a live camera (below the
     *  words). Present only when enabled and both are live; absent otherwise. */
    mediaOverCamera?: BackgroundSpec;
  };
}

export interface ThemeLogoLayerPlan extends OutputLayerBase {
  id: "theme-logo";
  kind: "theme-logo";
  props: Record<string, never>;
}

/**
 * Theme gaps (PR A): the theme background + decor objects, hosted OUTSIDE the
 * slide's transition wrapper so a decor video/animation persists across slides.
 * Present in the list ONLY when the theme has decor (decor-less plans are
 * byte-identical to before). Disabled over video / transparent keying / stage.
 */
export interface ThemeDecorLayerPlan extends OutputLayerBase {
  id: "theme-decor";
  kind: "theme-decor";
  props: { overVideo: boolean; transparentBg: boolean; ignoreThemeLayout: boolean };
}

export type OutputLayerPlan = BackgroundLayerPlan | ThemeDecorLayerPlan | SlideLayerPlan | ThemeLogoLayerPlan;

export interface CanvasPlan {
  /** Wrap the stack in a PresentationCanvas (livestream renders full-bleed). */
  enabled: boolean;
  /** Canvas width when enabled (undefined → PresentationCanvas default). */
  w?: number;
  /** Canvas height when enabled (undefined → PresentationCanvas default). */
  h?: number;
}

export interface OutputPlan {
  /** The composed layer stack, ordered by ascending z. The compositor iterates
   *  this list; disabled layers are skipped. */
  layers: OutputLayerPlan[];
  /** The PresentationCanvas wrapper spec. */
  canvas: CanvasPlan;
}

/** True when a video sits behind the slide — a live camera input, or a theme's
 *  looping video background. Kept in sync with OutputSlide.hasVideoBackground. */
function hasVideoBehind(videoInput?: VideoInputState | null, appearance?: ThemeAppearance | null): boolean {
  return !!videoInput || (appearance?.bgType === "video" && !!appearance.bgVideoUrl);
}

export interface PlanInput {
  mode: CompositorMode;
  slide: SlidePayload;
  appearance?: ThemeAppearance | null;
  background?: BackgroundSpec | null;
  videoInput?: VideoInputState | null;
  /** ProPresenter 7 order (Video Input below Media). Undefined/false ⇒ the
   *  legacy "camera hides the background" rule, byte-identical. */
  mediaOverCamera?: boolean;
  transparent?: boolean;
  transitionsEnabled?: boolean;
  aspectRatio?: "16:9" | "4:3" | "custom";
  /**
   * Decoupling Phase 3: an explicit theme-logo enable override. Undefined ⇒
   * legacy behaviour (logo on for everything except transparent keying), so a
   * caller that never sets it gets byte-identical output. Set false by a
   * `logo` layer-patch (enabled:false) to blank the logo layer alone. */
  showThemeLogoOverride?: boolean;
  /** Theme → Projector: full-screen, no theme boxes/decor (stage always). */
  ignoreThemeLayout?: boolean;
}

export function planOutput(input: PlanInput): OutputPlan {
  const { mode, appearance } = input;
  // Stage never has a live camera (no video input on the confidence monitor).
  // This nulling lives ONLY here — the compositor reads the resolved camera off
  // the slide layer's props, never re-derives it.
  const videoInput = mode === "stage" ? null : (input.videoInput ?? null);
  const background = input.background ?? null;
  // Transparent keying only exists for livestream/ndi; never for live/stage.
  const transparent = (mode === "livestream" || mode === "ndi") && !!input.transparent;

  // A Background Template renders only when set, NOT in transparent keying mode,
  // and NOT when a live camera is active (camera-wins-over-background-template).
  const bgActive = !!background && background.type !== "none";
  const showBackground = bgActive && !transparent && !videoInput;

  // overVideo: the slide sits over an active (non-transparent) background
  // template with no camera — its own background must go transparent.
  const overVideo = bgActive && !transparent && !videoInput;

  // Video behind the slide? When a background template is showing (and no
  // camera), the template wins and we do NOT route through the video composite.
  // In transparent OBS/NDI keying mode the camera comes from OBS itself, so we
  // NEVER composite our own video behind the slide.
  // Stage (confidence monitor) never composites a video behind the slide: it has
  // no live camera, and the OLD /stage route ALWAYS used the transition-wrapped
  // SlideRenderer (never OutputSlide), so a theme video background must NOT flip
  // it to the over-video path — parity with the pre-extraction /stage render.
  const videoBehind = mode !== "stage" && !transparent && hasVideoBehind(videoInput, appearance) && !showBackground;

  let renderMode: SlideRenderMode;
  if (videoBehind) {
    renderMode = "over-video";
  } else if (mode === "ndi") {
    // NDI never wraps the slide in a transition (offscreen paint surface).
    renderMode = "plain";
  } else if (mode === "livestream") {
    // Livestream only transitions when explicitly enabled via ?transitions=1.
    renderMode = input.transitionsEnabled ? "transition" : "plain";
  } else {
    // live + stage always transition.
    renderMode = "transition";
  }

  // The camera is FUSED into the over-video render (OutputSlide owns the video
  // sibling + slide overlay). It only rides the slide layer in that branch.
  const slideVideoInput = renderMode === "over-video" ? videoInput : null;
  // PP7: with a camera live, media sits between the camera and the words.
  const mediaOverCamera = !!input.mediaOverCamera && bgActive && !transparent && !!slideVideoInput && background ? background : null;

  // Theme logo: on for everything except transparent keying modes. A Phase 3
  // `logo` layer-patch can additionally force it off (undefined ⇒ unchanged, so
  // legacy callers are byte-identical).
  const showThemeLogo = !transparent && (input.showThemeLogoOverride ?? true);

  // Canvas: livestream renders full-bleed (no PresentationCanvas); the others
  // wrap in a fixed canvas. live uses 1440 for 4:3, else 1920; ndi is 1920×1080;
  // stage uses the PresentationCanvas default (no explicit dims).
  const canvasEnabled = mode !== "livestream";
  let canvasW: number | undefined;
  let canvasH: number | undefined;
  if (mode === "live") {
    canvasW = input.aspectRatio === "4:3" ? 1440 : 1920;
    canvasH = 1080;
  } else if (mode === "ndi") {
    canvasW = 1920;
    canvasH = 1080;
  }

  const ignoreThemeLayout = mode === "stage" || !!input.ignoreThemeLayout;
  const layers: OutputLayerPlan[] = [
    { id: "background", kind: "background", z: 0, enabled: showBackground, props: { background } },
    ...(themeHasDecor(appearance)
      ? [{
          id: "theme-decor", kind: "theme-decor", z: 5,
          enabled: renderMode !== "over-video" && !transparent && !ignoreThemeLayout,
          props: { overVideo, transparentBg: transparent, ignoreThemeLayout },
        } satisfies ThemeDecorLayerPlan]
      : []),
    {
      id: "slide", kind: "slide", z: 10, enabled: true,
      props: { renderMode, overVideo, transparentBg: transparent, videoInput: slideVideoInput, ...(mediaOverCamera ? { mediaOverCamera } : {}) },
    },
    { id: "theme-logo", kind: "theme-logo", z: 20, enabled: showThemeLogo, props: {} },
  ];

  return { layers, canvas: { enabled: canvasEnabled, w: canvasW, h: canvasH } };
}
