"use client";
import { useEffect, useRef } from "react";
import { SharedBackgroundRenderer, SHARED_OFF_W, SHARED_OFF_H, type SharedShaderSpec } from "../shared/SharedBackgroundRenderer";
import { FLOOR_GRADIENT, FLOOR_TINT_OPACITY, tintGradient } from "../shared/shaderUtils";

const FILL: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden" };

/**
 * A cheap 2D canvas registered with the ONE shared WebGL shader renderer. Used by
 * every operator-side surface that mirrors the active Background Template (slide
 * cards AND the Main/Stage/Stream monitors) so they all ANIMATE in step with each
 * other at the cost of a single WebGL context per window (never one per surface).
 * Layers: opaque dark floor + theme tint (never white, WebGL-failure fallback),
 * then the canvas the shared renderer blits into.
 */
export function SharedShaderCanvas({ spec }: { spec: SharedShaderSpec }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(1.5, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.min(SHARED_OFF_W, Math.round((r.width || 160) * dpr)));
      const h = Math.max(1, Math.min(SHARED_OFF_H, Math.round((r.height || 90) * dpr)));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
      return false;
    };
    fit();
    const handle = SharedBackgroundRenderer.register(canvas, spec);
    // Cull blits for surfaces scrolled out of view (a chapter can have 150+ cards).
    let obs: IntersectionObserver | null = null;
    try {
      obs = new IntersectionObserver((entries) => {
        for (const e of entries) handle.setVisible(e.isIntersecting);
      }, { rootMargin: "100px" });
      obs.observe(canvas);
    } catch { /* no IO support → stays visible */ }
    // A monitor mounted while hidden (MultiView picks another screen) has 0 size
    // at mount — re-fit when it gets a real layout so it isn't a blurry 160×90.
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => { if (fit()) handle.setVisible(true); });
      ro.observe(canvas);
    } catch { /* noop */ }
    return () => { obs?.disconnect(); ro?.disconnect(); handle.dispose(); };
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
