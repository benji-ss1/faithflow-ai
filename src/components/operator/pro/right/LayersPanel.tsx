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
import { useState } from "react";
import {
  Image as ImageIcon, Eye, EyeOff, Trash2, RectangleHorizontal, Square,
  RotateCw, ListOrdered,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { slideOutputIdentity } from "@/lib/broadcast";
import type { OperatorShellCtx } from "../../shell/types";
import type { LayerRow } from "../../useLiveLayers";
import { BackgroundSelector } from "@/backgrounds/components/BackgroundSelector";
import { setActiveBackgroundId } from "@/backgrounds/store/backgroundStore";
import { LAYER_META, HIT, liveDescription } from "./layerMeta";
import { ClearAllButton } from "./ClearAllButton";

export function LayersPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const { liveLayers, layersEngineOn } = ctx;
  const [swapOpen, setSwapOpen] = useState(false);
  const [slideActionsOpen, setSlideActionsOpen] = useState(false);
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
            // A disabled layer is either HIDDEN (eye-hide, non-destructive,
            // content preserved) or CLEARED (destructive, payload gone). Only the
            // former is in the off-wire eyeHidden set.
            cleared={!row.enabled && !liveLayers.isEyeHidden(row.id)}
            liveDesc={liveDescription(row, ctx)}
            liveSlideIsText={liveSlideIsText}
            onToggle={() => liveLayers.toggleLayer(row.id)}
            onClear={() => {
              // Clearing the background layer ALSO resets the Background Template
              // store to None so the base BackgroundSpec goes away on every
              // projector (layersV2 or not) AND the legacy Themes/background UI
              // shows None — honest single-source-of-truth clear, no divergence.
              if (row.kind === "background") setActiveBackgroundId("none");
              liveLayers.clearLayer(row.id);
            }}
            onZone={(full) => liveLayers.setZone(row.id, full ? { kind: "full" } : { kind: "lowerThird" })}
            onSwap={row.kind === "background" ? () => { setSwapOpen((v) => !v); setSlideActionsOpen(false); } : undefined}
            swapOpen={row.kind === "background" && swapOpen}
            onSlideActions={row.kind === "slide" ? () => { setSlideActionsOpen((v) => !v); setSwapOpen(false); } : undefined}
            slideActionsOpen={row.kind === "slide" && slideActionsOpen}
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

      {/* Slide content actions — mirrors the background "swap" idiom. Re-send the
          current live slide (a hard, forced re-project) + jump-to-slide chips for
          the slides in the currently-live item. */}
      {slideActionsOpen && <SlideActions ctx={ctx} />}

      <ClearAllButton
        onClearAll={() => {
          // Layers projectors clear per-layer via the hook; ALSO fire the legacy
          // blank so pre-layers projectors (church not on layers) clear too.
          setActiveBackgroundId("none"); // reset the Background Template store too
          liveLayers.clearAll();
          ctx.onKill();
        }}
      />
    </div>
  );
}

function LayerRowView({
  row, cleared, liveDesc, liveSlideIsText, onToggle, onClear, onZone, onSwap, swapOpen,
  onSlideActions, slideActionsOpen,
}: {
  row: LayerRow;
  cleared: boolean;
  liveDesc: string;
  liveSlideIsText: boolean;
  onToggle: () => void;
  onClear: () => void;
  onZone: (full: boolean) => void;
  onSwap?: () => void;
  swapOpen?: boolean;
  onSlideActions?: () => void;
  slideActionsOpen?: boolean;
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
      <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-[12px] min-w-0 truncate",
            row.enabled
              ? "text-[var(--color-foreground)]"
              : cleared
                // CLEARED: no line-through (nothing to "un-strike"); dimmed.
                ? "text-[var(--color-muted-foreground)] opacity-60"
                // HIDDEN: struck through — the content is still there, just off.
                : "text-[var(--color-muted-foreground)] line-through",
          )}
        >
          {meta.label}
        </span>
        {cleared && (
          <span className="shrink-0 text-[9px] uppercase tracking-wider text-[var(--color-muted-foreground)] opacity-60">
            Cleared
          </span>
        )}
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

      {/* Slide content actions — mirrors the background "swap" affordance. */}
      {onSlideActions && (
        <button
          type="button"
          onClick={onSlideActions}
          title="Slide actions"
          aria-label="Slide actions"
          aria-expanded={slideActionsOpen}
          className={cn(HIT, "hover:bg-white/5", slideActionsOpen ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
        >
          <ListOrdered className="w-3.5 h-3.5" />
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
        title={row.enabled ? "Hide layer" : cleared ? "Layer cleared — re-enable to show content again" : "Show layer"}
        aria-label={row.enabled ? `Hide ${meta.label}` : cleared ? `Re-enable ${meta.label}` : `Show ${meta.label}`}
        className={cn(
          HIT,
          "hover:bg-white/5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
          // A cleared layer's eye is dimmed — visibility isn't the reason it's dark.
          cleared && "opacity-40",
        )}
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
 * Slide-row content actions — the slide-layer analogue of the background "swap"
 * picker. Small + functional: a hard RE-SEND of the current live slide (forced,
 * so it re-projects even if identity is unchanged — useful after a hide/clear or
 * a projector reconnect), plus jump-to-slide chips for the slides in the item
 * that is currently live. Clicking a chip projects that slide live (instant,
 * forced). No emojis; --pf/token-driven, matching the panel idiom.
 */
function SlideActions({ ctx }: { ctx: OperatorShellCtx }) {
  const item = ctx.plan.items[ctx.liveItemIdx];
  const slides = item?.slides ?? [];
  const liveId = ctx.liveSlide ? slideOutputIdentity(ctx.liveSlide) : null;
  const canResend = ctx.liveSlide?.kind !== "empty";

  return (
    <div className="border-t border-[var(--color-border)] p-2 flex flex-col gap-2">
      <button
        type="button"
        disabled={!canResend}
        onClick={() => ctx.onSendSlideToLive(ctx.liveSlide, null, { instant: true, force: true })}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 h-8 rounded text-[12px] font-medium transition-colors",
          canResend
            ? "bg-white/5 text-[var(--color-foreground)] hover:bg-white/10"
            : "bg-white/5 text-[var(--color-muted-foreground)] opacity-40 cursor-not-allowed",
        )}
        title={canResend ? "Re-project the current live slide" : "Nothing is live to re-send"}
      >
        <RotateCw className="w-3.5 h-3.5" /> Re-send current
      </button>

      {slides.length > 0 ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] px-0.5 pb-1 truncate" title={item?.title || "Current item"}>
            Jump · {item?.title || "Current item"}
          </div>
          <div className="flex flex-wrap gap-1">
            {slides.map((s, i) => {
              const isLive = liveId != null && slideOutputIdentity(s) === liveId;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => ctx.onSendSlideToLive(s, null, { instant: true, force: true })}
                  title={`Project slide ${i + 1} live`}
                  aria-label={`Project slide ${i + 1} live`}
                  aria-current={isLive || undefined}
                  className={cn(
                    "h-7 min-w-7 px-2 rounded text-[12px] font-mono tabular-nums transition-colors",
                    isLive
                      ? "bg-[var(--color-brand)] text-white"
                      : "bg-white/5 text-[var(--color-muted-foreground)] hover:bg-white/10 hover:text-[var(--color-foreground)]",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-[var(--color-muted-foreground)] px-0.5">
          No slides in the current item to jump to.
        </div>
      )}
    </div>
  );
}
