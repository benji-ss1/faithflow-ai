"use client";
import type { BackgroundSpec } from "@/lib/broadcast";
import { ShaderBackground } from "./ShaderBackground";

/**
 * BackgroundLayer — renders the active background on the projector, BETWEEN the
 * theme background (behind) and the projected text (in front). Absolutely fills
 * its parent. type "none" ⇒ renders nothing (existing theme bg shows through).
 *
 * Phase 2: shader presets render as their static primary→secondary gradient —
 * real colour on the projector, text readable on top. Phase 4 upgrades shaders
 * to live WebGL animation. Image/video render here too (uploads land in 3/5).
 * Every path fails safe: a bad image/video URL just shows the gradient/nothing,
 * never a crash or a blank projector.
 */
export function BackgroundLayer({ background, frozen = false }: { background: BackgroundSpec | null | undefined; frozen?: boolean }) {
  if (!background || background.type === "none") return null;

  const fill: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden" };

  let content: React.ReactNode = null;

  if (background.type === "shader") {
    // Live WebGL shader (Phase 4). Falls back to a CSS gradient inside
    // ShaderBackground if WebGL is unavailable. Static presets (Clean Slate)
    // render one frame; the rest animate.
    content = (
      <ShaderBackground
        preset={background.shaderPreset || "cleanSlate"}
        speed={background.speed ?? 1}
        intensity={background.intensity ?? 1}
        primaryColor={background.primaryColor || "#0A0A0E"}
        secondaryColor={background.secondaryColor || "#0F0F14"}
        frozen={frozen}
      />
    );
  } else if (background.type === "image" && background.imageUrl) {
    const fit = background.imageFit === "stretch" ? "fill" : background.imageFit === "fit" ? "contain" : "cover";
    content = (
      <img
        src={background.imageUrl}
        alt=""
        style={{
          ...fill,
          objectFit: fit as React.CSSProperties["objectFit"],
          filter: background.imageBlur ? `blur(${Math.min(20, background.imageBlur)}px)` : undefined,
        }}
        // A dead image URL: hide the element, existing bg shows through. Never crash.
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  } else if (background.type === "video" && background.videoUrl) {
    content = (
      <video
        src={background.videoUrl}
        // frozen (thumbnail mirror): show the first frame only, no second live
        // decode of the same clip alongside the projector preview.
        autoPlay={!frozen}
        loop={!frozen}
        muted
        playsInline
        preload={frozen ? "metadata" : "auto"}
        style={{ ...fill, objectFit: "cover" }}
        ref={(el) => { if (el && !frozen) el.playbackRate = Math.min(1, Math.max(0.25, background.videoSpeed ?? 0.5)); }}
        onError={(e) => { (e.currentTarget as HTMLVideoElement).style.display = "none"; }}
      />
    );
  }

  const overlayOpacity = typeof background.overlayOpacity === "number" ? Math.min(0.8, Math.max(0, background.overlayOpacity)) : 0;

  return (
    <div style={fill} aria-hidden>
      {content}
      {overlayOpacity > 0 && background.overlayColor && (
        <div style={{ ...fill, background: background.overlayColor, opacity: overlayOpacity }} />
      )}
    </div>
  );
}
