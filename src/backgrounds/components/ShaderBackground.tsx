"use client";
import { useEffect, useRef, useState } from "react";
import { createShaderRenderer, type ShaderHandle } from "../shaders/ShaderRenderer";

function hexToRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return fallback;
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return fallback;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/**
 * Renders one animated background preset via WebGL. If WebGL init fails, the
 * canvas stays empty and the CSS-gradient fallback under it shows (the
 * Canvas-2D-equivalent) — never a crash or blank. Respects reduced motion by
 * rendering a single frozen frame.
 */
export function ShaderBackground({
  preset, speed = 1, intensity = 1, primaryColor = "#0A0A0E", secondaryColor = "#0F0F14",
}: {
  preset: string; speed?: number; intensity?: number; primaryColor?: string; secondaryColor?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webglOk, setWebglOk] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: ShaderHandle | null = null;
    // Fix B (defense-in-depth): if the GPU drops the context WHILE running
    // (GPU reset, projector window backgrounded, context eviction), flip to the
    // CSS fallback so the surface degrades to a dark gradient instead of a blank
    // canvas, and recovers on restore. Without this, an involuntarily-lost
    // context leaves the canvas blank forever on the operator preview.
    const onLost = () => setWebglOk(false);
    const onRestored = () => setWebglOk(true);
    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);
    // Defer one frame so the canvas has its layout size before we size the GL viewport.
    const raf = requestAnimationFrame(() => {
      handle = createShaderRenderer({
        canvas,
        preset,
        speed: Math.max(0.05, speed),
        intensity: Math.max(0.1, intensity),
        primaryColor: hexToRgb(primaryColor, [0.04, 0.04, 0.05]),
        secondaryColor: hexToRgb(secondaryColor, [0.06, 0.06, 0.08]),
        frozen: prefersReducedMotion(),
      });
      setWebglOk(!!handle);
    });
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onLost, false);
      canvas.removeEventListener("webglcontextrestored", onRestored, false);
      handle?.stop();
    };
  }, [preset, speed, intensity, primaryColor, secondaryColor]);

  return (
    <div
      // Fix A (the white-projector fix): ALWAYS paint an opaque dark floor behind
      // the canvas. An un-initialised or context-lost `alpha:false` WebGL canvas
      // is transparent (and composites to WHITE on many real GPUs), and the slide
      // over it is transparent (overVideo) — so without a floor the LIVE OUTPUT
      // could flash white during the shader's init frame or on context loss. The
      // opaque shader covers this floor the instant it draws its first frame, so
      // this is invisible in the normal case and only shows exactly when needed.
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden",
        background: "linear-gradient(160deg, #0A0A0E, #0F0F14)",
      }}
    >
      {/* primary→secondary tint under the canvas, so a blank/initialising canvas
          reads as the theme colour (never white) — hidden once the shader draws. */}
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`, opacity: 0.35 }} aria-hidden />
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
