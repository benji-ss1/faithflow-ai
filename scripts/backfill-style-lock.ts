/**
 * Style-lock backfill (2026-09-23). NOT run automatically — an operator runs it
 * deliberately, dry-run first. Church-scoped, idempotent, reversible, re-runnable.
 *
 *   npx tsx scripts/backfill-style-lock.ts --dry-run [--verbose]  # per-church counts (+ per-song list), no writes
 *   npx tsx scripts/backfill-style-lock.ts                         # apply
 *   npx tsx scripts/backfill-style-lock.ts --rollback [--dry-run]  # exact undo
 *   ... --church <uuid>                                            # limit to one church
 *
 * DEPLOY ORDER (see docs/migrations/2026-09-23-church-default-background.sql):
 * this runs BEFORE the "theme wins" renderer code reaches production. Current
 * production ignores `styleLocked` (unknown-but-valid field in
 * broadcast.ts isValidSlideObject), so writing it early changes nothing on
 * screen. Safe to re-run after deploy (only not-yet-locked objects are touched).
 *
 * WHAT IT LOCKS (full rule + rationale in src/lib/style-lock-backfill.ts):
 *  - theme-marked songs (themeBackup / appliedThemeId / slideThemeBackups);
 *  - any slide whose sole text object is hand-styled (colour/font/weight/align
 *    differ from editor defaults) or whose background was chosen. Importers
 *    never write objectsJson (verified on main), so every styled slide is a
 *    deliberate edit.
 * Records exactly which object ids it locked per slide; --rollback removes only those.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { songs, songSlides } from "../src/lib/db/schema";
import { planLock, planUnlock, type BackfillSong } from "../src/lib/style-lock-backfill";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 500;

async function main() {
  const dry = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");
  const rollback = process.argv.includes("--rollback");
  const ci = process.argv.indexOf("--church");
  const onlyChurch = ci >= 0 ? process.argv[ci + 1] : null;
  if (ci >= 0 && (!onlyChurch || !UUID_RE.test(onlyChurch))) {
    console.error("--church needs a church UUID"); process.exit(2);
  }
  const db = getDb();
  const at = new Date().toISOString();

  // Candidates: rollback → songs carrying the record; forward → theme-marked
  // songs OR songs with at least one designed slide (objects_json present).
  const marker = rollback
    ? sql`${songs.settings} ? 'styleLockBackfill'`
    : sql`(${songs.settings} ? 'themeBackup' OR ${songs.settings} ? 'appliedThemeId' OR ${songs.settings} ? 'slideThemeBackups'
          OR EXISTS (SELECT 1 FROM song_slides ss WHERE ss.song_id = ${songs.id} AND ss.objects_json IS NOT NULL))`;

  const perChurch = new Map<string, { songs: number; slides: number }>();
  let candidates = 0;
  const count = (churchId: string, songId: string, title: string, slides: number) => {
    const c = perChurch.get(churchId) ?? { songs: 0, slides: 0 };
    c.songs++; c.slides += slides; perChurch.set(churchId, c);
    if (verbose) console.log(JSON.stringify({ event: "stylelock.song", churchId, songId, title, slides }));
  };
  let cursor: string | null = null;
  for (;;) {
    const conds = [marker];
    if (onlyChurch) conds.push(eq(songs.churchId, onlyChurch));
    if (cursor) conds.push(gt(songs.id, cursor));
    const rows = await db.select({ id: songs.id, churchId: songs.churchId, settings: songs.settings, title: songs.title })
      .from(songs).where(and(...conds)).orderBy(asc(songs.id)).limit(PAGE);
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    candidates += rows.length;
    // One slides query per page (not per song).
    const slideRows = await db.select({ id: songSlides.id, songId: songSlides.songId, objectsJson: songSlides.objectsJson })
      .from(songSlides).where(inArray(songSlides.songId, rows.map((r) => r.id)));
    const bySong = new Map<string, { id: string; objectsJson: unknown }[]>();
    for (const s of slideRows) {
      const list = bySong.get(s.songId) ?? [];
      list.push({ id: s.id, objectsJson: s.objectsJson });
      bySong.set(s.songId, list);
    }
    for (const r of rows) {
      const song: BackfillSong = { id: r.id, churchId: r.churchId, settings: (r.settings ?? {}) as Record<string, unknown>, slides: bySong.get(r.id) ?? [] };
      const plan0 = rollback ? planUnlock(song) : planLock(song, at);
      if (!plan0) continue;
      if (dry) { count(r.churchId, r.id, r.title, plan0.slideUpdates.length); continue; }
      // Race fix (2026-09-24): an operator may save/apply a theme between the
      // page read and this write. Re-read the song FOR UPDATE (same lock
      // revertSongTheme takes) + its slides INSIDE the transaction and plan
      // from those fresh rows, so we never write back stale data.
      await db.transaction(async (tx) => {
        const [fresh] = await tx.select({ id: songs.id, churchId: songs.churchId, settings: songs.settings })
          .from(songs).where(and(eq(songs.id, r.id), eq(songs.churchId, r.churchId))).for("update");
        if (!fresh) return;
        const freshSlides = await tx.select({ id: songSlides.id, objectsJson: songSlides.objectsJson })
          .from(songSlides).where(eq(songSlides.songId, r.id));
        const fs: BackfillSong = { id: fresh.id, churchId: fresh.churchId, settings: (fresh.settings ?? {}) as Record<string, unknown>, slides: freshSlides };
        const plan = rollback ? planUnlock(fs) : planLock(fs, at);
        if (!plan) return;
        for (const u of plan.slideUpdates) {
          // Scoped to THIS song's slides (and the song to its church below).
          await tx.update(songSlides).set({ objectsJson: u.objectsJson })
            .where(and(eq(songSlides.id, u.id), eq(songSlides.songId, r.id)));
        }
        await tx.update(songs).set({ settings: plan.settings })
          .where(and(eq(songs.id, r.id), eq(songs.churchId, r.churchId)));
        count(r.churchId, r.id, r.title, plan.slideUpdates.length);
      });
    }
  }
  for (const [churchId, c] of perChurch) {
    console.log(JSON.stringify({ event: rollback ? "stylelock.rollback" : "stylelock.lock", dryRun: dry, churchId, songs: c.songs, slides: c.slides }));
  }
  console.log(JSON.stringify({ event: "stylelock.done", dryRun: dry, rollback, churches: perChurch.size, candidates }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
