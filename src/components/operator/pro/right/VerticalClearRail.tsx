"use client";
/**
 * VerticalClearRail — the always-visible "clear cues" strip (Decoupling Phase
 * 3b, ProPresenter parity — Field feedback round 1 §b "CLEAR-CUES RAIL").
 *
 * ProPresenter shows a PERSISTENT vertical strip of clear cues at the right
 * edge of the screen — not hidden in a popover. One small cue per layer, LIT in
 * the layer's accent when that layer has live content ("if it's red it's
 * activated with content"); clicking a cue clears THAT layer; a bottom X cue is
 * the guarded Clear All. This is the operator's primary "what's live" dashboard
 * and fastest error-recovery surface.
 *
 * This rail is CLEAR + STATUS ONLY — swap / zone / visibility still live in the
 * full LayersPanel popover (opened from the RightIconBar). It reuses the SAME
 * useLiveLayers rows + actions as the panel (no duplicated state) via `ctx`.
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

export function VerticalClearRail({ ctx }: { ctx: OperatorShellCtx }) {
  const { liveLayers, layersEngineOn } = ctx;
  if (!layersEngineOn) return null; // zero DOM when the engine is off

  return (
    <div
      className="shrink-0 w-10 border-l border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col items-center py-2 gap-1.5 overflow-y-auto pf-transcript-scroll"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Clear layers"
    >
      {liveLayers.rows.map((row) => (
        <ClearCue
          key={row.id}
          row={row}
          desc={liveDescription(row, ctx)}
          onClear={() => liveLayers.clearLayer(row.id)}
        />
      ))}

      {/* Spacer pushes Clear All to the bottom of the rail. */}
      <div className="flex-1 min-h-2" />

      {/* Guarded Clear All (shared component, compact "cue" variant). Layers
          projectors clear per-layer via the hook; ALSO fire the legacy blank so
          pre-layers projectors clear too — identical semantics to LayersPanel. */}
      <ClearAllButton
        variant="cue"
        onClearAll={() => { liveLayers.clearAll(); ctx.onKill(); }}
      />
    </div>
  );
}

/** A single per-layer clear cue: a square button LIT in the layer accent when
 *  the layer has live content, idle (muted) otherwise. Click clears the layer
 *  (same semantics as the LayersPanel per-row clear). */
function ClearCue({
  row, desc, onClear,
}: {
  row: LayerRow;
  desc: string;
  onClear: () => void;
}) {
  const meta = LAYER_META[row.kind];
  const { Icon } = meta;
  const label = `Clear ${meta.label} — ${desc}`;
  return (
    <button
      type="button"
      onClick={onClear}
      title={label}
      aria-label={label}
      // ≥32px hit area (h-8 w-8). Focus ring mirrors RightIconBar.
      className="relative h-8 w-8 rounded flex items-center justify-center transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset"
      style={{
        // Lit in the layer accent when active; muted border when idle.
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
