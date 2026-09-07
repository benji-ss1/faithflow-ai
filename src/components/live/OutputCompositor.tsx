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
import type { ReactNode } from "react";
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
import { overlayBandSlide, type ObsBandConfig, type ObsThemeColors } from "@/lib/obs-lowerthird";
import { planOutput, type CompositorMode } from "@/lib/output-plan";

export { planOutput, type CompositorMode } from "@/lib/output-plan";
export type { OutputPlan, SlideRenderMode } from "@/lib/output-plan";

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
  videoMuted?: boolean;
  onVideoRef?: (el: HTMLVideoElement | null) => void;
}

/**
 * Renders the composed layer stack for one output surface. The caller supplies
 * the OutputState pieces it holds in local state; the compositor owns the
 * z-ordering + precedence.
 */
export function OutputCompositor(props: OutputCompositorProps) {
  const {
    mode, slide, appearance, background, transition, fontScale, referenceScale,
    referenceColor, zone, obsBand, obsThemeColors, videoMuted = false, onVideoRef,
  } = props;

  const plan = planOutput(props);
  // Stage never composites a camera.
  const videoInput = mode === "stage" ? null : (props.videoInput ?? null);

  // OBS lower-third band transform (livestream lower_third capture mode).
  const effectiveSlide: SlidePayload = obsBand ? overlayBandSlide(slide, obsBand, obsThemeColors) : slide;

  const stack: ReactNode = (
    <>
      {plan.showBackground && background && (
        <BackgroundLayer key={background.shaderPreset ?? background.type} background={background} />
      )}
      {plan.slideRender === "over-video" ? (
        <OutputSlide
          slide={effectiveSlide}
          videoInput={videoInput}
          appearance={appearance}
          fontScale={fontScale}
          referenceScale={referenceScale}
          referenceColor={referenceColor}
          projectorFit
        />
      ) : plan.slideRender === "transition" ? (
        <TransitionWrapper identityKey={slideOutputIdentity(effectiveSlide)} transition={transition ?? null}>
          <SlideRenderer
            slide={effectiveSlide}
            projectorFit
            fontScale={fontScale}
            referenceScale={referenceScale}
            referenceColor={referenceColor}
            appearance={appearance}
            overVideo={plan.overVideo}
            transparentBg={plan.transparentBg}
            videoMuted={videoMuted}
            onVideoRef={onVideoRef}
          />
        </TransitionWrapper>
      ) : (
        <SlideRenderer
          slide={effectiveSlide}
          projectorFit
          fontScale={fontScale}
          referenceScale={referenceScale}
          referenceColor={referenceColor}
          appearance={appearance}
          overVideo={plan.overVideo}
          transparentBg={plan.transparentBg}
          videoMuted={videoMuted}
          onVideoRef={onVideoRef}
        />
      )}
      {plan.showThemeLogo && <ThemeLogoLayer appearance={appearance} />}
    </>
  );

  if (!plan.useCanvas) return stack;
  return (
    <PresentationCanvas canvasW={plan.canvasW} canvasH={plan.canvasH} zone={zone}>
      {stack}
    </PresentationCanvas>
  );
}
