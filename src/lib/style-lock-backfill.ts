/**
 * Style-lock backfill planner (2026-09-23) — PURE, unit-tested. Used by
 * scripts/backfill-style-lock.ts. Songs the operator already styled with a
 * theme BEFORE `styleLocked` existed must keep their look now that unlocked
 * lyric slides follow the church theme.
 *
 * Which slides: every slide of a song whose settings carry `themeBackup` or
 * `appliedThemeId` (whole-song apply); otherwise only the slide ids in
 * `slideThemeBackups` that still exist AND belong to that song.
 * What: set styleLocked=true on TEXT objects missing it. The touched slide ids
 * are recorded in songs.settings.styleLockBackfill = { at, slideIds } so the
 * rollback removes styleLocked from exactly those slides (idempotent both ways).
 */
export type BackfillSlide = { id: string; objectsJson: unknown };
export type BackfillSong = { id: string; churchId: string; settings: Record<string, unknown> | null; slides: BackfillSlide[] };

export const BACKFILL_KEY = "styleLockBackfill";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function targetSlideIds(song: BackfillSong): string[] {
  const s = song.settings ?? {};
  const own = new Set(song.slides.map((x) => x.id));
  if (s.themeBackup != null || typeof s.appliedThemeId === "string") return song.slides.map((x) => x.id);
  const per = isObj(s.slideThemeBackups) ? Object.keys(s.slideThemeBackups) : [];
  return per.filter((id) => own.has(id)); // stale/foreign ids are ignored
}

/** Returns the new objectsJson when at least one text object gained styleLocked, else null. */
export function lockTextObjects(objectsJson: unknown): unknown[] | null {
  if (!Array.isArray(objectsJson)) return null; // legacy lyrics-only slide: nothing to lock
  let changed = false;
  const next = objectsJson.map((o) => {
    if (isObj(o) && o.kind === "text" && o.styleLocked !== true) { changed = true; return { ...o, styleLocked: true }; }
    return o;
  });
  return changed ? next : null;
}

export function unlockTextObjects(objectsJson: unknown): unknown[] | null {
  if (!Array.isArray(objectsJson)) return null;
  let changed = false;
  const next = objectsJson.map((o) => {
    if (isObj(o) && o.kind === "text" && "styleLocked" in o) { changed = true; const { styleLocked: _drop, ...rest } = o; void _drop; return rest; }
    return o;
  });
  return changed ? next : null;
}

export type SongPlan = { songId: string; slideUpdates: { id: string; objectsJson: unknown[] }[]; settings: Record<string, unknown> } | null;

/** Forward plan. Idempotent: a song already carrying the backfill key is skipped. */
export function planLock(song: BackfillSong, at: string): SongPlan {
  const s = song.settings ?? {};
  if (isObj(s[BACKFILL_KEY])) return null;
  const ids = new Set(targetSlideIds(song));
  const slideUpdates: { id: string; objectsJson: unknown[] }[] = [];
  for (const sl of song.slides) {
    if (!ids.has(sl.id)) continue;
    const next = lockTextObjects(sl.objectsJson);
    if (next) slideUpdates.push({ id: sl.id, objectsJson: next });
  }
  if (slideUpdates.length === 0) return null;
  return { songId: song.id, slideUpdates, settings: { ...s, [BACKFILL_KEY]: { at, slideIds: slideUpdates.map((u) => u.id) } } };
}

/** Rollback plan: only the recorded slides (that still belong to the song). */
export function planUnlock(song: BackfillSong): SongPlan {
  const s = song.settings ?? {};
  const rec = s[BACKFILL_KEY];
  if (!isObj(rec)) return null;
  const recorded = new Set(Array.isArray(rec.slideIds) ? rec.slideIds.filter((x): x is string => typeof x === "string") : []);
  const slideUpdates: { id: string; objectsJson: unknown[] }[] = [];
  for (const sl of song.slides) {
    if (!recorded.has(sl.id)) continue;
    const next = unlockTextObjects(sl.objectsJson);
    if (next) slideUpdates.push({ id: sl.id, objectsJson: next });
  }
  const { [BACKFILL_KEY]: _gone, ...rest } = s; void _gone;
  return { songId: song.id, slideUpdates, settings: rest };
}
