/**
 * Style-lock backfill (2026-09-23). NOT run automatically — an operator runs it
 * deliberately, dry-run first. Church-scoped, idempotent, reversible.
 *
 *   npx tsx scripts/backfill-style-lock.ts --dry-run            # per-church counts, no writes
 *   npx tsx scripts/backfill-style-lock.ts                       # apply
 *   npx tsx scripts/backfill-style-lock.ts --rollback [--dry-run]
 *   ... --church <uuid>                                          # limit to one church
 *
 * Planning logic (which slides, idempotency, rollback) lives in
 * src/lib/style-lock-backfill.ts and is unit-tested.
 * NOTE: rule-of-thumb for the unlocked-lyric change — a slide the operator
 * UNSTYLED later (removeThemeFromSongSlide) is not in slideThemeBackups any
 * more and so is correctly left unlocked.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { songs, songSlides } from "../src/lib/db/schema";
import { planLock, planUnlock, type BackfillSong } from "../src/lib/style-lock-backfill";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const rollback = process.argv.includes("--rollback");
  const ci = process.argv.indexOf("--church");
  const onlyChurch = ci >= 0 ? process.argv[ci + 1] : null;
  const db = getDb();
  const at = new Date().toISOString();

  // Candidate songs only: those with a theme marker (forward) or backfill key (rollback).
  const marker = rollback
    ? sql`${songs.settings} ? 'styleLockBackfill'`
    : sql`(${songs.settings} ? 'themeBackup' OR ${songs.settings} ? 'appliedThemeId' OR ${songs.settings} ? 'slideThemeBackups')`;
  const rows = await db.select({ id: songs.id, churchId: songs.churchId, settings: songs.settings })
    .from(songs).where(onlyChurch ? and(marker, eq(songs.churchId, onlyChurch)) : marker);

  const perChurch = new Map<string, { songs: number; slides: number }>();
  for (const r of rows) {
    const slides = await db.select({ id: songSlides.id, objectsJson: songSlides.objectsJson })
      .from(songSlides).where(eq(songSlides.songId, r.id));
    const song: BackfillSong = { id: r.id, churchId: r.churchId, settings: (r.settings ?? {}) as Record<string, unknown>, slides };
    const plan = rollback ? planUnlock(song) : planLock(song, at);
    if (!plan) continue;
    const c = perChurch.get(r.churchId) ?? { songs: 0, slides: 0 };
    c.songs++; c.slides += plan.slideUpdates.length; perChurch.set(r.churchId, c);
    if (dry) continue;
    await db.transaction(async (tx) => {
      for (const u of plan.slideUpdates) {
        // Scoped to THIS song's slides (and the song to its church below).
        await tx.update(songSlides).set({ objectsJson: u.objectsJson })
          .where(and(eq(songSlides.id, u.id), eq(songSlides.songId, r.id)));
      }
      await tx.update(songs).set({ settings: plan.settings })
        .where(and(eq(songs.id, r.id), eq(songs.churchId, r.churchId)));
    });
  }
  for (const [churchId, c] of perChurch) {
    console.log(JSON.stringify({ event: rollback ? "stylelock.rollback" : "stylelock.lock", dryRun: dry, churchId, songs: c.songs, slides: c.slides }));
  }
  console.log(JSON.stringify({ event: "stylelock.done", dryRun: dry, rollback, churches: perChurch.size, candidates: rows.length }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
