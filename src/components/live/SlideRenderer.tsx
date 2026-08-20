"use client";
import { useEffect, useRef, useCallback } from "react";
import type { SlidePayload, ThemeAppearance } from "@/lib/broadcast";
import { AutoFitText } from "./AutoFitText";
import { AnimatedThemeBg } from "./ThemeLayers";
import { SlideObjectsLayer } from "./SlideObjectsLayer";

/** True when the active theme has a running animated (solid/gradient) background
 *  and this slide isn't over video / per-slide-coloured — i.e. AnimatedThemeBg
 *  will render and the text must be lifted to z-[1] to stay on top.
 *
 *  Perf note: this only fires when `appearance` is passed, which today is ONLY
 *  the real output surfaces (live/stage/livestream/OutputSlide). Operator
 *  thumbnail grids render <SlideRenderer> WITHOUT appearance, so they spin up no
 *  animated GPU layers. If you ever thread `appearance` into a many-tile grid,
 *  gate the animation off there — N concurrent full-screen transform layers. */
function usesAnimatedBg(appearance: ThemeAppearance | null | undefined, overVideo?: boolean, slideBgColor?: string): boolean {
  if (overVideo || slideBgColor) return false;
  const a = appearance?.bgAnimation;
  return !!a && a !== "none" && appearance?.bgType !== "image" && appearance?.bgType !== "video";
}

// ── Themes Phase 1: compute CSS from the active theme appearance ───────────
// Background supports solid / gradient / image, with an optional dark "dim"
// overlay for text readability (a single `background` shorthand — image/gradient
// layered under a dim gradient). Returns the built-in fallback when no theme is
// active. The values are validated on the wire (isValidThemeAppearance), and a
// hostile string can't break out of the single `background`/`color` CSS property
// (CSSOM parses each property in isolation).
function themeBackgroundStyle(appearance: ThemeAppearance | null | undefined, fallback: string): React.CSSProperties {
  if (!appearance) return { background: fallback };
  const dim = typeof appearance.dim === "number" && appearance.dim > 0 ? Math.min(1, appearance.dim) : 0;
  const dimLayer = dim > 0 ? `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim}))` : null;
  let base: string | undefined;
  if (appearance.bgType === "image" && appearance.bgImageUrl) {
    base = `url("${appearance.bgImageUrl}")`;
  } else if (appearance.bgType === "gradient" && appearance.bgColor) {
    base = `linear-gradient(${appearance.bgAngle ?? 180}deg, ${appearance.bgColor}, ${appearance.bgColor2 ?? appearance.bgColor})`;
  } else if (appearance.bgColor) {
    base = appearance.bgColor;
  }
  if (!base) return { background: fallback };
  return {
    background: dimLayer ? `${dimLayer}, ${base}` : base,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

// Pick a readable text color for a background color when the theme didn't
// specify one — prevents the "white text on a light theme = invisible verses"
// failure. Only handles hex (the common case); rgb()/unknown default to white
// (safe on the dark fallback). Perceptual luminance threshold.
function readableTextColor(bg: string | undefined): string {
  if (!bg) return "#ffffff";
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(bg.trim());
  if (!m) return "#ffffff";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

function themeTextStyle(appearance: ThemeAppearance | null | undefined): React.CSSProperties | undefined {
  if (!appearance) return undefined;
  const s: React.CSSProperties = {};
  if (appearance.textColor) s.color = appearance.textColor;
  // No explicit text color but a solid/gradient background color is set →
  // auto-pick black/white for contrast so scripture stays legible.
  else if (appearance.bgColor && (appearance.bgType === "solid" || appearance.bgType === "gradient" || appearance.bgType === undefined)) {
    s.color = readableTextColor(appearance.bgColor);
  }
  if (appearance.fontFamily) s.fontFamily = appearance.fontFamily;
  if (typeof appearance.fontWeight === "number") s.fontWeight = appearance.fontWeight;
  if (appearance.align) s.textAlign = appearance.align;
  if (appearance.textShadow === false) s.textShadow = "none";
  return Object.keys(s).length ? s : undefined;
}

export function SlideRenderer({ slide, className, textMinPx, disablePagination, projectorFit, videoMuted = true, onVideoRef, fontScale, appearance, overVideo }: {
  slide: SlidePayload;
  className?: string;
  // Phase 2a: rendering as an overlay ON TOP of a live video layer. Makes
  // text/blank backgrounds transparent (video shows through); the parent
  // supplies a readability scrim. Theme text styling still applies.
  overVideo?: boolean;
  // Themes Phase 1: active theme appearance (background + text styling) from
  // OutputState. Undefined ⇒ built-in defaults (dark bg, white text). A per-slide
  // `bgColor` still overrides the theme background. Applies to text/blank kinds;
  // image/video/logo slides keep their own full-bleed rendering.
  appearance?: ThemeAppearance | null;
  // B3 (2026-08-11): operator manual text-size multiplier (AUTO = 1.0),
  // threaded to AutoFitText for text slides. Undefined ⇒ AUTO.
  fontScale?: number;
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
    // Over video, a blank slide is fully transparent (shows the live feed).
    const bg = overVideo ? { background: "transparent" } : slide.bgColor ? { background: slide.bgColor } : themeBackgroundStyle(appearance, "#000000");
    const animated = usesAnimatedBg(appearance, overVideo, slide.bgColor);
    return (
      <div className={`${base} ${animated ? "relative" : ""} ${className || ""}`} style={bg}>
        {animated && <AnimatedThemeBg appearance={appearance} />}
      </div>
    );
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
    // Over video, the text sits transparently on the feed (parent adds a scrim);
    // otherwise use the per-slide bg color or the active theme background.
    // Rich object slide (ProPresenter-style): when the operator has designed a
    // positioned layout, render it verbatim instead of the auto-fit text block.
    // The per-slide design background (bgColor / bgImageUrl) wins over the theme.
    const objects = slide.objects;
    if (objects && objects.length > 0 && !overVideo) {
      const designBg: React.CSSProperties = slide.bgImageUrl
        ? { background: `#000 url("${slide.bgImageUrl}") center/cover no-repeat` }
        : slide.bgColor
          ? { background: slide.bgColor }
          : themeBackgroundStyle(appearance, "#0b0b0b");
      // Lyric/verse slides are stored as a SINGLE centered text object (from
      // import or the slide editor). Rendering that at its stored ~96px font
      // makes it tiny on a sanctuary screen — the "songs project small" bug.
      // On the output/preview surfaces, fill the screen with it via the same
      // largest-fit engine as plain-text lyrics, so ALL lyrics are big and
      // crowd-readable and preview stays WYSIWYG with the projector. Genuinely
      // DESIGNED slides (2+ objects, or an image/shape/video) keep their exact
      // positioned layout via SlideObjectsLayer.
      const visible = objects.filter((o) => !o.hidden);
      const soleText = visible.length === 1 && visible[0].kind === "text" ? visible[0] : null;
      if (soleText && soleText.text.trim()) {
        const animated = usesAnimatedBg(appearance, false, slide.bgColor || slide.bgImageUrl);
        // Respect the operator's colour/font/weight/alignment; AutoFitText owns
        // the SIZE (fill-to-fit) + the always-on uppercase crowd-readability.
        const objStyle: React.CSSProperties = {
          ...(soleText.color ? { color: soleText.color } : {}),
          ...(soleText.fontFamily ? { fontFamily: soleText.fontFamily } : {}),
          ...(soleText.fontWeight ? { fontWeight: soleText.fontWeight } : {}),
          ...(soleText.align ? { textAlign: soleText.align } : {}),
          ...(soleText.italic ? { fontStyle: "italic" } : {}),
        };
        return (
          <div className={`${base} ${animated ? "relative" : ""} ${className || ""}`} style={designBg}>
            {animated && <AnimatedThemeBg appearance={appearance} />}
            <AutoFitText
              text={soleText.text}
              maxPx={120}
              minPx={textMinPx}
              paddingRatio={projectorFit ? 0.05 : 0.06}
              disablePagination={disablePagination}
              projectorFit={projectorFit}
              fontScale={fontScale}
              className={`text-white font-display font-semibold${animated ? " relative z-[1]" : ""}`}
              textStyle={{ ...themeTextStyle(appearance), ...objStyle }}
            />
          </div>
        );
      }
      return (
        <div className={`${base} relative ${className || ""}`} style={designBg}>
          <SlideObjectsLayer objects={objects} fontScale={fontScale} />
        </div>
      );
    }
    const bg = overVideo ? { background: "transparent" } : slide.bgColor ? { background: slide.bgColor } : themeBackgroundStyle(appearance, "#0b0b0b");
    const animated = usesAnimatedBg(appearance, overVideo, slide.bgColor);
    const refText = slide.reference?.trim();
    return (
      <div
        className={`${base} ${animated ? "relative" : ""} ${className || ""}`}
        // Reserve bottom room for the fixed reference footer so a long verse body
        // fits ABOVE it instead of overlapping.
        style={refText ? { ...bg, paddingBottom: projectorFit ? "8%" : "12%" } : bg}
      >
        {animated && <AnimatedThemeBg appearance={appearance} />}
        <AutoFitText
          text={slide.text}
          maxPx={120}
          minPx={textMinPx}
          // Tighter safe-area on the projector path (6% → 3.5%) so scripture &
          // lyrics use more of the screen — bigger crowd-readable text. Still
          // enough inset that letters never touch the bezel.
          paddingRatio={projectorFit ? 0.05 : 0.06}
          disablePagination={disablePagination}
          projectorFit={projectorFit}
          fontScale={fontScale}
          className={`text-white font-display font-semibold${animated ? " relative z-[1]" : ""}`}
          textStyle={themeTextStyle(appearance)}
        />
        {refText && (
          // Fixed always-visible reference footer. Kept OUT of the AutoFitText box
          // so it can never be shrunk to nothing or paginated off with a long
          // verse — the reference must always read at the bottom of the screen.
          <div
            className={`absolute inset-x-0 bottom-0 flex justify-center pointer-events-none${animated ? " z-[1]" : ""}`}
            style={{ paddingBottom: projectorFit ? "3.5%" : "2.5%" }}
          >
            <span
              className="font-display font-semibold uppercase tracking-wide"
              style={{
                // Scales with the operator's text-size control (fontScale) so the
                // reference grows/shrinks with the verse instead of being a fixed
                // size the operator can't influence.
                fontSize: projectorFit
                  ? `calc(clamp(14px, 3.2vh, 42px) * ${fontScale ?? 1})`
                  : `calc(clamp(11px, 4%, 20px) * ${fontScale ?? 1})`,
                opacity: 0.82,
                ...themeTextStyle(appearance),
              }}
            >
              {refText}
            </span>
          </div>
        )}
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
    return <VideoSlide slide={slide} base={base} className={className} videoMuted={videoMuted} onVideoRef={onVideoRef} />;
  }

  return null;
}

/** Extracted so we can use hooks (useRef/useCallback) for stable ref handling.
 *  The inline ref callback in the parent was calling el.play() on every render,
 *  which auto-unpaused the video whenever React re-rendered. */
function VideoSlide({ slide, base, className, videoMuted, onVideoRef }: {
  slide: Extract<SlidePayload, { kind: "video" }>;
  base: string;
  className?: string;
  videoMuted: boolean;
  onVideoRef?: (el: HTMLVideoElement | null) => void;
}) {
  const hasAutoPlayed = useRef(false);
  const lastUrl = useRef(slide.url);

  // Reset auto-play flag when the video URL changes (new video should auto-play)
  if (slide.url !== lastUrl.current) {
    lastUrl.current = slide.url;
    hasAutoPlayed.current = false;
  }

  const setRef = useCallback((el: HTMLVideoElement | null) => {
    if (el && !hasAutoPlayed.current) {
      hasAutoPlayed.current = true;
      el.play().catch((err) => console.warn("[slide] video play blocked:", err instanceof Error ? err.message : String(err)));
    }
    onVideoRef?.(el);
  }, [onVideoRef]);

  return (
    <div className={`${base} bg-black ${className || ""}`}>
      <video
        src={slide.url}
        loop={slide.loop !== false}
        muted={videoMuted}
        preload="auto"
        playsInline
        onError={(e) => console.warn("[slide] video error:", (e.currentTarget as HTMLVideoElement).error?.message || "unknown")}
        ref={setRef}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          width: "auto",
          height: "auto",
          objectFit: slide.fit === "cover" ? "cover" : "contain",
          objectPosition: "center",
          display: "block",
          margin: "auto",
        }}
      />
    </div>
  );
}
