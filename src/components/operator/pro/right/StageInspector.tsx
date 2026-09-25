"use client";
/**
 * StageInspector — the properties panel for ONE selected stage widget.
 *
 * ProPresenter's equivalent has Shape and Text tabs carrying align/distribute,
 * position, size, flip, rotation, opacity, and collapsible Fill / Stroke /
 * Shadow / Visibility sections. We deliberately ship LESS, because the user's
 * brief was "much, much, much simpler and less detailed" and because a
 * confidence monitor is not a slide:
 *
 *   - ROTATION and FLIP are dropped. A rotated confidence-monitor element is
 *     never wanted, and adding them means a model field, a wire field, a
 *     validator, a sanitiser and three output surfaces for zero operator value.
 *   - OPACITY is dropped. Half-transparent text at 15 metres is a legibility
 *     bug, not a feature.
 *   - PER-WIDGET FILL / STROKE / SHADOW are dropped. A layout has one
 *     background; per-widget fills let an operator paint a black box on a black
 *     screen and lose the widget entirely.
 *   - ALIGN / DISTRIBUTE is dropped: it only means anything with multi-select,
 *     and the canvas is single-select by design.
 *
 * That is a stated, deliberate non-parity decision under
 * docs/PRODUCT_DOCTRINE.md — not an oversight, and not a thing to quietly
 * "complete" later without asking whether an operator ever wanted it.
 *
 * WHAT WE ADD that ProPresenter has no equivalent for: the placement presets.
 * One tap for "lower third" beats typing four numbers, and that is our layer.
 */
import { clampRect, STAGE_SCALE_MIN, STAGE_SCALE_MAX, type StageWidget, type StageAlign } from "@/engine/stage";
import type { TimersApi } from "../hooks";

const field = "h-7 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[12px] w-full";
const label = "text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]";

/** Placement presets — "where do we want it" as one click each. */
export const PLACEMENTS: Array<{ id: string; label: string; rect: { x: number; y: number; w: number; h: number } }> = [
  { id: "full", label: "Full screen", rect: { x: 0.05, y: 0.2, w: 0.9, h: 0.6 } },
  { id: "upper", label: "Upper third", rect: { x: 0.05, y: 0.04, w: 0.9, h: 0.28 } },
  { id: "middle", label: "Middle", rect: { x: 0.05, y: 0.36, w: 0.9, h: 0.28 } },
  { id: "lower", label: "Lower third", rect: { x: 0.05, y: 0.68, w: 0.9, h: 0.28 } },
  { id: "tl", label: "Top left", rect: { x: 0.04, y: 0.04, w: 0.42, h: 0.2 } },
  { id: "tr", label: "Top right", rect: { x: 0.54, y: 0.04, w: 0.42, h: 0.2 } },
  { id: "bl", label: "Bottom left", rect: { x: 0.04, y: 0.76, w: 0.42, h: 0.2 } },
  { id: "br", label: "Bottom right", rect: { x: 0.54, y: 0.76, w: 0.42, h: 0.2 } },
];

/** A few colours an operator actually picks, so the common case is one tap. */
const SWATCHES: Array<{ hex: string; name: string }> = [
  { hex: "#ffffff", name: "White" }, { hex: "#fbbf24", name: "Amber" },
  { hex: "#ef4444", name: "Red" }, { hex: "#4ade80", name: "Green" },
  { hex: "#38bdf8", name: "Blue" }, { hex: "#a1a1aa", name: "Grey" },
];

/**
 * Position/size fields, shown as WHOLE PERCENTAGES of the screen.
 *
 * Percent, not pixels: our rects are normalised 0..1 precisely so a layout
 * reads the same on a 720p confidence TV and a 4K wall. Printing "960px" on a
 * 1280-wide monitor would be a number the operator acts on and that is simply
 * untrue. Percent is true at every resolution and is how people actually talk
 * ("put it halfway down").
 *
 * EVERY write goes through clampRect. This is load-bearing: the wire validator
 * rejects any rect component outside 0..1, and a rejected layout does not
 * degrade gracefully — isValidStageLayoutList drops the WHOLE list, so one
 * typo in one box would blank every confidence monitor at once.
 */
function RectFields({ w, onRect }: { w: StageWidget; onRect: (r: StageWidget["rect"]) => void }) {
  const pct = (n: number) => Math.round(n * 100);
  const set = (k: "x" | "y" | "w" | "h", raw: string) => {
    // An EMPTY field is a half-typed number, not zero. Number("") is 0, which
    // is finite, so backspacing to retype used to collapse the box to a 1%
    // sliver and rewrite the field to "1" under the operator's cursor.
    if (raw.trim() === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onRect(clampRect({ ...w.rect, [k]: n / 100 }));
  };
  return (
    <div className="grid grid-cols-2 gap-1">
      {(["x", "y", "w", "h"] as const).map((k) => (
        <label key={k} className="flex items-center gap-1">
          <span className="w-4 text-[10px] uppercase text-[var(--color-muted-foreground)]">{k}</span>
          <input type="number" inputMode="numeric" min={0} max={100} step={1} value={pct(w.rect[k])}
            onChange={(e) => set(k, e.target.value)}
            // Escape in a number field bubbled to the Dialog and popped
            // "Discard your changes?" over someone mid-edit.
            onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }}
            aria-label={`${k} position, percent`}
            className="h-7 px-1 w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded text-[12px] tabular-nums" />
          <span className="text-[10px] text-[var(--color-muted-foreground)]">%</span>
        </label>
      ))}
    </div>
  );
}

export function StageInspector({
  widget, timers, onPatch, onOrder,
}: {
  widget: StageWidget;
  timers: TimersApi;
  onPatch: (p: Partial<StageWidget>) => void;
  /** Move this widget forward/back through the stack. */
  onOrder: (dir: 1 | -1) => void;
}) {
  const w = widget;
  return (
    <div className="flex flex-col gap-3">
      {/* ── What it shows (kind-specific) ───────────────────────────────── */}
      {w.kind === "timer" && (
        <div>
          <div className={label}>Which timer</div>
          <select onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }} value={w.timerId ?? ""} onChange={(e) => onPatch({ timerId: e.target.value || null })} className={field}>
            <option value="">Not chosen</option>
            {timers.slots.map((s) => <option key={s.def.id} value={s.def.id}>{s.def.name}</option>)}
          </select>
        </div>
      )}
      {w.kind === "slide_preview" && (
        <div>
          <div className={label}>Preview which screen</div>
          {/* All four, not two: the model and the wire have always accepted
              livestream and ndi while the picker offered only main/stage. */}
          <select onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }} value={w.previewScreen ?? "main"}
            onChange={(e) => onPatch({ previewScreen: e.target.value as StageWidget["previewScreen"] })} className={field}>
            <option value="main">Projector</option>
            <option value="stage">Stage</option>
            <option value="livestream">Livestream</option>
            <option value="ndi">NDI</option>
          </select>
        </div>
      )}
      {w.kind === "static_text" && (
        <div>
          <div className={label}>Text</div>
          <input value={w.text ?? ""} onChange={(e) => onPatch({ text: e.target.value })} className={field} />
        </div>
      )}

      {/* ── Look ────────────────────────────────────────────────────────── */}
      <div>
        <div className={label}>Size</div>
        <div className="flex items-center gap-2">
          <button onClick={() => onPatch({ scale: Math.max(STAGE_SCALE_MIN, Number((w.scale - 0.2).toFixed(2))) })}
            aria-label="Smaller" className="w-7 h-7 rounded border border-[var(--color-border)] text-[11px]">A-</button>
          <input type="range" min={STAGE_SCALE_MIN} max={STAGE_SCALE_MAX} step={0.1} value={w.scale}
            onChange={(e) => onPatch({ scale: Number(e.target.value) })}
            aria-label="Text size" className="flex-1" />
          <button onClick={() => onPatch({ scale: Math.min(STAGE_SCALE_MAX, Number((w.scale + 0.2).toFixed(2))) })}
            aria-label="Bigger" className="w-7 h-7 rounded border border-[var(--color-border)] text-[13px]">A+</button>
          {/* A readout, because a bare slider cannot be set precisely or
              communicated to anyone else. */}
          <span className="w-8 text-right text-[11px] tabular-nums text-[var(--color-muted-foreground)]">
            {w.scale.toFixed(1)}×
          </span>
        </div>
      </div>

      <div>
        <div className={label}>Colour</div>
        <div className="flex items-center gap-1">
          {SWATCHES.map((c) => (
            // aria-pressed, and a NAME not a hex code: "Colour pound f b b f
            // two four" tells a screen-reader user nothing.
            <button key={c.hex} onClick={() => onPatch({ color: c.hex })}
              aria-label={`Colour: ${c.name}`} aria-pressed={w.color === c.hex} title={c.name}
              className={`w-7 h-7 rounded border ${w.color === c.hex ? "border-[var(--color-brand)] border-2" : "border-[var(--color-border)]"}`}
              style={{ background: c.hex }} />
          ))}
          <input type="color" value={w.color ?? "#ffffff"} onChange={(e) => onPatch({ color: e.target.value })}
            aria-label="Custom colour" className="w-6 h-6 bg-transparent border border-[var(--color-border)] rounded" />
        </div>
      </div>

      <div>
        <div className={label}>Align</div>
        <div className="flex gap-1">
          {(["left", "center", "right"] as StageAlign[]).map((a) => (
            <button key={a} onClick={() => onPatch({ align: a })}
              className={`flex-1 h-7 rounded text-[11px] capitalize ${w.align === a ? "bg-[var(--color-brand)] text-black" : "border border-[var(--color-border)]"}`}>
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* CAPITALS and the name label. Both fields existed on the model and were
          set by a built-in preset with NO control to write them — they reached
          a screen and an operator could not touch them. */}
      <label className="flex items-center gap-2 text-[11px]">
        <input type="checkbox" checked={w.uppercase === true} onChange={(e) => onPatch({ uppercase: e.target.checked })} />
        CAPITALS
      </label>
      {(w.kind === "timer" || w.kind === "clock") && (
        <>
          <label className="flex items-center gap-2 text-[11px]">
            <input type="checkbox" checked={w.showLabel === true} onChange={(e) => onPatch({ showLabel: e.target.checked })} />
            Show its name above
          </label>
          <div>
            <div className={label}>Time format</div>
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={w.showHours === true}
                onChange={(e) => onPatch({ showHours: e.target.checked ? true : undefined })} />
              Always show hours
            </label>
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={w.leadingZeros === true}
                onChange={(e) => onPatch({ leadingZeros: e.target.checked })} />
              Leading zeros
            </label>
          </div>
        </>
      )}

      {/* ── Where it sits ───────────────────────────────────────────────── */}
      <div className="border-t border-[var(--color-border)] pt-2">
        <div className={label}>Place it</div>
        <div className="grid grid-cols-4 gap-1 mb-2">
          {PLACEMENTS.map((p) => (
            <button key={p.id} onClick={() => onPatch({ rect: clampRect(p.rect) })} title={p.label}
              className="h-7 rounded border border-[var(--color-border)] text-[9px] leading-tight px-1">
              {p.label}
            </button>
          ))}
        </div>
        <RectFields w={w} onRect={(rect) => onPatch({ rect })} />
      </div>

      <div>
        <div className={label}>Layer</div>
        <div className="flex gap-1">
          {/* zIndex was assigned once at add-time and could never change, so two
              overlapping boxes were stuck in creation order forever and the
              lower one became unclickable. */}
          <button onClick={() => onOrder(1)} className="flex-1 h-7 rounded border border-[var(--color-border)] text-[11px]">
            Bring forward
          </button>
          <button onClick={() => onOrder(-1)} className="flex-1 h-7 rounded border border-[var(--color-border)] text-[11px]">
            Send back
          </button>
        </div>
      </div>
    </div>
  );
}
