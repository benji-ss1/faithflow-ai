// Server-only. Core re-chunk logic for ONE song, extracted from actions.ts so
// it can be unit/adversarially tested directly (it is NOT a "use server" action,
// so it never becomes a client-callable endpoint). Callers (reChunkSong,
// reChunkAllSongs) MUST resolve the user via requireCap("edit_library") first —
// this does no auth of its own; it is church-scoped purely by the churchId arg.

import { and, eq, asc, sql } from "drizzle-orm";
import type { getDb } from "../db/client";
import { songs, songSlides, serviceItems, servicePlans } from "../db/schema";
import { chunkLyrics, rejoinSlides } from "../song-chunk";

export type ReChunkOutcome = { before: number; after: number; skipped?: "rich" | "empty" | "noop" };

/**
 * Re-chunk one song's slides. Returns null iff the song is not found in
 * `churchId` (the church-scope gate). Does not revalidate paths.
 *  - Rule 2: skip songs with rich per-slide objects (never destroy styling).
 *  - Rule 4: clear stale per-plan `slideOrder` overrides (church-scoped) in the
 *    same transaction so deleted slide UUIDs can't dangle → blank slides.
 */
export async function reChunkSongCore(
  db: ReturnType<typeof getDb>,
  churchId: string,
  songId: string,
): Promise<ReChunkOutcome | null> {
  const [song] = await db.select().from(songs).where(and(eq(songs.id, songId), eq(songs.churchId, churchId))).limit(1);
  if (!song) return null;

  const slides = await db.select().from(songSlides).where(eq(songSlides.songId, songId)).orderBy(asc(songSlides.order));
  if (slides.length === 0) return { before: 0, after: 0, skipped: "empty" };

  const hasRich = slides.some((s) => {
    const o = s.objectsJson as unknown;
    return Array.isArray(o) ? o.length > 0 : o != null && typeof o === "object" && Object.keys(o).length > 0;
  });
  if (hasRich) return { before: slides.length, after: slides.length, skipped: "rich" };

  const chunked = chunkLyrics(rejoinSlides(slides.map((s) => s.lyrics)));
  if (chunked.length === 0) return { before: slides.length, after: slides.length, skipped: "empty" };
  const unchanged = chunked.length === slides.length && chunked.every((l, i) => l === slides[i].lyrics);
  if (unchanged) return { before: slides.length, after: slides.length, skipped: "noop" };

  await db.transaction(async (tx) => {
    await tx.delete(songSlides).where(eq(songSlides.songId, songId));
    await tx.insert(songSlides).values(chunked.map((lyrics, i) => ({ songId, order: i, lyrics })));
    const affected = await tx
      .select({ id: serviceItems.id, payload: serviceItems.payload })
      .from(serviceItems)
      .innerJoin(servicePlans, eq(serviceItems.servicePlanId, servicePlans.id))
      .where(and(
        eq(servicePlans.churchId, churchId),
        eq(serviceItems.type, "song"),
        sql`${serviceItems.payload}->>'songId' = ${songId}`,
        sql`${serviceItems.payload} ? 'slideOrder'`,
      ));
    for (const it of affected) {
      const payload = { ...(it.payload as Record<string, unknown>) };
      delete payload.slideOrder;
      await tx.update(serviceItems).set({ payload }).where(eq(serviceItems.id, it.id));
    }
  });
  return { before: slides.length, after: chunked.length };
}
