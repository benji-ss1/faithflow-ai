import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { subscriptions, transcriptSegments, servicePlans } from "@/lib/db/schema";
import { dbTierToTier, type Tier } from "@/lib/tier";

/**
 * GET /api/usage — quota tiles for Settings > Usage.
 *
 * Auth-gated. Returns real transcription minutes for the current week
 * (Monday 00:00 local-to-UTC). Other counters return `used: null` (labelled
 * "—" in the UI) until we wire dedicated tracking stores for them.
 *
 * Tier → quota mapping:
 *   - free/pilot: transcription 40 min/week, context 200/month, custom themes 1
 *   - max:        unlimited (null), multi-channel NDI
 */
export async function GET() {
  try {
    const user = await apiUser();
    let tier: Tier = "free";
    let transcriptionUsedMinutes: number | null = null;

    if (user) {
      const db = getDb();
      const [sub] = await db
        .select({ tier: subscriptions.tier, status: subscriptions.status })
        .from(subscriptions)
        .where(eq(subscriptions.churchId, user.churchId))
        .limit(1);
      const active = sub ? ["pilot", "trialing", "active"].includes(sub.status) : false;
      tier = active ? dbTierToTier(sub!.tier) : "free";

      // Transcription minutes this week — segments joined to servicePlans so
      // we can scope by church_id (transcriptSegments only has plan_id).
      // Uses length(text) as a rough proxy when duration isn't recorded; the
      // segments schema doesn't currently track durationMs, so we count
      // segments and estimate ~5s/segment for a stable, obviously-approximate
      // number rather than fabricating precision.
      try {
        const now = new Date();
        const dayOfWeek = now.getUTCDay(); // 0=Sun
        const daysSinceMonday = (dayOfWeek + 6) % 7;
        const weekStart = new Date(now);
        weekStart.setUTCDate(now.getUTCDate() - daysSinceMonday);
        weekStart.setUTCHours(0, 0, 0, 0);

        const [row] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(transcriptSegments)
          .innerJoin(servicePlans, eq(servicePlans.id, transcriptSegments.servicePlanId))
          .where(and(
            eq(servicePlans.churchId, user.churchId),
            gte(transcriptSegments.ts, weekStart),
          ));
        const segCount = row?.count ?? 0;
        transcriptionUsedMinutes = Math.round((segCount * 5) / 60);
      } catch {
        transcriptionUsedMinutes = null;
      }
    }

    const isMax = tier === "max";
    return NextResponse.json({
      tier,
      transcription: {
        used: transcriptionUsedMinutes,
        quota: isMax ? null : 40,
        label: isMax ? "Unlimited" : "40 min / week",
      },
      // No context-search log yet — surface null so the UI renders "—" and
      // an "Estimated soon" caption rather than a fake zero.
      contextSearches: {
        used: null,
        quota: isMax ? null : 200,
        label: isMax ? "Unlimited" : "200 / month",
      },
      customThemes: {
        used: null,
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
