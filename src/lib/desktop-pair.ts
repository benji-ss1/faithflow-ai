// Desktop first-launch pairing service (DB layer). Route/action wrappers add
// auth + rate limits; this module is directly adversarial-tested
// (test/adversarial/desktop-signin.test.ts).
//
// Flow: desktop login page → startPairing() records a device_pair_requests row
// (code hash, IP, UA, geo) and returns code + signed ticket → the user types
// the code on /link → lookupPairingRequest() shows the requesting device →
// approvePairingForUser() ATOMICALLY claims the row (first approver wins) →
// desktop pollPairing(ticket) atomically consumes the claim and receives a
// short-lived single-use device_link token → navigates to device-exchange.

import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { devicePairRequests } from "./db/schema";
import { consumeAuthToken, issueAuthToken } from "./auth-tokens";
import {
  PAIR_UA_MAX,
  describeLocation,
  describeUserAgent,
  formatPairCode,
  generatePairCode,
  normalizePairCode,
  pairCodeHash,
  signPairTicket,
  verifyPairTicket,
} from "./desktop-auth-core";

export const PAIR_EXCHANGE_TTL_MS = 2 * 60 * 1000;
/** Expired rows are kept this long (so late polls/approvals get a clear answer), then deleted. */
const CLEANUP_GRACE_MS = 60 * 60 * 1000;
/** expires_at written by revokePendingPairings (to_timestamp(0)). */
export const REVOKED_EXPIRES_AT = new Date(0);

export type PairRequestMeta = { ip?: string | null; userAgent?: string | null; country?: string | null; city?: string | null };

export async function cleanupExpiredPairRequests(now = Date.now()): Promise<void> {
  await getDb().delete(devicePairRequests).where(lt(devicePairRequests.expiresAt, new Date(now - CLEANUP_GRACE_MS)));
}

export async function startPairing(meta: PairRequestMeta = {}): Promise<{ code: string; displayCode: string; ticket: string; expiresAt: number; nonce: string }> {
  const db = getDb();
  // Lazy cleanup, best-effort (indexed on expires_at).
  await cleanupExpiredPairRequests().catch(() => { /* non-fatal */ });
  for (let attempt = 0; ; attempt++) {
    const code = generatePairCode();
    const t = signPairTicket(code);
    const inserted = await db
      .insert(devicePairRequests)
      .values({
        codeHash: pairCodeHash(code),
        expiresAt: new Date(t.expiresAt),
        ip: meta.ip ? meta.ip.slice(0, 64) : null,
        userAgent: meta.userAgent ? meta.userAgent.slice(0, PAIR_UA_MAX) : null,
        country: meta.country ?? null,
        city: meta.city ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: devicePairRequests.id });
    if (inserted[0]) return { code, displayCode: formatPairCode(code), ticket: t.ticket, expiresAt: t.expiresAt, nonce: t.nonce };
    // 40-bit collision with a live/grace row: astronomically rare — retry.
    if (attempt >= 3) throw new Error("could not allocate pairing code");
  }
}

export type PairRequestView = { device: string; location: string; country: string | null; createdAt: Date };

function view(row: { userAgent: string | null; city: string | null; country: string | null; createdAt: Date }): PairRequestView {
  return { device: describeUserAgent(row.userAgent), location: describeLocation(row.city, row.country), country: row.country, createdAt: row.createdAt };
}

const BAD_FORMAT = "That code doesn't look right. It's 8 letters/numbers shown on the desktop app.";
const NOT_FOUND = "That code wasn't found or has expired. Start again on the desktop app.";
const ALREADY_APPROVED = "This code was already approved. Start again on the desktop app.";
const ALREADY_USED = "That code has already been used. Start again on the desktop app.";

export type LookupResult = { ok: true; request: PairRequestView; alreadyApprovedByYou: boolean } | { ok: false; error: string };

/** Read-only: what device is asking? Refuses codes claimed by someone else / consumed / expired. */
export async function lookupPairingRequest(userId: string, rawCode: unknown): Promise<LookupResult> {
  const code = normalizePairCode(rawCode);
  if (!code) return { ok: false, error: BAD_FORMAT };
  const [row] = await getDb().select().from(devicePairRequests).where(eq(devicePairRequests.codeHash, pairCodeHash(code))).limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) return { ok: false, error: NOT_FOUND };
  if (row.consumedAt) return { ok: false, error: ALREADY_USED };
  if (row.claimedByUserId && row.claimedByUserId !== userId) return { ok: false, error: ALREADY_APPROVED };
  return { ok: true, request: view(row), alreadyApprovedByYou: row.claimedByUserId === userId };
}

export type ApproveResult =
  | { ok: true; firstApproval: boolean; request: PairRequestView }
  | { ok: false; error: string };

/**
 * Atomic first-approver-wins claim. One UPDATE ... WHERE claimed_by_user_id IS
 * NULL RETURNING: concurrent approvers can't both match. Same user again is
 * idempotent (until the desktop consumes it); anyone else is refused.
 */
export async function approvePairingForUser(userId: string, rawCode: unknown): Promise<ApproveResult> {
  const code = normalizePairCode(rawCode);
  if (!code) return { ok: false, error: BAD_FORMAT };
  const hash = pairCodeHash(code);
  const db = getDb();
  const now = new Date();
  const claimed = await db
    .update(devicePairRequests)
    .set({ claimedByUserId: userId, claimedAt: now })
    .where(and(
      eq(devicePairRequests.codeHash, hash),
      isNull(devicePairRequests.claimedByUserId),
      isNull(devicePairRequests.consumedAt),
      gt(devicePairRequests.expiresAt, now),
    ))
    .returning();
  if (claimed[0]) return { ok: true, firstApproval: true, request: view(claimed[0]) };

  const [row] = await db.select().from(devicePairRequests).where(eq(devicePairRequests.codeHash, hash)).limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) return { ok: false, error: NOT_FOUND };
  if (row.consumedAt) return { ok: false, error: ALREADY_USED };
  if (row.claimedByUserId === userId) return { ok: true, firstApproval: false, request: view(row) };
  return { ok: false, error: ALREADY_APPROVED };
}

export type PollResult =
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "pending"; expiresAt: number }
  | { status: "error"; expiresAt: number }
  | { status: "approved"; token: string };

export async function pollPairing(ticket: unknown): Promise<PollResult> {
  const t = verifyPairTicket(ticket);
  if (!t) return { status: "invalid" };
  const db = getDb();
  const now = new Date();
  const consumed = await db
    .update(devicePairRequests)
    .set({ consumedAt: now })
    .where(and(
      eq(devicePairRequests.codeHash, t.codeHash),
      isNotNull(devicePairRequests.claimedByUserId),
      isNull(devicePairRequests.consumedAt),
      gt(devicePairRequests.expiresAt, now),
    ))
    .returning({ id: devicePairRequests.id, userId: devicePairRequests.claimedByUserId, expiresAt: devicePairRequests.expiresAt });
  const hit = consumed[0];
  if (!hit?.userId) {
    const [row] = await db
      .select({ consumedAt: devicePairRequests.consumedAt, expiresAt: devicePairRequests.expiresAt })
      .from(devicePairRequests)
      .where(eq(devicePairRequests.codeHash, t.codeHash))
      .limit(1);
    // No row (cleaned up / never started) or already consumed → this ticket is done.
    if (!row || row.consumedAt) return { status: "invalid" };
    // Row expired or revoked (password reset / sign-out-all → epoch) → stop polling.
    if (row.expiresAt.getTime() <= REVOKED_EXPIRES_AT.getTime() || row.expiresAt.getTime() <= Date.now()) return { status: "expired" };
    return { status: "pending", expiresAt: t.expiresAt };
  }
  try {
    const token = await issueAuthToken(hit.userId, "device_link", PAIR_EXCHANGE_TTL_MS);
    // Race guard vs revokeAllSessionsForUser: it expires this row FIRST (sets
    // expires_at to the epoch), then burns device_link tokens. If the revoke
    // landed before this re-read we burn the token ourselves and answer
    // "expired"; if after, our token already exists and its burn pass gets it.
    // Compared against the expires_at we CLAIMED (not Date.now()), so no
    // cross-server clock dependency and a legit poll near natural expiry is
    // never burned.
    const [after] = await db.select({ expiresAt: devicePairRequests.expiresAt }).from(devicePairRequests).where(eq(devicePairRequests.id, hit.id)).limit(1);
    if (!after || after.expiresAt.getTime() !== hit.expiresAt.getTime()) {
      await consumeAuthToken(token, "device_link").catch(() => { /* best-effort; reset also burns it */ });
      return { status: "expired" };
    }
    return { status: "approved", token };
  } catch (e) {
    // Un-consume so the desktop can retry the poll (claim stays with the approver).
    console.error("[desktop-pair] exchange token issue failed:", e instanceof Error ? e.message : e);
    await db.update(devicePairRequests).set({ consumedAt: null }).where(eq(devicePairRequests.id, hit.id)).catch(() => { /* ignore */ });
    return { status: "error", expiresAt: t.expiresAt };
  }
}

/**
 * Password reset / sign-out-all: expire every still-live pairing this user
 * approved — including ones a desktop is consuming right now (pollPairing
 * re-reads expiry after issuing its token; see the race guard there).
 */
export async function revokePendingPairings(userId: string): Promise<void> {
  await getDb()
    .update(devicePairRequests)
    // Epoch sentinel (not "now - 1s"): no dependency on this server's clock; any
    // changed expires_at is detected by pollPairing's claim-time comparison.
    .set({ expiresAt: REVOKED_EXPIRES_AT })
    // Row selection may use a generous clock window (skew of hours is harmless):
    // anything not already revoked and not yet past cleanup grace.
    .where(and(
      eq(devicePairRequests.claimedByUserId, userId),
      gt(devicePairRequests.expiresAt, REVOKED_EXPIRES_AT),
      gt(devicePairRequests.expiresAt, new Date(Date.now() - CLEANUP_GRACE_MS)),
    ));
}
