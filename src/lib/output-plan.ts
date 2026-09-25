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
 *
 * PP7 DRAW ORDER (2026-09-18, `pp7DrawOrder` — see src/lib/pp7-draw-order.ts).
 * ProPresenter's stack is fixed, and two of ours were in the wrong place. With
 * the flag on the plan gains two layers so the ORDER itself is right instead of
 * being patched downstream:
 *   - `camera` (z -10) — Video Input is the back wall, BELOW Media, so media
 *     covers a live camera. The slide layer stops painting it (`cameraExternal`)
 *     and keeps it only to lay the words out (full scrim vs lower-third band).
 *   - `announcement` (z 15) — below the props (theme logo), which PP7 draws on
 *     top. Legacy leaves announcements to the route, i.e. above everything.
 * Flag off, planOutput is byte-identical to what it returned before the change
 * across all 22,400 fixtures (test/fixtures/output-plan-main.golden.json).
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

/** Stable per-layer identity. Phase 2's LayerWire[] will reuse these ids.
 *  Listed in paint order. `camera` and `announcement` exist ONLY under the PP7
 *  draw order (2026-09-18): legacy fuses the camera into the slide's over-video
 *  render and lets the route paint announcements on top, so neither is a layer
 *  there. `theme-decor` (theme gaps PR A) is theme chrome that belongs WITH the
 *  slide — it stays above the media and the camera and below the words. */
export type OutputLayerId = "camera" | "background" | "theme-bg" | "theme-decor" | "slide" | "announcement" | "theme-logo";
export type OutputLayerKind = "camera" | "background" | "theme-bg" | "theme-decor" | "slide" | "announcement" | "theme-logo";

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

export interface CameraLayerPlan extends OutputLayerBase {
  id: "camera";
  kind: "camera";
  props: { videoInput: VideoInputState };
}

export interface AnnouncementLayerPlan extends OutputLayerBase {
  id: "announcement";
  kind: "announcement";
  props: Record<string, never>;
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
    /** The camera behind the over-video render (stage-nulled here, once).
     *  null for the transition/plain branches.
     *  LEGACY: OutputSlide PAINTS it (the camera is fused into this layer).
     *  PP7 draw order: it is painted by the separate `camera` layer BELOW the
     *  media, and this field only tells OutputSlide how to lay the words out
     *  (full-screen scrim vs lower-third band) — see `cameraFused`. */
    videoInput: VideoInputState | null;
    /** PP7 draw order only: the camera above is NOT painted here — the separate
     *  `camera` plan layer owns those pixels, below the media. Absent (legacy)
     *  means OutputSlide paints the camera itself, as it always has. */
    cameraExternal?: true;
    /** Layer Order V3 only: the theme background is painted by the separate
     *  `theme-bg` layer, so the slide paints NO theme background of its own —
     *  only an explicit (bgExplicit) colour or a bgImageUrl. */
    themeBgExternal?: true;
  };
}

/**
 * Layer Order V3 only: the theme background (solid / gradient / image / video /
 * animated) as its own persistent layer between the media and the slide, with
 * real CSS transparency. A theme with no background paints nothing (transparent),
 * so the media shows through. `opacity` is the theme's layerOpacity see-through (0..1, default 1).
 */
export interface ThemeBgLayerPlan extends OutputLayerBase {
  id: "theme-bg";
  kind: "theme-bg";
  props: { opacity: number };
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

export type OutputLayerPlan =
  | CameraLayerPlan | BackgroundLayerPlan | ThemeBgLayerPlan | ThemeDecorLayerPlan | SlideLayerPlan
  | AnnouncementLayerPlan | ThemeLogoLayerPlan;

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
  /**
   * ProPresenter 7 draw order (src/lib/pp7-draw-order.ts):
   *   Video Input BELOW Media, and Props (theme logo) ABOVE Announcements.
   * Undefined/false ⇒ the legacy order — the camera hides the background
   * template and the route paints announcements over everything — byte-identical
   * (golden-locked, test/pp7-draw-order.test.ts).
   */
  pp7DrawOrder?: boolean;
  /** PP7 draw order only: an announcement is live on this surface, so the plan
   *  carries an `announcement` layer BELOW the props (theme logo). Legacy paints
   *  announcements in the route, above everything, and ignores this. */
  announcementLive?: boolean;
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
  /**
   * Layer Order V3 (src/lib/layer-order-v3.ts): fixed independent layers
   * media(z0) → theme bg(z10) → slide(z20) → overlays(z30+). Undefined/false ⇒
   * the existing plan, byte-identical (golden-locked). Takes precedence over
   * pp7DrawOrder when set.
   */
  layerOrderV3?: boolean;
  /** V3 only: operator pressed "Hide theme" for this send — the theme-bg layer
   *  is disabled (kept mounted, its video paused), the appearance untouched. */
  themeLayerHidden?: boolean;
}

/** Theme-layer see-through (0..1, `layerOpacity`); anything invalid ⇒ 1.
 *  NOT `dim` (a black overlay drawn inside the layer, legacy semantics). */
export function themeBgOpacity(appearance?: ThemeAppearance | null): number {
  const o = appearance?.layerOpacity;
  return typeof o === "number" && Number.isFinite(o) ? Math.max(0, Math.min(1, o)) : 1;
}

/**
 * Layer Order V3 plan. Independent of every legacy mutual exclusion:
 *   - the camera never suppresses media and media never forces the slide/theme
 *     transparent ("overVideo" is never set);
 *   - the theme bg is its own layer, so an opaque theme COVERS media and a
 *     transparent / partly-opaque one reveals it — the media layer stays in the
 *     plan either way (covered ≠ gone);
 *   - the theme bg belongs to the PRESENTATION: shown only while a slide is live
 *     (any non-empty kind) or a keep-theme-bg retention is explicitly active. A
 *     cleared slide / blank start hides it (still mounted) so the media shows;
 *     the theme itself is never mutated, the next slide shows it again;
 *   - overlays: announcement (z30) BELOW the theme logo / Props (z40) — PP7
 *     draw order, Victor 2026-09-18;
 *   - OBS/NDI alpha keying still suppresses media, camera, theme bg and logo;
 *   - stage never has a camera.
 */
function planOutputV3(input: PlanInput): OutputPlan {
  const { mode, appearance } = input;
  const transparent = (mode === "livestream" || mode === "ndi") && !!input.transparent;
  const videoInput = mode === "stage" || transparent ? null : (input.videoInput ?? null);
  const background = input.background ?? null;
  const bgActive = !!background && background.type !== "none";
  const ignoreThemeLayout = mode === "stage" || !!input.ignoreThemeLayout;
  // A live camera keeps the over-video composite ONLY for text layout (full
  // scrim vs lower-third band); the camera pixels are the separate `camera`
  // layer. Theme video no longer routes through it — it lives in `theme-bg`.
  let renderMode: SlideRenderMode;
  if (videoInput) renderMode = "over-video";
  else if (mode === "ndi") renderMode = "plain";
  else if (mode === "livestream") renderMode = input.transitionsEnabled ? "transition" : "plain";
  else renderMode = "transition";

  let canvasW: number | undefined;
  let canvasH: number | undefined;
  if (mode === "live") { canvasW = input.aspectRatio === "4:3" ? 1440 : 1920; canvasH = 1080; }
  else if (mode === "ndi") { canvasW = 1920; canvasH = 1080; }

  const layers: OutputLayerPlan[] = [];
  if (videoInput) layers.push({ id: "camera", kind: "camera", z: -10, enabled: true, props: { videoInput } });
  layers.push({ id: "background", kind: "background", z: 0, enabled: bgActive && !transparent, props: { background } });
  const slidePresent = input.slide.kind !== "empty" || (input.slide as { keepThemeBg?: boolean }).keepThemeBg === true;
  // A V3 blank is an OPAQUE black slide (see SlideRenderer themeBgExternal), so
  // the theme layer beneath it is disabled (paused, still mounted).
  const blankCovers = input.slide.kind === "blank" && !transparent;
  layers.push({ id: "theme-bg", kind: "theme-bg", z: 10, enabled: !transparent && slidePresent && !blankCovers && !input.themeLayerHidden, props: { opacity: themeBgOpacity(appearance) } });
  if (themeHasDecor(appearance)) {
    layers.push({
      id: "theme-decor", kind: "theme-decor", z: 15,
      enabled: !transparent && !ignoreThemeLayout,
      props: { overVideo: false, transparentBg: transparent, ignoreThemeLayout },
    });
  }
  layers.push({
    id: "slide", kind: "slide", z: 20, enabled: true,
    props: {
      renderMode, overVideo: false, transparentBg: transparent, videoInput,
      ...(videoInput ? { cameraExternal: true as const } : {}),
      themeBgExternal: true as const,
    },
  });
  if (input.announcementLive) layers.push({ id: "announcement", kind: "announcement", z: 30, enabled: true, props: {} });
  layers.push({ id: "theme-logo", kind: "theme-logo", z: 40, enabled: !transparent && (input.showThemeLogoOverride ?? true), props: {} });
  return { layers, canvas: { enabled: mode !== "livestream", w: canvasW, h: canvasH } };
}

export function planOutput(input: PlanInput): OutputPlan {
  if (input.layerOrderV3) return planOutputV3(input);
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
  const pp7 = !!input.pp7DrawOrder;

  const bgActive = !!background && background.type !== "none";
  // PP7: Media sits ABOVE Video Input, so a live camera no longer suppresses the
  // template — the media simply covers the camera (spec §2, "Media covers a live
  // camera"). Legacy: camera-wins-over-background-template.
  const showBackground = bgActive && !transparent && (pp7 || !videoInput);

  // overVideo: the slide sits over an active (non-transparent) background
  // template (legacy: with no camera) — its own background must go transparent.
  const overVideo = bgActive && !transparent && (pp7 || !videoInput);

  // Video behind the slide? When a background template is showing (and no
  // camera), the template wins and we do NOT route through the video composite.
  // In transparent OBS/NDI keying mode the camera comes from OBS itself, so we
  // NEVER composite our own video behind the slide.
  // Stage (confidence monitor) never composites a video behind the slide: it has
  // no live camera, and the OLD /stage route ALWAYS used the transition-wrapped
  // SlideRenderer (never OutputSlide), so a theme video background must NOT flip
  // it to the over-video path — parity with the pre-extraction /stage render.
  // PP7: a live camera ALWAYS routes through the over-video composite, even with
  // media showing — the media now paints as its own layer between them, so the
  // words must still render transparent-backed over the pair. A theme VIDEO
  // background still loses to a template exactly as before.
  const videoBehind = pp7
    ? mode !== "stage" && !transparent && (!!videoInput || (hasVideoBehind(null, appearance) && !showBackground))
    : mode !== "stage" && !transparent && hasVideoBehind(videoInput, appearance) && !showBackground;

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
  // PP7: the camera is its OWN layer at the bottom of the stack; the slide layer
  // keeps the camera only to lay the words out (full scrim vs lower-third band).
  const cameraExternal = pp7 && !!slideVideoInput;

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

  const layers: OutputLayerPlan[] = [];
  if (pp7 && slideVideoInput) {
    // Video Input — the back wall, BELOW Media (PP7 §1). Legacy has no such
    // layer (OutputSlide paints the camera inside the slide layer).
    layers.push({ id: "camera", kind: "camera", z: -10, enabled: true, props: { videoInput: slideVideoInput } });
  }
  layers.push({ id: "background", kind: "background", z: 0, enabled: showBackground, props: { background } });
  if (themeHasDecor(appearance)) {
    // Theme decor (theme gaps PR A) is theme CHROME, not a PP7 layer: it belongs
    // with the slide, so it sits above the media (z 0) and above the new camera
    // layer (z -10) and below the words (z 10) — the new camera layer can never
    // cover it. Its enable rule is untouched: over video (camera OR theme video)
    // the decor is hosted INSIDE the slide render instead, which is still above
    // the camera, so a live camera never hides decor either way.
    layers.push({
      id: "theme-decor", kind: "theme-decor", z: 5,
      enabled: renderMode !== "over-video" && !transparent && !ignoreThemeLayout,
      props: { overVideo, transparentBg: transparent, ignoreThemeLayout },
    });
  }
  layers.push({
    id: "slide", kind: "slide", z: 10, enabled: true,
    props: { renderMode, overVideo, transparentBg: transparent, videoInput: slideVideoInput, ...(cameraExternal ? { cameraExternal: true as const } : {}) },
  });
  if (pp7 && input.announcementLive) {
    // Announcements draw BELOW Props (PP7 §1). Legacy paints them in the route,
    // i.e. above everything, so there is no announcement layer there.
    layers.push({ id: "announcement", kind: "announcement", z: 15, enabled: true, props: {} });
  }
  layers.push({ id: "theme-logo", kind: "theme-logo", z: 20, enabled: showThemeLogo, props: {} });

  return { layers, canvas: { enabled: canvasEnabled, w: canvasW, h: canvasH } };
}
