// Server-only. Church-scoped analytics queries for the /analytics dashboard.
// Every query joins/filters by churchId — never returns cross-tenant data.
//
// Not import-able from client components.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  servicePlans,
  serviceItems,
  transcriptSegments,
  detectedReferences,
  aiSuggestions,
} from "../db/schema";

// ---------------------------------------------------------------------------
// Recent services
// ---------------------------------------------------------------------------
export type RecentService = {
  id: string;
  title: string;
  createdAt: Date;
  scheduledFor: string | null;
  itemCount: number;
  segmentCount: number;
  durationMs: number | null;
};

export async function getRecentServices(churchId: string, limit = 10): Promise<RecentService[]> {
  const db = getDb();
  const plans = await db
    .select({
      id: servicePlans.id,
      title: servicePlans.title,
      createdAt: servicePlans.createdAt,
      scheduledFor: servicePlans.scheduledFor,
    })
    .from(servicePlans)
    .where(eq(servicePlans.churchId, churchId))
    .orderBy(desc(servicePlans.createdAt))
    .limit(limit);

  if (plans.length === 0) return [];
  const ids = plans.map((p) => p.id);

  const itemCounts = await db
    .select({ planId: serviceItems.servicePlanId, n: sql<number>`count(*)::int` })
    .from(serviceItems)
    .where(inArray(serviceItems.servicePlanId, ids))
    .groupBy(serviceItems.servicePlanId);

  const segStats = await db
    .select({
      planId: transcriptSegments.servicePlanId,
      n: sql<number>`count(*)::int`,
      minTs: sql<Date | null>`min(${transcriptSegments.ts})`,
      maxTs: sql<Date | null>`max(${transcriptSegments.ts})`,
    })
    .from(transcriptSegments)
    .where(inArray(transcriptSegments.servicePlanId, ids))
    .groupBy(transcriptSegments.servicePlanId);

  const itemMap = new Map(itemCounts.map((r) => [r.planId, r.n]));
  const segMap = new Map(segStats.map((r) => [r.planId, r]));

  return plans.map((p) => {
    const seg = segMap.get(p.id);
    let durationMs: number | null = null;
    if (seg && seg.minTs && seg.maxTs) {
      const start = new Date(seg.minTs as unknown as string).getTime();
      const end = new Date(seg.maxTs as unknown as string).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) durationMs = end - start;
    }
    return {
      id: p.id,
      title: p.title,
      createdAt: p.createdAt,
      scheduledFor: p.scheduledFor,
      itemCount: itemMap.get(p.id) ?? 0,
      segmentCount: seg?.n ?? 0,
      durationMs,
    };
  });
}

// ---------------------------------------------------------------------------
// Accuracy trend — approval rate per day for last N days.
// ---------------------------------------------------------------------------
export type AccuracyPoint = { day: string; total: number; approved: number; rate: number };

export async function getAccuracyTrend(churchId: string, days = 30): Promise<AccuracyPoint[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      day: sql<string>`to_char(${aiSuggestions.createdAt}, 'YYYY-MM-DD')`,
      total: sql<number>`count(*)::int`,
      approved: sql<number>`count(*) filter (where ${aiSuggestions.actionTaken} in ('auto_approved','manual_approved','edited'))::int`,
    })
    .from(aiSuggestions)
    .innerJoin(servicePlans, eq(servicePlans.id, aiSuggestions.servicePlanId))
    .where(and(eq(servicePlans.churchId, churchId), gte(aiSuggestions.createdAt, since)))
    .groupBy(sql`to_char(${aiSuggestions.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${aiSuggestions.createdAt}, 'YYYY-MM-DD')`);

  return rows.map((r) => ({
    day: r.day,
    total: r.total,
    approved: r.approved,
    rate: r.total > 0 ? r.approved / r.total : 0,
  }));
}

// ---------------------------------------------------------------------------
// Top songs used across services (based on service_items type='song').
// ---------------------------------------------------------------------------
export type TopSong = { title: string; count: number };

export async function getTopSongs(churchId: string, limit = 10): Promise<TopSong[]> {
  const db = getDb();
  const rows = await db
    .select({
      title: serviceItems.title,
      count: sql<number>`count(*)::int`,
    })
    .from(serviceItems)
    .innerJoin(servicePlans, eq(servicePlans.id, serviceItems.servicePlanId))
    .where(and(eq(servicePlans.churchId, churchId), eq(serviceItems.type, "song")))
    .groupBy(serviceItems.title)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows.map((r) => ({ title: r.title, count: r.count }));
}

// ---------------------------------------------------------------------------
// Top scriptures used across services.
// ---------------------------------------------------------------------------
export type TopScripture = { title: string; count: number };

export async function getTopScriptures(churchId: string, limit = 10): Promise<TopScripture[]> {
  const db = getDb();
  const rows = await db
    .select({
      title: serviceItems.title,
      count: sql<number>`count(*)::int`,
    })
    .from(serviceItems)
    .innerJoin(servicePlans, eq(servicePlans.id, serviceItems.servicePlanId))
    .where(and(eq(servicePlans.churchId, churchId), eq(serviceItems.type, "scripture")))
    .groupBy(serviceItems.title)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows.map((r) => ({ title: r.title, count: r.count }));
}

// ---------------------------------------------------------------------------
// Median service length over the last N services (transcript span).
// ---------------------------------------------------------------------------
export async function getAvgServiceLengthMs(churchId: string, limit = 20): Promise<number | null> {
  const db = getDb();
  const plans = await db
    .select({ id: servicePlans.id })
    .from(servicePlans)
    .where(eq(servicePlans.churchId, churchId))
    .orderBy(desc(servicePlans.createdAt))
    .limit(limit);
  if (plans.length === 0) return null;
  const ids = plans.map((p) => p.id);
  const rows = await db
    .select({
      planId: transcriptSegments.servicePlanId,
      minTs: sql<Date | null>`min(${transcriptSegments.ts})`,
      maxTs: sql<Date | null>`max(${transcriptSegments.ts})`,
    })
    .from(transcriptSegments)
    .where(inArray(transcriptSegments.servicePlanId, ids))
    .groupBy(transcriptSegments.servicePlanId);

  const durations: number[] = [];
  for (const r of rows) {
    if (!r.minTs || !r.maxTs) continue;
    const s = new Date(r.minTs as unknown as string).getTime();
    const e = new Date(r.maxTs as unknown as string).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) durations.push(e - s);
  }
  if (durations.length === 0) return null;
  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 === 0 ? Math.round((durations[mid - 1] + durations[mid]) / 2) : durations[mid];
}

// ---------------------------------------------------------------------------
// Detection breakdown (detected_references by status) over last N days.
// ---------------------------------------------------------------------------
export type DetectionBreakdown = { pending: number; approved: number; rejected: number; total: number };

export async function getDetectionBreakdown(churchId: string, days = 30): Promise<DetectionBreakdown> {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      status: detectedReferences.status,
      n: sql<number>`count(*)::int`,
    })
    .from(detectedReferences)
    .innerJoin(transcriptSegments, eq(transcriptSegments.id, detectedReferences.transcriptSegmentId))
    .innerJoin(servicePlans, eq(servicePlans.id, transcriptSegments.servicePlanId))
    .where(and(eq(servicePlans.churchId, churchId), gte(detectedReferences.createdAt, since)))
    .groupBy(detectedReferences.status);

  const out: DetectionBreakdown = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const r of rows) {
    if (r.status === "pending") out.pending = r.n;
    else if (r.status === "approved") out.approved = r.n;
    else if (r.status === "rejected") out.rejected = r.n;
    out.total += r.n;
  }
  return out;
}
