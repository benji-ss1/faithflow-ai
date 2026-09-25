/**
 * New-song dialog options (PP7 "New Presentation", plan A.6) — PURE helpers so
 * the server gate and the dialog share one definition and both are
 * node-testable without a DB.
 *
 * Security boundary: `resolveNewSongOptions` is called by `createSong` BEFORE
 * any row is inserted, with lookups that are church-scoped
 * (`eq(themes.churchId, user.churchId)` etc.). A theme / library / playlist id
 * from another church simply isn't found ⇒ the whole create is refused, so a
 * forged id can never attach a foreign theme to a new song.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sentinel values the dialog uses in its selects. */
export const NEW_SONG_THEME_NONE = "none";
export const NEW_SONG_LIBRARY_DEFAULT = "default";
export const NEW_SONG_PLAYLIST_NONE = "none";

/** Display-only sizes. Songs carry no size in the data model (output size is a
 *  screen setting), so this is never persisted — see the dialog's hint. */
export const NEW_SONG_SIZES = ["1920x1080", "1280x720"] as const;
export type NewSongSize = (typeof NEW_SONG_SIZES)[number];

export type NewSongOptionsInput = { themeId?: unknown; libraryId?: unknown };
export type NewSongLookups = {
  /** true iff a theme with this id belongs to the caller's church. */
  themeInChurch: (id: string) => Promise<boolean>;
  /** null when OK, else an error string (not found / smart folder). */
  libraryError: (id: string) => Promise<string | null>;
};
export type ResolvedNewSongOptions = { themeId: string | null; libraryId: string | null };

function readId(v: unknown, sentinel: string): string | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return "invalid";
  const s = v.trim();
  if (s === "" || s === sentinel) return null;
  return UUID_RE.test(s) ? s : "invalid";
}

export async function resolveNewSongOptions(
  input: NewSongOptionsInput,
  lookups: NewSongLookups,
): Promise<{ ok: true; data: ResolvedNewSongOptions } | { ok: false; error: string }> {
  const themeId = readId(input.themeId, NEW_SONG_THEME_NONE);
  if (themeId === "invalid") return { ok: false, error: "Theme not found" };
  const libraryId = readId(input.libraryId, NEW_SONG_LIBRARY_DEFAULT);
  if (libraryId === "invalid") return { ok: false, error: "Library not found in your church" };
  if (themeId && !(await themeInChurch(lookups, themeId))) return { ok: false, error: "Theme not found" };
  if (libraryId) {
    const err = await lookups.libraryError(libraryId);
    if (err) return { ok: false, error: err };
  }
  return { ok: true, data: { themeId, libraryId } };
}

async function themeInChurch(l: NewSongLookups, id: string): Promise<boolean> {
  try { return (await l.themeInChurch(id)) === true; } catch { return false; }
}

// ── Theme picker Recents (per user/device, localStorage) ────────────────────
// Reuses the operator's shared theme Recents list (theme-apply-client), so the
// dialog and the top-bar Themes popover agree. Order = most recent first.
export const NEW_SONG_RECENTS_MAX = 3;

/** The recents to show: known ids only, most-recent first, capped. */
export function pickRecentThemes<T extends { id: string }>(recentIds: string[], themes: T[], max = NEW_SONG_RECENTS_MAX): T[] {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const out: T[] = [];
  for (const id of recentIds) {
    const t = byId.get(id);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** New list after choosing `id` (moved to the front, de-duplicated). */
export function nextRecents(prev: string[], id: string, max = 6): string[] {
  return [id, ...prev.filter((x) => x !== id)].slice(0, max);
}
