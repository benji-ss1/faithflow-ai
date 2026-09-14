// Cryptographically strong one-time tokens for email verification,
// password reset, and church invitations. The plaintext token goes in the
// email link; only the SHA-256 hash is stored in the DB. Standard pattern.

import crypto from "node:crypto";
import { and, eq, isNull, gte, inArray } from "drizzle-orm";
import { getDb } from "./db/client";
import { authTokens, users } from "./db/schema";

export type AuthTokenKind = "verify_email" | "password_reset" | "device_link" | "device_pair";

export function mintToken(): { plaintext: string; hash: string } {
  const plaintext = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export async function issueAuthToken(userId: string, kind: AuthTokenKind, ttlMs: number): Promise<string> {
  const db = getDb();
  const { plaintext, hash } = mintToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(authTokens).values({ userId, kind, tokenHash: hash, expiresAt });
  return plaintext;
}

export async function consumeAuthToken(plaintext: string, kind: AuthTokenKind): Promise<string | null> {
  const db = getDb();
  const hash = hashToken(plaintext);
  // Atomic single-use claim: mark usedAt only if it's still unused, in one
  // statement, and take the userId from the RETURNING row. Two concurrent
  // requests with the same token can't both win — the second UPDATE matches 0
  // rows. (The previous select-then-update had a double-consume race.)
  const claimed = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(
      eq(authTokens.tokenHash, hash),
      eq(authTokens.kind, kind),
      isNull(authTokens.usedAt),
      gte(authTokens.expiresAt, new Date()),
    ))
    .returning({ userId: authTokens.userId });
  return claimed[0]?.userId ?? null;
}

/**
 * Desktop device-link exchange: burn the token AND read the user's
 * session_version in ONE transaction. The burn's row lock on auth_tokens is held
 * until commit, so revokeAllSessionsForUser's final token burn blocks behind it
 * and its trailing session_version bump always lands AFTER this read — the new
 * session can never capture a post-revocation version (it is revoked on refresh).
 * FOR SHARE additionally blocks a concurrent version bump until we commit.
 */
export async function exchangeDeviceLinkToken(plaintext: string): Promise<{ id: string; email: string; name: string; churchId: string | null; role: string; sessionVersion: number } | null> {
  const hash = hashToken(plaintext);
  return getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(
        eq(authTokens.tokenHash, hash),
        eq(authTokens.kind, "device_link"),
        isNull(authTokens.usedAt),
        gte(authTokens.expiresAt, new Date()),
      ))
      .returning({ userId: authTokens.userId });
    if (!claimed) return null;
    const [u] = await tx
      .select({ id: users.id, email: users.email, name: users.name, churchId: users.churchId, role: users.role, sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, claimed.userId))
      .limit(1)
      .for("share");
    return u ?? null;
  });
}

// Non-consuming lookup: who a still-valid (unused, unexpired) token belongs to.
// Used by device-exchange to decide "same user / different user / no session"
// WITHOUT burning the token before the user has confirmed an account switch.
export async function peekAuthTokenUser(plaintext: string, kind: AuthTokenKind): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ userId: authTokens.userId })
    .from(authTokens)
    .where(and(
      eq(authTokens.tokenHash, hashToken(plaintext)),
      eq(authTokens.kind, kind),
      isNull(authTokens.usedAt),
      gte(authTokens.expiresAt, new Date()),
    ))
    .limit(1);
  return rows[0]?.userId ?? null;
}

// Burn every still-unused token of the given kinds for a user (e.g. all
// desktop sign-in links + pairing approvals after a password reset).
export async function invalidateUserTokens(userId: string, kinds: AuthTokenKind[]): Promise<void> {
  const db = getDb();
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), inArray(authTokens.kind, kinds), isNull(authTokens.usedAt)));
}
