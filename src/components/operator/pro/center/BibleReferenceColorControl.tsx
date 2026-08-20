"use client";
import { useEffect, useState } from "react";
import { Palette, X } from "lucide-react";
import { REFERENCE_COLOR_KEY, readReferenceColor } from "../operatorConstants";

/**
 * Reference-footer COLOUR control — sets the colour of "the scripture at the
 * bottom" independently of the verse text. Empty = use the theme's text colour
 * (default). Writes REFERENCE_COLOR_KEY + fires `presentflow:reference-color-changed`,
 * which OperatorConsole publishes on OutputState → the projector footer recolours.
 */
export function BibleReferenceColorControl() {
  const [color, setColor] = useState("");

  useEffect(() => {
    setColor(readReferenceColor());
    const onChange = (e: Event) => {
      const c = (e as CustomEvent<{ color?: string }>).detail?.color;
      if (typeof c === "string") setColor(c);
    };
    window.addEventListener("presentflow:reference-color-changed", onChange);
    return () => window.removeEventListener("presentflow:reference-color-changed", onChange);
  }, []);

  const change = (next: string) => {
    const v = /^#[0-9a-fA-F]{6}$/.test(next) ? next : "";
    setColor(v);
    try { localStorage.setItem(REFERENCE_COLOR_KEY, v); } catch { /* noop */ }
    try { window.dispatchEvent(new CustomEvent("presentflow:reference-color-changed", { detail: { color: v } })); } catch { /* noop */ }
  };

  const isSet = /^#[0-9a-fA-F]{6}$/.test(color);
  return (
    <div className="h-9 inline-flex items-center rounded-md border border-[var(--color-border)] overflow-hidden" title="Reference footer colour (empty = theme colour)">
      <span className="pl-2 pr-1 text-[var(--color-muted-foreground)]"><Palette className="w-3.5 h-3.5" /></span>
      <label className="h-full inline-flex items-center px-1 cursor-pointer hover:bg-[var(--color-elevated)]">
        <span
          className="w-4 h-4 rounded-full border border-[var(--color-border)]"
          style={{ background: isSet ? color : "linear-gradient(135deg,#fff 0 50%,#888 50% 100%)" }}
        />
        <input
          type="color"
          value={isSet ? color : "#ffffff"}
          onChange={(e) => change(e.target.value)}
          className="w-0 h-0 opacity-0 absolute"
          aria-label="Reference colour"
        />
      </label>
      {isSet && (
        <button
          onClick={() => change("")}
          className="h-full px-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-elevated)]"
          title="Use theme colour"
          aria-label="Reset reference colour"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
