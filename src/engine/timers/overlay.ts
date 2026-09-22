/**
 * src/engine/timers/overlay — the ONE Timer → TimerOverlay mapping. PURE.
 *
 * This file used to be a SECOND implementation: the operator shell hand-rolled
 * the same mapping inline, and the two had already drifted (this one had no
 * scale and no colour). An uncalled pure function is not "available for later",
 * it is a copy waiting to disagree with the real one — so the shell now calls
 * THIS, and there is one place where a timer becomes a wire overlay.
 */
import type { TimerOverlay, OverlayPosition } from "@/lib/broadcast";
import {
  type TimerDefinition,
  type TimerRuntime,
  computeRemainingSec,
  isOverrun,
  resolveTimerColor,
  triggerValueFor,
} from "./index";
import { sanitizeTimerScreens, type TimerScreenId } from "./screens";

/** What the mapping needs. Declared structurally so the engine stays free of
 *  any React import. */
export type OverlayableSlot = {
  def: TimerDefinition;
  runtime: TimerRuntime;
  appearance: {
    position: OverlayPosition;
    scale: number;
    color?: string;
    overrunColor?: string;
    showLabel: boolean;
    showHours?: boolean;
    leadingZeros: boolean;
    colorTriggers: Array<{ atSec: number; color: string }>;
    /** Undefined ⇒ every screen. */
    screens?: readonly TimerScreenId[];
  };
};

export function timerToOverlay(s: OverlayableSlot, nowMs: number): Extract<TimerOverlay, { clear?: false }> {
  const a = s.appearance;
  const remaining = computeRemainingSec(s.def, s.runtime, nowMs);
  // Colour triggers judge TIME LEFT. An elapsed timer counts UP, so
  // triggerValueFor converts — without it every trigger fires backwards.
  const tv = triggerValueFor(s.def, remaining);
  const color = tv === null ? a.color : resolveTimerColor(a, tv);
  return {
    id: s.def.id,
    // An absent name IS "no label" to every renderer. ProPresenter never puts
    // the timer's name on an output unless the operator asks.
    ...(a.showLabel === false ? {} : { name: s.def.name }),
    // Clamp to the wire bounds (isValidTimerOverlay: -3600..86400).
    remainingSec: Math.max(-3600, Math.min(24 * 60 * 60, Math.round(remaining))),
    running: s.runtime.running,
    kind: s.def.type === "elapsed" ? "elapsed" : "countdown",
    position: a.position,
    overrun: isOverrun(s.def, s.runtime, nowMs),
    scale: a.scale,
    ...(color ? { color } : {}),
    ...(a.showHours !== undefined ? { showHours: a.showHours } : {}),
    leadingZeros: a.leadingZeros,
    // Same-machine path carries routing too — otherwise the operator's own
    // projector would ignore a choice their stage screen honoured.
    ...(sanitizeTimerScreens(a.screens) ? { screens: sanitizeTimerScreens(a.screens) } : {}),
  };
}

/** A clear overlay for one named timer. */
export function timerClearOverlay(id: string): TimerOverlay {
  return { clear: true, id };
}
