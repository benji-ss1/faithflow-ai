import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { dbTierToTier, type Tier } from "@/lib/tier";

/**
 * GET /api/usage — returns quota usage tiles for the Settings > Usage tab.
 *
 * Auth-gated. Returns placeholder numbers (0 used) with tier-appropriate
 * quotas. Real usage counters are not yet wired to a store — this is a
 * scaffolding endpoint so the UI can render quotas today, and we can
 * point counters at a real usage table without changing the client.
 *
 * Tier → quota mapping:
 *   - free/pilot: transcription 40 min/week, context 200/month, custom themes 1
 *   - max:        all unlimited (null), multi-channel NDI
 */
export async function GET() {
  try {
    const user = await apiUser();
    let tier: Tier = "free";
    if (user) {
      const db = getDb();
      const [sub] = await db
        .select({ tier: subscriptions.tier, status: subscriptions.status })
        .from(subscriptions)
        .where(eq(subscriptions.churchId, user.churchId))
        .limit(1);
      const active = sub ? ["pilot", "trialing", "active"].includes(sub.status) : false;
      tier = active ? dbTierToTier(sub!.tier) : "free";
    }

    const isMax = tier === "max";
    return NextResponse.json({
      tier,
      transcription: {
        used: 0,
        quota: isMax ? null : 40,
        label: isMax ? "Unlimited" : "40 min / week",
      },
      contextSearches: {
        used: 0,
        quota: isMax ? null : 200,
        label: isMax ? "Unlimited" : "200 / month",
      },
      customThemes: {
        used: 0,
        quota: isMax ? null : 1,
        label: isMax ? "Unlimited" : "1 theme",
      },
      broadcastOutputs: {
        label: isMax ? "Multi-channel NDI" : "Main channel only",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "usage error" },
      { status: 500 }
    );
  }
}
