"use client";
import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { REFERENCE_SCALE_KEY, readReferenceScale, REFERENCE_SCALE_MIN, REFERENCE_SCALE_MAX, REFERENCE_SCALE_STEP } from "../operatorConstants";

/**
 * Reference-footer size stepper — sizes "the scripture at the bottom" (the
 * Book Ch:Verse (TRANS) footer) INDEPENDENTLY of the verse text size, so the
 * operator can make it as big or small as they like. Writes REFERENCE_SCALE_KEY
 * + fires `presentflow:reference-scale-changed`, which OperatorConsole publishes
 * on OutputState → the projector footer sizes to match.
 */
export function BibleReferenceSizeControl() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(readReferenceScale());
    const onChange = (e: Event) => {
      const s = (e as CustomEvent<{ scale?: number }>).detail?.scale;
      if (typeof s === "number") setScale(s);
    };
    window.addEventListener("presentflow:reference-scale-changed", onChange);
    return () => window.removeEventListener("presentflow:reference-scale-changed", onChange);
  }, []);

  const change = (next: number) => {
    const clamped = Math.max(REFERENCE_SCALE_MIN, Math.min(REFERENCE_SCALE_MAX, Math.round(next * 100) / 100));
    setScale(clamped);
    try { localStorage.setItem(REFERENCE_SCALE_KEY, String(clamped)); } catch { /* noop */ }
    try { window.dispatchEvent(new CustomEvent("presentflow:reference-scale-changed", { detail: { scale: clamped } })); } catch { /* noop */ }
  };

  const isDefault = Math.abs(scale - 1) < 1e-6;
  return (
    <div
      className="h-9 inline-flex items-center rounded-md border border-[var(--color-border)] overflow-hidden"
      title="Reference footer size (the Book Chapter:Verse line at the bottom)"
    >
      <span className="pl-2 pr-1 text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">Ref</span>
      <button
        onClick={() => change(scale - REFERENCE_SCALE_STEP)}
        disabled={scale <= REFERENCE_SCALE_MIN + 1e-6}
        className="h-full px-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-elevated)] disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Smaller reference"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => change(1)}
        className="h-full px-1.5 min-w-[42px] text-[11px] font-mono text-[var(--color-foreground)] hover:bg-[var(--color-elevated)]"
        title="Reset reference size"
      >
        {isDefault ? "100%" : `${Math.round(scale * 100)}%`}
      </button>
      <button
        onClick={() => change(scale + REFERENCE_SCALE_STEP)}
        disabled={scale >= REFERENCE_SCALE_MAX - 1e-6}
        className="h-full px-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-elevated)] disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Larger reference"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
