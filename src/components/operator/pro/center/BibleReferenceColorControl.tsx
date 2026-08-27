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
    <div className="h-9 inline-flex items-center gap-0.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-1 shadow-[var(--edge-top),var(--shadow-sm)] transition-all duration-150 [transition-timing-function:var(--ease-spring)] hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--edge-top),var(--shadow-md)]" title="Reference footer colour (empty = theme colour)">
      <span className="pl-1 pr-0.5 text-[var(--color-muted-foreground)]"><Palette className="w-3.5 h-3.5" /></span>
      <label className="h-7 inline-flex items-center rounded-lg px-1.5 cursor-pointer hover:bg-[var(--color-brand)]/10">
        <span
          className="w-4 h-4 rounded-full border border-[var(--color-border)] shadow-[var(--shadow-sm)]"
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
          className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-[var(--color-muted-foreground)] transition-transform duration-150 [transition-timing-function:var(--ease-spring)] hover:bg-[var(--color-brand)]/10 hover:text-[var(--color-foreground)] active:scale-90"
          title="Use theme colour"
          aria-label="Reset reference colour"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
