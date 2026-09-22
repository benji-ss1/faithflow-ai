/**
 * callAction — a server action must never reach the global error net.
 *
 * THE BUG THIS FIXES (2026-09-22, seen live in a church mid-service):
 * the timers and stage-layout hooks all called server actions in the shape
 *
 *     const res = await createTimerDefinition(input);
 *     if (res.ok) await refresh();
 *
 * with no try/catch, and the panels called those in turn without awaiting or
 * catching. So when an action THREW — as opposed to returning {ok:false} —
 * the promise rejected unhandled, fell through to ProOperatorShell's global
 * `unhandledrejection` listener, and the operator got:
 *
 *     Background task failed: An error occurred in the Server Components
 *     render. The specific message is omitted in production builds…
 *
 * Two things were wrong with that, and both matter more than the original
 * throw. The operator was shown a frightening, meaningless message during a
 * service; and their actual action — add this timer, delete that layout —
 * failed SILENTLY, with the UI closing the dialog as though it had worked.
 *
 * Next.js redacts server errors in production ON PURPOSE, so the message will
 * never be useful to a client. What IS useful is the `digest`: the server logs
 * the real stack under the same digest, so quoting it turns an unreproducible
 * "it went red" report into one log lookup. We put it in the console, never in
 * the operator's toast.
 *
 * This keeps the {ok} shape callers already branch on, so wrapping a call is a
 * pure no-op on the happy path.
 */

export type ActionResult<T> = { ok: true; data?: T } | { ok: false; error: string };

/** Pull Next's error digest out of an unknown thrown value, if present. */
export function actionDigest(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const d = (err as { digest?: unknown }).digest;
  return typeof d === "string" && d.length > 0 ? d : null;
}

/**
 * `label` is what the OPERATOR was trying to do, phrased so it reads in a
 * sentence: callAction("add the timer", …) → "Couldn't add the timer."
 */
export async function callAction<T>(
  label: string,
  fn: () => Promise<ActionResult<T>>,
  onError?: (message: string) => void,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    const digest = actionDigest(err);
    // The digest is the ONLY part of a production server error that can be
    // traced back to a real stack, so it goes in the console every time.
    console.error(`[action] ${label} failed`, digest ? `digest=${digest}` : "", err);
    const message = `Couldn't ${label}. Nothing was changed.`;
    onError?.(message);
    return { ok: false, error: message };
  }
}
