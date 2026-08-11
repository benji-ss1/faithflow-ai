"use client";
import type { SlidePayload, ThemeAppearance, VideoInputState } from "@/lib/broadcast";
import { SlideRenderer } from "./SlideRenderer";
import { LiveVideoLayer } from "./LiveVideoLayer";

// Positioning + readability scrim for the slide content that sits over the
// live video. Lower-third = bottom band with a bottom-up gradient; full =
// whole frame with a light dark scrim so text stays legible on bright video.
function overlayClass(overlay?: VideoInputState["overlay"]): string {
  if (overlay === "full") return "absolute inset-0 flex items-center justify-center bg-black/45";
  return "absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-black/80 via-black/45 to-transparent";
}

/**
 * One output surface's composition: when a live video input is active it
 * renders the persistent video layer with the slide content composited over it
 * (lower-third by default); otherwise it renders the slide normally. The video
 * layer is a sibling of the overlay (not wrapped by any slide-keyed element),
 * so slide changes never restart the camera.
 */
export function OutputSlide({ slide, videoInput, appearance, fontScale, projectorFit = true, videoMuted = false, onVideoRef }: {
  slide: SlidePayload;
  videoInput?: VideoInputState | null;
  appearance?: ThemeAppearance | null;
  fontScale?: number;
  projectorFit?: boolean;
  videoMuted?: boolean;
  onVideoRef?: (el: HTMLVideoElement | null) => void;
}) {
  if (videoInput) {
    // Only text/blank slides composite AS a transparent overlay over the video.
    // Media/image/logo slides can't sit in a lower-third band — they render
    // full-bleed and cover the video (the camera stream stays mounted behind, so
    // returning to a lyric/verse keeps it live). Empty slide = camera only.
    const isOverlayKind = slide.kind === "text" || slide.kind === "blank";
    return (
      <div className="absolute inset-0">
        <LiveVideoLayer input={videoInput} />
        {slide.kind !== "empty" && (
          isOverlayKind ? (
            <div className={overlayClass(videoInput.overlay)}>
              <SlideRenderer slide={slide} overVideo projectorFit={projectorFit} fontScale={fontScale} appearance={appearance} />
            </div>
          ) : (
            <div className="absolute inset-0">
              <SlideRenderer slide={slide} projectorFit={projectorFit} fontScale={fontScale} appearance={appearance} />
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
      appearance={appearance}
      videoMuted={videoMuted}
      onVideoRef={onVideoRef}
    />
  );
}
