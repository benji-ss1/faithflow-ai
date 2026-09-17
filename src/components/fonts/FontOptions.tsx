"use client";
// Shared <option> lists for every font picker (Fonts P1, 2026-09-17).
// One registry-driven list everywhere; a stored value that is not in the list is
// shown as "(current) <value>" so opening a picker never silently changes it.
import { fontStack, pickerOptionsFor, weightOptionsFor } from "@/lib/fonts/registry";

/** Font <option>s, each label rendered in its own face. */
export function FontOptions({ current }: { current: string | null | undefined }) {
  return (
    <>
      {pickerOptionsFor(current).map((o) => (
        <option key={o.value} value={o.value} style={{ fontFamily: fontStack(o.value) }}>{o.label}</option>
      ))}
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
