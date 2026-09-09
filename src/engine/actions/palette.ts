/**
 * src/engine/actions/palette.ts — Phase 4: the ONE action palette.
 *
 * Single source of truth for the operator-facing "add an action" menu, shared by
 * BOTH surfaces that build ActionSpecs: the Automations editor (MacrosTab — offers
 * every entry, guarded included) and the per-slide Actions menu (SlideGrid — offers
 * `slideSafe` entries only). The `slideSafe` flag mirrors the engine invariant
 * `!isGuardedSpec(make())` (a slide action can never be destructive) — so the two
 * palettes can never drift out of sync with the save/dispatch guards.
 *
 * Pure data + factories. No React, no server import.
 */
import type { ActionSpec } from "./spec";

export interface PaletteEntry {
  label: string;
  make: () => ActionSpec;
  /** True iff this action is permitted as a per-slide auto-fire (non-destructive).
   *  Guarded (blank/kill/clear_all_layers) entries are `false`. */
  slideSafe: boolean;
}

/** The full palette (Automations editor shows all of these). */
export const ACTION_PALETTE: PaletteEntry[] = [
  { label: "Switch background: none", make: () => ({ type: "set_background", spec: null }), slideSafe: true },
  { label: "Clear background layer", make: () => ({ type: "clear_layer", layerId: "background" }), slideSafe: true },
  { label: "Clear slide layer", make: () => ({ type: "clear_layer", layerId: "slide" }), slideSafe: true },
  { label: "Start timer (default)", make: () => ({ type: "timer", timerId: "default", command: "start" }), slideSafe: true },
  { label: "Stop timer (default)", make: () => ({ type: "timer", timerId: "default", command: "stop" }), slideSafe: true },
  { label: "Reset timer (default)", make: () => ({ type: "timer", timerId: "default", command: "reset" }), slideSafe: true },
  { label: "Show message…", make: () => ({ type: "show_message", text: "Message" }), slideSafe: true },
  { label: "Clear message", make: () => ({ type: "clear_message" }), slideSafe: true },
  { label: "Show logo", make: () => ({ type: "logo" }), slideSafe: true },
  { label: "Clear lower third", make: () => ({ type: "clear_lower_third" }), slideSafe: true },
  { label: "Blank (guarded)", make: () => ({ type: "blank" }), slideSafe: false },
  { label: "Kill / clear all output (guarded)", make: () => ({ type: "kill" }), slideSafe: false },
  { label: "Clear all layers (guarded)", make: () => ({ type: "clear_all_layers" }), slideSafe: false },
];

/** The subset offered on a slide (non-destructive only). */
export const SLIDE_SAFE_PALETTE: PaletteEntry[] = ACTION_PALETTE.filter((e) => e.slideSafe);
