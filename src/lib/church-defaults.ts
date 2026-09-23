/**
 * Church defaults (2026-09-23, user-approved) — PURE logic, unit-tested.
 *
 * Three church-level defaults an admin sets once (settings modal "Church
 * defaults" tab, /organization, onboarding):
 *   1. default Bible translation  → church_preferences.default_translation_id
 *   2. main theme                 → themes.is_default (the star)
 *   3. default animated background → church_preferences.default_background_id
 *
 * In-service changes (translation switch incl. voice, theme apply, background
 * pick) stay SESSION-ONLY; only these explicit actions write the defaults.
 */
import { BUILT_IN_BACKGROUNDS } from "@/backgrounds/presets/defaultTemplates";

export const FALLBACK_TRANSLATION_CODE = "KJV";

/** Built-in animated backgrounds a church may pick as its default (no "none",
 *  no retired presets, no per-machine custom uploads). */
export const DEFAULT_BACKGROUND_CHOICES = BUILT_IN_BACKGROUNDS
  .filter((b) => b.id !== "none")
  .map((b) => ({ id: b.id, name: b.name, primary: b.shaderPrimaryColor ?? "#111", secondary: b.shaderSecondaryColor ?? "#333" }));

export function isValidDefaultBackgroundId(id: unknown): id is string {
  return typeof id === "string" && DEFAULT_BACKGROUND_CHOICES.some((b) => b.id === id);
}

/** `undefined` = leave unchanged; `null` = clear; string = set. */
export type ChurchDefaultsInput = {
  translationId?: string | null;
  mainThemeId?: string | null;
  backgroundId?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whitelist + shape-check raw client input BEFORE any DB access. Returns the
 * normalized patch or an error. Ownership/accessibility is checked server-side
 * afterwards (translation accessible to the church; theme belongs to it).
 */
export function normalizeChurchDefaultsInput(raw: unknown):
  | { ok: true; value: ChurchDefaultsInput }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid input" };
  const r = raw as Record<string, unknown>;
  const out: ChurchDefaultsInput = {};
  if ("translationId" in r) {
    if (r.translationId === null) out.translationId = null;
    else if (typeof r.translationId === "string" && UUID_RE.test(r.translationId)) out.translationId = r.translationId;
    else return { ok: false, error: "Invalid translation" };
  }
  if ("mainThemeId" in r) {
    // The main theme can be changed but not cleared here (a church always keeps
    // its current star until another is chosen).
    if (typeof r.mainThemeId === "string" && UUID_RE.test(r.mainThemeId)) out.mainThemeId = r.mainThemeId;
    else if (r.mainThemeId !== null) return { ok: false, error: "Invalid theme" };
  }
  if ("backgroundId" in r) {
    if (r.backgroundId === null || r.backgroundId === "none" || r.backgroundId === "") out.backgroundId = null;
    else if (isValidDefaultBackgroundId(r.backgroundId)) out.backgroundId = r.backgroundId;
    else return { ok: false, error: "Invalid background" };
  }
  return { ok: true, value: out };
}

/** A translation is usable by a church when it is public-domain or its
 *  licensed code is unlocked for that church (mirrors /api/bible/translations). */
export function isTranslationAccessible(
  t: { code: string; licenseRequired: boolean } | undefined | null,
  unlockedCodes: Set<string>,
): boolean {
  if (!t) return false;
  return !t.licenseRequired || unlockedCodes.has(t.code.toUpperCase());
}

/**
 * Fresh-machine rule for the default animated background: seed it ONLY when
 * this machine has never stored a background selection (key absent). An
 * existing selection — including an explicit "none" — always wins.
 */
export function shouldSeedDefaultBackground(storedActiveId: string | null, churchDefaultId: string | null | undefined): boolean {
  return storedActiveId === null && isValidDefaultBackgroundId(churchDefaultId);
}

export type ChurchDefaultsDeps = {
  translationAccessible: (churchId: string, translationId: string) => Promise<boolean>;
  themeBelongs: (churchId: string, themeId: string) => Promise<boolean>;
  writeTranslation: (churchId: string, translationId: string | null) => Promise<void>;
  writeMainTheme: (churchId: string, themeId: string) => Promise<void>;
  /** false when the column is not migrated yet */
  writeBackground: (churchId: string, backgroundId: string | null) => Promise<boolean>;
};

/**
 * Validate EVERYTHING first (church-scoped ownership/accessibility), then write.
 * A foreign theme id or an inaccessible translation rejects the whole call
 * before any write — so church A can never make church B's theme its default,
 * nor clear its own default with a bad id.
 */
export async function applyChurchDefaults(
  churchId: string,
  raw: unknown,
  deps: ChurchDefaultsDeps,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!churchId) return { ok: false, error: "No church" };
  const norm = normalizeChurchDefaultsInput(raw);
  if (!norm.ok) return norm;
  const v = norm.value;
  if (typeof v.translationId === "string" && !(await deps.translationAccessible(churchId, v.translationId))) {
    return { ok: false, error: "That translation isn't available to your church" };
  }
  if (typeof v.mainThemeId === "string" && !(await deps.themeBelongs(churchId, v.mainThemeId))) {
    return { ok: false, error: "Theme not found" };
  }
  if (v.translationId !== undefined) await deps.writeTranslation(churchId, v.translationId);
  if (typeof v.mainThemeId === "string") await deps.writeMainTheme(churchId, v.mainThemeId);
  if (v.backgroundId !== undefined) {
    const ok = await deps.writeBackground(churchId, v.backgroundId);
    if (!ok) return { ok: false, error: "Default background isn't available yet (database update pending)" };
  }
  return { ok: true };
}
