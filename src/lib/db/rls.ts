import { sql } from "drizzle-orm";
import { getDb } from "./client";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Run `fn` in a transaction with the `app.current_church_id` GUC set, which is
 * what every church_isolation policy in
 * docs/migrations/2026-09-23-rls-church-isolation-policies.sql checks.
 *
 * set_config(..., true) is SET LOCAL: the value dies with the transaction, so it
 * cannot leak into the next checkout of a pooled connection. We pool, so this is
 * load-bearing, not stylistic.
 *
 * TODAY THIS IS BELT-AND-BRACES, NOT THE BELT. The app's role has rolbypassrls,
 * so Postgres skips RLS entirely and isolation still rests on app-layer
 * church_id filtering (CLAUDE.md rule 5). Wrapping a query in this does NOT
 * license dropping its church_id WHERE clause. Enforcement begins only at the
 * separate, signed-off role cutover.
 */
export async function withChurchScope<T>(
  churchId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!churchId) {
    // Fail loudly here rather than let the GUC go unset: unset means every
    // policy evaluates to NULL, which after the cutover reads as "no rows" —
    // a blank projector instead of an error, which is far harder to diagnose.
    throw new Error(
      "withChurchScope requires a churchId — use withServiceRole for pre-session paths",
    );
  }
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_church_id', ${churchId}, true)`);
    return fn(tx);
  });
}

/**
 * A transaction that deliberately carries NO church scope, for server-side
 * flows that genuinely have no church context yet: onboarding creating the
 * first Church row, pre-login token lookups (verify_email, password_reset),
 * and seed/migration scripts.
 *
 * Bypass comes from the ROLE, not from anything set here — today the app role's
 * rolbypassrls; after the cutover, a separate privileged role used only by
 * these paths. An earlier draft of this helper set an `app.bypass_rls` GUC, but
 * no policy reads that GUC, so under a non-bypassing role it would have
 * returned zero rows while looking like it had escalated. Left out on purpose.
 *
 * Keep every call site glanceable. Do not wrap arbitrary user-input queries.
 */
export async function withServiceRole<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}
