// Desktop first-launch pairing service (DB layer). Route/action wrappers add
// auth + rate limits; this module is directly adversarial-tested
// (test/adversarial/desktop-signin.test.ts).
//
// Flow: desktop login page → startPairing() → shows code, keeps ticket →
// user signs in on the web, opens /link?code=… → approvePairingForUser()
// writes an auth_tokens row (kind device_pair, user-scoped, hashed, 10 min)
// → desktop pollPairing(ticket) atomically consumes that row and receives a
// short-lived single-use device_link token → navigates to device-exchange.

import { and, eq, gte, isNull } from "drizzle-orm";
import { getDb } from "./db/client";
import { authTokens } from "./db/schema";
import { issueAuthToken } from "./auth-tokens";
import { PAIR_TTL_MS, formatPairCode, generatePairCode, normalizePairCode, pairCodeHash, signPairTicket, verifyPairTicket } from "./desktop-auth-core";

export const PAIR_EXCHANGE_TTL_MS = 2 * 60 * 1000;

export function startPairing(): { code: string; displayCode: string; ticket: string; expiresAt: number; nonce: string } {
  const code = generatePairCode();
  const t = signPairTicket(code);
  return { code, displayCode: formatPairCode(code), ticket: t.ticket, expiresAt: t.expiresAt, nonce: t.nonce };
}

export type ApproveResult = { ok: true } | { ok: false; error: string };

export async function approvePairingForUser(userId: string, rawCode: unknown): Promise<ApproveResult> {
  const code = normalizePairCode(rawCode);
  if (!code) return { ok: false, error: "That code doesn't look right. It's 8 letters/numbers shown on the desktop app." };
  const hash = pairCodeHash(code);
  const db = getDb();
  const existing = await db
    .select({ userId: authTokens.userId })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hash), eq(authTokens.kind, "device_pair"), isNull(authTokens.usedAt), gte(authTokens.expiresAt, new Date())))
    .limit(1);
  if (existing[0]) {
    // Idempotent for the same user; nobody else may re-point a pending approval.
    return existing[0].userId === userId ? { ok: true } : { ok: false, error: "That code has already been used. Start again on the desktop app." };
  }
  await db.insert(authTokens).values({ userId, kind: "device_pair", tokenHash: hash, expiresAt: new Date(Date.now() + PAIR_TTL_MS) });
  return { ok: true };
}

export type PollResult =
  | { status: "invalid" }
  | { status: "pending"; expiresAt: number }
  | { status: "approved"; token: string };

export async function pollPairing(ticket: unknown): Promise<PollResult> {
  const t = verifyPairTicket(ticket);
  if (!t) return { status: "invalid" };
  const db = getDb();
  const claimed = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, t.codeHash), eq(authTokens.kind, "device_pair"), isNull(authTokens.usedAt), gte(authTokens.expiresAt, new Date())))
    .returning({ userId: authTokens.userId });
  const userId = claimed[0]?.userId;
  if (!userId) return { status: "pending", expiresAt: t.expiresAt };
  const token = await issueAuthToken(userId, "device_link", PAIR_EXCHANGE_TTL_MS);
  return { status: "approved", token };
}
