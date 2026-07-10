// Server-only. Announcements + themes list helpers.
import { eq, asc, and } from "drizzle-orm";
import { getDb } from "../db/client";
import { announcements, announcementPresets, themes } from "../db/schema";

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

export async function getTheme(id: string, churchId: string) {
  const db = getDb();
  const [row] = await db.select().from(themes)
    .where(and(eq(themes.id, id), eq(themes.churchId, churchId))).limit(1);
  return row ?? null;
}
