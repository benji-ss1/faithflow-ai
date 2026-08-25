"use client";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { BackgroundLayer } from "@/backgrounds/components/BackgroundLayer";
import type { BackgroundSpec } from "@/lib/broadcast";

/**
 * A center-panel slide card that renders the SAME theme composite the projector
 * shows — the active Background Template (System B) behind the SlideRenderer
 * (which paints the theme appearance, System A) — so each card box is WYSIWYG.
 * Mirrors LivePreviewPanel's stacking. SlideRenderer / slideOutputIdentity /
 * projector output stay byte-identical (preview-only; never enters OutputState).
 *
 * WebGL budget: a live shader Background Template is a WebGL context, and
 * browsers cap those at ~16. A chapter/song grid can show 30+ cards, so we
 * render the LIVE animated shader ONLY in the focused card (`liveBg`) and a
 * cheap STATIC gradient (the shader's own no-WebGL fallback: primary→secondary)
 * in every other card — unlimited, no context exhaustion. Image templates render
 * their <img> (cheap, cache-shared); video/shader use the static gradient in
 * grid cards. The real animation still lives in LivePreviewPanel + the projector.
 *
 * Only text/blank slides get a background (image/video/logo slides are opaque
 * full-bleed and would hide it).
 */
export function ThemedSlideCard({
  slide,
  appearance,
  background,
  liveBg,
  ...rest
}: React.ComponentProps<typeof SlideRenderer> & { background?: BackgroundSpec | null; liveBg?: boolean }) {
  const hasBg = !!(background && background.type !== "none");
  const kind = slide.kind;
  const themeable = kind === "text" || kind === "blank";
  const showBg = hasBg && themeable;
  return (
    <>
      {showBg && (liveBg ? <BackgroundLayer background={background} /> : <StaticCardBackground background={background!} />)}
      <SlideRenderer slide={slide} appearance={appearance} overVideo={showBg} {...rest} />
    </>
  );
}

const FILL: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden" };

/** Cheap, WebGL-free representation of a Background Template for grid cards. */
function StaticCardBackground({ background }: { background: BackgroundSpec }) {
  const primary = background.primaryColor || "#0A0A0E";
  const secondary = background.secondaryColor || "#0F0F14";
  const overlayOpacity = typeof background.overlayOpacity === "number" ? Math.min(0.8, Math.max(0, background.overlayOpacity)) : 0;
  return (
    <div style={FILL} aria-hidden>
      {background.type === "image" && background.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={background.imageUrl}
          alt=""
          style={{ ...FILL, objectFit: background.imageFit === "stretch" ? "fill" : background.imageFit === "fit" ? "contain" : "cover" }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        // shader / gradient / video → static primary→secondary gradient
        // (ShaderBackground's own no-WebGL fallback), no context cost.
        <div style={{ ...FILL, background: `linear-gradient(135deg, ${primary}, ${secondary})` }} />
      )}
      {overlayOpacity > 0 && background.overlayColor && (
        <div style={{ ...FILL, background: background.overlayColor, opacity: overlayOpacity }} />
      )}
    </div>
  );
}
