"use client";
/**
 * ClearAllButton — the guarded "Clear All" control, shared by the full
 * LayersPanel popover AND the always-visible VerticalClearRail (extracted so
 * the two surfaces cannot drift apart on the guard semantics).
 *
 * Deliberately guarded: press and HOLD for 300ms; a fill animation (GPU
 * transform, Y8) confirms the hold, then it fires. A quick tap does nothing
 * (matches spec §22.1 "Clear All = X with 300ms hold"). Distinct destructive
 * styling.
 *
 * `variant`:
 *   - "bar"  — the wide labelled button used inside the LayersPanel popover.
 *   - "cue"  — a compact square X cue used at the bottom of the vertical rail.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const CLEAR_ALL_HOLD_MS = 300;

export function ClearAllButton({
  onClearAll, variant = "bar",
}: {
  onClearAll: () => void;
  variant?: "bar" | "cue";
}) {
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

  // Unmount cleanup: if the surface closes mid-hold, cancel the pending timer so
  // it can't fire Clear All (and setState) after the component is gone.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const common = {
    type: "button" as const,
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === "Enter" || e.key === " ") && !holding) start(); },
    onKeyUp: cancel,
    title: "Hold to clear all layers",
    "aria-label": "Hold to clear all layers",
  };

  if (variant === "cue") {
    return (
      <button
        {...common}
        className="relative h-8 w-8 rounded overflow-hidden border border-red-500/40 text-red-300 flex items-center justify-center select-none touch-none hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset"
      >
        {/* Fill animation while holding — GPU-friendly transform: scaleX (Y8). */}
        <span
          aria-hidden
          className="absolute inset-0 bg-red-500/30 origin-bottom"
          style={{
            transform: holding ? "scaleY(1)" : "scaleY(0)",
            transition: holding ? `transform ${CLEAR_ALL_HOLD_MS}ms linear` : "transform 120ms ease-out",
          }}
        />
        <X className="relative w-4 h-4" />
      </button>
    );
  }

  return (
    <button
      {...common}
      className="relative m-2 h-9 rounded-md overflow-hidden border border-red-500/40 text-red-300 text-[12px] font-semibold uppercase tracking-wider select-none touch-none"
    >
      {/* Fill animation while holding — GPU-friendly transform: scaleX (Y8). */}
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 right-0 bg-red-500/30 origin-left")}
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
