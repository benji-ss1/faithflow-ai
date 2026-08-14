// Server-only. Announcements + themes list helpers.
import { eq, asc, and } from "drizzle-orm";
import { getDb } from "../db/client";
import { announcements, announcementPresets, themes } from "../db/schema";
import { refreshPresignedUrl } from "../s3";

export async function listAnnouncements(churchId: string) {
  const db = getDb();
  return db.select().from(announcements)
    .where(eq(announcements.churchId, churchId))
    .orderBy(asc(announcements.createdAt));
}

export async function listAnnouncementPresets(churchId: string) {
  const db = getDb();
  return db.select().from(announcementPresets)
    .where(eq(announcementPresets.churchId, churchId))
    .orderBy(asc(announcementPresets.createdAt));
}

export async function listThemes(churchId: string) {
  const db = getDb();
  return db.select().from(themes)
    .where(eq(themes.churchId, churchId))
    .orderBy(asc(themes.createdAt));
}

/**
 * Re-sign any expiring media URLs stored in a theme config so a theme's
 * background / logo / video never 404s after the original 6h presign lapses.
 * External (non-presigned) URLs pass through untouched. Call at every point a
 * theme config is loaded for consumption (operator + web).
 */
export async function refreshThemeMediaUrls(config: unknown): Promise<unknown> {
  if (!config || typeof config !== "object") return config;
  const c = config as Record<string, unknown>;
  const out: Record<string, unknown> = { ...c };
  for (const field of ["bgImageUrl", "logoUrl", "bgVideoUrl"] as const) {
    const v = out[field];
    if (typeof v === "string" && v) out[field] = await refreshPresignedUrl(v);
  }
  return out;
}

export async function getTheme(id: string, churchId: string) {
  const db = getDb();
  const [row] = await db.select().from(themes)
    .where(and(eq(themes.id, id), eq(themes.churchId, churchId))).limit(1);
  return row ?? null;
}
