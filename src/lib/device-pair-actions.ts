"use server";

/**
 * Server actions for the networked-projector-sync pair-code system.
 *
 * Pair codes are the shared secret that lets a projector/stage/stream device
 * subscribe to a specific Supabase Realtime channel. They:
 *  - are 6 chars, alphanumeric excluding I/O/0/1 (~1B combinations)
 *  - expire 6 hours after mint
 *  - are unique per-row (DB constraint)
 *  - can be revoked one-click from Settings → Devices
 *  - rate-limited: 10 mints per user per hour (in-memory Map, same pattern as
 *    auth-actions signUp rate limit)
 */

import { and, desc, eq, isNull, gt } from "drizzle-orm";
import { getDb } from "./db/client";
import { devicePairs } from "./db/schema";
import { requireUser } from "./session";
import { createLimiter } from "./rate-limit";

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no I/O/0/1
const CODE_LEN = 6;
const CODE_TTL_MS = 6 * 60 * 60 * 1000;

const mintLimiter = createLimiter("pair-mint", 10, 60 * 60 * 1000);

function genCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  // crypto is globally available in Node 20 and edge runtimes
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}


export async function mintPairCode(input: {
  planId?: string | null;
  label?: string | null;
  screenKind?: "projector" | "stage" | "stream" | "operator";
} = {}): Promise<Result<{ code: string; expiresAt: string }>> {
  const user = await requireUser();
  if (!(await mintLimiter(user.id))) {
    return { ok: false, error: "Too many pair-code mints. Please wait an hour before minting more." };
  }
  const db = getDb();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  const screenKind = input.screenKind ?? "projector";
  const label = input.label?.trim() || null;
  const planId = input.planId || null;
  // Retry on unique-collision (unbelievably rare with 1B space, but cheap).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    try {
      await db.insert(devicePairs).values({
        churchId: user.churchId,
        planId,
        pairCode: code,
        label,
        screenKind,
        createdByUserId: user.id,
        expiresAt,
      });
      return { ok: true, data: { code, expiresAt: expiresAt.toISOString() } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/unique|duplicate/i.test(msg)) return { ok: false, error: msg };
      // else retry
    }
  }
  return { ok: false, error: "Could not mint a unique pair code — please retry." };
}

export async function revokePairCode(code: string): Promise<Result<void>> {
  const user = await requireUser();
  const db = getDb();
  const normalized = code.trim().toUpperCase();
  const rows = await db
    .update(devicePairs)
    .set({ revokedAt: new Date() })
    .where(and(eq(devicePairs.pairCode, normalized), eq(devicePairs.churchId, user.churchId), isNull(devicePairs.revokedAt)))
    .returning({ id: devicePairs.id });
  if (rows.length === 0) return { ok: false, error: "Pair code not found or already revoked." };
  return { ok: true, data: undefined };
}

/**
 * Server-only: resolve a pair code to its scope. Returns null if the code is
 * unknown, expired, or revoked. NEVER trust caller-supplied churchId — this
 * function IS the source of truth for cross-church isolation.
 */
export async function resolvePairCode(code: string): Promise<{ churchId: string; planId: string | null } | null> {
  const db = getDb();
  const normalized = code.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized)) return null;
  const [row] = await db
    .select({ churchId: devicePairs.churchId, planId: devicePairs.planId, expiresAt: devicePairs.expiresAt, revokedAt: devicePairs.revokedAt })
    .from(devicePairs)
    .where(eq(devicePairs.pairCode, normalized))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { churchId: row.churchId, planId: row.planId };
}

export type ActivePair = {
  code: string;
  label: string | null;
  kind: "projector" | "stage" | "stream" | "operator";
  createdAt: string;
  expiresAt: string;
};

export async function listActivePairs(): Promise<Result<ActivePair[]>> {
  const user = await requireUser();
  const db = getDb();
  const rows = await db
    .select({
      code: devicePairs.pairCode,
      label: devicePairs.label,
      kind: devicePairs.screenKind,
      createdAt: devicePairs.createdAt,
      expiresAt: devicePairs.expiresAt,
    })
    .from(devicePairs)
    .where(and(
      eq(devicePairs.churchId, user.churchId),
      isNull(devicePairs.revokedAt),
      gt(devicePairs.expiresAt, new Date()),
    ))
    .orderBy(desc(devicePairs.createdAt))
    .limit(50);
  return {
    ok: true,
    data: rows.map((r) => ({
      code: r.code,
      label: r.label,
      kind: r.kind,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    })),
  };
}
