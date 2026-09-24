"use client";
import type { SlidePayload, ThemeAppearance, VideoInputState } from "@/lib/broadcast";
import { SlideRenderer } from "./SlideRenderer";
import { LiveVideoLayer } from "./LiveVideoLayer";
import { ThemeVideoBackground } from "./ThemeLayers";
import { ThemeDecorLayer } from "./ThemeDecorLayer";
import { themeDecorPlan, themeHasDecor } from "@/lib/theme-decor-plan";

// Positioning + readability scrim for the slide content that sits over the
// live video. Lower-third = bottom band with a bottom-up gradient; full =
// whole frame with a light dark scrim so text stays legible on bright video.
function overlayClass(overlay?: VideoInputState["overlay"]): string {
  if (overlay === "full") return "absolute inset-0 flex items-center justify-center bg-black/45";
  return "absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-black/80 via-black/45 to-transparent";
}

/** True when this output has a video BEHIND the slide — a live camera input, or
 * a theme's looping video background. Used by the pages to route through the
 * composite (and skip the slide-keyed transition wrapper). */
export function hasVideoBackground(videoInput?: VideoInputState | null, appearance?: ThemeAppearance | null): boolean {
  return !!videoInput || (appearance?.bgType === "video" && !!appearance.bgVideoUrl);
}

/**
 * One output surface's composition. When there's a video behind the slide
 * (live camera input OR a theme video background) it renders the persistent
 * video layer with the slide composited over it; otherwise it renders the slide
 * normally. The video layer is a sibling of the overlay (not wrapped by any
 * slide-keyed element), so slide changes never restart the video.
 */
export function OutputSlide({ slide, videoInput, appearance, fontScale, referenceScale, referenceColor, projectorFit = true, videoMuted = false, onVideoRef, cameraExternal = false, ignoreThemeLayout, previewFrozen, themeBgExternal = false }: {
  slide: SlidePayload;
  videoInput?: VideoInputState | null;
  appearance?: ThemeAppearance | null;
  fontScale?: number;
  referenceScale?: number;
  referenceColor?: string;
  projectorFit?: boolean;
  videoMuted?: boolean;
  onVideoRef?: (el: HTMLVideoElement | null) => void;
  /** PP7 draw order (src/lib/pp7-draw-order.ts): the camera is painted by its
   *  OWN layer BELOW the media, so this composite must NOT paint it again — it
   *  keeps `videoInput` only to lay the words out (full-screen scrim vs the
   *  lower-third band). Absent/false = legacy, this component paints the camera. */
  cameraExternal?: boolean;
  /** Theme → Projector (PR 2): full-screen (stage). */
  ignoreThemeLayout?: boolean;
  /** Operator mini-preview: pause persistent decor video. */
  previewFrozen?: boolean;
  /** Layer Order V3: theme bg / video / decor are separate compositor layers
   *  below this one; the slide paints none of them. */
  themeBgExternal?: boolean;
}) {
  const ign = ignoreThemeLayout ? { ignoreThemeLayout: true } : {};
  const ext = themeBgExternal ? { themeBgExternal: true } : {};
  // Live camera takes precedence over a theme video background.
  const themeVideoUrl = !themeBgExternal && !videoInput && appearance?.bgType === "video" && appearance.bgVideoUrl ? appearance.bgVideoUrl : null;

  if (videoInput || themeVideoUrl) {
    // Only text/blank slides composite AS a transparent overlay over the video.
    // Media/image/logo slides render full-bleed and cover the video (which stays
    // mounted behind, so returning to a lyric/verse keeps it playing).
    // (An empty slide that KEEPS the theme's media — PP7 Clear Slide — also lets
    // the persistent theme decor paint; a plain empty slide never does.)
    const isOverlayKind = slide.kind === "text" || slide.kind === "blank" || (slide.kind === "empty" && slide.keepThemeBg === true);
    // Camera → full-screen lyrics by default (sanctuary look; operator can switch
    // to lower-third). Theme video background →
    // centered content (it's a backdrop); readability comes from the theme dim
    // (applied in ThemeVideoBackground) + text shadow, so no extra scrim.
    // Theme gaps (PR A): persistent theme decor BETWEEN the video and the words
    // (theme video bg, or a camera in full-overlay/centre mode only — the same
    // surfaces where SlideRenderer allowed decor). Constant position in the tree,
    // so a decor video never restarts per slide.
    const verticalAlign = videoInput?.overlay === "full" ? (videoInput?.lyricsPos ?? "center") : "center";
    const fitBandFraction = videoInput && videoInput.overlay !== "full" ? 0.38 : undefined;
    const decorFlags = { overVideo: true, verticalAlign, fitBandFraction, ignoreThemeLayout } as const;
    const decorEligible = !themeBgExternal && !ignoreThemeLayout && themeHasDecor(appearance) && (!videoInput || (videoInput.overlay === "full" && verticalAlign === "center"));
    const decorPlan = decorEligible && isOverlayKind ? themeDecorPlan(slide, appearance, decorFlags) : null;
    // Full-screen camera + theme decor: the readability scrim moves to a sibling
    // BEFORE the decor so it darkens the camera only, not the theme decor. With
    // no decor the container keeps its scrim class (DOM unchanged).
    const scrimAsSibling = decorEligible && videoInput?.overlay === "full";
    const containerClass = videoInput
      ? (scrimAsSibling ? "absolute inset-0 flex items-center justify-center" : overlayClass(videoInput.overlay))
      : "absolute inset-0 flex items-center justify-center";
    return (
      <div className="absolute inset-0">
        {videoInput
          ? (cameraExternal ? null : <LiveVideoLayer input={videoInput} />)
          : <ThemeVideoBackground url={themeVideoUrl!} dim={appearance?.dim} />}
        {scrimAsSibling ? <div data-camera-scrim="" className="absolute inset-0 bg-black/45 pointer-events-none" /> : null}
        {/* Theme decor stays INSIDE this composite, above the video/scrim and
            below the words. Under the PP7 draw order the camera is painted by the
            compositor's own layer BELOW the media, and this whole composite is the
            SLIDE layer — which paints above both — so decor is above the media and
            the camera there too, and the new camera layer can never cover it. */}
        {decorEligible ? <ThemeDecorLayer appearance={appearance} plan={decorPlan} overVideo frozen={previewFrozen} /> : null}
        {slide.kind !== "empty" && (
          isOverlayKind ? (
            <div className={containerClass}>
              <SlideRenderer
                slide={slide}
                overVideo
                projectorFit={projectorFit}
                fontScale={fontScale}
                referenceScale={referenceScale}
                referenceColor={referenceColor}
                appearance={appearance}
                verticalAlign={verticalAlign}
                // Lower-third camera mode draws the lyrics in the 38% band above
                // (overlayClass). Fit them to THAT band, not the whole frame, or
                // multi-line lyrics clip out of it (2026-09-16).
                fitBandFraction={fitBandFraction}
                {...(decorEligible ? { themeChromeHosted: true } : {})}
                {...ign}
                {...ext}
              />
            </div>
          ) : (
            <div className="absolute inset-0">
              <SlideRenderer slide={slide} projectorFit={projectorFit} fontScale={fontScale} referenceScale={referenceScale} referenceColor={referenceColor} appearance={appearance} {...ign} {...ext} />
            </div>
          )
        )}
      </div>
    );
  }
  return (
    <SlideRenderer
      slide={slide}
      projectorFit={projectorFit}
      fontScale={fontScale}
      referenceScale={referenceScale}
      referenceColor={referenceColor}
      appearance={appearance}
      videoMuted={videoMuted}
      onVideoRef={onVideoRef}
      {...ign}
      {...ext}
    />
  );
}
