import "server-only";
/**
 * Church defaults (2026-09-23) — server reads/writes. Church-scoped on every
 * query. `default_background_id` is an ADDITIVE column
 * (docs/migrations/2026-09-23-church-default-background.sql) read/written with
 * explicit raw SQL inside try/catch, so its absence can never break the
 * operate page or the translation default.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { churchPreferences, bibleTranslations, themes } from "@/lib/db/schema";
import { availableLicensedCodes, listTranslations } from "@/lib/server/bible";
import { FALLBACK_TRANSLATION_CODE, isTranslationAccessible, isValidDefaultBackgroundId } from "@/lib/church-defaults";

/** The church's default Bible translation CODE, or KJV. Never throws. */
export async function getChurchDefaultTranslationCode(churchId: string): Promise<string> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ code: bibleTranslations.code })
      .from(churchPreferences)
      .innerJoin(bibleTranslations, eq(bibleTranslations.id, churchPreferences.defaultTranslationId))
      .where(eq(churchPreferences.churchId, churchId))
      .limit(1);
    return row?.code ?? FALLBACK_TRANSLATION_CODE;
  } catch {
    return FALLBACK_TRANSLATION_CODE;
  }
}

/** The church default animated background id, or null (also when the column
 *  has not been migrated yet). Never throws. */
export async function getChurchDefaultBackgroundId(churchId: string): Promise<string | null> {
  try {
    const db = getDb();
    const res = await db.execute(sql`SELECT default_background_id FROM church_preferences WHERE church_id = ${churchId} LIMIT 1`);
    const v = (res.rows?.[0] as { default_background_id?: unknown } | undefined)?.default_background_id;
    return isValidDefaultBackgroundId(v) ? v : null;
  } catch {
    return null;
  }
}

export type ChurchDefaultsView = {
  translationId: string | null;
  translationCode: string;
  mainThemeId: string | null;
  backgroundId: string | null;
  translations: { id: string; code: string; name: string }[];
  themes: { id: string; name: string; config: Record<string, unknown>; isDefault: boolean }[];
};

/** Everything the Church defaults card needs, church-scoped. */
export async function getChurchDefaultsView(churchId: string): Promise<ChurchDefaultsView> {
  const db = getDb();
  const [prefs] = await db
    .select({ defaultTranslationId: churchPreferences.defaultTranslationId })
    .from(churchPreferences)
    .where(eq(churchPreferences.churchId, churchId))
    .limit(1);
  const [all, unlocked, themeRows, backgroundId] = await Promise.all([
    listTranslations(),
    availableLicensedCodes(churchId),
    db.select({ id: themes.id, name: themes.name, config: themes.config, isDefault: themes.isDefault })
      .from(themes).where(eq(themes.churchId, churchId)),
    getChurchDefaultBackgroundId(churchId),
  ]);
  const translations = all.filter((t) => isTranslationAccessible(t, unlocked)).map((t) => ({ id: t.id, code: t.code, name: t.name }));
  const translationId = prefs?.defaultTranslationId ?? null;
  const code = all.find((t) => t.id === translationId)?.code ?? FALLBACK_TRANSLATION_CODE;
  return {
    translationId,
    translationCode: code,
    mainThemeId: themeRows.find((t) => t.isDefault)?.id ?? null,
    backgroundId,
    translations,
    themes: themeRows
      .map((t) => ({ id: t.id, name: t.name, config: (t.config ?? {}) as Record<string, unknown>, isDefault: t.isDefault }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** True when the translation exists AND is usable by this church. */
export async function translationAccessibleToChurch(churchId: string, translationId: string): Promise<boolean> {
  const all = await listTranslations();
  const t = all.find((x) => x.id === translationId);
  if (!t) return false;
  if (!t.licenseRequired) return true;
  return isTranslationAccessible(t, await availableLicensedCodes(churchId));
}

/** True when the theme exists AND belongs to this church. */
export async function themeBelongsToChurch(churchId: string, themeId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select({ id: themes.id }).from(themes)
    .where(and(eq(themes.id, themeId), eq(themes.churchId, churchId))).limit(1);
  return !!row;
}

// ── writes (church-scoped) ──────────────────────────────────────────────────
export async function writeChurchDefaultTranslation(churchId: string, translationId: string | null): Promise<void> {
  const db = getDb();
  const [existing] = await db.select({ id: churchPreferences.id }).from(churchPreferences)
    .where(eq(churchPreferences.churchId, churchId)).limit(1);
  if (existing) {
    await db.update(churchPreferences).set({ defaultTranslationId: translationId, updatedAt: new Date() })
      .where(eq(churchPreferences.churchId, churchId));
  } else {
    await db.insert(churchPreferences).values({ churchId, defaultTranslationId: translationId });
  }
}

export async function writeChurchMainTheme(churchId: string, themeId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(themes).set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(themes.churchId, churchId), eq(themes.isDefault, true)));
    await tx.update(themes).set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(themes.id, themeId), eq(themes.churchId, churchId)));
  });
}

/** True when church_preferences.default_background_id exists (never throws). */
export async function churchDefaultBackgroundReady(): Promise<boolean> {
  try {
    const db = getDb();
    const res = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'church_preferences' AND column_name = 'default_background_id' LIMIT 1`);
    return (res.rows?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Returns false when the column is not migrated yet (never throws). Checks
 *  the column BEFORE inserting a preferences row, so a failed call has no
 *  side effect. */
export async function writeChurchDefaultBackground(churchId: string, backgroundId: string | null): Promise<boolean> {
  try {
    if (!(await churchDefaultBackgroundReady())) return false;
    const db = getDb();
    const [existing] = await db.select({ id: churchPreferences.id }).from(churchPreferences)
      .where(eq(churchPreferences.churchId, churchId)).limit(1);
    if (!existing) await db.insert(churchPreferences).values({ churchId });
    await db.execute(sql`UPDATE church_preferences SET default_background_id = ${backgroundId}, updated_at = now() WHERE church_id = ${churchId}`);
    return true;
  } catch {
    return false;
  }
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * All-or-nothing defaults save (2026-09-24 review): background + translation +
 * main theme are written in ONE transaction, so a DB error on any write rolls
 * back the others. Returns false (nothing saved) on any failure. The
 * background column readiness is checked BEFORE the transaction opens.
 */
export async function writeChurchDefaultsAtomic(
  churchId: string,
  v: { backgroundId?: string | null; translationId?: string | null; mainThemeId?: string | null },
): Promise<boolean> {
  try {
    if (v.backgroundId !== undefined && !(await churchDefaultBackgroundReady())) return false;
    const db = getDb();
    await db.transaction(async (tx: Tx) => {
      const needsPrefs = v.backgroundId !== undefined || v.translationId !== undefined;
      if (needsPrefs) {
        const [existing] = await tx.select({ id: churchPreferences.id }).from(churchPreferences)
          .where(eq(churchPreferences.churchId, churchId)).limit(1);
        if (!existing) await tx.insert(churchPreferences).values({ churchId });
      }
      if (v.backgroundId !== undefined) {
        await tx.execute(sql`UPDATE church_preferences SET default_background_id = ${v.backgroundId}, updated_at = now() WHERE church_id = ${churchId}`);
      }
      if (v.translationId !== undefined) {
        await tx.update(churchPreferences).set({ defaultTranslationId: v.translationId, updatedAt: new Date() })
          .where(eq(churchPreferences.churchId, churchId));
      }
      if (typeof v.mainThemeId === "string") {
        await tx.update(themes).set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(themes.churchId, churchId), eq(themes.isDefault, true)));
        await tx.update(themes).set({ isDefault: true, updatedAt: new Date() })
          .where(and(eq(themes.id, v.mainThemeId), eq(themes.churchId, churchId)));
      }
    });
    return true;
  } catch {
    return false;
  }
}
