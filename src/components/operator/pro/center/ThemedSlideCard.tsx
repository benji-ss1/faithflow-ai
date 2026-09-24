"use client";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { PresentationCanvas } from "@/components/live/PresentationCanvas";
import { useTransparentSlide } from "@/lib/transparent-slide";
import { useLayerOrderV3 } from "@/lib/layer-order-v3";
import { isBandSlide } from "@/lib/band-media";
import type { BackgroundSpec } from "@/lib/broadcast";
import { SharedShaderCanvas } from "@/backgrounds/components/SharedShaderCanvas";

/**
 * A center-panel slide card that renders the SAME theme composite the projector
 * shows — the active Background Template (System B) behind the SlideRenderer
 * (which paints the theme appearance, System A) — so each card box is a TRUE
 * 1:1 replica of the live output. SlideRenderer / slideOutputIdentity / projector
 * output stay byte-identical (preview-only; never enters OutputState).
 *
 * WebGL budget: a live shader is a WebGL context (browser cap ~16), so we can't
 * give every card its own. Instead a single shared offscreen shader renders once
 * (SharedBackgroundRenderer) and each card cheaply blits it into a 2D canvas —
 * so 40 cards show the exact same animated shader as live at the cost of ONE GL
 * context total. (Previously grid cards showed a STATIC gradient that mismatched
 * the live shader — e.g. Holy Fire looked flat-orange instead of dark-with-embers.)
 *
 * Only text/blank slides get a background (image/video/logo slides are opaque
 * full-bleed and would hide it).
 */
export function ThemedSlideCard({
  slide,
  appearance,
  background,
  ...rest
}: React.ComponentProps<typeof SlideRenderer> & { background?: BackgroundSpec | null }) {
  const transparentSlide = useTransparentSlide();
  // Layer Order V3 only: a slide with no background of its own is SEE-THROUGH,
  // so its card shows PP7's transparency checkerboard at the very bottom (any
  // theme / template / slide colour paints over it). Flag off ⇒ no extra node.
  const layerOrderV3 = useLayerOrderV3();
  const hasBg = !!(background && background.type !== "none");
  const kind = slide.kind;
  const themeable = kind === "text" || kind === "blank";
  // A per-slide background IMAGE fully overrides the global/theme background (this
  // is the precedence SlideRenderer uses on the LIVE path). The card must match:
  // if we still painted the global CardBackground here it would stack ABOVE
  // SlideRenderer's own per-slide image and hide it — so the card showed the global
  // background while live showed the dropped image. Suppress the global layer (and
  // overVideo) when the slide carries its own image, making the card === live.
  const hasSlideImage = kind === "text" && !!(slide as { bgImageUrl?: string }).bgImageUrl;
  const showBg = hasBg && themeable && !hasSlideImage;
  const renderer = <SlideRenderer slide={slide} appearance={appearance} overVideo={showBg} {...rest} />;
  return (
    <>
      {/* Screen colour (PP7's bottom layer). With the transparent slide layer on, a slide
          that was never given a background paints nothing, so the card needs the same
          opaque base a real projector surface has (/live is bg-black, /stage and
          /livestream paint #000) — otherwise the operator UI would show through the
          card. Sits BELOW the background template, exactly like the projector. */}
      {layerOrderV3 && themeable
        ? <div aria-hidden data-slide-checkerboard="" className="absolute inset-0" style={CHECKERBOARD} />
        : transparentSlide && <div aria-hidden className="absolute inset-0" style={{ background: "#000" }} />}
      {showBg && <CardBackground background={background!} />}
      {/* Lower-third BAND slides (verse / song / band media) size their reference +
          caption in fixed-canvas px, so like /live, the operator preview and the
          scripture editor they must compose in the 1920x1080 PresentationCanvas and be
          scaled down. Rendered raw in a ~500px card the reference came out ~4x too big,
          overlapped the verse and the band clipped it (2026-09-19). Every other slide
          keeps the raw render exactly as before. */}
      {isBandSlide(slide as { kind: string; scriptureLayout?: string; layout?: string })
        ? <PresentationCanvas>{renderer}</PresentationCanvas>
        : renderer}
    </>
  );
}

/** PP7 transparency checkerboard (same pattern as the Themes popover swatch). */
export const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: "#1f1f1f",
  backgroundImage: "linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
};

const FILL: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden" };

function CardBackground({ background }: { background: BackgroundSpec }) {
  const overlayOpacity = typeof background.overlayOpacity === "number" ? Math.min(0.8, Math.max(0, background.overlayOpacity)) : 0;
  return (
    <div style={FILL} aria-hidden>
      {background.type === "image" && background.imageUrl ? (
        // Image templates: a shared-cache <img> is cheap AND already 1:1 with live.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={background.imageUrl}
          alt=""
          style={{ ...FILL, objectFit: background.imageFit === "stretch" ? "fill" : background.imageFit === "fit" ? "contain" : "cover" }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        // shader / gradient / video → the REAL shader via the shared renderer.
        <SharedShaderCard background={background} />
      )}
      {overlayOpacity > 0 && background.overlayColor && (
        <div style={{ ...FILL, background: background.overlayColor, opacity: overlayOpacity }} />
      )}
    </div>
  );
}

/** One card's canvas on the shared shader renderer (see SharedShaderCanvas). */
function SharedShaderCard({ background }: { background: BackgroundSpec }) {
  return (
    <SharedShaderCanvas
      spec={{
        preset: background.shaderPreset || "cleanSlate",
        speed: background.speed ?? 1,
        intensity: background.intensity ?? 1,
        primary: background.primaryColor || "#0A0A0E",
        secondary: background.secondaryColor || "#0F0F14",
      }}
    />
  );
}
