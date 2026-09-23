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

/** Static CSS swatches that resemble each animated background as rendered
 *  (the raw primary→secondary gradient was misleading for several). Falls back
 *  to that gradient for a preset without an entry. */
const BACKGROUND_SWATCHES: Record<string, string> = {
  gentleWaves: "linear-gradient(180deg, #0A1628 0%, #12394a 55%, #1A5C5C 100%)",
  holyFire: "radial-gradient(circle at 30% 70%, rgba(232,80,26,0.55) 0 3%, transparent 4%), radial-gradient(circle at 65% 40%, rgba(212,120,30,0.5) 0 2.5%, transparent 3.5%), radial-gradient(circle at 80% 80%, rgba(232,80,26,0.45) 0 2%, transparent 3%), #0e0806",
  cleanSlate: "linear-gradient(180deg, #0F0F14, #0A0A0E)",
  goldenBokeh: "radial-gradient(ellipse at 12% 0%, rgba(140,115,115,0.55), transparent 55%), radial-gradient(circle at 40% 55%, rgba(232,184,106,0.7) 0 5%, transparent 6%), radial-gradient(circle at 70% 40%, rgba(255,240,215,0.55) 0 3%, transparent 4%), linear-gradient(180deg, #04050a, #0B0F1C)",
  waterfall: "linear-gradient(90deg, transparent 18%, rgba(159,212,232,0.35) 30% 70%, transparent 82%), linear-gradient(0deg, rgba(220,235,255,0.35), transparent 45%), linear-gradient(180deg, #0B2A36, #06151b)",
  forestLight: "linear-gradient(210deg, rgba(243,230,166,0.4), transparent 55%), linear-gradient(180deg, #0F3A22, #06170e)",
  heavenClouds: "radial-gradient(ellipse at 30% 55%, rgba(200,200,215,0.55), transparent 45%), radial-gradient(ellipse at 75% 35%, rgba(215,205,190,0.5), transparent 40%), linear-gradient(0deg, #1E3A66, #5a5a70)",
  gloryDust: "radial-gradient(circle at 25% 30%, #fff 0 1%, transparent 1.5%), radial-gradient(circle at 70% 60%, #C9A7FF 0 1%, transparent 1.5%), radial-gradient(circle at 50% 50%, #120A24, #05030b)",
  auroraGlow: "linear-gradient(0deg, transparent 45%, rgba(54,224,160,0.55) 55%, rgba(115,90,240,0.25) 75%, transparent 90%), linear-gradient(180deg, #05101E, #020609)",
  stillWaters: "linear-gradient(180deg, #14203a 0%, #7a6a5e 50%, #5d5049 54%, #101a2c 100%)",
};

/** Built-in animated backgrounds a church may pick as its default (no "none",
 *  no retired presets, no per-machine custom uploads). */
export const DEFAULT_BACKGROUND_CHOICES = BUILT_IN_BACKGROUNDS
  .filter((b) => b.id !== "none")
  .map((b) => ({ id: b.id, name: b.name, primary: b.shaderPrimaryColor ?? "#111", secondary: b.shaderSecondaryColor ?? "#333", swatch: BACKGROUND_SWATCHES[b.id] }));


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
  /** true when the default_background_id column exists (checked BEFORE any write) */
  backgroundReady: () => Promise<boolean>;
  /** Optional: write every field in ONE transaction (production path). When
   *  given, the per-field writers are not used. false ⇒ nothing was saved. */
  writeAll?: (churchId: string, v: { backgroundId?: string | null; translationId?: string | null; mainThemeId?: string | null }) => Promise<boolean>;
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
  // All-or-nothing (2026-09-23 review): the background column may not be
  // migrated yet — check BEFORE writing anything, then write the background
  // FIRST so its failure can never leave translation/theme half-saved.
  const bgPending = { ok: false as const, error: "Default background isn't available yet (database update pending). Nothing was saved." };
  if (deps.writeAll) {
    if (v.backgroundId !== undefined && !(await deps.backgroundReady())) return bgPending;
    const ok = await deps.writeAll(churchId, {
      ...(v.backgroundId !== undefined ? { backgroundId: v.backgroundId } : {}),
      ...(v.translationId !== undefined ? { translationId: v.translationId } : {}),
      ...(typeof v.mainThemeId === "string" ? { mainThemeId: v.mainThemeId } : {}),
    });
    return ok ? { ok: true } : { ok: false, error: "Couldn't save church defaults. Nothing was saved." };
  }
  if (v.backgroundId !== undefined) {
    if (!(await deps.backgroundReady())) return bgPending;
    if (!(await deps.writeBackground(churchId, v.backgroundId))) return bgPending;
  }
  if (v.translationId !== undefined) await deps.writeTranslation(churchId, v.translationId);
  if (typeof v.mainThemeId === "string") await deps.writeMainTheme(churchId, v.mainThemeId);
  return { ok: true };
}
