/**
 * src/engine/timers/overlay — pure Timer → TimerOverlay wire mapper (P4).
 *
 * Turns a definition + runtime into the EXISTING `TimerOverlay` wire shape the
 * three output surfaces already render. Keeps the wire's `kind` union
 * ("countdown" | "elapsed") by folding countdown_to → "countdown" (it displays
 * identically — a signed remaining value). Pure + deterministic.
 */
import type { TimerOverlay, OverlayPosition } from "@/lib/broadcast";
import {
  type TimerDefinition,
  type TimerRuntime,
  computeRemainingSec,
  isOverrun,
} from "./index";

export function timerToOverlay(
  def: TimerDefinition,
  rt: TimerRuntime,
  nowMs: number,
  position: OverlayPosition,
): Extract<TimerOverlay, { clear?: false }> {
  const remaining = computeRemainingSec(def, rt, nowMs);
  return {
    id: def.id,
    name: def.name,
    // Clamp to the wire bounds (isValidTimerOverlay: -3600..86400).
    remainingSec: Math.max(-3600, Math.min(24 * 60 * 60, Math.round(remaining))),
    running: def.type === "countdown_to" ? true : rt.running,
    kind: def.type === "elapsed" ? "elapsed" : "countdown",
    position,
    overrun: isOverrun(def, rt, nowMs),
  };
}

/** A clear overlay for one named timer. */
export function timerClearOverlay(id: string): TimerOverlay {
  return { clear: true, id };
}
