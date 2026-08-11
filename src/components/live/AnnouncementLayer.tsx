"use client";
import type { AnnouncementPayload, AnnouncementLogoPosition } from "@/lib/broadcast";

// Placement classes for the announcement logo overlay. The 9-grid mirrors the
// theme logo layer; upper/lower-third center the logo within the top/bottom band.
const ANN_LOGO_POS_CLASS: Record<AnnouncementLogoPosition, string> = {
  "top-left": "top-[5%] left-[5%]",
  "top-center": "top-[5%] left-1/2 -translate-x-1/2",
  "top-right": "top-[5%] right-[5%]",
  "middle-left": "top-1/2 left-[5%] -translate-y-1/2",
  "center": "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
  "middle-right": "top-1/2 right-[5%] -translate-y-1/2",
  "bottom-left": "bottom-[5%] left-[5%]",
  "bottom-center": "bottom-[5%] left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-[5%] right-[5%]",
  "upper-third": "top-[16%] left-1/2 -translate-x-1/2",
  "lower-third": "bottom-[16%] left-1/2 -translate-x-1/2",
};

function AnnouncementLogo({ logo }: { logo: NonNullable<AnnouncementPayload["logo"]> }) {
  const posClass = ANN_LOGO_POS_CLASS[logo.position] ?? ANN_LOGO_POS_CLASS["top-right"];
  return (
    <div className={`absolute ${posClass} pointer-events-none z-40`} style={{ width: `${logo.sizePct}%`, opacity: logo.opacity }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.url} alt="" style={{ width: "100%", height: "auto", display: "block" }} />
    </div>
  );
}

export function AnnouncementLayer({ ann }: { ann: AnnouncementPayload | null | undefined }) {
  if (!ann) return null;
  const { line1, line2, position, style, logo } = ann;
  const logoEl = logo ? <AnnouncementLogo logo={logo} /> : null;
  const bgRgba = hexToRgba(style.bgColor || "#000000", (style.bgOpacity ?? 70) / 100);
  const base: React.CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: style.fontSizePx,
    fontWeight: style.fontWeight,
    color: style.textColor,
    background: bgRgba,
    padding: style.padding,
    borderRadius: style.borderRadius,
    textAlign: style.align,
    lineHeight: 1.2,
  };
  if (position === "lower_third") {
    return (
      <>
        <div className="absolute bottom-16 left-16 max-w-[70%] pointer-events-none z-40" style={base}>
          <div>{line1}</div>
          {line2 && <div style={{ opacity: 0.75, fontSize: (style.fontSizePx ?? 32) * 0.7 }}>{line2}</div>}
        </div>
        {logoEl}
      </>
    );
  }
  if (position === "top_banner") {
    return (
      <>
        <div className="absolute top-0 left-0 right-0 pointer-events-none z-40" style={base}>
          <div>{line1}</div>
          {line2 && <div style={{ opacity: 0.75, fontSize: (style.fontSizePx ?? 32) * 0.7 }}>{line2}</div>}
        </div>
        {logoEl}
      </>
    );
  }
  if (position === "ticker") {
    return (
      <>
        <div className="absolute bottom-0 left-0 right-0 overflow-hidden pointer-events-none z-40" style={{ ...base, whiteSpace: "nowrap" }}>
          <div style={{ display: "inline-block", animation: "ff-ticker-scroll 24s linear infinite" }}>
            {line1}{line2 ? ` · ${line2}` : ""} &nbsp;&nbsp;&nbsp;&nbsp; {line1}{line2 ? ` · ${line2}` : ""}
          </div>
          <style jsx>{`
            @keyframes ff-ticker-scroll {
              from { transform: translateX(100%); }
              to { transform: translateX(-100%); }
            }
          `}</style>
        </div>
        {logoEl}
      </>
    );
  }
  // center_card
  return (
    <>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
        <div style={{ ...base, maxWidth: "70%" }}>
          <div>{line1}</div>
          {line2 && <div style={{ opacity: 0.75, fontSize: (style.fontSizePx ?? 32) * 0.7, marginTop: 8 }}>{line2}</div>}
        </div>
      </div>
      {logoEl}
    </>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
