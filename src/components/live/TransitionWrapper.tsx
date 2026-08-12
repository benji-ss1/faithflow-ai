"use client";
import { useEffect } from "react";
import { ensureEffectKeyframes, getEffect, type EffectId } from "@/lib/effects";
import type { TransitionSpec } from "@/lib/broadcast";

/**
 * Wraps a projector-side slide render and replays an "enter" animation
 * whenever the identity key changes. When `transition` is null we render
 * children with no animation to preserve legacy behavior.
 *
 * JITTER FIX (2026-08-12): the remount key is `identityKey` DIRECTLY, derived
 * during render — NOT bumped in a post-paint effect. The old effect-based
 * approach double-painted every new slide: render A updated the div in place →
 * the browser painted the new verse fully (opacity 1, no animation); then the
 * post-paint effect bumped the key → render B remounted and played the enter
 * animation from opacity 0. The audience saw the verse APPEAR, then blink to
 * invisible and fade back in. Keying on `identityKey` makes React remount
 * during render (pre-paint), so the new verse's FIRST painted frame is the
 * animation's opacity-0 start → one clean fade-in, no flash. A repeat of the
 * same content keeps the same key → no spurious re-animation (same as before);
 * a null transition just swaps instantly.
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

  const eff = transition ? getEffect(transition.effectId as EffectId) : null;
  const animation = eff && transition
    ? eff.css(transition.durationMs, transition.easing).in
    : undefined;

  return (
    <div key={identityKey} style={{ width: "100%", height: "100%", animation }}>
      {children}
    </div>
  );
}
