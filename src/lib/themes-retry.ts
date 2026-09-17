// Cold-start retry for the operator's church-themes cache (2026-09-17).
//
// The operator console resolves a plan item's look from the themes list it
// fetched once on mount (item theme → song's applied theme → content-type
// default → church default). If that ONE fetch never lands — a fresh session
// racing auth, a dropped request, a cold serverless route — the cache stays
// empty, every later resolve silently falls through to the built-in default
// look, and nothing ever re-resolves: the song projects in Sora/white with no
// background even though the church's content-type default is correct in the
// page payload and in the DB.
//
// This is the bounded retry for exactly that case: the attempt reports whether
// the cache was populated, and a failed attempt is retried on a short backoff.
// A SUCCESSFUL load is never retried — including one that legitimately returns
// no themes — so a church with no themes costs nothing.
//
// Pure + injectable (no window, no fetch) so it is directly unit-testable.

/** Backoff between cold-start retries, in ms. Bounded: ~32s total, then stop. */
export const THEMES_RETRY_MS = [1000, 3000, 8000, 20000] as const;

/** Delay before retry number `attempt` (0-based), or null when retries are exhausted. */
export function themesRetryDelay(attempt: number): number | null {
  return attempt >= 0 && attempt < THEMES_RETRY_MS.length ? THEMES_RETRY_MS[attempt] : null;
}

export type ThemesRetryDeps = {
  /** One load attempt. Resolves true when the themes cache is now populated. */
  attempt: () => Promise<boolean>;
  /** True once the component unmounted — stops the loop, never schedules again. */
  isCancelled: () => boolean;
  /** setTimeout injection (tests drive it synchronously). */
  schedule: (fn: () => void, ms: number) => void;
};

/**
 * Run `attempt` until it reports the cache is populated, the retries run out,
 * or the caller is cancelled. A throwing attempt counts as a failure.
 */
export async function loadThemesWithRetry(deps: ThemesRetryDeps): Promise<void> {
  let attempts = 0;
  const run = async (): Promise<void> => {
    if (deps.isCancelled()) return;
    let ok = false;
    try { ok = await deps.attempt(); } catch { ok = false; }
    if (ok || deps.isCancelled()) return;
    const ms = themesRetryDelay(attempts++);
    if (ms == null) return;
    deps.schedule(() => { void run(); }, ms);
  };
  await run();
}
