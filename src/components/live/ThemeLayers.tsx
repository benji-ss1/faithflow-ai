"use client";
import type { ThemeAppearance } from "@/lib/broadcast";

/**
 * Theme video background (Phase 2) — a looping, muted background video from the
 * active theme, rendered full-bleed BEHIND the slide overlay. Keyed by URL in
 * the parent so it stays playing across slide changes (no restart/flash). An
 * optional dim overlay keeps text readable over bright footage. If the video
 * fails to load it simply shows black (the div bg) — never blanks the slide,
 * which renders as a sibling above it.
 */
export function ThemeVideoBackground({ url, dim }: { url: string; dim?: number }) {
  const d = typeof dim === "number" && dim > 0 ? Math.min(1, dim) : 0;
  return (
    <div className="absolute inset-0 bg-black overflow-hidden">
      <video
        src={url}
        autoPlay
        loop
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      {d > 0 && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${d})` }} />}
    </div>
  );
}

/**
 * Animated theme background (Themes 3) — a subtle, always-looping motion layer
 * for solid/gradient theme backgrounds, used behind verses/lyrics to give the
 * screen life without a video file. Rendered as a GPU-composited `transform`
 * animation on an OVERSIZED gradient layer: no per-frame JS, no layout, no paint
 * after the first frame, so it's cheap enough for a weak projector PC and safe
 * for the livestream encoder (unlike animating background-position, which
 * repaints every frame). Respects prefers-reduced-motion. Returns null for
 * image/video backgrounds (those have their own look) or when animation is off.
 *
 * Sits at z-0 inside the (relative, overflow-hidden) slide root; slide text is
 * given z-[1] by the caller so it always reads on top.
 */
const BG_ANIM_KEYFRAME: Record<string, string> = {
  drift: "pf-bg-drift 26s ease-in-out infinite",
  aurora: "pf-bg-aurora 48s ease-in-out infinite",
  pulse: "pf-bg-pulse 10s ease-in-out infinite",
};
// aurora rotates, so it needs the most oversize to keep corners covered.
const BG_ANIM_SCALE: Record<string, string> = { drift: "scale(1.2)", aurora: "scale(1.6)", pulse: "scale(1.1)" };

export function AnimatedThemeBg({ appearance }: { appearance?: ThemeAppearance | null }) {
  const anim = appearance?.bgAnimation;
  if (!anim || anim === "none" || !BG_ANIM_KEYFRAME[anim]) return null;
  // Only for solid/gradient backgrounds (image/video render their own layer).
  if (appearance?.bgType === "image" || appearance?.bgType === "video") return null;
  const c1 = appearance?.bgColor ?? "#0b0b0b";
  const c2 = appearance?.bgColor2 ?? c1;
  const angle = typeof appearance?.bgAngle === "number" ? appearance.bgAngle : 180;
  const dim = typeof appearance?.dim === "number" && appearance.dim > 0 ? Math.min(1, appearance.dim) : 0;
  return (
    <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        className="pf-anim-bg absolute inset-[-20%]"
        style={{
          background: `linear-gradient(${angle}deg, ${c1}, ${c2})`,
          animation: BG_ANIM_KEYFRAME[anim],
          transform: BG_ANIM_SCALE[anim],
          willChange: "transform",
        }}
      />
      {dim > 0 && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${dim})` }} />}
    </div>
  );
}

const LOGO_POS_CLASS: Record<string, string> = {
  "top-left": "top-[4%] left-[4%]",
  "top-center": "top-[4%] left-1/2 -translate-x-1/2",
  "top-right": "top-[4%] right-[4%]",
  "middle-left": "top-1/2 left-[4%] -translate-y-1/2",
  "center": "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
  "middle-right": "top-1/2 right-[4%] -translate-y-1/2",
  "bottom-left": "bottom-[4%] left-[4%]",
  "bottom-center": "bottom-[4%] left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-[4%] right-[4%]",
};

/**
 * Persistent church-logo overlay (Phase 2) — drawn on top of every output
 * surface at the theme's chosen corner/position, size (% of output width), and
 * opacity. Non-interactive; renders nothing when the theme has no logo.
 */
export function ThemeLogoLayer({ appearance }: { appearance?: ThemeAppearance | null }) {
  if (!appearance?.logoUrl || appearance.logoPosition === "none") return null;
  const pos = appearance.logoPosition ?? "bottom-right";
  const posClass = LOGO_POS_CLASS[pos] ?? LOGO_POS_CLASS["bottom-right"];
  const width = `${appearance.logoSizePct ?? 12}%`;
  const opacity = typeof appearance.logoOpacity === "number" ? appearance.logoOpacity : 1;
  return (
    <div className={`absolute ${posClass} pointer-events-none z-10`} style={{ width, opacity }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={appearance.logoUrl} alt="" style={{ width: "100%", height: "auto", display: "block" }} />
    </div>
  );
}
