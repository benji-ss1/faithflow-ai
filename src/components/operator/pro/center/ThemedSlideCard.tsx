"use client";
import { useEffect, useRef } from "react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { BackgroundSpec } from "@/lib/broadcast";
import { SharedBackgroundRenderer, type SharedShaderSpec } from "@/backgrounds/shared/SharedBackgroundRenderer";
import { FLOOR_GRADIENT, FLOOR_TINT_OPACITY, tintGradient } from "@/backgrounds/shared/shaderUtils";

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
  const hasBg = !!(background && background.type !== "none");
  const kind = slide.kind;
  const themeable = kind === "text" || kind === "blank";
  const showBg = hasBg && themeable;
  return (
    <>
      {showBg && <CardBackground background={background!} />}
      <SlideRenderer slide={slide} appearance={appearance} overVideo={showBg} {...rest} />
    </>
  );
}

const FILL: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden" };
// Matches SharedBackgroundRenderer's offscreen size — the per-card cap.
const OFF_W = 480, OFF_H = 270;

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

/**
 * One card's 2D canvas registered with the shared shader renderer. Layers:
 *   1. opaque dark base + primary→secondary tint (readable floor — shows before
 *      the first blit and if WebGL is unavailable; never white, always legible);
 *   2. the 2D canvas the shared renderer blits the real shader into each frame.
 * The opaque shader blit covers the floor once it draws — so the card shows the
 * exact live shader, and falls back to the dark tint gracefully.
 */
function SharedShaderCard({ background }: { background: BackgroundSpec }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const spec: SharedShaderSpec = {
    preset: background.shaderPreset || "cleanSlate",
    speed: background.speed ?? 1,
    intensity: background.intensity ?? 1,
    primary: background.primaryColor || "#0A0A0E",
    secondary: background.secondaryColor || "#0F0F14",
  };
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(1.5, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    canvas.width = Math.max(1, Math.min(OFF_W, Math.round((r.width || 160) * dpr)));
    canvas.height = Math.max(1, Math.min(OFF_H, Math.round((r.height || 90) * dpr)));
    const handle = SharedBackgroundRenderer.register(canvas, spec);
    // Cull blits for cards scrolled out of view — a chapter can have 150+ cards,
    // and blitting all of them every frame is needless GPU work on church laptops.
    let obs: IntersectionObserver | null = null;
    try {
      obs = new IntersectionObserver((entries) => {
        for (const e of entries) handle.setVisible(e.isIntersecting);
      }, { rootMargin: "100px" });
      obs.observe(canvas);
    } catch { /* no IO support → all cards stay visible (fine) */ }
    return () => { obs?.disconnect(); handle.dispose(); };
    // Re-register when the active theme changes (one context rebuild, deduped).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.preset, spec.primary, spec.secondary, spec.speed, spec.intensity]);
  return (
    <>
      <div style={{ ...FILL, background: FLOOR_GRADIENT }} />
      <div style={{ ...FILL, background: tintGradient(spec.primary, spec.secondary), opacity: FLOOR_TINT_OPACITY }} />
      <canvas ref={ref} style={{ ...FILL, display: "block" }} />
    </>
  );
}
