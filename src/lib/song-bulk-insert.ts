import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { songs, songSlides } from "./db/schema";

export type SongCandidate = {
  title: string;
  artist?: string | null;
  slides: string[];
  source: "imported";
};

/**
 * Shared by every bulk song-import path (importDrop, finalizeImport,
 * importPro6Files, importSongsCsv) — previously each did its own per-item
 * `SELECT` dup-check + `INSERT songs` + `INSERT songSlides` sequentially in
 * a loop, so a 200-song import paid 400-600+ round trips. This does the
 * dup-check as ONE query up front and the inserts as two multi-row
 * statements total, regardless of batch size.
 */
export async function bulkInsertSongs(
  churchId: string,
  candidates: SongCandidate[],
  headroom: number,
): Promise<{
  added: number;
  /** Legacy combined count (invalid + duplicate + limit) — MigrationStep still renders this. */
  skipped: number;
  /** Skipped because the title already exists (in DB or earlier in this batch) or was invalid. */
  duplicateSkipped: number;
  /** Skipped because the church hit its song-limit headroom — NOT duplicates. */
  limitSkipped: number;
}> {
  const db = getDb();
  if (candidates.length === 0) return { added: 0, skipped: 0, duplicateSkipped: 0, limitSkipped: 0 };

  const existingTitles = new Set(
    (await db.select({ title: songs.title }).from(songs).where(eq(songs.churchId, churchId))).map((r) => r.title),
  );

  const toInsert: SongCandidate[] = [];
  const seenInBatch = new Set<string>();
  let remaining = headroom;
  let duplicateSkipped = 0;
  let limitSkipped = 0;

  for (const c of candidates) {
    const title = c.title.trim();
    if (!title || c.slides.length === 0) { duplicateSkipped++; continue; }
    if (existingTitles.has(title) || seenInBatch.has(title)) { duplicateSkipped++; continue; }
    if (remaining <= 0) { limitSkipped++; continue; }
    seenInBatch.add(title);
    toInsert.push({ ...c, title });
    remaining--;
  }

  if (toInsert.length === 0) return { added: 0, skipped: duplicateSkipped + limitSkipped, duplicateSkipped, limitSkipped };

  // Match returned rows back up by TITLE, not array position. Postgres
  // reliably returns RETURNING rows in VALUES order today for a plain,
  // trigger-free, non-partitioned insert like this one — but that's an
  // implementation detail, not a documented guarantee, so match on the
  // (already-deduped-within-this-batch) title instead of trusting index
  // alignment. Removes the risk entirely at negligible cost.
  const rows = await db.insert(songs).values(
    toInsert.map((c) => ({ churchId, title: c.title, artist: c.artist ?? null, source: c.source })),
  ).returning({ id: songs.id, title: songs.title });
  const idByTitle = new Map(rows.map((r) => [r.title, r.id]));

  const slideRows: { songId: string; order: number; lyrics: string }[] = [];
  toInsert.forEach((c) => {
    const songId = idByTitle.get(c.title);
    if (!songId) return; // shouldn't happen — every toInsert title was just inserted
    c.slides.forEach((lyrics, order) => slideRows.push({ songId, order, lyrics }));
  });
  if (slideRows.length > 0) {
    await db.insert(songSlides).values(slideRows);
  }

  return {
    added: toInsert.length,
    skipped: duplicateSkipped + limitSkipped,
    duplicateSkipped,
    limitSkipped,
  };
}
