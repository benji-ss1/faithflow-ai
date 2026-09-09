/**
 * src/engine/timers/messages — pure message-token expansion (Wave 7 P4).
 *
 * The operator's message overlays support inline tokens that resolve at post
 * time. This is deliberately PURE (no React, no server import) so it is
 * directly unit-testable — it was previously inlined in pro/hooks.ts, which
 * eagerly imports server actions ("server-only") at module top and so could
 * never be imported into a node:test unit (the stress suite had to keep a
 * byte-copy). Living here, the real function is imported by both hooks.ts and
 * the tests.
 */
import { formatTimerClock } from "./index";

/** Expand message tokens. `{{time}}`/`{{date}}`/`{{currentSlide}}` mirror the
 *  legacy composer; `{{timer}}` → the first shown timer's clock, `{{timer:ID}}`
 *  → that specific timer. `timers` maps a timer id to its live formatted clock;
 *  `firstTimer` is the fallback for the bare `{{timer}}` token. Pure. */
export function expandMessageTokens(
  text: string,
  opts: { now?: Date; currentSlide?: number; timers?: Record<string, string>; firstTimer?: string },
): string {
  const now = opts.now ?? new Date();
  let out = text
    .replace(/\{\{time\}\}/g, now.toLocaleTimeString())
    .replace(/\{\{date\}\}/g, now.toLocaleDateString())
    .replace(/\{\{currentSlide\}\}/g, String((opts.currentSlide ?? 0) + 1));
  out = out.replace(/\{\{timer:([a-zA-Z0-9_-]{1,64})\}\}/g, (_m, id) => opts.timers?.[id] ?? "");
  out = out.replace(/\{\{timer\}\}/g, opts.firstTimer ?? "");
  return out;
}

/** Convenience: format a raw seconds value for a {{timer}} token. */
export function timerTokenValue(sec: number): string { return formatTimerClock(sec); }
