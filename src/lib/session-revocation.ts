// Server-only helper (deliberately NOT "use server": it takes an arbitrary
// userId and must never be exposed as a callable server action).

import { eq, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { invalidateUserTokens } from "./auth-tokens";
import { revokePendingPairings } from "./desktop-pair";

/** Run a revocation step; retry once, then log loudly. Returns false if both attempts failed. */
async function step(label: string, userId: string, fn: () => Promise<unknown>): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await fn();
      return true;
    } catch (e) {
      if (attempt === 2) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[session-revocation] ${label} FAILED after retry for user ${userId}:`, msg);
        // Sentry breadcrumb when available (never let observability break revocation).
        try {
          const Sentry = await import("@sentry/nextjs");
          Sentry.addBreadcrumb({ category: "session-revocation", level: "error", message: `${label} failed`, data: { userId } });
          Sentry.captureException(e);
        } catch { /* Sentry unavailable */ }
      }
    }
  }
  return false;
}

export async function bumpSessionVersion(userId: string): Promise<void> {
  await getDb().update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
}

/**
 * Revoke every session for a user: bump users.session_version (each JWT carries
 * the version it was issued with; the jwt refresh in auth.ts ends sessions whose
 * copy differs — within the 5-min refresh window), and burn outstanding desktop
 * links / pairing approvals. Used by password reset and "Sign out all devices".
 *
 * ORDER MATTERS (race with a desktop mid-poll / mid-exchange):
 *   1. expire pairings (no new exchange token can be kept),
 *   2. burn tokens, 3. bump version, 4. burn again (token inserted between 1-2),
 *   5. bump AGAIN after the last burn (bumpVersion !== false). A concurrent
 *      exchange holds its token row lock until it has read session_version, so
 *      step 4 waits behind it and step 5 is strictly newer than anything that
 *      exchange captured.
 * With bumpVersion:false the caller (resetPassword) MUST bump after this returns.
 *
 * Failure policy: every step retries once and then logs (console.error + Sentry)
 * instead of throwing — callers like resetPassword have already changed the
 * password, so we keep going and ALWAYS attempt the version bumps (sessions
 * still end on refresh even if a token/pairing burn failed). `ok:false` flags
 * a partial revocation.
 */
export async function revokeAllSessionsForUser(userId: string, opts: { bumpVersion?: boolean } = {}): Promise<{ ok: boolean }> {
  const bump = opts.bumpVersion !== false;
  const kinds = ["device_link", "device_pair"] as const;
  const results = [
    await step("revokePendingPairings", userId, () => revokePendingPairings(userId)),
    await step("invalidateUserTokens#1", userId, () => invalidateUserTokens(userId, [...kinds])),
  ];
  if (bump) results.push(await step("bumpSessionVersion#1", userId, () => bumpSessionVersion(userId)));
  results.push(await step("invalidateUserTokens#2", userId, () => invalidateUserTokens(userId, [...kinds])));
  if (bump) results.push(await step("bumpSessionVersion#2", userId, () => bumpSessionVersion(userId)));
  return { ok: results.every(Boolean) };
}
