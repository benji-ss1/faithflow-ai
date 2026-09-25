/**
 * src/engine/timers/screens — WHICH SCREENS a timer shows on. PURE.
 *
 * WHY THIS EXISTS (2026-09-22): the whole point of the timers work was that an
 * operator can "choose stage or projector or livestream". Until now the only
 * per-screen control was the Scene Builder's layer matrix — which is a LOOK
 * (one global matrix for every layer at once), is admin-gated, and ships OFF by
 * default (`churchPreferences.scenesEnabled`). So in the shipped product a
 * timer went to all four outputs and the operator had no way to see that, let
 * alone change it. A capability an operator cannot reach does not exist
 * (docs/ONE_TO_ONE_LOOP.md).
 *
 * This is PER-TIMER routing and is INDEPENDENT of Scenes. The two compose by
 * AND: a timer draws on a screen only if its own routing allows it AND the
 * active scene does not hide the "timer" layer there. Neither can force the
 * other on, which is the only composition that can't surprise an operator.
 *
 * BACK-COMPAT IS LOAD-BEARING: `undefined` means "every screen", which is
 * exactly what every existing timer did before this file existed. An EMPTY
 * array is a deliberate "nowhere" — the operator unticked everything — and the
 * panel warns rather than silently re-enabling it.
 */

/** The four output surfaces. These strings are the SAME ids the scene matrix
 *  uses (`sceneHidesLayer(scene, screen, "timer")`), so the two systems can
 *  never disagree about what "stage" means. */
export const TIMER_SCREEN_IDS = ["main", "stage", "livestream", "ndi"] as const;
export type TimerScreenId = (typeof TIMER_SCREEN_IDS)[number];

/** Operator-facing names. "main" is the projector/audience screen — an
 *  operator has never once called it "main". */
export const TIMER_SCREEN_LABELS: Record<TimerScreenId, string> = {
  main: "Projector",
  stage: "Stage",
  livestream: "Livestream",
  ndi: "NDI",
};

const VALID = new Set<string>(TIMER_SCREEN_IDS);

/**
 * Does this timer draw on this screen? `undefined` ⇒ yes (legacy = everywhere).
 */
export function timerShowsOn(screens: readonly string[] | undefined | null, screen: TimerScreenId): boolean {
  if (screens == null) return true;
  return screens.includes(screen);
}

/**
 * Normalise an operator/wire value to a canonical list, or `undefined` when it
 * is "all four" — collapsing the full set back to `undefined` is what keeps the
 * default timer's wire frame BYTE-IDENTICAL to the pre-routing one, which is
 * what test/timer-wire.test.ts's determinism lock is protecting.
 */
export function sanitizeTimerScreens(v: unknown): TimerScreenId[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TimerScreenId[] = [];
  for (const id of TIMER_SCREEN_IDS) {
    if (v.includes(id)) out.push(id);
  }
  // Anything unrecognised is dropped rather than rejected: a newer operator
  // sending a screen this build has never heard of must not blank the timer.
  if (out.length === TIMER_SCREEN_IDS.length) return undefined;
  return out;
}

/** Toggle one screen, returning the canonical form. */
export function toggleTimerScreen(
  screens: readonly TimerScreenId[] | undefined,
  screen: TimerScreenId,
): TimerScreenId[] | undefined {
  const current: TimerScreenId[] = screens == null ? [...TIMER_SCREEN_IDS] : [...screens];
  const next = current.includes(screen) ? current.filter((s) => s !== screen) : [...current, screen];
  return sanitizeTimerScreens(next) ?? undefined;
}

/** Is the wire/stored value structurally acceptable? Used by the validators. */
export function isValidTimerScreens(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > TIMER_SCREEN_IDS.length) return false;
  return v.every((x) => typeof x === "string" && VALID.has(x));
}


/**
 * Coerce an unknown / NULL / legacy screen target to a safe one.
 *
 * Unknown always falls back to "stage" — the meaning every row had before
 * targets existed. A value we do not recognise must never be GUESSED onto the
 * projector: the failure direction matters far more than the failure rate.
 */
export function sanitizeScreenTarget(v: unknown): TimerScreenId {
  return typeof v === "string" && VALID.has(v) ? (v as TimerScreenId) : "stage";
}
