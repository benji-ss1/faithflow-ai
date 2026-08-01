"use client";
import { useEffect, useRef, useCallback } from "react";
import type { SlidePayload } from "@/lib/broadcast";
import { AutoFitText } from "./AutoFitText";

export function SlideRenderer({ slide, className, textMinPx, disablePagination, projectorFit, videoMuted = true, onVideoRef }: {
  slide: SlidePayload;
  className?: string;
  // 2026-07-25: pass-through to AutoFitText for text slides. Grid cards
  // use small values to fit whole verses at a glance; live projector uses
  // the sanctuary-readability default.
  textMinPx?: number;
  disablePagination?: boolean;
  // 2026-07-27 JPD Fix 2: projector-surface sizing — word-count-banded
  // % of container height with a hard 3%-of-height floor. Only the /live
  // and /stage output routes pass this; thumbnails/previews are untouched.
  projectorFit?: boolean;
  // 2026-08-01: video audio control. Defaults to muted for operator previews
  // and thumbnails. The /live and /livestream routes pass false to enable audio.
  // Electron's autoplay policy allows unmuted autoplay without user gesture.
  videoMuted?: boolean;
  // 2026-08-01: expose the <video> element to the parent (e.g. /live page)
  // so it can apply media-control commands and report media-status.
  onVideoRef?: (el: HTMLVideoElement | null) => void;
}) {
  const base = "w-full h-full flex items-center justify-center overflow-hidden";

  if (slide.kind === "empty") return <div className={`${base} bg-black ${className || ""}`} />;

  if (slide.kind === "blank") {
    return <div className={`${base} ${className || ""}`} style={{ background: slide.bgColor || "#000000" }} />;
  }

  if (slide.kind === "logo") {
    return (
      <div className={`${base} bg-black ${className || ""}`}>
        {slide.url ? (
          <img src={slide.url} alt="Logo" className="max-w-[60%] max-h-[60%] object-contain" />
        ) : (
          <div className="text-white text-6xl font-display font-semibold tracking-tight">PresentFlow</div>
        )}
      </div>
    );
  }

  if (slide.kind === "text") {
    return (
      <div className={`${base} ${className || ""}`} style={{ background: slide.bgColor || "#0b0b0b" }}>
        <AutoFitText
          text={slide.text}
          maxPx={120}
          minPx={textMinPx}
          disablePagination={disablePagination}
          projectorFit={projectorFit}
          className="text-white font-display font-semibold"
        />
      </div>
    );
  }

  if (slide.kind === "image") {
    // Two fit modes:
    //   contain (PPTX slides, most media): letterbox — flex-centered <img>
    //     capped by max-width/max-height + object-contain. Preserves aspect,
    //     never overflows the pane.
    //   cover (opt-in per media asset): fills the pane, cropping as needed.
    const isCover = slide.fit === "cover";
    return (
      <div className={`${base} bg-black ${className || ""}`}>
        {slide.url ? (
          <img
            src={slide.url}
            alt=""
            style={isCover ? {
              width: "100%", height: "100%",
              objectFit: "cover", objectPosition: "center",
              display: "block",
            } : {
              maxWidth: "100%", maxHeight: "100%",
              width: "auto", height: "auto",
              objectFit: "contain", objectPosition: "center",
              display: "block", margin: "auto",
            }}
            onError={(e) => {
              console.error("[slide] image failed to load:", (e.currentTarget as HTMLImageElement).src);
            }}
          />
        ) : (
          <div className="text-white text-xs opacity-50">Image not available</div>
        )}
      </div>
    );
  }

  if (slide.kind === "video") {
    return (
      <div className={`${base} bg-black ${className || ""}`}>
        <video src={slide.url} autoPlay loop={slide.loop !== false} muted={videoMuted} playsInline
               onError={(e) => console.warn("[slide] video error:", (e.currentTarget as HTMLVideoElement).error?.message || "unknown")}
               ref={(el) => {
                 if (el) el.play().catch((err) => console.warn("[slide] video play blocked:", err instanceof Error ? err.message : String(err)));
                 onVideoRef?.(el);
               }}
               style={{
                 maxWidth: "100%",
                 maxHeight: "100%",
                 width: "auto",
                 height: "auto",
                 objectFit: slide.fit === "cover" ? "cover" : "contain",
                 objectPosition: "center",
                 display: "block",
                 margin: "auto",
               }} />
      </div>
    );
  }

  return null;
}
