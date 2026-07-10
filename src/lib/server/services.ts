// Server-only. Do not import from client components.
import { eq, asc, and } from "drizzle-orm";
import { getDb } from "../db/client";
import { desc } from "drizzle-orm";
import { servicePlans, serviceItems, songs, songSlides, mediaAssets, pptxImports, pptxSlides, settings, aiSuggestions } from "../db/schema";
import { presignGet } from "../s3";
import type { SlidePayload } from "../broadcast";

export type ExpandedItem = {
  id: string;
  order: number;
  type: "song" | "scripture" | "media" | "sermon" | "blank" | "logo";
  title: string;
  slides: SlidePayload[];
  pptxImportId?: string; // present for sermon items — enables /api/sermon/match
  // Phase 5D: song-editor needs the underlying song ID + raw slide rows
  // (with objectsJson) to enable per-slide object editing. Populated only
  // for song items.
  songId?: string;
  songSlideRows?: { id: string; lyrics: string; objectsJson: unknown }[];
};

export type ExpandedPlan = {
  id: string;
  title: string;
  items: ExpandedItem[];
  logoUrl?: string;
  blankBgColor: string;
};

export async function getExpandedServicePlan(planId: string, churchId: string): Promise<ExpandedPlan | null> {
  const db = getDb();
  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, churchId))).limit(1);
  if (!plan) return null;

  const items = await db.select().from(serviceItems).where(eq(serviceItems.servicePlanId, plan.id)).orderBy(asc(serviceItems.order));
  const [chSettings] = await db.select().from(settings).where(eq(settings.churchId, churchId)).limit(1);
  const logoUrl = chSettings?.logoS3Key ? await presignGet(chSettings.logoS3Key) : undefined;
  const blankBgColor = chSettings?.blankBgColor || "#000000";

  const expanded: ExpandedItem[] = [];
  for (const it of items) {
    const payload = (it.payload || {}) as Record<string, unknown>;
    let slides: SlidePayload[] = [];

    let songId: string | undefined;
    let songSlideRows: { id: string; lyrics: string; objectsJson: unknown }[] | undefined;
    if (it.type === "song" && payload.songId) {
      songId = String(payload.songId);
      const rows = await db.select().from(songSlides).where(eq(songSlides.songId, songId)).orderBy(asc(songSlides.order));
      songSlideRows = rows.map((r) => ({ id: r.id, lyrics: r.lyrics, objectsJson: r.objectsJson }));
      slides = rows.map((r) => ({ kind: "text" as const, text: r.lyrics }));
    } else if (it.type === "scripture") {
      const scriptureSlides = Array.isArray(payload.slides) ? (payload.slides as { text: string }[]) : [];
      slides = scriptureSlides.map((s) => ({ kind: "text" as const, text: s.text }));
      if (slides.length === 0 && typeof payload.text === "string") slides = [{ kind: "text", text: payload.text as string }];
    } else if (it.type === "media" && payload.mediaAssetId) {
      const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, String(payload.mediaAssetId))).limit(1);
      if (asset) {
        const url = await presignGet(asset.s3Key);
        const fit = (payload.fitMode === "cover" ? "cover" : "contain") as "cover" | "contain";
        slides = [asset.kind === "video" ? { kind: "video", url, fit } : { kind: "image", url, fit }];
      }
    } else if (it.type === "sermon" && payload.pptxImportId) {
      const rows = await db.select().from(pptxSlides).where(eq(pptxSlides.pptxImportId, String(payload.pptxImportId))).orderBy(asc(pptxSlides.order));
      slides = await Promise.all(rows.map(async (r) => ({ kind: "image" as const, url: await presignGet(r.imageS3Key), fit: "contain" as const })));
    } else if (it.type === "blank") {
      slides = [{ kind: "blank", bgColor: blankBgColor }];
    } else if (it.type === "logo") {
      slides = [{ kind: "logo", url: logoUrl }];
    }

    if (slides.length === 0) slides = [{ kind: "blank", bgColor: blankBgColor }];
    const extra: { pptxImportId?: string } = {};
    if (it.type === "sermon" && typeof payload.pptxImportId === "string") extra.pptxImportId = payload.pptxImportId;
    expanded.push({ id: it.id, order: it.order, type: it.type, title: it.title, slides, ...extra, songId, songSlideRows });
  }

  return { id: plan.id, title: plan.title, items: expanded, logoUrl, blankBgColor };
}

export async function listServicePlans(churchId: string) {
  const db = getDb();
  return db.select().from(servicePlans).where(eq(servicePlans.churchId, churchId)).orderBy(asc(servicePlans.createdAt));
}

export async function listSongs(churchId: string) {
  const db = getDb();
  return db.select().from(songs).where(eq(songs.churchId, churchId)).orderBy(asc(songs.title));
}

export async function listMedia(churchId: string) {
  const db = getDb();
  return db.select().from(mediaAssets).where(eq(mediaAssets.churchId, churchId)).orderBy(asc(mediaAssets.createdAt));
}

export type SuggestionHistoryRow = {
  id: string;
  type: "scripture" | "song" | "action";
  payload: Record<string, unknown>;
  editedPayload: Record<string, unknown> | null;
  confidence: number;
  status: "pending" | "approved" | "rejected";
  actionTaken: "auto_approved" | "manual_approved" | "rejected" | "edited" | null;
  reason: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

export async function listSuggestionHistory(planId: string, churchId: string, limit = 50): Promise<SuggestionHistoryRow[]> {
  const db = getDb();
  const [plan] = await db.select({ id: servicePlans.id })
    .from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, churchId)))
    .limit(1);
  if (!plan) return [];
  const rows = await db.select().from(aiSuggestions)
    .where(eq(aiSuggestions.servicePlanId, planId))
    .orderBy(desc(aiSuggestions.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: (r.payload as Record<string, unknown>) ?? {},
    editedPayload: (r.editedPayload as Record<string, unknown> | null) ?? null,
    confidence: r.confidence,
    status: r.status,
    actionTaken: r.actionTaken,
    reason: r.reason,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  }));
}

export async function listPptxImports(churchId: string) {
  const db = getDb();
  return db.select().from(pptxImports).where(eq(pptxImports.churchId, churchId)).orderBy(asc(pptxImports.createdAt));
}
