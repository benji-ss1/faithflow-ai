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
  // Theme Editor layout (PR 1): slide background images and image/video
  // objects inside config.layout are presigned too — re-sign them so layout
  // media doesn't expire after 6h.
  const layout = out.layout as { slides?: unknown } | undefined;
  if (layout && typeof layout === "object" && Array.isArray(layout.slides)) {
    const slides = await Promise.all(layout.slides.map(async (sl) => {
      if (!sl || typeof sl !== "object") return sl;
      const slide = { ...(sl as Record<string, unknown>) };
      if (typeof slide.bgImageUrl === "string" && slide.bgImageUrl) slide.bgImageUrl = await refreshPresignedUrl(slide.bgImageUrl);
      if (Array.isArray(slide.objects)) {
        slide.objects = await Promise.all(slide.objects.map(async (o) => {
          if (!o || typeof o !== "object") return o;
          const obj = o as Record<string, unknown>;
          if ((obj.kind === "image" || obj.kind === "video") && typeof obj.url === "string" && obj.url) {
            return { ...obj, url: await refreshPresignedUrl(obj.url) };
          }
          return obj;
        }));
      }
      return slide;
    }));
    out.layout = { ...(layout as Record<string, unknown>), slides };
  }
  return out;
}

export async function getTheme(id: string, churchId: string) {
  const db = getDb();
  const [row] = await db.select().from(themes)
    .where(and(eq(themes.id, id), eq(themes.churchId, churchId))).limit(1);
  return row ?? null;
}
