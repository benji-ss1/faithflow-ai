// Theme re-apply helpers (Theme Editor PR 1). Pure — no DB — so the re-bake and
// backup-preservation rules are directly unit-testable.
//
// Why "reset then bake": bakeThemeIntoObjectsJson only OVERWRITES fields the
// theme defines. If an operator removes a field from a theme (e.g. clears the
// background image) and we re-bake on top of the already-baked slide, the old
// value sticks forever. So we first restore every THEME-OWNED field from the
// slide's pre-theme snapshot, then bake. Content (lyrics/text, positions, other
// objects) always comes from the CURRENT slide, so edits made since the first
// apply are kept.
import { bakeThemeIntoObjectsJson, type BakeableThemeConfig } from "./theme-bake";

export const THEME_OWNED_SLIDE_FIELDS = ["bgType", "bgColor", "bgColor2", "bgImageUrl", "transition"] as const;
export const THEME_OWNED_TEXT_FIELDS = ["fontFamily", "fontSize", "fontWeight", "color", "align"] as const;

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

function copyField(target: Obj, source: Obj, key: string) {
  if (source[key] === undefined) delete target[key];
  else target[key] = source[key];
}

/** Restore theme-owned fields on `current` from `original` (no bake). */
export function resetThemeOwnedFields(currentObjectsJson: unknown, originalObjectsJson: unknown): Obj {
  const cur = asObj(currentObjectsJson);
  const orig = asObj(originalObjectsJson);
  const out: Obj = { ...cur };
  for (const k of THEME_OWNED_SLIDE_FIELDS) copyField(out, orig, k);
  const origObjects = Array.isArray(orig.objects) ? (orig.objects as Obj[]) : [];
  const byId = new Map<string, Obj>();
  for (const o of origObjects) if (o && typeof o.id === "string") byId.set(o.id, o);
  const curObjects = Array.isArray(cur.objects) ? (cur.objects as Obj[]) : [];
  out.objects = curObjects.map((o) => {
    if (!o || o.kind !== "text") return o;
    const src = typeof o.id === "string" ? byId.get(o.id) : undefined;
    if (!src) return o; // object added after the first apply — no snapshot to restore from
    const next: Obj = { ...o };
    for (const k of THEME_OWNED_TEXT_FIELDS) copyField(next, src, k);
    return next;
  });
  return out;
}

/** Reset theme-owned fields from the snapshot, then bake the (current) theme. */
export function rebakeThemeFromOriginal(cfg: BakeableThemeConfig, currentObjectsJson: unknown, originalObjectsJson: unknown): Obj {
  return bakeThemeIntoObjectsJson(cfg, resetThemeOwnedFields(currentObjectsJson, originalObjectsJson));
}

export type ThemeBackupEntry = { id: string; objectsJson: unknown };
export type ThemeBackup = { slides: ThemeBackupEntry[]; themeId?: string };

/**
 * Preserve the FIRST pre-theme snapshot across repeated applies (the revert
 * bug: every apply used to overwrite the backup with already-themed slides, so
 * "Undo theme" restored the previous theme instead of the original look).
 * Existing entries are kept verbatim; only slides with no entry yet (created
 * after the first apply) are added with their current objectsJson.
 */
export function mergeThemeBackup(prev: unknown, slides: { id: string; objectsJson: unknown }[], themeId: string): ThemeBackup {
  const p = asObj(prev);
  const prevSlides = Array.isArray(p.slides)
    ? (p.slides as unknown[]).filter((e): e is ThemeBackupEntry => !!e && typeof (e as Obj).id === "string")
    : [];
  const have = new Set(prevSlides.map((e) => e.id));
  const added = slides.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, objectsJson: s.objectsJson ?? null }));
  return { slides: [...prevSlides, ...added], themeId };
}

/**
 * Decide what a theme re-apply should do with one slide of a song.
 * Returns the snapshot to rebake from, or null to skip the slide.
 *   - slide has a per-slide override of ANOTHER theme (or a legacy entry with no
 *     themeId) → skip (the operator chose a different look for that slide)
 *   - per-slide override of THIS theme → rebake from that slide's snapshot
 *   - whole-song apply of THIS theme → rebake from the song backup (or, for a
 *     slide created after the apply, from its current state)
 */
export function reapplySourceForSlide(
  themeId: string,
  slide: { id: string; objectsJson: unknown },
  settings: unknown,
): { original: unknown; addToBackup: boolean } | null {
  const s = asObj(settings);
  const perSlide = asObj(s.slideThemeBackups)[slide.id];
  if (perSlide !== undefined) {
    const entry = asObj(perSlide);
    if (entry.themeId !== themeId) return null;
    return { original: entry.objectsJson ?? null, addToBackup: false };
  }
  if (s.appliedThemeId !== themeId) return null;
  const backup = asObj(s.themeBackup);
  const list = Array.isArray(backup.slides) ? (backup.slides as Obj[]) : [];
  const hit = list.find((e) => e && e.id === slide.id);
  if (hit) return { original: hit.objectsJson ?? null, addToBackup: false };
  return { original: slide.objectsJson ?? null, addToBackup: true };
}
