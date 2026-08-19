"use client";

/**
 * Connector between the BetaScroll section (progress rail on the LEFT) and the
 * Auditorium section (rail on the RIGHT). As you scroll through this gap, a line
 * draws from top-left to bottom-right and a small square marker travels along it
 * — visually carrying the rail from one section across to meet the other.
 * Reduced-motion: the line is simply drawn, no travel.
 */
import { useEffect, useRef } from "react";

// S-curve in a 0..100 viewBox: starts top-left (≈ BetaScroll's left rail x),
// ends bottom-right (≈ the auditorium's right rail x).
const PATH = "M 4 0 C 4 46, 95 52, 95 100";

export default function RailConnector() {
  const ref = useRef<HTMLDivElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const markerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current, path = pathRef.current, marker = markerRef.current;
    if (!el || !path) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = String(len);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { path.style.strokeDashoffset = "0"; return; }
    path.style.strokeDashoffset = String(len);

    const onScroll = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 as the connector enters from the bottom → 1 as it exits the top.
      const p = Math.max(0, Math.min(1, (vh - r.top) / (vh + r.height)));
      path.style.strokeDashoffset = String(len * (1 - p));
      if (marker) {
        const pt = path.getPointAtLength(len * p); // viewBox units (0..100)
        marker.style.left = `${pt.x}%`;
        marker.style.top = `${pt.y}%`;
        marker.style.opacity = p > 0.01 && p < 0.99 ? "1" : "0";
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="pf-railconn"
      aria-hidden="true"
      style={{
        position: "relative",
        height: "clamp(240px, 42vh, 440px)",
        /* Roll the dark BetaScroll above into the white "How it works" below —
           the connector line + square carry the rail across the seam. On mobile
           (no side rails) we keep just this gradient blend and drop the line. */
        background: "linear-gradient(180deg, var(--bg) 0%, var(--bg) 22%, #F6F3EC 100%)",
        overflow: "hidden",
      }}
    >
      <style>{`@media (max-width:960px){.pf-railconn{height:clamp(120px,20vh,200px)}.pf-railconn .rc-line{display:none}}`}</style>
      <svg
        className="rc-line"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {/* faint full track — a neutral that reads on both the dark top and light bottom */}
        <path d={PATH} fill="none" stroke="#a8926a" strokeOpacity="0.4" strokeWidth="0.35" />
        {/* drawn-on-scroll leading line — ember so the connection reads */}
        <path ref={pathRef} d={PATH} fill="none" stroke="var(--ember)" strokeOpacity="0.9" strokeWidth="0.55" strokeLinecap="round" />
      </svg>
      {/* traveling square marker */}
      <div
        ref={markerRef}
        className="rc-line"
        style={{
          position: "absolute",
          left: "4%",
          top: 0,
          width: 13,
          height: 13,
          borderRadius: 3,
          background: "var(--ember)",
          transform: "translate(-50%,-50%)",
          transition: "opacity .3s ease",
          boxShadow: "0 0 0 4px rgba(255,122,44,.18), 0 0 18px rgba(255,122,44,.55)",
        }}
      />
    </div>
  );
}
