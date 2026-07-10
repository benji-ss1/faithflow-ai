"use client";
import { useEffect, useRef, useState } from "react";
import { ensureEffectKeyframes, getEffect, type EffectId } from "@/lib/effects";
import type { TransitionSpec } from "@/lib/broadcast";

/**
 * Wraps a projector-side slide render and replays an "enter" animation
 * whenever the identity key changes. When `transition` is null we render
 * children with no animation to preserve legacy behavior.
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
  const [animKey, setAnimKey] = useState(0);
  const prevRef = useRef<string>(identityKey);

  useEffect(() => { ensureEffectKeyframes(); }, []);

  useEffect(() => {
    if (prevRef.current !== identityKey) {
      prevRef.current = identityKey;
      setAnimKey((k) => k + 1);
    }
  }, [identityKey]);

  const eff = transition ? getEffect(transition.effectId as EffectId) : null;
  const animation = eff && transition
    ? eff.css(transition.durationMs, transition.easing).in
    : undefined;

  return (
    <div key={animKey} style={{ width: "100%", height: "100%", animation }}>
      {children}
    </div>
  );
}
