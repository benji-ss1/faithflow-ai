// Server-only helper (deliberately NOT "use server": it takes an arbitrary
// userId and must never be exposed as a callable server action).

import { eq, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { invalidateUserTokens } from "./auth-tokens";
import { revokePendingPairings } from "./desktop-pair";

/**
 * Revoke every session for a user: bump users.session_version (each JWT carries
 * the version it was issued with; the jwt refresh in auth.ts ends sessions whose
 * copy differs — within the 5-min refresh window), and burn outstanding desktop
 * links / pairing approvals. Used by password reset and "Sign out all devices".
 */
export async function revokeAllSessionsForUser(userId: string, opts: { bumpVersion?: boolean } = {}): Promise<void> {
  // ORDER MATTERS (race with a desktop mid-poll): expire pairings FIRST so no
  // new exchange token can be kept, then burn tokens, bump the version, and
  // burn once more to catch a token inserted between the first two steps.
  await revokePendingPairings(userId).catch(() => { /* best-effort */ });
  await invalidateUserTokens(userId, ["device_link", "device_pair"]).catch(() => { /* best-effort */ });
  if (opts.bumpVersion !== false) {
    await getDb().update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
  }
  await invalidateUserTokens(userId, ["device_link", "device_pair"]).catch(() => { /* best-effort */ });
}
