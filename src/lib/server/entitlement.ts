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
  active: boolean; // pilot | trialing | active (and, for trialing, not expired)
  paid: boolean; // pro | enterprise on an active status
  trialExpired: boolean; // status==="trialing" AND trialEnd has passed
  trialEnd: Date | null; // the trial cutoff, if on a trial
};

const ACTIVE_STATUSES = new Set(["pilot", "trialing", "active"]);
const PAID_TIERS = new Set<DbTier>(["pro", "enterprise"]);

/** Fetch the subscription row for a church. Never throws — returns free-tier
 * defaults on DB failure so a transient outage doesn't 500 an operator.
 *
 * Trial expiry (2026-09-02): a `trialing` church is active UNTIL its `trialEnd`
 * passes, then it flips to trialExpired=true / active=false so the app locks
 * behind the "your trial has ended — contact us to continue" prompt. This is
 * FAIL-OPEN: a null trialEnd, an unparseable date, or any DB error never
 * expires a trial (we only lock when we can positively prove now > trialEnd),
 * so a bug here can never wrongly lock a church out mid-trial. Only `trialing`
 * churches are ever subject to expiry — `pilot`/`active` never lock. */
export async function getEntitlement(churchId: string): Promise<Entitlement> {
  try {
    const db = getDb();
    const [sub] = await db
      .select({ tier: subscriptions.tier, status: subscriptions.status, trialEnd: subscriptions.trialEnd })
      .from(subscriptions)
      .where(eq(subscriptions.churchId, churchId))
      .limit(1);
    if (!sub) return { tier: null, status: null, active: false, paid: false, trialExpired: false, trialEnd: null };
    const trialEnd = sub.trialEnd instanceof Date ? sub.trialEnd : sub.trialEnd ? new Date(sub.trialEnd) : null;
    const trialExpired =
      sub.status === "trialing" &&
      trialEnd != null &&
      !Number.isNaN(trialEnd.getTime()) &&
      Date.now() > trialEnd.getTime();
    const active = ACTIVE_STATUSES.has(sub.status) && !trialExpired;
    const paid = active && PAID_TIERS.has(sub.tier);
    return { tier: sub.tier, status: sub.status, active, paid, trialExpired, trialEnd };
  } catch {
    return { tier: null, status: null, active: false, paid: false, trialExpired: false, trialEnd: null };
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
