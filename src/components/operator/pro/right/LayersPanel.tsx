"use client";
/**
 * LayersPanel — the operator Layers strip (Decoupling Phase 3, ProPresenter
 * parity §1/§16/§22.1). Shows the LIVE layer stack top-to-bottom with a lit
 * "what's live" indicator per layer, per-layer clear + visibility toggle, a
 * background "swap" that reuses the existing Background Templates picker, a
 * slide zone control (Full / Lower third), and a guarded press-and-HOLD
 * Clear All.
 *
 * Gating: rendered ONLY when `ctx.layersEngineOn` (global NEXT_PUBLIC_LAYERS_V2
 * kill-switch AND the church's `layersV2` opt-in). The RightIconBar hides the
 * entry entirely when the env kill-switch is off (zero DOM), and shows a
 * disabled affordance with an explanatory tooltip when the env flag is on but
 * the church has not opted in. No emojis — lucide icon components only.
 */
import { useCallback, useRef, useState } from "react";
import {
  Image as ImageIcon, Video, Type, Award, Megaphone, Clock, MessageSquare,
  Eye, EyeOff, Trash2, RectangleHorizontal, Square, Layers as LayersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { LayerRow } from "../../useLiveLayers";
import type { LayerWire } from "@/lib/broadcast";
import { BackgroundSelector } from "@/backgrounds/components/BackgroundSelector";

const CLEAR_ALL_HOLD_MS = 300;

// Per-layer accent colours (via --pf-* / --color-* tokens where possible; the
// accents themselves are fixed hues so each layer reads distinctly at a glance).
const LAYER_META: Record<LayerWire["kind"], { label: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; accent: string }> = {
  background: { label: "Background", Icon: ImageIcon, accent: "#8b5cf6" },
  camera:     { label: "Camera",     Icon: Video,     accent: "#06b6d4" },
  slide:      { label: "Slide",      Icon: Type,      accent: "#f59e0b" },
  media:      { label: "Media",      Icon: ImageIcon, accent: "#10b981" },
  logo:       { label: "Logo",       Icon: Award,     accent: "#eab308" },
  announcement:{ label: "Announcement", Icon: Megaphone, accent: "#ef4444" },
  band:       { label: "Band",       Icon: RectangleHorizontal, accent: "#ec4899" },
  timer:      { label: "Timer",      Icon: Clock,     accent: "#3b82f6" },
  message:    { label: "Message",    Icon: MessageSquare, accent: "#a3a3a3" },
};

export function LayersPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const { liveLayers, layersEngineOn } = ctx;
  const [swapOpen, setSwapOpen] = useState(false);

  if (!layersEngineOn) {
    return (
      <div className="p-3 text-[12px] text-[var(--color-muted-foreground)]" role="note">
        The layers engine is not enabled for this church. Ask an admin to turn on
        Layers (Output engine) in settings to control background, camera, slide
        and logo independently while live.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-2 h-7 border-b border-[var(--color-border)]">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] flex items-center gap-1">
          <LayersIcon className="w-3 h-3" /> Layers
        </span>
        <span className="text-[10px] text-[var(--color-muted-foreground)]">lit = live</span>
      </div>

      <div className="flex flex-col divide-y divide-[var(--color-border)]">
        {liveLayers.rows.map((row) => (
          <LayerRowView
            key={row.id}
            row={row}
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
  row, onToggle, onClear, onZone, onSwap, swapOpen,
}: {
  row: LayerRow;
  onToggle: () => void;
  onClear: () => void;
  onZone: (full: boolean) => void;
  onSwap?: () => void;
  swapOpen?: boolean;
}) {
  const meta = LAYER_META[row.kind] ?? LAYER_META.slide;
  const { Icon } = meta;
  const isLowerThird = row.zone.kind === "lowerThird";

  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
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
          onClick={() => onZone(isLowerThird)}
          title={isLowerThird ? "Lower third — tap for full" : "Full — tap for lower third"}
          aria-label={isLowerThird ? "Switch slide to full" : "Switch slide to lower third"}
          className="p-1 rounded hover:bg-white/5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
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
          className={cn("p-1 rounded hover:bg-white/5", swapOpen ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
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
        className="p-1 rounded hover:bg-white/5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        {row.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      </button>

      {/* Per-layer clear. */}
      <button
        type="button"
        onClick={onClear}
        title={`Clear ${meta.label}`}
        aria-label={`Clear ${meta.label}`}
        className="p-1 rounded hover:bg-white/5 text-[var(--color-muted-foreground)] hover:text-red-400"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * Clear All — deliberately guarded. Press and HOLD for 300ms; a fill animation
 * confirms the hold, then it fires. A quick tap does nothing (matches spec
 * §22.1 "Clear All = X with 300ms hold"). Distinct destructive styling.
 */
function ClearAllButton({ onClearAll }: { onClearAll: () => void }) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const start = useCallback(() => {
    firedRef.current = false;
    setHolding(true);
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setHolding(false);
      onClearAll();
    }, CLEAR_ALL_HOLD_MS);
  }, [onClearAll]);

  const cancel = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setHolding(false);
  }, []);

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
      {/* Fill animation while holding. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-red-500/30"
        style={{
          width: holding ? "100%" : "0%",
          transition: holding ? `width ${CLEAR_ALL_HOLD_MS}ms linear` : "width 120ms ease-out",
        }}
      />
      <span className="relative flex items-center justify-center gap-1.5">
        <Trash2 className="w-3.5 h-3.5" /> Hold to clear all
      </span>
    </button>
  );
}
