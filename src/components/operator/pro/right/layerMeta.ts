"use client";
/**
 * layerMeta — shared per-layer presentation metadata for the Layers surfaces
 * (the full LayersPanel popover AND the always-visible VerticalClearRail).
 *
 * Extracted from LayersPanel so the rail and the panel share ONE source of
 * truth for each layer's label, icon and accent token — a new/changed layer
 * hue is edited in exactly one place. No emojis — lucide icon components only.
 */
import {
  Image as ImageIcon, Video, Type, Award, Megaphone, Clock, MessageSquare,
  RectangleHorizontal,
} from "lucide-react";
import type { LayerWire } from "@/lib/broadcast";
import type { LayerRow } from "../../useLiveLayers";
import type { OperatorShellCtx } from "../../shell/types";

export type LayerIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

// Per-layer accent colours, referenced from the app token stylesheet
// (--pf-layer-* in src/app/globals.css) so the hues live in one place. Each
// layer reads distinctly at a glance. NOTE (Y6): `background/camera/slide/logo`
// are the kinds the derived stack surfaces TODAY; `media/announcement/band/
// timer/message` are kept here so the map is exhaustive over LayerKind (and a
// future Phase 3+ layer that reaches a surface already has an accent/icon) —
// they are not currently produced by outputStateToLayers.
export const LAYER_META: Record<LayerWire["kind"], { label: string; Icon: LayerIcon; accent: string }> = {
  background: { label: "Background", Icon: ImageIcon, accent: "var(--pf-layer-background)" },
  camera:     { label: "Camera",     Icon: Video,     accent: "var(--pf-layer-camera)" },
  slide:      { label: "Slide",      Icon: Type,      accent: "var(--pf-layer-slide)" },
  media:      { label: "Media",      Icon: ImageIcon, accent: "var(--pf-layer-media)" },
  logo:       { label: "Logo",       Icon: Award,     accent: "var(--pf-layer-logo)" },
  announcement:{ label: "Announcement", Icon: Megaphone, accent: "var(--pf-layer-announcement)" },
  band:       { label: "Band",       Icon: RectangleHorizontal, accent: "var(--pf-layer-band)" },
  timer:      { label: "Timer",      Icon: Clock,     accent: "var(--pf-layer-timer)" },
  message:    { label: "Message",    Icon: MessageSquare, accent: "var(--pf-layer-message)" },
};

// Shared square hit-target for row controls (≈32px, Y14) — padding, not icon
// blow-up, so the icons stay small but the tap area is finger-friendly.
export const HIT = "inline-flex items-center justify-center h-8 w-8 rounded shrink-0";

/** Cheap "what's live" one-liner for a layer's current content (Y10 tooltip). */
export function liveDescription(row: LayerRow, ctx: OperatorShellCtx): string {
  const meta = LAYER_META[row.kind];
  if (!row.active) return `${meta.label}: idle`;
  switch (row.kind) {
    case "background": {
      const bg = ctx.background;
      if (!bg) return "Background: active";
      if (bg.type === "image") return "Background: image";
      if (bg.type === "shader") return `Background: ${bg.shaderPreset ?? "shader"}`;
      if (bg.type === "video") return "Background: video";
      return `Background: ${bg.type}`;
    }
    case "camera":
      return `Camera: ${ctx.videoInput?.label || "live input"}`;
    case "slide":
    case "media": {
      const s = ctx.liveSlide;
      if (s && s.kind === "text" && s.text) {
        const words = s.text.trim().split(/\s+/).slice(0, 6).join(" ");
        return `Slide: ${words}${s.text.trim().split(/\s+/).length > 6 ? "…" : ""}`;
      }
      if (s && s.kind === "image") return "Slide: image";
      if (s && s.kind === "video") return "Slide: video";
      return "Slide: live";
    }
    case "logo":
      return "Logo: church logo";
    default:
      return `${meta.label}: live`;
  }
}
