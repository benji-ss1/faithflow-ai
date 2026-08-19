"use client";
import { useEffect, useRef } from "react";
import { ensureEffectKeyframes, getEffect, type EffectId } from "@/lib/effects";
import type { TransitionSpec } from "@/lib/broadcast";

/**
 * Wraps a projector-side slide render and plays an "enter" animation exactly
 * ONCE per real content change.
 *
 * The frame is remounted (React `key={identityKey}` in the parent) only when the
 * slide CONTENT changes, so the enter animation plays once for each new slide.
 *
 * JITTER FIX (2026-08-12): the remount key is `identityKey` derived during
 * render — NOT bumped in a post-paint effect — so React remounts pre-paint and
 * the new verse's first painted frame is the animation's opacity-0 start (one
 * clean fade-in, no double-paint flash).
 *
 * FADE-PULSE FIX (2026-08-19): previously the `animation` inline style was
 * recomputed from the `transition` prop on EVERY render and applied to the div.
 * Changing that string on an element that is NOT remounting restarts the CSS
 * animation. While a verse was held on the projector and the AI kept
 * re-detecting it, the operator's published `transition` field alternated
 * (AI_AUTO_TRANSITION ↔ configured spec) with a byte-identical slide — so the
 * enter fade replayed on a loop and the audience saw the scripture pulse
 * (fade out/in) every few seconds. The animation is now FROZEN at mount inside
 * `TransitionFrame`, so a later transition-prop change on already-mounted
 * content can never restart it; only a genuine content change (new mount)
 * plays the transition captured at that moment. When `transition` is null the
 * child swaps instantly with no animation.
 */
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
    <TransitionFrame key={identityKey} transition={transition}>
      {children}
    </TransitionFrame>
  );
}

function TransitionFrame({
  transition,
  children,
}: {
  transition?: TransitionSpec | null;
  children: React.ReactNode;
}) {
  // Freeze the enter animation at MOUNT. This frame only mounts for a NEW
  // identityKey (see parent), so the animation reflects the transition in
  // effect when THIS content became live and never restarts afterwards.
  // Sentinel `null` = "not computed yet"; `""` = "computed, no animation".
  const animationRef = useRef<string | null>(null);
  if (animationRef.current === null) {
    const eff = transition ? getEffect(transition.effectId as EffectId) : null;
    animationRef.current = eff && transition
      ? eff.css(transition.durationMs, transition.easing).in
      : "";
  }
  return (
    <div style={{ width: "100%", height: "100%", animation: animationRef.current || undefined }}>
      {children}
    </div>
  );
}
