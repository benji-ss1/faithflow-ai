import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { dbTierToTier, type Tier } from "@/lib/tier";

/**
 * GET /api/tier — returns the current church's tier bucket for UI gating.
 *
 * Auth-gated. Returns "free" for unauthenticated so the UI can render
 * the free-tier scaffolding safely. Server actions still enforce real
 * entitlement — this endpoint is a UI hint only.
 *
 * On DB error we return 503 with { tier: null } so the client can preserve
 * last-known-good tier rather than fail-open to "free" and pop upgrade
 * prompts mid-service to a paid church.
 */
export async function GET() {
  try {
    const user = await apiUser();
    if (!user) return NextResponse.json({ tier: "free" satisfies Tier });
    const db = getDb();
    const [sub] = await db
      .select({ tier: subscriptions.tier, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.churchId, user.churchId))
      .limit(1);
    // Only treat as active if status is trialing / active / pilot.
    const active = !sub ? false : ["pilot", "trialing", "active"].includes(sub.status);
    const tier: Tier = active ? dbTierToTier(sub!.tier) : "free";
    return NextResponse.json({ tier });
  } catch {
    return NextResponse.json(
      { tier: null, error: "unavailable" },
      { status: 503 },
    );
  }
}
