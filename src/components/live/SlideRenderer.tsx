"use client";
import type { SlidePayload } from "@/lib/broadcast";
import { AutoFitText } from "./AutoFitText";

export function SlideRenderer({ slide, className }: { slide: SlidePayload; className?: string }) {
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
        <video src={slide.url} autoPlay loop muted playsInline
               onError={(e) => console.warn("[slide] video error:", (e.currentTarget as HTMLVideoElement).error?.message || "unknown")}
               ref={(el) => { if (el) el.play().catch((err) => console.warn("[slide] video play blocked:", err instanceof Error ? err.message : String(err))); }}
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
