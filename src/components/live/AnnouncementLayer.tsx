"use client";
import type { AnnouncementPayload } from "@/lib/broadcast";

export function AnnouncementLayer({ ann }: { ann: AnnouncementPayload | null | undefined }) {
  if (!ann) return null;
  const { line1, line2, position, style } = ann;
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
      <div className="absolute bottom-16 left-16 max-w-[70%] pointer-events-none z-40" style={base}>
        <div>{line1}</div>
        {line2 && <div style={{ opacity: 0.75, fontSize: (style.fontSizePx ?? 32) * 0.7 }}>{line2}</div>}
      </div>
    );
  }
  if (position === "top_banner") {
    return (
      <div className="absolute top-0 left-0 right-0 pointer-events-none z-40" style={base}>
        <div>{line1}</div>
        {line2 && <div style={{ opacity: 0.75, fontSize: (style.fontSizePx ?? 32) * 0.7 }}>{line2}</div>}
      </div>
    );
  }
  if (position === "ticker") {
    return (
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
    );
  }
  // center_card
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
      <div style={{ ...base, maxWidth: "70%" }}>
        <div>{line1}</div>
        {line2 && <div style={{ opacity: 0.75, fontSize: (style.fontSizePx ?? 32) * 0.7, marginTop: 8 }}>{line2}</div>}
      </div>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
