// Stale-action recovery (Wave 3, item 1).
//
// When a browser tab has been open across a Vercel redeploy, its cached client
// chunks reference Server Action ids that no longer exist on the freshly-
// deployed server. Next.js then rejects the call with a recognisable error:
//
//   "Failed to find Server Action \"7f3a…\". This request might be from an
//    older or newer deployment."
//
// (older wording: "Server Action \"…\" was not found on the server"). These
// surface at the operator shell's global error net as an ugly red toast. We
// detect this ONE failure class here (pure, unit-testable) so the shell can
// replace the toast with a calm "PresentFlow updated — reload to continue"
// notice instead.
//
// This helper is deliberately conservative: it only matches the specific
// next-server-action version-mismatch phrasings, never generic network / action
// failures, so a real bug is never silently swallowed as "just reload".

const STALE_ACTION_PATTERNS: RegExp[] = [
  // Current Next.js (App Router) wording.
  /failed to find server action/i,
  // Older / alternate wording seen in the field.
  /server action .* was not found on the server/i,
  // The explanatory sentence Next.js appends — a strong secondary signal.
  /this request might be from an older or newer deployment/i,
];

/**
 * True iff the given error is the next-server-action version-mismatch failure
 * class (a stale tab after a redeploy), NOT a generic action/network failure.
 */
export function isStaleServerActionError(err: unknown): boolean {
  const msg = staleErrorMessage(err);
  if (!msg) return false;
  return STALE_ACTION_PATTERNS.some((re) => re.test(msg));
}

/** Extract a comparable string from an unknown thrown value (Error, string,
 *  or an object carrying a `message`/`digest`). Exported for testing. */
export function staleErrorMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    // Next.js sometimes carries the signal on `digest` rather than `message`.
    const digest = (err as Error & { digest?: unknown }).digest;
    return [err.message, typeof digest === "string" ? digest : ""].filter(Boolean).join(" ");
  }
  if (typeof err === "object") {
    const o = err as { message?: unknown; digest?: unknown };
    return [o.message, o.digest].filter((x) => typeof x === "string").join(" ");
  }
  return String(err);
}

/**
 * Decide how to recover from a detected stale-action error.
 *
 * If nothing is live on the projector we can safely auto-reload to pick up the
 * new deployment. If content IS live we must NEVER yank the projector — offer a
 * manual Reload button only.
 *
 * Reload-loop guard: PresentFlow has a documented history of a stale service
 * worker serving old chunks even across a reload. If we auto-reloaded once and
 * the very next action STILL throws the stale-action class (the reload landed
 * back on a stale chunk), auto-reloading again would spin an infinite loop.
 * When `recentlyAutoReloaded` is set the caller has already spent its one free
 * auto-reload, so we fall through to the manual banner instead — the operator
 * (and their still-served chunk) is never trapped in a reload cycle.
 *
 * Pure so the policy is test-locked.
 */
export function staleActionRecovery(opts: {
  contentIsLive: boolean;
  recentlyAutoReloaded?: boolean;
}): {
  autoReload: boolean;
} {
  return { autoReload: !opts.contentIsLive && !opts.recentlyAutoReloaded };
}
