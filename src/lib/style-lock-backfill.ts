/**
 * Style-lock backfill planner (2026-09-23) — PURE, unit-tested. Used by
 * scripts/backfill-style-lock.ts. Songs the operator already styled BEFORE
 * `styleLocked` existed must keep their look now that unlocked plain lyric
 * slides follow the church theme.
 *
 * Stored shape (every writer — saveSlideObjects, bakeThemeIntoObjectsJson,
 * song-rechunk, theme-editor-model): objectsJson = { bgColor, bgImageUrl,
 * bgExplicit?, objects: [...] }. A bare array is tolerated (defensive); null /
 * anything else is a legacy lyrics-only slide and is never touched.
 *
 * WHICH TEXT OBJECTS GET LOCKED
 *  (a) Theme markers — songs.settings has `themeBackup` or `appliedThemeId`
 *      (whole-song apply) → every text object on every slide; otherwise the
 *      slide ids in `slideThemeBackups` (still existing, this song's own).
 *  (b) Hand-styled slides — ANY slide (marker or not) whose SOLE visible text
 *      object has a non-default look, or whose background was chosen:
 *        - colour / fontFamily / fontWeight / align differ from the editor
 *          defaults (TEXT_DEFAULTS = emptyTextObject: Inter/600/#fff/center) —
 *          the only style keys the plain-lyric renderer ever honoured, so a
 *          size/lineHeight-only difference (AutoFit owns size) never locks;
 *        - `bgExplicit: true`, or a stored bgColor that isn't black / the
 *          legacy #010101 theme sentinel (pre-2026-09-21 hand-picked colours
 *          and PP7 coloured slides had no bgExplicit flag).
 *      Importers are NOT a concern: verified on main 2026-09-23 that no
 *      importer (ProPresenter / EasyWorship / CSV / pipeline / song-bulk-insert
 *      / import-actions / pro7-parser) writes objectsJson — they insert lyrics
 *      only. Every styled objectsJson therefore came from a deliberate edit or
 *      a theme apply, so no import marker is needed.
 *
 * RECORD: songs.settings.styleLockBackfill = { at, locked: { slideId: [objId] } }
 * — exactly the objects this backfill locked. Rollback removes styleLocked ONLY
 * from those objects (a lock that pre-existed, or that an operator added later,
 * is kept). Re-running is safe: objects already locked are never re-recorded,
 * new locks are merged into the existing record, and a run that changes
 * nothing produces no plan.
 */
export type BackfillSlide = { id: string; objectsJson: unknown };
export type BackfillSong = { id: string; churchId: string; settings: Record<string, unknown> | null; slides: BackfillSlide[] };

export const BACKFILL_KEY = "styleLockBackfill";

const TEXT_DEFAULTS: Record<string, unknown> = { fontFamily: "Inter", fontWeight: 600, color: "#ffffff", align: "center" };
const RENDERED_STYLE_KEYS = ["color", "fontFamily", "fontWeight", "align"] as const;
const DEFAULT_BGS = new Set(["", "#000000", "#000", "black", "rgb(0,0,0)", "rgb(0, 0, 0)", "#010101"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
const norm = (c: unknown) => (typeof c === "string" ? c.trim().toLowerCase() : c ?? null);

/** Objects list + a writer that puts a new list back in the same shape. */
function readShape(objectsJson: unknown): { objects: unknown[]; bgColor?: unknown; bgExplicit?: unknown; wrap: (next: unknown[]) => unknown } | null {
  if (Array.isArray(objectsJson)) return { objects: objectsJson, wrap: (next) => next };
  if (isObj(objectsJson) && Array.isArray(objectsJson.objects)) {
    const base = objectsJson;
    return { objects: base.objects as unknown[], bgColor: base.bgColor, bgExplicit: base.bgExplicit, wrap: (next) => ({ ...base, objects: next }) };
  }
  return null;
}

export function targetSlideIds(song: BackfillSong): string[] {
  const s = song.settings ?? {};
  const own = new Set(song.slides.map((x) => x.id));
  if (s.themeBackup != null || typeof s.appliedThemeId === "string") return song.slides.map((x) => x.id);
  const per = isObj(s.slideThemeBackups) ? Object.keys(s.slideThemeBackups) : [];
  return per.filter((id) => own.has(id)); // stale/foreign ids are ignored
}

/** Id of the sole visible text object when the slide is hand-styled (rule b), else null. */
export function handStyledTextId(objectsJson: unknown): string | null {
  const sh = readShape(objectsJson);
  if (!sh) return null;
  const visible = sh.objects.filter((o) => isObj(o) && o.hidden !== true);
  const t = visible[0];
  if (visible.length !== 1 || !isObj(t) || t.kind !== "text" || typeof t.id !== "string") return null;
  const bgChosen = sh.bgExplicit === true || (typeof sh.bgColor === "string" && !DEFAULT_BGS.has(norm(sh.bgColor) as string));
  const styled = RENDERED_STYLE_KEYS.some((k) => t[k] !== undefined && norm(t[k]) !== norm(TEXT_DEFAULTS[k]));
  return bgChosen || styled ? t.id : null;
}

/** Lock the given text objects (all text objects when ids === "all"). Returns new json + locked ids, or null. */
export function lockTextObjects(objectsJson: unknown, ids: "all" | Set<string> = "all"): { objectsJson: unknown; lockedIds: string[] } | null {
  const sh = readShape(objectsJson);
  if (!sh) return null;
  const lockedIds: string[] = [];
  const next = sh.objects.map((o) => {
    if (isObj(o) && o.kind === "text" && typeof o.id === "string" && o.styleLocked !== true && (ids === "all" || ids.has(o.id))) {
      lockedIds.push(o.id);
      return { ...o, styleLocked: true };
    }
    return o;
  });
  return lockedIds.length ? { objectsJson: sh.wrap(next), lockedIds } : null;
}

/** Remove styleLocked from exactly the given object ids. */
export function unlockTextObjects(objectsJson: unknown, ids: Set<string>): unknown | null {
  const sh = readShape(objectsJson);
  if (!sh) return null;
  let changed = false;
  const next = sh.objects.map((o) => {
    if (isObj(o) && o.kind === "text" && typeof o.id === "string" && ids.has(o.id) && "styleLocked" in o) {
      changed = true; const { styleLocked: _drop, ...rest } = o; void _drop; return rest;
    }
    return o;
  });
  return changed ? sh.wrap(next) : null;
}

export type SongPlan = { songId: string; slideUpdates: { id: string; objectsJson: unknown }[]; settings: Record<string, unknown> } | null;

function recordOf(s: Record<string, unknown>): Record<string, string[]> {
  const rec = s[BACKFILL_KEY];
  const out: Record<string, string[]> = {};
  if (isObj(rec) && isObj(rec.locked)) {
    for (const [k, v] of Object.entries(rec.locked)) if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
  }
  return out;
}

/** Forward plan. Idempotent + re-runnable: only objects not yet locked are touched and recorded. */
export function planLock(song: BackfillSong, at: string): SongPlan {
  const s = song.settings ?? {};
  const marked = new Set(targetSlideIds(song));
  const slideUpdates: { id: string; objectsJson: unknown }[] = [];
  const locked = recordOf(s);
  for (const sl of song.slides) {
    let ids: "all" | Set<string> | null = null;
    if (marked.has(sl.id)) ids = "all";
    else { const h = handStyledTextId(sl.objectsJson); if (h) ids = new Set([h]); }
    if (!ids) continue;
    const r = lockTextObjects(sl.objectsJson, ids);
    if (!r) continue;
    slideUpdates.push({ id: sl.id, objectsJson: r.objectsJson });
    locked[sl.id] = [...new Set([...(locked[sl.id] ?? []), ...r.lockedIds])];
  }
  if (slideUpdates.length === 0) return null;
  const prev = s[BACKFILL_KEY];
  const prevAt = isObj(prev) && typeof prev.at === "string" ? prev.at : undefined;
  return { songId: song.id, slideUpdates, settings: { ...s, [BACKFILL_KEY]: { at: prevAt ?? at, ...(prevAt ? { lastRunAt: at } : {}), locked } } };
}

/** Rollback plan: remove styleLocked from exactly the recorded objects. */
export function planUnlock(song: BackfillSong): SongPlan {
  const s = song.settings ?? {};
  if (!isObj(s[BACKFILL_KEY])) return null;
  const locked = recordOf(s);
  const slideUpdates: { id: string; objectsJson: unknown }[] = [];
  for (const sl of song.slides) {
    const ids = locked[sl.id];
    if (!ids?.length) continue;
    const next = unlockTextObjects(sl.objectsJson, new Set(ids));
    if (next) slideUpdates.push({ id: sl.id, objectsJson: next });
  }
  const { [BACKFILL_KEY]: _gone, ...rest } = s; void _gone;
  return { songId: song.id, slideUpdates, settings: rest };
}
