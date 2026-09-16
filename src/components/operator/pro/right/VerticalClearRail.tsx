"use client";
/**
 * VerticalClearRail — the always-visible layer cue strip (Decoupling Phase 3b,
 * ProPresenter parity — Field feedback round 1 §b "CLEAR-CUES RAIL").
 *
 * ProPresenter shows a PERSISTENT vertical strip of layer cues at the right
 * edge of the screen — not hidden in a popover. One small cue per layer, LIT in
 * the layer's accent when that layer is showing live content.
 *
 * Wave 6F (field rec10/11/14): each cue is a NON-DESTRUCTIVE hide/show TOGGLE —
 * one control, two states (lit=live → click hides → click again restores),
 * matching the operator's repeated ask for "click-off / click-again-restore".
 * The DESTRUCTIVE clear (payload gone) stays available via the LayersPanel's
 * per-row trash and the guarded Clear All at the bottom of this rail. Tooltips
 * say "Hide/Show <layer>" honestly. This is the operator's primary "what's
 * live" dashboard and fastest recovery surface.
 *
 * This rail is TOGGLE + STATUS ONLY — swap / zone / destructive clear still live
 * in the full LayersPanel popover (opened from the RightIconBar). It reuses the
 * SAME useLiveLayers rows + actions as the panel (no duplicated state) via `ctx`.
 *
 * Gating: renders ONLY when `ctx.layersEngineOn` (global NEXT_PUBLIC_LAYERS_V2
 * kill-switch AND the church's `layersV2` opt-in) — identical gating to the
 * Layers panel. Flag off ⇒ this component returns null ⇒ zero DOM (and the
 * parent gates on the same flag so no empty column is reserved).
 *
 * No emojis — lucide icon components only; mirrors the RightIconBar idiom
 * (tokens, icon sizes, focus rings).
 */
import type { OperatorShellCtx } from "../../shell/types";
import type { LayerRow } from "../../useLiveLayers";
import { LAYER_META, liveDescription } from "./layerMeta";
import { ClearAllButton } from "./ClearAllButton";
import { setActiveBackgroundId } from "@/backgrounds/store/backgroundStore";

export function VerticalClearRail({ ctx }: { ctx: OperatorShellCtx }) {
  const { liveLayers, layersEngineOn } = ctx;
  if (!layersEngineOn) return null; // zero DOM when the engine is off

  return (
    <div
      className="shrink-0 w-10 border-l border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col items-center py-2 gap-1.5 overflow-y-auto pf-transcript-scroll"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Show or hide layers"
    >
      {liveLayers.rows.map((row) => (
        <LayerCue
          key={row.id}
          row={row}
          // A disabled layer is HIDDEN (eye-hide, non-destructive) vs CLEARED
          // (destructive, payload gone via the panel trash). Only the former can
          // be restored by a rail toggle; a cleared layer shows as idle.
          cleared={!row.enabled && !liveLayers.isEyeHidden(row.id)}
          desc={liveDescription(row, ctx)}
          onToggle={() => liveLayers.toggleLayer(row.id)}
        />
      ))}

      {/* Spacer pushes Clear All to the bottom of the rail. */}
      <div className="flex-1 min-h-2" />

      {/* Guarded Clear All (shared component, compact "cue" variant). Layers
          projectors clear per-layer via the hook; ALSO fire the legacy blank so
          pre-layers projectors clear too — identical semantics to LayersPanel. */}
      <ClearAllButton
        variant="cue"
        onClearAll={() => { setActiveBackgroundId("none"); liveLayers.clearAll(); ctx.onKill(); }}
      />
    </div>
  );
}

/** A single per-layer visibility cue: a square button LIT in the layer accent
 *  when the layer is showing live content, muted otherwise. Click is a
 *  NON-DESTRUCTIVE toggle — hide a live layer, click again to restore exactly
 *  what was there (same `toggleLayer` semantics as the LayersPanel eye). The
 *  destructive clear stays on the panel trash + the rail's Clear All. */
function LayerCue({
  row, cleared, desc, onToggle,
}: {
  row: LayerRow;
  cleared: boolean;
  desc: string;
  onToggle: () => void;
}) {
  const meta = LAYER_META[row.kind];
  const { Icon } = meta;
  // Honest tooltip: lit → Hide; hidden → Show; cleared → nothing to restore here.
  const label = cleared
    ? `${meta.label} cleared — restore from the Layers panel`
    : row.active
      ? row.id === "slide"
        ? `Hide ${meta.label} until the next slide — ${desc}`
        : `Hide ${meta.label} — ${desc}`
      : `Show ${meta.label}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={row.active}
      // ≥32px hit area (h-8 w-8). Focus ring mirrors RightIconBar.
      className="relative h-8 w-8 rounded flex items-center justify-center transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset"
      style={{
        // Lit in the layer accent when showing; muted border when hidden/idle.
        border: `1px solid ${row.active ? meta.accent : "var(--color-border)"}`,
        boxShadow: row.active ? `0 0 6px ${meta.accent}` : "none",
      }}
    >
      <Icon
        className="w-4 h-4"
        style={{ color: row.active ? meta.accent : "var(--color-muted-foreground)" }}
      />
    </button>
  );
}
