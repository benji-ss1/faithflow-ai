"use client";
import type { SlidePayload, ThemeAppearance, VideoInputState } from "@/lib/broadcast";
import { SlideRenderer } from "./SlideRenderer";
import { LiveVideoLayer } from "./LiveVideoLayer";
import { ThemeVideoBackground } from "./ThemeLayers";

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
export function OutputSlide({ slide, videoInput, appearance, fontScale, referenceScale, projectorFit = true, videoMuted = false, onVideoRef }: {
  slide: SlidePayload;
  videoInput?: VideoInputState | null;
  appearance?: ThemeAppearance | null;
  fontScale?: number;
  referenceScale?: number;
  projectorFit?: boolean;
  videoMuted?: boolean;
  onVideoRef?: (el: HTMLVideoElement | null) => void;
}) {
  // Live camera takes precedence over a theme video background.
  const themeVideoUrl = !videoInput && appearance?.bgType === "video" && appearance.bgVideoUrl ? appearance.bgVideoUrl : null;

  if (videoInput || themeVideoUrl) {
    // Only text/blank slides composite AS a transparent overlay over the video.
    // Media/image/logo slides render full-bleed and cover the video (which stays
    // mounted behind, so returning to a lyric/verse keeps it playing).
    const isOverlayKind = slide.kind === "text" || slide.kind === "blank";
    // Camera → lower-third by default (broadcast look). Theme video background →
    // centered content (it's a backdrop); readability comes from the theme dim
    // (applied in ThemeVideoBackground) + text shadow, so no extra scrim.
    const containerClass = videoInput
      ? overlayClass(videoInput.overlay)
      : "absolute inset-0 flex items-center justify-center";
    return (
      <div className="absolute inset-0">
        {videoInput
          ? <LiveVideoLayer input={videoInput} />
          : <ThemeVideoBackground url={themeVideoUrl!} dim={appearance?.dim} />}
        {slide.kind !== "empty" && (
          isOverlayKind ? (
            <div className={containerClass}>
              <SlideRenderer slide={slide} overVideo projectorFit={projectorFit} fontScale={fontScale} referenceScale={referenceScale} appearance={appearance} />
            </div>
          ) : (
            <div className="absolute inset-0">
              <SlideRenderer slide={slide} projectorFit={projectorFit} fontScale={fontScale} referenceScale={referenceScale} appearance={appearance} />
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
      appearance={appearance}
      videoMuted={videoMuted}
      onVideoRef={onVideoRef}
    />
  );
}
