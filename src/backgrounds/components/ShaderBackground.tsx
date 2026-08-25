"use client";
import { useEffect, useRef } from "react";
import { createShaderRenderer, type ShaderHandle } from "../shaders/ShaderRenderer";
import { hexToRgb, prefersReducedMotion, FLOOR_GRADIENT, FLOOR_TINT_OPACITY, tintGradient, PRIMARY_RGB_FALLBACK, SECONDARY_RGB_FALLBACK } from "../shared/shaderUtils";

/**
 * Renders one animated background preset via WebGL for the LIVE surfaces
 * (projector /live, /stage, /livestream, and the operator LivePreviewPanel).
 *
 * Never-white guarantee: an un-initialised or context-lost `alpha:false` canvas
 * is transparent and composites to WHITE on many real GPUs, and the slide over
 * it is transparent (overVideo) — so we ALWAYS paint an opaque dark floor + a
 * theme tint UNDER the canvas. The opaque shader covers it once it draws.
 */
export function ShaderBackground({
  preset, speed = 1, intensity = 1, primaryColor = "#0A0A0E", secondaryColor = "#0F0F14",
}: {
  preset: string; speed?: number; intensity?: number; primaryColor?: string; secondaryColor?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: ShaderHandle | null = null;
    // Defer one frame so the canvas has its layout size before we size the GL viewport.
    const raf = requestAnimationFrame(() => {
      handle = createShaderRenderer({
        canvas,
        preset,
        speed: Math.max(0.05, speed),
        intensity: Math.max(0.1, intensity),
        primaryColor: hexToRgb(primaryColor, PRIMARY_RGB_FALLBACK),
        secondaryColor: hexToRgb(secondaryColor, SECONDARY_RGB_FALLBACK),
        frozen: prefersReducedMotion(),
      });
    });
    return () => { cancelAnimationFrame(raf); handle?.stop(); };
  }, [preset, speed, intensity, primaryColor, secondaryColor]);

  return (
    <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden", background: FLOOR_GRADIENT }}>
      {/* theme tint under the canvas so a blank/initialising canvas reads as the
          theme colour, never white — hidden once the opaque shader draws. */}
      <div style={{ position: "absolute", inset: 0, background: tintGradient(primaryColor, secondaryColor), opacity: FLOOR_TINT_OPACITY }} aria-hidden />
      {/*
        CRITICAL: `key` includes ALL shader params, not just the preset. stop()
        loseContext()s the canvas on cleanup; reusing a lost canvas makes the next
        shader compile fail and freezes the projector to the static floor. Keying
        the canvas on every param gives a FRESH canvas on any change (preset OR a
        Speed/Intensity/Colour slider drag on the active background) — mirroring
        SharedBackgroundRenderer's "always a fresh canvas" rule. The dark floor
        covers the one-frame re-init, so this is white-safe.
      */}
      <canvas
        key={`${preset}|${speed}|${intensity}|${primaryColor}|${secondaryColor}`}
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
