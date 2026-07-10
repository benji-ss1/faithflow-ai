"use client";
// Phase 5D-3 — non-blocking canvas warnings strip. Renders below SlideCanvas
// with small amber pills (contrast / overflow / empty). Purely informational.
import { useMemo } from "react";
import type { EditableSlide, TextObject } from "@/lib/slide-objects";
import { CANVAS_H } from "@/lib/slide-objects";

type Warning = { id: string; kind: "contrast" | "overflow" | "empty"; label: string; detail: string };

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function relLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const srgb = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}
function contrastRatio(a: string, b: string): number | null {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const la = relLuminance(ra), lb = relLuminance(rb);
  const lo = Math.min(la, lb), hi = Math.max(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function computeWarnings(slide: EditableSlide | null): Warning[] {
  if (!slide) return [];
  const warnings: Warning[] = [];
  const bg = slide.bgColor || "#0b0b0b";

  for (const obj of slide.objects) {
    if (obj.kind !== "text") continue;
    const t = obj as TextObject;

    // Empty / whitespace
    if (!t.text || !t.text.trim()) {
      warnings.push({ id: `${t.id}-empty`, kind: "empty", label: "Empty text", detail: "Text object has no content" });
      continue;
    }

    // Contrast
    const fg = t.color || "#ffffff";
    const ratio = contrastRatio(fg, bg);
    if (ratio !== null && ratio < 4.5) {
      warnings.push({
        id: `${t.id}-contrast`,
        kind: "contrast",
        label: "Low contrast",
        detail: `${fg} on ${bg} ≈ ${ratio.toFixed(2)}:1 (WCAG AA needs ≥ 4.5)`,
      });
    }

    // Overflow (approximate — cannot measure DOM here, so estimate line count vs height)
    const fontSize = t.fontSize ?? 96;
    const lineHeight = fontSize * 1.2;
    const charsPerLineApprox = Math.max(1, Math.floor(t.w / (fontSize * 0.55)));
    const lines = t.text.split(/\r?\n/).reduce((acc, line) => {
      return acc + Math.max(1, Math.ceil(line.length / charsPerLineApprox));
    }, 0);
    const neededHeight = lines * lineHeight;
    if (neededHeight > t.h * 1.05) {
      warnings.push({
        id: `${t.id}-overflow`,
        kind: "overflow",
        label: "Text overflow",
        detail: `~${lines} lines needed, box holds ~${Math.floor(t.h / lineHeight)}`,
      });
    }

    // Yardstick: also flag if text starts within visible canvas but extends beyond
    if (t.y + t.h > CANVAS_H + 20) {
      warnings.push({ id: `${t.id}-offscreen`, kind: "overflow", label: "Off-canvas", detail: "Text object extends below slide" });
    }
  }
  return warnings;
}

export function CanvasWarnings({ slide }: { slide: EditableSlide | null }) {
  const warnings = useMemo(() => computeWarnings(slide), [slide]);
  if (warnings.length === 0) return null;
  return (
    <div className="shrink-0 flex flex-wrap gap-1 px-3 py-1.5 border-t bg-amber-500/5"
      style={{ borderColor: "#2a3232" }}>
      {warnings.map((w) => (
        <span
          key={w.id}
          title={w.detail}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-200 border border-amber-500/30 cursor-help"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          {w.label}
        </span>
      ))}
    </div>
  );
}
