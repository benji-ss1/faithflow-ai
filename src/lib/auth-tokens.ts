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

export async function issueAuthToken(userId: string, kind: "verify_email" | "password_reset", ttlMs: number): Promise<string> {
  const db = getDb();
  const { plaintext, hash } = mintToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(authTokens).values({ userId, kind, tokenHash: hash, expiresAt });
  return plaintext;
}

export async function consumeAuthToken(plaintext: string, kind: "verify_email" | "password_reset"): Promise<string | null> {
  const db = getDb();
  const hash = hashToken(plaintext);
  const [row] = await db.select().from(authTokens).where(and(
    eq(authTokens.tokenHash, hash),
    eq(authTokens.kind, kind),
    isNull(authTokens.usedAt),
    gte(authTokens.expiresAt, new Date()),
  )).limit(1);
  if (!row) return null;
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  return row.userId;
}
