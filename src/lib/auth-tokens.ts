// Cryptographically strong one-time tokens for email verification,
// password reset, and church invitations. The plaintext token goes in the
// email link; only the SHA-256 hash is stored in the DB. Standard pattern.

import crypto from "node:crypto";
import { and, eq, isNull, gte } from "drizzle-orm";
import { authTokens } from "./db/schema";
import { withServiceRole } from "./db/rls";

export function mintToken(): { plaintext: string; hash: string } {
  const plaintext = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

// Auth-token reads/writes are pre-session (no church context yet), so
// they run through withServiceRole. Under owner-role DB access this is a
// no-op; once we cut over to a scoped app role, this is the ONE bypass
// path that keeps verify-email / password-reset / invitation acceptance
// working. Do not add app-user query paths inside these helpers.

export async function issueAuthToken(userId: string, kind: "verify_email" | "password_reset", ttlMs: number): Promise<string> {
  const { plaintext, hash } = mintToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await withServiceRole(async (tx) => {
    await tx.insert(authTokens).values({ userId, kind, tokenHash: hash, expiresAt });
  });
  return plaintext;
}

export async function consumeAuthToken(plaintext: string, kind: "verify_email" | "password_reset"): Promise<string | null> {
  const hash = hashToken(plaintext);
  return withServiceRole(async (tx) => {
    const [row] = await tx.select().from(authTokens).where(and(
      eq(authTokens.tokenHash, hash),
      eq(authTokens.kind, kind),
      isNull(authTokens.usedAt),
      gte(authTokens.expiresAt, new Date()),
    )).limit(1);
    if (!row) return null;
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    return row.userId;
  });
}
