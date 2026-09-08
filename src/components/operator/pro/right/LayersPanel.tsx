"use client";
/**
 * LayersPanel — the operator Layers strip (Decoupling Phase 3, ProPresenter
 * parity §1/§16/§22.1/Ch8). Shows the LIVE layer stack top-to-bottom with a lit
 * "what's live" indicator per layer, per-layer clear + visibility toggle, a
 * background "swap" that reuses the existing Background Templates picker, a
 * slide zone control (Full / Lower third), and a guarded press-and-HOLD Clear
 * All. Each row has a "what's live" hover tooltip describing its current
 * content, and its Clear button lights with the layer accent while the layer is
 * live (Ch8 error-recovery dashboard).
 *
 * Gating: rendered ONLY when `ctx.layersEngineOn` (global NEXT_PUBLIC_LAYERS_V2
 * kill-switch AND the church's `layersV2` opt-in). The RightIconBar hides the
 * entry entirely when the env kill-switch is off (zero DOM), and shows a
 * disabled affordance when the env flag is on but the church has not opted in.
 * No emojis — lucide icon components only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon, Video, Type, Award, Megaphone, Clock, MessageSquare,
  Eye, EyeOff, Trash2, RectangleHorizontal, Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { LayerRow } from "../../useLiveLayers";
import type { LayerWire } from "@/lib/broadcast";
import { BackgroundSelector } from "@/backgrounds/components/BackgroundSelector";

const CLEAR_ALL_HOLD_MS = 300;

// Per-layer accent colours, referenced from the app token stylesheet
// (--pf-layer-* in src/app/globals.css) so the hues live in one place. Each
// layer reads distinctly at a glance. NOTE (Y6): `background/camera/slide/logo`
// are the kinds the derived stack surfaces TODAY; `media/announcement/band/
// timer/message` are kept here so the map is exhaustive over LayerKind (and a
// future Phase 3+ layer that reaches the panel already has an accent/icon) —
// they are not currently produced by outputStateToLayers.
const LAYER_META: Record<LayerWire["kind"], { label: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; accent: string }> = {
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
// blow-up, so the icons stay 14px but the tap area is finger-friendly.
const HIT = "inline-flex items-center justify-center h-8 w-8 rounded shrink-0";

/** Cheap "what's live" one-liner for a layer's current content (Y10 tooltip). */
function liveDescription(row: LayerRow, ctx: OperatorShellCtx): string {
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

export function LayersPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const { liveLayers, layersEngineOn } = ctx;
  const [swapOpen, setSwapOpen] = useState(false);
  const liveSlideIsText = ctx.liveSlide?.kind === "text";

  if (!layersEngineOn) {
    // Honest early-access copy (Y13) — no reference to a settings toggle that
    // does not exist yet. Enabling is admin/back-office only for now.
    return (
      <div className="p-3 text-[12px] leading-relaxed text-[var(--color-muted-foreground)]" role="note">
        The layers engine is in early access. It lets you control background,
        camera, slide and logo independently while live. Contact PresentFlow to
        enable it for your church.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Legend inline (Y12 — no duplicate title; PopoverShell already titles it). */}
      <div className="flex items-center justify-end px-2 h-6">
        <span className="text-[10px] text-[var(--color-muted-foreground)]">lit = live</span>
      </div>

      <div className="flex flex-col divide-y divide-[var(--color-border)]">
        {liveLayers.rows.map((row) => (
          <LayerRowView
            key={row.id}
            row={row}
            liveDesc={liveDescription(row, ctx)}
            liveSlideIsText={liveSlideIsText}
            onToggle={() => liveLayers.toggleLayer(row.id)}
            onClear={() => liveLayers.clearLayer(row.id)}
            onZone={(full) => liveLayers.setZone(row.id, full ? { kind: "full" } : { kind: "lowerThird" })}
            onSwap={row.kind === "background" ? () => setSwapOpen((v) => !v) : undefined}
            swapOpen={row.kind === "background" && swapOpen}
          />
        ))}
      </div>

      {/* Background Templates picker — reused, not rebuilt. Applies to the base
          background layer live via the existing background store. */}
      {swapOpen && (
        <div className="border-t border-[var(--color-border)] p-2 max-h-[280px] overflow-y-auto pf-transcript-scroll">
          <BackgroundSelector />
        </div>
      )}

      <ClearAllButton
        onClearAll={() => {
          // Layers projectors clear per-layer via the hook; ALSO fire the legacy
          // blank so pre-layers projectors (church not on layers) clear too.
          liveLayers.clearAll();
          ctx.onKill();
        }}
      />
    </div>
  );
}

function LayerRowView({
  row, liveDesc, liveSlideIsText, onToggle, onClear, onZone, onSwap, swapOpen,
}: {
  row: LayerRow;
  liveDesc: string;
  liveSlideIsText: boolean;
  onToggle: () => void;
  onClear: () => void;
  onZone: (full: boolean) => void;
  onSwap?: () => void;
  swapOpen?: boolean;
}) {
  const meta = LAYER_META[row.kind];
  const { Icon } = meta;
  const isLowerThird = row.zone.kind === "lowerThird";
  // Y9: zones only mean something for text slides — disable with a tooltip when
  // the live slide payload isn't text (image/video/empty), where lowerThird is
  // a silent no-op on the projector.
  const zoneDisabled = row.kind === "slide" && !liveSlideIsText;

  return (
    // Y10: a "what's live" hover tooltip on the whole row.
    <div className="flex items-center gap-1.5 px-2 py-1" title={liveDesc}>
      {/* Live indicator — lit when the layer has active content. */}
      <span
        aria-label={row.active ? `${meta.label} is live` : `${meta.label} is idle`}
        className="w-2 h-2 rounded-full shrink-0 transition-[background,box-shadow] duration-150"
        style={{
          background: row.active ? meta.accent : "var(--color-border)",
          boxShadow: row.active ? `0 0 8px ${meta.accent}` : "none",
        }}
      />
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: row.active ? meta.accent : "var(--color-muted-foreground)" }} />
      <span className={cn("text-[12px] flex-1 min-w-0 truncate", row.enabled ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] line-through")}>
        {meta.label}
      </span>

      {/* Slide zone toggle (Full / Lower third). */}
      {row.kind === "slide" && (
        <button
          type="button"
          onClick={() => { if (!zoneDisabled) onZone(isLowerThird); }}
          disabled={zoneDisabled}
          title={zoneDisabled ? "Zones apply to text slides" : (isLowerThird ? "Lower third — tap for full" : "Full — tap for lower third")}
          aria-label={zoneDisabled ? "Zones apply to text slides" : (isLowerThird ? "Switch slide to full" : "Switch slide to lower third")}
          className={cn(HIT, "text-[var(--color-muted-foreground)]", zoneDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-white/5 hover:text-[var(--color-foreground)]")}
        >
          {isLowerThird ? <RectangleHorizontal className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        </button>
      )}

      {/* Background swap — reuse the Background Templates picker. */}
      {onSwap && (
        <button
          type="button"
          onClick={onSwap}
          title="Swap background"
          aria-label="Swap background"
          aria-expanded={swapOpen}
          className={cn(HIT, "hover:bg-white/5", swapOpen ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
        >
          <ImageIcon className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Visibility toggle. */}
      <button
        type="button"
        onClick={onToggle}
        title={row.enabled ? "Hide layer" : "Show layer"}
        aria-label={row.enabled ? `Hide ${meta.label}` : `Show ${meta.label}`}
        className={cn(HIT, "hover:bg-white/5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
      >
        {row.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      </button>

      {/* Per-layer clear. Extra left margin separates it from Hide (Y14). The
          icon lights with the layer accent while the layer is live (Y10/Ch8). */}
      <button
        type="button"
        onClick={onClear}
        title={`Clear ${meta.label}`}
        aria-label={`Clear ${meta.label}`}
        className={cn(HIT, "ml-1 hover:bg-white/5 hover:text-red-400")}
        style={{ color: row.active ? meta.accent : "var(--color-muted-foreground)" }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * Clear All — deliberately guarded. Press and HOLD for 300ms; a fill animation
 * (GPU transform, Y8) confirms the hold, then it fires. A quick tap does
 * nothing (matches spec §22.1 "Clear All = X with 300ms hold"). Distinct
 * destructive styling.
 */
function ClearAllButton({ onClearAll }: { onClearAll: () => void }) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const start = useCallback(() => {
    // Y8: guard against a second pointerdown while a hold is already timing —
    // clear any existing timer first so we can never stack two timeouts (and
    // thus never double-fire onClearAll).
    clearTimer();
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onClearAll();
    }, CLEAR_ALL_HOLD_MS);
  }, [onClearAll, clearTimer]);

  const cancel = useCallback(() => {
    clearTimer();
    setHolding(false);
  }, [clearTimer]);

  // Unmount cleanup: if the popover closes mid-hold, cancel the pending timer so
  // it can't fire Clear All (and setState) after the component is gone.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !holding) start(); }}
      onKeyUp={cancel}
      title="Hold to clear all layers"
      aria-label="Hold to clear all layers"
      className="relative m-2 h-9 rounded-md overflow-hidden border border-red-500/40 text-red-300 text-[12px] font-semibold uppercase tracking-wider select-none touch-none"
    >
      {/* Fill animation while holding — GPU-friendly transform: scaleX (Y8). */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 right-0 bg-red-500/30 origin-left"
        style={{
          transform: holding ? "scaleX(1)" : "scaleX(0)",
          transition: holding ? `transform ${CLEAR_ALL_HOLD_MS}ms linear` : "transform 120ms ease-out",
        }}
      />
      <span className="relative flex items-center justify-center gap-1.5">
        <Trash2 className="w-3.5 h-3.5" /> Hold to clear all
      </span>
    </button>
  );
}
