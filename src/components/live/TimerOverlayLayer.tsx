"use client";
/**
 * TimerOverlayLayer — the ONE timer renderer, shared by every output surface
 * (2026-09-21).
 *
 * WHY THIS EXISTS: /live, /stage and /livestream each had their own inline
 * copy of the timer markup AND its own hand-rolled MM:SS formatter, while /ndi
 * had no timer rendering at all. They had already drifted:
 *   - all three printed MM:SS with NO hours, so a 90-minute sermon timer read
 *     "90:00" on the screens while the operator's panel read "1:30:00"
 *   - /stage and /livestream ignored `position` entirely and hardcoded a corner
 *   - /livestream's legacy slot hardcoded white, ignoring the operator's colour
 *
 * The user's requirement is that a timer looks the SAME on every screen unless
 * the operator deliberately made them differ, so there must be exactly one
 * implementation. Formatting comes from the pure engine (`formatTimerClock`),
 * the same function the operator panel uses — so what they set is what shows.
 *
 * Surfaces differ ONLY where that is a deliberate, documented choice (see
 * `density`), never by accident.
 *
 * NOTE: operator-only state is NOT printed here. A "(paused)" suffix used to
 * render beside the name, which put "PRE-SERVICE COUNTDOWN (paused)" on the
 * congregation's screen. Paused state belongs in the operator panel.
 */
import { useEffect, useState } from "react";
import {
  formatTimerClock, computeRemainingSec, isOverrun, resolveTimerColor, triggerValueFor,
  type TimerDefinition, type TimerRuntime,
} from "@/engine/timers";
import type { OverlayPosition, TimerWire } from "@/lib/broadcast";
import { senderNow, type ClockSync } from "@/lib/timer-clock";

export type TimerOverlayItem = {
  id?: string;
  name?: string;
  remainingSec: number;
  running: boolean;
  kind?: "countdown" | "elapsed";
  position?: OverlayPosition;
  overrun?: boolean;
  scale?: number;
  color?: string;
  showHours?: boolean;
  leadingZeros?: boolean;
};

/**
 * A stage confidence monitor is read from the platform a few feet away and
 * shares the screen with lyrics, so it uses a tighter type scale. The projector
 * and stream are full-frame. This is the ONLY sanctioned difference between
 * surfaces, and it scales both surfaces off the SAME operator `scale` value.
 */
export type TimerDensity = "full" | "compact";

const POS_CLASS: Record<OverlayPosition, string> = {
  "top-left": "top-[6%] left-[6%] items-start",
  "top-right": "top-[6%] right-[6%] items-end",
  "bottom-left": "bottom-[6%] left-[6%] items-start",
  "bottom-right": "bottom-[6%] right-[6%] items-end",
  "lower-third": "bottom-[18%] left-0 right-0 items-center",
  "center": "top-1/2 -translate-y-1/2 left-0 right-0 items-center",
};

/** Type scale per density. `full` matches what /live already shipped, so the
 *  projector is visually unchanged for anyone not using the new controls. */
const SIZES: Record<TimerDensity, { clock: number; label: number; gap: string }> = {
  full: { clock: 7, label: 1.4, gap: "gap-[3vh]" },
  compact: { clock: 4.5, label: 0.9, gap: "gap-[1.5vh]" },
};

const DEFAULT_COLOR = "#ffffff";
const OVERRUN_COLOR = "#f87171";

/** True once past zero. Prefers the explicit flag; falls back to the value so
 *  an older wire without `overrun` still styles correctly. */
function isOver(t: TimerOverlayItem): boolean {
  return t.overrun ?? t.remainingSec < 0;
}

function TimerValue({ t, density }: { t: TimerOverlayItem; density: TimerDensity }) {
  const size = SIZES[density];
  const scale = t.scale ?? 1;
  // The operator's resolved colour wins (it already includes Color Triggers,
  // resolved operator-side). Only fall back to the overrun red when they have
  // not chosen one, so a deliberate colour is never overridden.
  const color = t.color ?? (isOver(t) ? OVERRUN_COLOR : DEFAULT_COLOR);
  return (
    <div className="flex flex-col leading-none" style={{ alignItems: "inherit" }}>
      {t.name && (
        <div className="uppercase tracking-[0.15em] font-semibold"
          style={{ color, opacity: 0.75, fontSize: `${size.label * scale}vw`, textShadow: "0 2px 10px rgba(0,0,0,0.6)" }}>
          {t.name}
        </div>
      )}
      <div className="font-mono font-bold tabular-nums"
        style={{ color, fontSize: `${size.clock * scale}vw`, lineHeight: 1, textShadow: "0 4px 18px rgba(0,0,0,0.65)" }}>
        {/* The SAME formatter the operator panel uses — hours appear past an
            hour instead of a bare "90:00" — honouring the operator's format. */}
        {formatTimerClock(t.remainingSec, { showHours: t.showHours, leadingZeros: t.leadingZeros })}
      </div>
    </div>
  );
}

/**
 * Renders every shown timer, grouped by position so several in one corner stack
 * instead of overlapping. `fallbackPosition` is what a timer with no explicit
 * position gets — top-right everywhere, matching what /live already did.
 */
/** Turn a wire timer into a renderable item by TICKING IT LOCALLY. This is the
 *  whole networked design: the operator sends an anchor, not a number, and each
 *  screen computes the value itself — which is also why colour triggers keep
 *  firing on a remote screen, where a frozen value could never cross one.
 *  `nowMs` must already be in the SENDER's clock domain. */
function wireToItem(w: TimerWire, nowMs: number): TimerOverlayItem {
  const def: TimerDefinition = {
    id: w.id, name: w.name ?? "", type: w.type, durationSec: w.durationSec,
    targetMs: w.targetMs ?? null, allowsOverrun: w.allowsOverrun,
    elapsedStartSec: w.elapsedStartSec, elapsedEndSec: w.elapsedEndSec,
  };
  const rt: TimerRuntime = { running: w.running, anchorMs: w.anchorMs, baseSec: w.baseSec };
  const remainingSec = computeRemainingSec(def, rt, nowMs);
  const tv = triggerValueFor(def, remainingSec);
  const color = tv === null
    ? w.color
    : resolveTimerColor({ color: w.color, overrunColor: w.overrunColor, colorTriggers: w.colorTriggers ?? [] }, tv);
  return {
    id: w.id, name: w.name, remainingSec, running: w.running,
    kind: w.type === "elapsed" ? "elapsed" : "countdown",
    position: w.position, overrun: isOverrun(def, rt, nowMs),
    scale: w.scale, color, showHours: w.showHours, leadingZeros: w.leadingZeros,
  };
}

export function TimerOverlayLayer({
  timers,
  wireTimers,
  clockSync = null,
  density = "full",
  fallbackPosition = "top-right",
  className = "",
}: {
  /** Already-computed, from the same-machine 1Hz path. */
  timers: TimerOverlayItem[];
  /** Anchors from OutputState.timersWire, ticked locally here. */
  wireTimers?: TimerWire[];
  clockSync?: ClockSync | null;
  density?: TimerDensity;
  fallbackPosition?: OverlayPosition;
  className?: string;
}) {
  // Tick ONLY when there is something to tick, so a surface with no remote
  // timers mounts no interval and renders exactly as it did before.
  const hasWire = (wireTimers?.length ?? 0) > 0;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasWire) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [hasWire]);

  // SAME-MACHINE ALWAYS WINS. On the operator's own box a timer arrives twice —
  // once on the zero-latency local channel, once via OutputState. Rule 8 says
  // the local path is primary, so the wire copy only ever FILLS A GAP. One id,
  // one entry: a timer can never render twice, and the two cannot fight.
  const localIds = new Set(timers.map((t) => t.id ?? "default"));
  const now = senderNow(clockSync);
  const merged = hasWire
    ? [...timers, ...wireTimers!.filter((w) => !localIds.has(w.id)).map((w) => wireToItem(w, now))]
    : timers;

  if (merged.length === 0) return null;
  const groups = new Map<OverlayPosition, TimerOverlayItem[]>();
  for (const t of merged) {
    const p = t.position ?? fallbackPosition;
    const list = groups.get(p);
    if (list) list.push(t); else groups.set(p, [t]);
  }
  return (
    <>
      {[...groups.entries()].map(([pos, items]) => (
        <div key={pos}
          className={`absolute ${POS_CLASS[pos]} pointer-events-none z-20 flex flex-col ${SIZES[density].gap} ${className}`}>
          {items.map((t, i) => <TimerValue key={t.id ?? `legacy-${i}`} t={t} density={density} />)}
        </div>
      ))}
    </>
  );
}
