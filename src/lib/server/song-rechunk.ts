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

type SlideObjects = { bgColor?: string; bgImageUrl?: string; objects?: Array<Record<string, unknown>> };

/** Normalise objectsJson to the { bgColor, bgImageUrl, objects[] } shape (it may
 * be stored as a bare objects array on older rows). Returns null when the slide
 * carries no designed objects (a plain-lyric slide). */
function readObjects(o: unknown): SlideObjects | null {
  if (Array.isArray(o)) return o.length > 0 ? { objects: o as Array<Record<string, unknown>> } : null;
  if (o && typeof o === "object") {
    const oj = o as SlideObjects;
    return Array.isArray(oj.objects) && oj.objects.length > 0 ? oj : null;
  }
  return null;
}

/**
 * Re-chunk one song's slides. Returns null iff the song is not found in
 * `churchId` (the church-scope gate). Does not revalidate paths.
 *  - Text-styled designed songs (every object is a text object) are re-chunked
 *    IN A STYLE-PRESERVING way: the design (bg + the text object's font/colour/
 *    geometry) is carried onto every new slide, only the text is re-flowed.
 *  - Songs with non-text objects (images/shapes/videos) are still skipped —
 *    re-chunking can't reassign those without loss.
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

  // Designed slides + whether the whole song is text-only (safe to re-flow) or
  // carries images/shapes (must be left alone).
  const designed = slides.map((s) => readObjects(s.objectsJson)).filter((o): o is SlideObjects => o != null);
  const hasRich = designed.length > 0;
  // Only re-flow when EVERY designed slide is a single text box (+ optional bg).
  // A slide with an image/shape/video OR with 2+ text boxes (e.g. lyric +
  // translation, or a titled layout) can't be re-chunked without moving/merging
  // those — so we keep the protective skip and don't touch the styling.
  const uniformSingleText = designed.every((o) => {
    const objs = o.objects ?? [];
    return objs.length === 1 && !!objs[0] && objs[0].kind === "text";
  });
  if (hasRich && !uniformSingleText) return { before: slides.length, after: slides.length, skipped: "rich" };

  const chunked = chunkLyrics(rejoinSlides(slides.map((s) => s.lyrics)));
  if (chunked.length === 0) return { before: slides.length, after: slides.length, skipped: "empty" };
  const unchanged = chunked.length === slides.length && chunked.every((l, i) => l === slides[i].lyrics);
  if (unchanged) return { before: slides.length, after: slides.length, skipped: "noop" };

  // Style-preserving template for text-styled songs: the first designed slide's
  // background + its first text object with the text stripped (font/colour/
  // weight/align/geometry preserved), applied to every re-chunked slide so the
  // look survives the tidy. Null for plain-lyric songs (no design to carry).
  let template: { bgColor?: string; bgImageUrl?: string; textObj: Record<string, unknown> } | null = null;
  if (hasRich && uniformSingleText) {
    const first = designed[0];
    const firstTextObj = (first.objects ?? []).find((o) => o && o.kind === "text");
    if (firstTextObj) {
      const { text: _drop, ...styleOnly } = firstTextObj as { text?: unknown } & Record<string, unknown>;
      void _drop;
      template = { bgColor: first.bgColor, bgImageUrl: first.bgImageUrl, textObj: styleOnly };
    }
  }
  const buildRow = (lyrics: string, i: number) =>
    template
      ? { songId, order: i, lyrics, objectsJson: { bgColor: template.bgColor, bgImageUrl: template.bgImageUrl, objects: [{ ...template.textObj, text: lyrics }] } }
      : { songId, order: i, lyrics };

  await db.transaction(async (tx) => {
    await tx.delete(songSlides).where(eq(songSlides.songId, songId));
    await tx.insert(songSlides).values(chunked.map((lyrics, i) => buildRow(lyrics, i)));
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
