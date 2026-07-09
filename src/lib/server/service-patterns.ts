// Church service-pattern learning.
//
// This is the honest, narrow first pass. It aggregates structural
// metadata from past service plans and stores it as one row per church.
// What it DOES:
//   - counts services analyzed
//   - avg item count per service
//   - most-common item order signature
//   - top songs by frequency
//   - top scripture references by frequency
//
// What it does NOT yet do:
//   - adjust AI confidence thresholds dynamically per church
//   - predict sermon length / timing
//   - correlate patterns with attendance or other church metrics
//   - factor in transcript content (uses only structural item metadata)
//
// Overclaiming here would be dishonest — this is a starting foundation.

import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { servicePlans, serviceItems, churchServicePatterns, songs } from "../db/schema";

type ItemType = "song" | "scripture" | "media" | "sermon" | "blank" | "logo";

export type PatternSummary = {
  servicesAnalyzed: number;
  avgItemCount: number;
  typicalItemOrder: ItemType[];
  topSongs: { title: string; count: number }[];
  topScriptures: { book: string; chapter: number; count: number }[];
};

/**
 * Recompute pattern data for one church. Idempotent — safe to run after
 * every service, or on a nightly cron. Only reads structural data; never
 * reads transcript text.
 */
export async function recomputeChurchPatterns(churchId: string): Promise<PatternSummary> {
  const db = getDb();

  const plans = await db.select().from(servicePlans)
    .where(eq(servicePlans.churchId, churchId))
    .orderBy(asc(servicePlans.createdAt));

  const summary: PatternSummary = {
    servicesAnalyzed: plans.length,
    avgItemCount: 0,
    typicalItemOrder: [],
    topSongs: [],
    topScriptures: [],
  };

  if (plans.length === 0) {
    await upsert(churchId, summary);
    return summary;
  }

  // Item types in order per plan
  const perPlanTypes: ItemType[][] = [];
  const songCounter = new Map<string, number>();       // songId -> count
  const scriptureCounter = new Map<string, { book: string; chapter: number; count: number }>();
  let totalItems = 0;

  for (const plan of plans) {
    const items = await db.select().from(serviceItems)
      .where(eq(serviceItems.servicePlanId, plan.id))
      .orderBy(asc(serviceItems.order));
    totalItems += items.length;
    perPlanTypes.push(items.map((i) => i.type as ItemType));

    for (const it of items) {
      if (it.type === "song") {
        const p = (it.payload as Record<string, string> | null) || {};
        const songId = p.songId;
        if (songId) songCounter.set(songId, (songCounter.get(songId) || 0) + 1);
      } else if (it.type === "scripture") {
        const p = (it.payload as Record<string, unknown>) || {};
        const ref = String(p.reference || "");
        // Extract book + chapter from "John 3:16" style
        const m = /^([1-3]?\s?[A-Za-z ]+)\s+(\d+)/.exec(ref.trim());
        if (m) {
          const key = `${m[1].trim()}|${m[2]}`;
          const prev = scriptureCounter.get(key);
          if (prev) prev.count++;
          else scriptureCounter.set(key, { book: m[1].trim(), chapter: Number(m[2]), count: 1 });
        }
      }
    }
  }

  summary.avgItemCount = Math.round(totalItems / plans.length);
  summary.typicalItemOrder = computeTypicalOrder(perPlanTypes, summary.avgItemCount);

  // Top songs — resolve songIds to titles
  const topSongIds = Array.from(songCounter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topSongIds.length > 0) {
    const rows = await db.select({ id: songs.id, title: songs.title }).from(songs)
      .where(and(eq(songs.churchId, churchId), sql`${songs.id} = ANY(${topSongIds.map(([id]) => id)})`));
    const idToTitle = new Map(rows.map((r) => [r.id, r.title]));
    summary.topSongs = topSongIds
      .map(([id, count]) => ({ title: idToTitle.get(id) || "(deleted song)", count }))
      .filter((s) => s.title !== "(deleted song)");
  }

  // Top scriptures
  summary.topScriptures = Array.from(scriptureCounter.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  await upsert(churchId, summary);
  return summary;
}

/**
 * The "typical order" is the mode of item types at each position. If a
 * position doesn't have a clear plurality winner, it's omitted so the
 * suggestion doesn't include noise.
 */
function computeTypicalOrder(perPlanTypes: ItemType[][], avgLen: number): ItemType[] {
  if (perPlanTypes.length === 0) return [];
  const positions: ItemType[] = [];
  for (let i = 0; i < avgLen; i++) {
    const counts = new Map<ItemType, number>();
    for (const arr of perPlanTypes) {
      if (i < arr.length) counts.set(arr[i], (counts.get(arr[i]) || 0) + 1);
    }
    if (counts.size === 0) break;
    const [top, second] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    // Require a modest plurality: top count >= 40% of services AND at
    // least +1 above the runner-up. Otherwise the position is ambiguous.
    if (top[1] >= Math.max(2, Math.ceil(perPlanTypes.length * 0.4)) && (!second || top[1] > second[1])) {
      positions.push(top[0]);
    }
  }
  return positions;
}

async function upsert(churchId: string, s: PatternSummary) {
  const db = getDb();
  const [existing] = await db.select().from(churchServicePatterns).where(eq(churchServicePatterns.churchId, churchId)).limit(1);
  const row = {
    servicesAnalyzed: s.servicesAnalyzed,
    avgItemCount: s.avgItemCount,
    typicalItemOrder: s.typicalItemOrder,
    topSongs: s.topSongs,
    topScriptures: s.topScriptures,
    updatedAt: new Date(),
  };
  if (existing) await db.update(churchServicePatterns).set(row).where(eq(churchServicePatterns.id, existing.id));
  else await db.insert(churchServicePatterns).values({ churchId, ...row });
}

export async function getChurchPatterns(churchId: string): Promise<PatternSummary | null> {
  const db = getDb();
  const [row] = await db.select().from(churchServicePatterns).where(eq(churchServicePatterns.churchId, churchId)).limit(1);
  if (!row) return null;
  return {
    servicesAnalyzed: row.servicesAnalyzed,
    avgItemCount: row.avgItemCount,
    typicalItemOrder: row.typicalItemOrder as ItemType[],
    topSongs: row.topSongs as { title: string; count: number }[],
    topScriptures: row.topScriptures as { book: string; chapter: number; count: number }[],
  };
}

/**
 * Suggested structure for a new blank plan, based on the church's typical
 * order. If there's no pattern yet (< 2 services analyzed), returns a
 * conservative default rather than nothing.
 */
export async function suggestPlanStructure(churchId: string): Promise<{
  items: { type: ItemType; title: string }[];
  basedOnServices: number;
}> {
  const patterns = await getChurchPatterns(churchId);
  if (!patterns || patterns.servicesAnalyzed < 2) {
    return {
      basedOnServices: patterns?.servicesAnalyzed ?? 0,
      items: [
        { type: "logo", title: "Welcome" },
        { type: "song", title: "Opening song" },
        { type: "scripture", title: "Scripture reading" },
        { type: "sermon", title: "Sermon" },
        { type: "blank", title: "Prayer" },
      ],
    };
  }
  const order = patterns.typicalItemOrder.length > 0 ? patterns.typicalItemOrder : ["logo", "song", "scripture", "sermon", "blank"] as ItemType[];
  const titles: Record<ItemType, string> = {
    logo: "Welcome",
    song: "Song",
    scripture: "Scripture reading",
    media: "Media",
    sermon: "Sermon",
    blank: "Prayer",
  };
  return {
    basedOnServices: patterns.servicesAnalyzed,
    items: order.map((type) => ({ type, title: titles[type] })),
  };
}
