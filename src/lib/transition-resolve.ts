// Theme → Projector (PR 2): which transition a live send uses.
//
// Decision 3 (signed off 2026-09-17) — resolved ONCE per send and sticky while
// that slide is live:
//   instant (Bible card clicks, hard cut) → AI/voice auto (150ms fade)
//   → operator master Off switch → the resolved theme's transition (ONLY when
//   that theme sets one) → the operator's global transition.
// Pure; the localStorage read is isolated in readOperatorTransitionsOff.
import { AI_AUTO_TRANSITION, isValidTransitionSpec, type TransitionSpec } from "./broadcast";
import { getEffect } from "./effects";
import { TRANSITION_KEY, TRANSITION_NAME_TO_EFFECT_ID } from "./transition-names";

const EASING_RE = /^[a-zA-Z0-9(),.\s%-]{1,64}$/;

/**
 * A theme config's transition as a wire-valid spec.
 *  - undefined → the theme sets no transition (fall through to the operator's)
 *  - null      → the theme explicitly chose "Cut"
 * Handles PR 1's saved shape where `effectId` held the display name ("Fade").
 */
export function normalizeThemeTransition(cfg: unknown): TransitionSpec | null | undefined {
  if (!cfg || typeof cfg !== "object") return undefined;
  const c = cfg as Record<string, unknown>;
  const t = c.transition;
  if (!t || typeof t !== "object" || Array.isArray(t)) return undefined;
  const p = t as Record<string, unknown>;
  const rawName = typeof p.name === "string" ? p.name : undefined;
  const rawEffect = typeof p.effectId === "string" ? p.effectId : undefined;
  let name: string | undefined;
  let effectId: string | null | undefined;
  const byName = (n: string | undefined) => (n !== undefined && Object.prototype.hasOwnProperty.call(TRANSITION_NAME_TO_EFFECT_ID, n) ? n : undefined);
  const knownName = byName(rawName) ?? byName(rawEffect);
  if (knownName) {
    name = knownName;
    effectId = TRANSITION_NAME_TO_EFFECT_ID[knownName];
  } else if (rawEffect && getEffect(rawEffect)) {
    // A real effect id — find a whitelisted display name for it.
    effectId = rawEffect;
    name = Object.keys(TRANSITION_NAME_TO_EFFECT_ID).find((k) => TRANSITION_NAME_TO_EFFECT_ID[k] === rawEffect);
    if (!name) return undefined;
  } else {
    return undefined;
  }
  if (effectId === null) return null; // Cut
  const durRaw = typeof p.durationMs === "number" && Number.isFinite(p.durationMs)
    ? p.durationMs
    : typeof c.transitionDurationMs === "number" && Number.isFinite(c.transitionDurationMs) ? c.transitionDurationMs : 300;
  const durationMs = Math.round(Math.max(0, Math.min(5000, durRaw)));
  const easing = typeof p.easing === "string" && EASING_RE.test(p.easing) ? p.easing : "ease-in-out";
  const spec: TransitionSpec = { effectId: effectId as string, durationMs, easing, name };
  return isValidTransitionSpec(spec) ? spec : undefined;
}

export type SendTransitionInput = {
  instant?: boolean;
  aiAuto?: boolean;
  operatorOff?: boolean;
  /** normalizeThemeTransition() of the resolved theme (undefined = sets none). */
  themeTransition?: TransitionSpec | null;
  /** The operator's global transition (explicit spec for this send, else current). */
  operatorSpec: TransitionSpec | null;
};

export function resolveSendTransition(i: SendTransitionInput): TransitionSpec | null {
  if (i.instant) return null;
  if (i.aiAuto) return AI_AUTO_TRANSITION;
  if (i.operatorOff) return null;
  if (i.themeTransition !== undefined) return i.themeTransition;
  return i.operatorSpec;
}

/** The operator's master "transitions off" switch (BottomBar), read at send time. */
export function readOperatorTransitionsOff(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const raw = window.localStorage.getItem(TRANSITION_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as { off?: unknown };
    return p?.off === true;
  } catch { return false; }
}
