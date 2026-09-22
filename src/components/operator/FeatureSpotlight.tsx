"use client";

/**
 * Feature spotlight — rings a real control so a new operator can SEE where a
 * feature lives instead of guessing.
 *
 * Why this exists: What's New could already say "Try it →" and navigate, but
 * it dropped you on a dense operator screen with no indication of which of the
 * ~40 controls it meant. The `?highlight=` param it appended was read by
 * nothing.
 *
 * Now: `?highlight=<name>` (or a `presentflow:spotlight` event) rings the
 * element carrying `data-vic="<name>"`, reusing the SAME orange ring Vic's
 * guided tour draws, so the two features look like one idea rather than two.
 *
 * Deliberately undemanding:
 *   - purely additive; nothing renders unless asked
 *   - never blocks the UI (pointer-events: none, no overlay/scrim)
 *   - if the target does not exist it gives up quietly after a short retry
 *     window rather than leaving a stray ring or throwing
 *   - dismisses on click, Esc, scroll or after a few seconds
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/** How long the ring stays before fading on its own. */
const VISIBLE_MS = 6000;
/** The target may mount a moment after navigation — keep looking briefly. */
const FIND_TIMEOUT_MS = 4000;
const FIND_INTERVAL_MS = 120;

export function FeatureSpotlight() {
  const params = useSearchParams();
  const [target, setTarget] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setTarget(null);
    setRect(null);
  }, [clearTimers]);

  // Source 1: ?highlight= on arrival (What's New "Try it →" across routes).
  useEffect(() => {
    const h = params?.get("highlight");
    if (h) setTarget(h);
  }, [params]);

  // Source 2: a same-route request (no navigation happened).
  useEffect(() => {
    const onSpotlight = (e: Event) => {
      const name = (e as CustomEvent<{ target?: string }>).detail?.target;
      if (name) setTarget(name);
    };
    window.addEventListener("presentflow:spotlight", onSpotlight);
    return () => window.removeEventListener("presentflow:spotlight", onSpotlight);
  }, []);

  // Locate the control, retrying while the panel mounts.
  useLayoutEffect(() => {
    if (!target) return;
    clearTimers();
    let found = false;
    const started = Date.now();

    const measure = () => {
      const el = document.querySelector(`[data-vic="${CSS.escape(target)}"]`) as HTMLElement | null;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      // A zero-size box means it is present but not laid out (collapsed
      // panel) — keep waiting rather than ringing nothing.
      if (r.width === 0 && r.height === 0) return false;
      setRect(r);
      return true;
    };

    const tick = () => {
      if (measure()) {
        if (!found) {
          found = true;
          timers.current.push(window.setTimeout(dismiss, VISIBLE_MS));
        }
        timers.current.push(window.setTimeout(tick, 250)); // track layout shifts
        return;
      }
      if (Date.now() - started > FIND_TIMEOUT_MS) { dismiss(); return; }
      timers.current.push(window.setTimeout(tick, FIND_INTERVAL_MS));
    };
    tick();
    return clearTimers;
  }, [target, dismiss, clearTimers]);

  // Any deliberate interaction ends it.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [target, dismiss]);

  if (!target || !rect) return null;

  // Label sits below the control, or above when there is no room.
  const below = rect.bottom + 8;
  const labelTop = below + 40 > window.innerHeight ? rect.top - 34 : below;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]" aria-hidden>
      <div
        className="absolute rounded-xl border-2 border-orange-400 shadow-[0_0_0_4px_rgba(249,115,22,.18),0_0_30px_rgba(249,115,22,.38)] transition-all duration-200"
        style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
      />
      <div
        className="absolute rounded-md bg-[#171311]/95 px-2.5 py-1.5 text-[11px] font-semibold text-orange-200 shadow-lg ring-1 ring-orange-300/40"
        style={{ left: Math.max(8, Math.min(rect.left - 4, window.innerWidth - 200)), top: labelTop }}
      >
        Here it is
      </div>
    </div>
  );
}
