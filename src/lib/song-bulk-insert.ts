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

  // Dedupe key is case/whitespace-insensitive. This matters for the CHUNKED
  // importer: the parse pipeline used to collapse "Amazing Grace"/"amazing
  // grace" to one song before this function ever saw them, but batching splits
  // such variants across separate calls, so cross-batch dedupe now happens
  // ONLY here — it must match the pipeline's case-insensitive key.
  const existingTitles = new Set(
    (await db.select({ title: songs.title }).from(songs).where(eq(songs.churchId, churchId))).map((r) => r.title.trim().toLowerCase()),
  );

  const toInsert: SongCandidate[] = [];
  const seenInBatch = new Set<string>();
  let remaining = headroom;
  let duplicateSkipped = 0;
  let limitSkipped = 0;

  for (const c of candidates) {
    const title = c.title.trim();
    const key = title.toLowerCase();
    if (!title || c.slides.length === 0) { duplicateSkipped++; continue; }
    if (existingTitles.has(key) || seenInBatch.has(key)) { duplicateSkipped++; continue; }
    if (remaining <= 0) { limitSkipped++; continue; }
    seenInBatch.add(key);
    toInsert.push({ ...c, title });
    remaining--;
  }

  if (toInsert.length === 0) return { added: 0, skipped: duplicateSkipped + limitSkipped, duplicateSkipped, limitSkipped };

  // ALL-OR-NOTHING per import (review 🔴): the songs insert and the (chunked)
  // slide inserts run in ONE transaction. Without this, a failure on a later
  // slide chunk (timeout, dropped connection, param overflow) would leave
  // songs already committed with missing/partial slides — and because those
  // titles now "exist", a retry dup-skips them, stranding the church with
  // broken half-songs. The transaction rolls the whole batch back so the user
  // gets a clean failure and a clean retry.
  //
  // Chunking rationale: a large library produces tens of thousands of slide
  // rows; a single VALUES insert would blow Postgres's 65535 bound-parameter
  // limit (slides 3 params/row → ~21k rows; songs 4 params/row → ~16k rows).
  // Both inserts are chunked so even a mega-library can't overflow.
  const SONG_CHUNK = 5000;
  const SLIDE_CHUNK = 5000;
  const added = await db.transaction(async (tx) => {
    const idByTitle = new Map<string, string>();
    for (let i = 0; i < toInsert.length; i += SONG_CHUNK) {
      const batch = toInsert.slice(i, i + SONG_CHUNK);
      const rows = await tx.insert(songs).values(
        batch.map((c) => ({ churchId, title: c.title, artist: c.artist ?? null, source: c.source })),
      ).returning({ id: songs.id, title: songs.title });
      // Match returned rows back up by TITLE, not array position — RETURNING
      // order in VALUES order is an implementation detail, not a guarantee.
      // Titles are already deduped within this batch, so the map is 1:1.
      for (const r of rows) idByTitle.set(r.title, r.id);
    }

    const slideRows: { songId: string; order: number; lyrics: string }[] = [];
    toInsert.forEach((c) => {
      const songId = idByTitle.get(c.title);
      if (!songId) return; // shouldn't happen — every toInsert title was just inserted
      c.slides.forEach((lyrics, order) => slideRows.push({ songId, order, lyrics }));
    });
    for (let i = 0; i < slideRows.length; i += SLIDE_CHUNK) {
      await tx.insert(songSlides).values(slideRows.slice(i, i + SLIDE_CHUNK));
    }
    return toInsert.length;
  });
  void added;

  return {
    added: toInsert.length,
    skipped: duplicateSkipped + limitSkipped,
    duplicateSkipped,
    limitSkipped,
  };
}
