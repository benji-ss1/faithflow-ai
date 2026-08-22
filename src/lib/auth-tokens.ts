// Cryptographically strong one-time tokens for email verification,
// password reset, and church invitations. The plaintext token goes in the
// email link; only the SHA-256 hash is stored in the DB. Standard pattern.

import crypto from "node:crypto";
import { and, eq, isNull, gte } from "drizzle-orm";
import { getDb } from "./db/client";
import { authTokens } from "./db/schema";

export function mintToken(): { plaintext: string; hash: string } {
  const plaintext = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export async function issueAuthToken(userId: string, kind: "verify_email" | "password_reset" | "device_link", ttlMs: number): Promise<string> {
  const db = getDb();
  const { plaintext, hash } = mintToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(authTokens).values({ userId, kind, tokenHash: hash, expiresAt });
  return plaintext;
}

export async function consumeAuthToken(plaintext: string, kind: "verify_email" | "password_reset" | "device_link"): Promise<string | null> {
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
