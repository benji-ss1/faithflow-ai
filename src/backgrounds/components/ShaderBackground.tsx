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
    return () => { cancelAnimationFrame(raf); handle?.stop(); };
  }, [preset, speed, intensity, primaryColor, secondaryColor]);

  return (
    <div
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden",
        // Fallback gradient shows through if WebGL failed (canvas empty).
        background: webglOk ? undefined : `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
