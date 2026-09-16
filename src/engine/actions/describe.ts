/**
 * src/engine/actions/describe.ts — shared, pure helpers for rendering an
 * ActionSpec in UI (Automations panel, slide-action badges).
 *
 * `describeSpec` is copied from MacrosTab.tsx's local describer (so both
 * surfaces can share one source) with an optional resolved macro name.
 * `specKey` is a stable, key-order-independent string for React keys / dedupe.
 * No React, no server imports.
 */
import type { ActionSpec } from "./spec";

/** Human label for a spec. `macroName` (when the caller resolved the id) is
 *  shown instead of the raw macro id. */
export function describeSpec(s: ActionSpec, macroName?: string): string {
  switch (s.type) {
    case "timer": return `Timer ${s.command} · ${s.timerId}`;
    case "show_message": return `Show message: “${s.text.slice(0, 24)}”`;
    case "clear_message": return "Clear message";
    case "clear_layer": return `Clear layer: ${s.layerId}`;
    case "set_background": return s.spec ? "Set background" : "Set background: none";
    case "set_background_media": return `Set background media: ${s.assetRef?.fileName ?? "asset"}`;
    case "send_lower_third": return "Send lower third";
    case "clear_lower_third": return "Clear lower third";
    case "set_announcement": return "Set announcement";
    case "set_transition": return "Set transition";
    case "logo": return "Show logo";
    case "blank": return "Blank";
    case "kill": return "Kill / clear all";
    case "clear_all_layers": return "Clear all layers";
    case "scene": return `Switch scene to ${s.sceneId}`;
    case "macro": return macroName ? `Run automation: ${macroName}` : `Run automation ${s.macroId}`;
    default: return "Action";
  }
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (o[k] !== undefined) out[k] = canonical(o[k]);
    }
    return out;
  }
  return v;
}

/** Stable string key for a spec: identical content ⇒ identical key regardless
 *  of property insertion order. */
export function specKey(spec: ActionSpec | unknown): string {
  try { return JSON.stringify(canonical(spec)); } catch { return "invalid"; }
}
