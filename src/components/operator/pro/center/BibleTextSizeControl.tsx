"use client";
import { useEffect, useState } from "react";
import { Minus, Plus, Type } from "lucide-react";
import { FONT_SCALE_KEY, readFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP } from "../operatorConstants";

/**
 * Compact verse text-size stepper for the Bible bar — the same font-scale the
 * TopBar A−/A+ controls, surfaced right where the operator is working so they can
 * size the projected verse (and its reference footer, which scales with it)
 * without hunting. Writes the shared FONT_SCALE_KEY + fires the same
 * `presentflow:font-scale-changed` event OperatorConsole syncs to the projector,
 * so it stays in lockstep with the TopBar control.
 */
export function BibleTextSizeControl() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(readFontScale());
    const onChange = (e: Event) => {
      const s = (e as CustomEvent<{ scale?: number }>).detail?.scale;
      if (typeof s === "number") setScale(s);
    };
    window.addEventListener("presentflow:font-scale-changed", onChange);
    return () => window.removeEventListener("presentflow:font-scale-changed", onChange);
  }, []);

  const change = (next: number) => {
    const clamped = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, Math.round(next * 100) / 100));
    setScale(clamped);
    try { localStorage.setItem(FONT_SCALE_KEY, String(clamped)); } catch { /* noop */ }
    try { window.dispatchEvent(new CustomEvent("presentflow:font-scale-changed", { detail: { scale: clamped } })); } catch { /* noop */ }
  };

  const isAuto = Math.abs(scale - 1) < 1e-6;
  return (
    <div
      className="h-9 inline-flex items-center rounded-md border border-[var(--color-border)] overflow-hidden"
      title="Projected verse text size (also scales the reference footer)"
    >
      <span className="pl-2 pr-1 text-[var(--color-muted-foreground)]"><Type className="w-3.5 h-3.5" /></span>
      <button
        onClick={() => change(scale - FONT_SCALE_STEP)}
        disabled={scale <= FONT_SCALE_MIN + 1e-6}
        className="h-full px-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-elevated)] disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Smaller verse text"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => change(1)}
        className="h-full px-1.5 min-w-[42px] text-[11px] font-mono text-[var(--color-foreground)] hover:bg-[var(--color-elevated)]"
        title="Reset to auto"
      >
        {isAuto ? "AUTO" : `${Math.round(scale * 100)}%`}
      </button>
      <button
        onClick={() => change(scale + FONT_SCALE_STEP)}
        disabled={scale >= FONT_SCALE_MAX - 1e-6}
        className="h-full px-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-elevated)] disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Larger verse text"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
