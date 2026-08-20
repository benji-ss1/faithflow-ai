"use client";
import { useEffect, useRef } from "react";
import { ensureEffectKeyframes, getEffect, type EffectId } from "@/lib/effects";
import type { TransitionSpec } from "@/lib/broadcast";

/**
 * Wraps a projector-side slide render and plays an "enter" animation exactly
 * ONCE per real content change — even under stress (rapid verse calling, 1 Hz
 * OutputState heartbeats, appearance/video churn).
 *
 * Layered guarantees:
 *  1. The frame is remounted (React `key={identityKey}` on TransitionFrame) only
 *     when the slide CONTENT changes, so a NEW verse mounts a fresh frame and
 *     animates once.
 *  2. FREEZE (2026-08-19): the animation string is captured ONCE at mount into a
 *     ref, so a later change to the `transition` PROP on already-mounted content
 *     cannot restart the CSS animation.
 *  3. IDEMPOTENT-PER-CONTENT (2026-08-20): a module-level record of recently-
 *     animated identityKeys. If the SAME content's frame remounts within a short
 *     window — which happens when the `hasVideoBackground(videoInput, appearance)`
 *     branch on the projector flips between the `set` message (stale
 *     appearance/videoInput) and the follow-up `output` message (fresh), or on
 *     any OutputState re-post that crosses that boundary — the enter animation is
 *     SUPPRESSED. Net: the fade plays exactly once for a verse, never "again and
 *     again". A genuinely fresh projection of the same reference more than
 *     ANIM_SUPPRESS_MS later still animates.
 *
 * When `transition` is null the child swaps instantly with no animation.
 */

// identityKey -> last-animated epoch ms. Module-level so it survives frame
// remounts (the whole point). Pruned on each read; bounded by the few keys
// active in any window.
const recentlyAnimated = new Map<string, number>();
const ANIM_SUPPRESS_MS = 2500;

export function TransitionWrapper({
  identityKey,
  transition,
  children,
}: {
  identityKey: string;
  transition?: TransitionSpec | null;
  children: React.ReactNode;
}) {
  useEffect(() => { ensureEffectKeyframes(); }, []);
  return (
    <TransitionFrame key={identityKey} identityKey={identityKey} transition={transition}>
      {children}
    </TransitionFrame>
  );
}

function TransitionFrame({
  identityKey,
  transition,
  children,
}: {
  identityKey: string;
  transition?: TransitionSpec | null;
  children: React.ReactNode;
}) {
  // Compute the enter animation ONCE at mount. Sentinel `null` = "not computed
  // yet"; `""` = "computed, no animation".
  const animationRef = useRef<string | null>(null);
  if (animationRef.current === null) {
    const now = Date.now();
    for (const [k, t] of recentlyAnimated) if (now - t > ANIM_SUPPRESS_MS) recentlyAnimated.delete(k);
    const suppressed = recentlyAnimated.has(identityKey);
    const eff = !suppressed && transition ? getEffect(transition.effectId as EffectId) : null;
    animationRef.current = eff && transition
      ? eff.css(transition.durationMs, transition.easing).in
      : "";
    // Record that THIS content has now animated (or was intentionally shown
    // without animation), so an immediate remount of the same content won't
    // replay it.
    recentlyAnimated.set(identityKey, now);
  }
  return (
    <div style={{ width: "100%", height: "100%", animation: animationRef.current || undefined }}>
      {children}
    </div>
  );
}
