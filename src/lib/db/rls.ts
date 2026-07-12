import { sql } from "drizzle-orm";
import { getDb } from "./client";

/**
 * Run `fn` inside a transaction with the RLS session GUC
 * `app.current_church_id` set to `churchId`. Every policy in
 * drizzle/0001_rls.sql checks against this GUC.
 *
 * The GUC is scoped by SET LOCAL so it only lives for the length of
 * the transaction and cannot leak into the next checkout of the same
 * pooled connection.
 *
 * Usage:
 *   const rows = await withChurchScope(user.churchId, (tx) =>
 *     tx.select().from(songs)
 *   );
 */
export async function withChurchScope<T>(
  churchId: string,
  fn: (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  if (!churchId) throw new Error("withChurchScope requires a churchId — use withServiceRole for pre-session paths");
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_church_id', ${churchId}, true)`);
    return fn(tx);
  });
}

/**
 * Bypass RLS for a single transaction. Use ONLY for server-side flows
 * that legitimately have no church context yet:
 *   - onboarding: creating the first Church row
 *   - auth tokens: verify_email / password_reset lookups pre-login
 *   - seed / migration scripts
 *
 * Every call site should be reviewable at a glance. Do NOT wrap
 * arbitrary user-input queries with this.
 */
export async function withServiceRole<T>(
  fn: (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
