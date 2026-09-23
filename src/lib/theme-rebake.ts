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
export type { BakeableThemeConfig };

// `bgExplicit` is theme-owned too: a bake sets it alongside bgColor/bgImageUrl,
// so an undo that restores the pre-theme background must restore the marker with
// it — otherwise a stale `true` makes a restored default black paint as a choice.
export const THEME_OWNED_SLIDE_FIELDS = ["bgType", "bgColor", "bgColor2", "bgImageUrl", "bgExplicit", "transition"] as const;
export const THEME_OWNED_TEXT_FIELDS = ["fontFamily", "fontSize", "fontWeight", "color", "align"] as const;

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isOperatorSetBg(k: string, cur: Obj, orig: Obj, originalObjectsJson: unknown, bakedConfigs: BakeableThemeConfig[]): boolean {
  if (sameValue(cur[k], orig[k])) return false;
  for (const c of bakedConfigs) {
    if (sameValue(cur[k], bakeThemeIntoObjectsJson(c, originalObjectsJson)[k])) return false;
  }
  return true;
}

const BAKEABLE_KEYS = ["fontFamily", "fontSizePx", "fontWeight", "textColor", "align", "bgType", "bgColor", "bgColor2", "bgImageUrl", "transition"] as const;
/** The bake-relevant subset of a theme config (no layout/media blobs) — what a
 *  song stores to remember what it was baked with. */
export function pickBakedConfig(cfg: unknown): BakeableThemeConfig {
  const c = asObj(cfg);
  const out: Obj = {};
  for (const k of BAKEABLE_KEYS) if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
  return out as BakeableThemeConfig;
}
export type BakeableThemeConfigList = BakeableThemeConfig[];
const MAX_BAKED_CONFIGS = 5;
/** Stored baked-config list, or undefined when absent/malformed (legacy). */
export function readBakedConfigs(v: unknown): BakeableThemeConfig[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map((x) => pickBakedConfig(x));
}
/**
 * The baked-config list to store after baking `cfg` ON TOP of a slide's current
 * look. `prior` = configs already baked into it; `legacyThemed` = the slide
 * already carries a theme bake with no stored config ⇒ stay legacy (undefined),
 * so a later re-apply keeps today's reset-all behaviour for it.
 */
export function appendBakedConfig(prior: BakeableThemeConfig[] | undefined, cfg: unknown, legacyThemed: boolean): BakeableThemeConfig[] | undefined {
  if (!prior && legacyThemed) return undefined;
  return [...(prior ?? []), pickBakedConfig(cfg)].slice(-MAX_BAKED_CONFIGS);
}

function copyField(target: Obj, source: Obj, key: string) {
  if (source[key] === undefined) delete target[key];
  else target[key] = source[key];
}

export type ThemeOwnedFields = { slide: readonly string[]; text: readonly string[] };
export const ALL_THEME_OWNED_FIELDS: ThemeOwnedFields = { slide: THEME_OWNED_SLIDE_FIELDS, text: THEME_OWNED_TEXT_FIELDS };

/**
 * The slide/text fields a set of theme configs actually bake. A re-apply only
 * resets THESE (from the new AND the previous config), so an operator's own
 * value for a field no theme version ever set (e.g. fontWeight) survives.
 * The bake also writes an auto-contrast text colour whenever a bgColor is set.
 */
export function themeFieldsForConfigs(configs: unknown[]): ThemeOwnedFields {
  const slide = new Set<string>();
  const text = new Set<string>();
  for (const c of configs) {
    const cfg = asObj(c);
    const has = (k: string) => cfg[k] !== undefined && cfg[k] !== null;
    for (const k of ["bgType", "bgColor", "bgColor2", "bgImageUrl", "transition"]) if (has(k)) slide.add(k);
    if (has("fontFamily")) text.add("fontFamily");
    if (has("fontSizePx")) text.add("fontSize");
    if (has("fontWeight")) text.add("fontWeight");
    if (has("align")) text.add("align");
    if (has("textColor") || has("bgColor")) text.add("color");
  }
  return { slide: [...slide], text: [...text] };
}

/**
 * Fields a theme RE-APPLY resets from the pre-theme snapshot. Background
 * fields (bgType/bgColor/bgColor2/bgImageUrl/transition) are ALWAYS reset —
 * regardless of which keys the new/previous config carry — because a stale
 * baked background (e.g. an image left over after a previous edit whose
 * `previousConfig` was lost) otherwise sticks forever ("keep songs" bg
 * leftover). Text fields keep the key-union protection so an operator's own
 * value for a field no theme version set (e.g. fontWeight) survives.
 */
export function reapplyFieldsForConfigs(configs: unknown[]): ThemeOwnedFields {
  return { slide: THEME_OWNED_SLIDE_FIELDS, text: themeFieldsForConfigs(configs).text };
}

/**
 * Restore theme-owned fields on `current` from `original` (no bake).
 *
 * `bakedConfigs` (review fix): the theme config(s) THIS slide was actually baked
 * with, stored SERVER-SIDE on the song at bake time (never from the client).
 * When given, a BACKGROUND field is only reset if its current value is the
 * snapshot's or what one of those configs baked onto the snapshot (theme-owned /
 * leftover — including a song baked on an OLDER theme version). A background the
 * operator set by hand matches none of them and is kept. Undefined (legacy song,
 * no stored config) ⇒ every background field is reset, as before.
 */
export function resetThemeOwnedFields(currentObjectsJson: unknown, originalObjectsJson: unknown, fields: ThemeOwnedFields = ALL_THEME_OWNED_FIELDS, bakedConfigs?: BakeableThemeConfig[]): Obj {
  const cur = asObj(currentObjectsJson);
  const orig = asObj(originalObjectsJson);
  const out: Obj = { ...cur };
  for (const k of fields.slide) {
    if (bakedConfigs && isOperatorSetBg(k, cur, orig, originalObjectsJson, bakedConfigs)) continue; // operator-set: keep
    copyField(out, orig, k);
  }
  const origObjects = Array.isArray(orig.objects) ? (orig.objects as Obj[]) : [];
  const byId = new Map<string, Obj>();
  for (const o of origObjects) if (o && typeof o.id === "string") byId.set(o.id, o);
  const curObjects = Array.isArray(cur.objects) ? (cur.objects as Obj[]) : [];
  out.objects = curObjects.map((o) => {
    if (!o || o.kind !== "text") return o;
    const src = typeof o.id === "string" ? byId.get(o.id) : undefined;
    if (!src) return o; // object added after the first apply — no snapshot to restore from
    const next: Obj = { ...o };
    for (const k of fields.text) copyField(next, src, k);
    // 2026-09-23: the lock the theme apply added goes too — a reverted slide
    // gets back EXACTLY its pre-apply lock state (unlocked → follows the
    // theme again; a slide that was already hand-styled/locked stays locked).
    copyField(next, src, "styleLocked");
    return next;
  });
  return out;
}

/** Reset theme-owned fields from the snapshot, then bake the (current) theme. */
export function rebakeThemeFromOriginal(cfg: BakeableThemeConfig, currentObjectsJson: unknown, originalObjectsJson: unknown, fields: ThemeOwnedFields = ALL_THEME_OWNED_FIELDS, bakedConfigs?: BakeableThemeConfig[]): Obj {
  const reset = resetThemeOwnedFields(currentObjectsJson, originalObjectsJson, fields, bakedConfigs);
  if (bakedConfigs) {
    // Keep operator-set backgrounds through the bake too: the new theme must not
    // overwrite a field the operator chose by hand.
    const cur = asObj(currentObjectsJson);
    const baked = bakeThemeIntoObjectsJson(cfg, reset);
    for (const k of fields.slide) {
      if (!sameValue(reset[k], asObj(originalObjectsJson)[k]) && sameValue(reset[k], cur[k])) copyField(baked, cur, k);
    }
    return baked;
  }
  return bakeThemeIntoObjectsJson(cfg, reset);
}

export type ThemeBackupEntry = { id: string; objectsJson: unknown };
export type ThemeBackup = { slides: ThemeBackupEntry[]; themeId?: string; bakedConfigs?: BakeableThemeConfig[] };

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
  const bc = readBakedConfigs(p.bakedConfigs);
  return { slides: [...prevSlides, ...added], themeId, ...(bc ? { bakedConfigs: bc } : {}) };
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
): { original: unknown; addToBackup: boolean; bakedConfigs?: BakeableThemeConfig[] } | null {
  const s = asObj(settings);
  const perSlide = asObj(s.slideThemeBackups)[slide.id];
  if (perSlide !== undefined) {
    const entry = asObj(perSlide);
    if (entry.themeId !== themeId) return null;
    const bc = readBakedConfigs(entry.bakedConfigs);
    return { original: entry.objectsJson ?? null, addToBackup: false, ...(bc ? { bakedConfigs: bc } : {}) };
  }
  if (s.appliedThemeId !== themeId) return null;
  const backup = asObj(s.themeBackup);
  const list = Array.isArray(backup.slides) ? (backup.slides as Obj[]) : [];
  const hit = list.find((e) => e && e.id === slide.id);
  const bakedConfigs = readBakedConfigs(backup.bakedConfigs);
  if (hit) return { original: hit.objectsJson ?? null, addToBackup: false, ...(bakedConfigs ? { bakedConfigs } : {}) };
  // Slide created after the apply: its current look IS the snapshot.
  return { original: slide.objectsJson ?? null, addToBackup: true, ...(bakedConfigs ? { bakedConfigs } : {}) };
}

/** Drop backup entries whose slides no longer exist. */
export function pruneThemeBackup(backup: unknown, existingSlideIds: Iterable<string>): ThemeBackup | undefined {
  const b = asObj(backup);
  if (!Array.isArray(b.slides)) return undefined;
  const ids = new Set(existingSlideIds);
  const slides = (b.slides as unknown[]).filter((e): e is ThemeBackupEntry => !!e && typeof (e as Obj).id === "string" && ids.has((e as Obj).id as string));
  const bc = readBakedConfigs(b.bakedConfigs);
  return { slides, ...(typeof b.themeId === "string" ? { themeId: b.themeId } : {}), ...(bc ? { bakedConfigs: bc } : {}) };
}

/**
 * A duplicated slide inherits its source's pre-theme snapshot (whole-song
 * backup + per-slide override), so a later re-apply/revert treats the copy
 * exactly like the original instead of snapshotting an already-themed look.
 * Returns the new settings, or null when there is nothing to copy.
 */
export function copyThemeBackupForDuplicate(settings: unknown, sourceSlideId: string, newSlideId: string): Obj | null {
  const s = asObj(settings);
  let changed = false;
  const next: Obj = { ...s };
  const backup = asObj(s.themeBackup);
  if (Array.isArray(backup.slides)) {
    const hit = (backup.slides as Obj[]).find((e) => e && e.id === sourceSlideId);
    if (hit && !(backup.slides as Obj[]).some((e) => e && e.id === newSlideId)) {
      next.themeBackup = { ...backup, slides: [...(backup.slides as Obj[]), { id: newSlideId, objectsJson: hit.objectsJson ?? null }] };
      changed = true;
    }
  }
  const per = asObj(s.slideThemeBackups);
  if (per[sourceSlideId] !== undefined && per[newSlideId] === undefined) {
    next.slideThemeBackups = { ...per, [newSlideId]: per[sourceSlideId] };
    changed = true;
  }
  return changed ? next : null;
}
