/**
 * never-override — manual-takeover suppression (pure, unit-testable core).
 *
 * When AI auto-detection + AUTO autopilot are on, the AI must NOT yank the
 * output out from under an operator who is actively driving it by hand (typing
 * a reference, staging/sending a slide, clicking through). Instead the
 * detection HOLDS as a tappable chip and fires normally once the operator goes
 * idle. This is a sliding time window — never a latch — so it always re-arms.
 *
 * The component stamps `lastInteractionMs` on every real DOM click/keydown
 * (AI fires call sendLive directly and never dispatch synthetic events, so they
 * never self-stamp) and calls `shouldHoldForOperator(...)` at each auto-fire
 * chokepoint. An explicit spoken directive (voiceCommand) always bypasses; a
 * plain restatement (forceLive) does NOT — a repeat isn't intent to override a
 * working operator. A live kill-switch (`killSwitch === false`) disables the
 * hold entirely so it can never starve a real service.
 */

export interface OperatorTakeoverInput {
  /** ms timestamp of the operator's last hands-on action (0 = never). */
  lastInteractionMs: number;
  /** current time in ms. */
  now: number;
  /** hold window length in ms (OPERATOR_FLOW_MS). */
  windowMs: number;
  /** true when this fire is an explicit spoken directive ("next verse"). */
  voiceCommand?: boolean;
  /** false disables the hold (kill-switch OFF). Defaults to enabled. */
  enabled?: boolean;
}

/**
 * True ⇒ HOLD the auto-fire (operator is driving). False ⇒ fire normally.
 * Pure: no Date, no I/O — the caller passes `now` and reads the kill-switch.
 */
export function shouldHoldForOperator(input: OperatorTakeoverInput): boolean {
  const { lastInteractionMs, now, windowMs, voiceCommand = false, enabled = true } = input;
  if (!enabled) return false;          // kill-switch off → never hold
  if (voiceCommand) return false;      // explicit spoken directive always fires
  if (lastInteractionMs <= 0) return false; // operator has never interacted
  if (windowMs <= 0) return false;
  return now - lastInteractionMs < windowMs;
}
