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
 */
import type { SlidePayload, ThemeAppearance, VideoInputState, BackgroundSpec } from "@/lib/broadcast";

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

export interface OutputPlan {
  /** Render the Background Template layer (behind the slide). */
  showBackground: boolean;
  /** How to render the slide layer. */
  slideRender: SlideRenderMode;
  /** overVideo flag passed to SlideRenderer (slide bg goes transparent). */
  overVideo: boolean;
  /** transparentBg flag passed to SlideRenderer (OBS / NDI alpha key). */
  transparentBg: boolean;
  /** Render the theme logo layer on top. */
  showThemeLogo: boolean;
  /** Wrap the stack in a PresentationCanvas (livestream renders full-bleed). */
  useCanvas: boolean;
  /** Canvas width when useCanvas (undefined → PresentationCanvas default). */
  canvasW?: number;
  /** Canvas height when useCanvas (undefined → PresentationCanvas default). */
  canvasH?: number;
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
  transparent?: boolean;
  transitionsEnabled?: boolean;
  aspectRatio?: "16:9" | "4:3" | "custom";
}

export function planOutput(input: PlanInput): OutputPlan {
  const { mode, appearance } = input;
  // Stage never has a live camera (no video input on the confidence monitor).
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

  let slideRender: SlideRenderMode;
  if (videoBehind) {
    slideRender = "over-video";
  } else if (mode === "ndi") {
    // NDI never wraps the slide in a transition (offscreen paint surface).
    slideRender = "plain";
  } else if (mode === "livestream") {
    // Livestream only transitions when explicitly enabled via ?transitions=1.
    slideRender = input.transitionsEnabled ? "transition" : "plain";
  } else {
    // live + stage always transition.
    slideRender = "transition";
  }

  // Theme logo: on for everything except transparent keying modes.
  const showThemeLogo = !transparent;

  // Canvas: livestream renders full-bleed (no PresentationCanvas); the others
  // wrap in a fixed canvas. live uses 1440 for 4:3, else 1920; ndi is 1920×1080;
  // stage uses the PresentationCanvas default (no explicit dims).
  const useCanvas = mode !== "livestream";
  let canvasW: number | undefined;
  let canvasH: number | undefined;
  if (mode === "live") {
    canvasW = input.aspectRatio === "4:3" ? 1440 : 1920;
    canvasH = 1080;
  } else if (mode === "ndi") {
    canvasW = 1920;
    canvasH = 1080;
  }

  return { showBackground, slideRender, overVideo, transparentBg: transparent, showThemeLogo, useCanvas, canvasW, canvasH };
}
