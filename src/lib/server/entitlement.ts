import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import type { DbTier } from "@/lib/tier";

/**
 * Server-side entitlement lookup. This is the SECURITY BOUNDARY — the client
 * `useTier()` hook is UI hint only and MUST NOT be trusted for gating.
 *
 * Returns the church's current tier row + a boolean summary of whether the
 * subscription is in a paying/active state. Any route that costs money to
 * serve (Groq calls, pgvector search, PPTX conversion, semantic sermon match)
 * must call this before doing work.
 */

export type Entitlement = {
  tier: DbTier | null;
  status: string | null;
  active: boolean; // pilot | trialing | active
  paid: boolean; // pro | enterprise on an active status
};

const ACTIVE_STATUSES = new Set(["pilot", "trialing", "active"]);
const PAID_TIERS = new Set<DbTier>(["pro", "enterprise"]);

/** Fetch the subscription row for a church. Never throws — returns free-tier
 * defaults on DB failure so a transient outage doesn't 500 an operator. */
export async function getEntitlement(churchId: string): Promise<Entitlement> {
  try {
    const db = getDb();
    const [sub] = await db
      .select({ tier: subscriptions.tier, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.churchId, churchId))
      .limit(1);
    if (!sub) return { tier: null, status: null, active: false, paid: false };
    const active = ACTIVE_STATUSES.has(sub.status);
    const paid = active && PAID_TIERS.has(sub.tier);
    return { tier: sub.tier, status: sub.status, active, paid };
  } catch {
    return { tier: null, status: null, active: false, paid: false };
  }
}

/** True when the church may hit any paid AI/compute endpoint. Includes pilot
 * (trial) + starter (paid basic) + pro + enterprise. Only true "free" (no
 * active sub) is rejected. */
export function canUseAI(e: Entitlement): boolean {
  return e.active;
}

/** True when the church may hit Max-only features (semantic sermon match,
 * pgvector song lookup at scale, PPTX bulk conversion). */
export function canUseMax(e: Entitlement): boolean {
  return e.paid || (e.active && e.tier === "pilot");
}
