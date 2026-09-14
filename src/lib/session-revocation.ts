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
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await getDb().update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
  await invalidateUserTokens(userId, ["device_link", "device_pair"]).catch(() => { /* best-effort */ });
  await revokePendingPairings(userId).catch(() => { /* best-effort */ });
}
