"use client";
// Shared <option> lists for every font picker (Fonts P1, 2026-09-17).
// One registry-driven list everywhere; a stored value the registry cannot place
// is shown as "Keep current: <value>" so opening a picker never silently
// changes what was saved.
import { fontStack, pickerOptionsFor, weightOptionsFor, type PickerOptionView } from "@/lib/fonts/registry";

// Re-exported so a picker imports its <option>s and its selected VALUE from one
// place. Every <select> that renders <FontOptions> MUST set
// value={selectedFontValue(stored)} — a stored CSS stack ("Georgia, serif",
// which is exactly what themeConfigToAppearance and the ThemesTab swatches
// produce) is not itself an option value, so binding the raw stored string makes
// the select fall back to showing the FIRST option and silently misreport the
// font (and overwrite it on the next save). test/fonts-picker-value.test.ts
// pins that every picker routes through this.
export { selectedFontValue } from "@/lib/fonts/registry";

const GROUP_LABEL = {
  bundled: "PresentFlow fonts (same on every computer)",
  system: "System fonts (vary by computer)",
} as const;

/**
 * Font <option>s, grouped so the operator can see which fonts are guaranteed to
 * look the same on the church's other machines. Each option renders its own
 * NAME in its own face — the names here are short and Latin, so they stay
 * readable at 12px / 150% Windows scaling; we deliberately do not append a
 * sample string, which is what becomes unreadable in a display face at that size.
 * The coverage hint is plain text in the system UI font, appended to the label
 * (an <option> cannot carry mixed styling reliably across browsers).
 */
export function FontOptions({ current }: { current: string | null | undefined }) {
  const opts = pickerOptionsFor(current);
  const group = (g: PickerOptionView["group"]) => opts.filter((o) => o.group === g);
  const render = (o: PickerOptionView) => (
    <option key={o.value} value={o.value} style={{ fontFamily: fontStack(o.value) }}>
      {o.hint ? `${o.label} — ${o.hint}` : o.label}
    </option>
  );
  return (
    <>
      {group("current").map(render)}
      {(["bundled", "system"] as const).map((g) =>
        group(g).length ? (
          <optgroup key={g} label={GROUP_LABEL[g]}>
            {group(g).map(render)}
          </optgroup>
        ) : null,
      )}
    </>
  );
}

/** Weight <option>s: the font's real weights (plus the stored weight if it isn't one). */
export function WeightOptions({ font, current, fallback }: { font: string | null | undefined; current?: number; fallback?: number[] }) {
  return (
    <>
      {weightOptionsFor(font, current, fallback).map((w) => <option key={w} value={w}>{w}</option>)}
    </>
  );
}
