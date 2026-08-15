"use client";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * PresentationCanvas — ProPresenter-style fixed presentation surface.
 *
 * THE PARITY FIX (2026-08-15). Previously every surface rendered the slide into
 * its OWN physical container — the operator preview into a small ~356×200 box,
 * the projector into the full output window — and AutoFitText measured those
 * different containers, so text fitting produced DIFFERENT results and the
 * preview never reliably matched the projector.
 *
 * Now the slide is always composed inside a FIXED 1920×1080 canvas (the
 * "presentation canvas", independent of the physical output — exactly the
 * professional model). AutoFitText therefore always measures the SAME
 * 1920×1080 geometry, so text sizing + wrapping is deterministic and identical
 * everywhere. The whole canvas is then uniformly scaled with a CSS transform to
 * fit the actual surface — scaled DOWN into the little preview box, scaled to
 * the projector's resolution on the output — preserving aspect ratio and
 * letterboxing when the surface isn't 16:9. The composition is pixel-for-pixel
 * proportional between preview and projector; only the scale factor differs.
 *
 * `transform: scale()` does not change layout metrics, so children still see a
 * clean 1920×1080 box to measure against; centering via translate(-50%,-50%)
 * keeps the scaled canvas centred (letterboxed) in any surface aspect ratio.
 */
export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

export function PresentationCanvas({
  children,
  className,
  canvasW = CANVAS_W,
  canvasH = CANVAS_H,
}: {
  children: React.ReactNode;
  className?: string;
  /** Fixed canvas size to compose against. 1920×1080 (16:9) by default; pass
   *  1440×1080 for a 4:3 output. The canvas is always centred + letterboxed in
   *  the physical surface, so the design geometry is independent of the display. */
  canvasW?: number;
  canvasH?: number;
}) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  const [dbg, setDbg] = useState({ w: 0, h: 0 });
  // TEMP debug (2026-08-15): surface the measured surface size + scale so we can
  // see, on the actual projector output, whether the fixed-canvas scaling is
  // active. Remove once the projector/preview parity is confirmed.
  const DEBUG = true;

  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const measure = () => {
      const w = outer.clientWidth;
      const h = outer.clientHeight;
      if (w <= 0 || h <= 0) return;
      setDbg({ w, h });
      // Contain: the largest uniform scale that fits the fixed canvas inside the
      // surface while preserving aspect ratio (letterbox the remainder).
      const s = Math.min(w / canvasW, h / canvasH);
      setScale((prev) => (Math.abs(prev - s) > 0.0001 ? s : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [canvasW, canvasH]);

  return (
    <div
      ref={outerRef}
      className={`relative w-full h-full overflow-hidden ${className ?? ""}`}
    >
      {/* The fixed canvas, absolutely centred and uniformly scaled. Hidden until
          the first measurement so we never flash the un-scaled full-size canvas. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: canvasW,
          height: canvasH,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
          visibility: scale > 0 ? "visible" : "hidden",
          outline: DEBUG ? "6px solid #ff2d55" : undefined,
        }}
      >
        {children}
      </div>
      {DEBUG && (
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            zIndex: 9999,
            background: "#ff2d55",
            color: "#fff",
            font: "700 14px monospace",
            padding: "2px 6px",
            borderRadius: 4,
            pointerEvents: "none",
          }}
        >
          PC {dbg.w}×{dbg.h} → {canvasW}×{canvasH} s={scale.toFixed(3)}
        </div>
      )}
    </div>
  );
}
