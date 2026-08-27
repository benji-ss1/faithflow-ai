// Server-only. Do not import from client components.
import { eq, asc, and, sql, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { sanitizeLyrics } from "../pro6-parser";
import { desc } from "drizzle-orm";
import { servicePlans, serviceItems, songs, songSlides, mediaAssets, pptxImports, pptxSlides, settings, aiSuggestions, themes } from "../db/schema";
import { presignGet } from "../s3";
import type { SlidePayload } from "../broadcast";
import { projectableTextSlide } from "../broadcast";

// Build the projectable payload for a song slide. When the slide has a designed
// object layout (saved via saveSlideObjects → objects_json), carry the objects +
// per-slide background so the live projector renders the real layout; otherwise
// fall back to the plain text block. projectableTextSlide VALIDATES every field
// and DROPS invalid objects individually (fail-open to readable text), so a
// designed slide always projects — one bad value can never no-op the slide on
// the projector (the whole-OutputState wire validator would otherwise reject it).
function projectableSongSlide(text: string, objectsJson: unknown): SlidePayload {
  const raw = objectsJson as { bgColor?: unknown; bgImageUrl?: unknown; objects?: unknown } | null | undefined;
  return projectableTextSlide(text, raw?.bgColor, raw?.bgImageUrl, raw?.objects);
}

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
  // Themes 2c — optional per-item theme override (a "section theme"). When set,
  // the operator resolves this theme for the item instead of the church default.
  themeId?: string;
  // For a grouped MEDIA item: the underlying asset id + name for each expanded
  // slide, in the SAME order as `slides`. Lets the playlist rename / reorder /
  // remove individual images inside a group.
  mediaMeta?: { id: string; fileName: string }[];
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
    let mediaMeta: { id: string; fileName: string }[] | undefined;

    let songId: string | undefined;
    let songSlideRows: { id: string; lyrics: string; objectsJson: unknown }[] | undefined;
    if (it.type === "song" && payload.songId) {
      // C1 defense-in-depth: two-hop verify the song belongs to this
      // church before we dereference its slides. validateAddServiceItemPayload
      // in actions.ts is the first line at write; this ensures a legacy row
      // or a future direct-DB write path can't leak another church's slides.
      const candidateSongId = String(payload.songId);
      let [ownedSong] = await db.select({ id: songs.id }).from(songs)
        .where(and(eq(songs.id, candidateSongId), eq(songs.churchId, churchId))).limit(1);
      // Resilience: a dangling payload.songId (the song was re-imported/re-synced
      // under a NEW id while the plan item still points at the old one) would
      // otherwise fall through to a single blank slide with no lyrics. Resolve
      // the song by (church, title) instead so the plan still loads and can
      // project. Church-scoped, so it can never surface another church's song.
      // Pick the title match with the MOST slides so a stray empty duplicate
      // can't win over the real song; require > 0 slides so we never "resolve"
      // to an equally-empty row.
      if (!ownedSong) {
        const titleKey = (it.title || "").trim().toLowerCase();
        if (titleKey) {
          const byTitle = await db
            .select({ id: songs.id, n: sql<number>`count(${songSlides.id})::int` })
            .from(songs)
            .leftJoin(songSlides, eq(songSlides.songId, songs.id))
            .where(and(eq(songs.churchId, churchId), sql`lower(trim(${songs.title})) = ${titleKey}`))
            .groupBy(songs.id)
            .orderBy(sql`count(${songSlides.id}) desc`)
            .limit(1);
          if (byTitle[0] && byTitle[0].n > 0) {
            ownedSong = { id: byTitle[0].id };
            console.log(`[services] re-linked stale song ref for "${it.title}" (${candidateSongId} → ${byTitle[0].id}, ${byTitle[0].n} slides)`);
          }
        }
      }
      if (ownedSong) {
        songId = ownedSong.id;
        const rows = await db.select().from(songSlides).where(eq(songSlides.songId, songId)).orderBy(asc(songSlides.order));
        // Task C: apply per-plan slideOrder override if present. The override
        // is an array of songSlide IDs in the desired order — church-scoped
        // via the containing plan. Rows not present in the override fall to
        // the end in their original order (defensive against stale override
        // arrays that predate a slide add).
        const overrideRaw = payload.slideOrder;
        const override = Array.isArray(overrideRaw)
          ? (overrideRaw as unknown[]).filter((x): x is string => typeof x === "string")
          : null;
        let orderedRows = rows;
        if (override && override.length > 0) {
          const byId = new Map(rows.map((r) => [r.id, r]));
          const seen = new Set<string>();
          const front: typeof rows = [];
          for (const id of override) {
            const r = byId.get(id);
            if (r && !seen.has(id)) { front.push(r); seen.add(id); }
          }
          const tail = rows.filter((r) => !seen.has(r.id));
          orderedRows = [...front, ...tail];
        }
        songSlideRows = orderedRows.map((r) => ({ id: r.id, lyrics: sanitizeLyrics(r.lyrics), objectsJson: r.objectsJson }));
        slides = orderedRows.map((r) => projectableSongSlide(sanitizeLyrics(r.lyrics), r.objectsJson));
      }
    } else if (it.type === "scripture") {
      // 2026-07-25 field bug fix — the client (BibleMode.addVerseToPlaylist)
      // stores `{reference, verses: [{verse, text}]}` in the payload but this
      // reader previously only looked at `payload.slides` or `payload.text`.
      // Result: every Bible verse added to the playlist landed as a blank
      // fallback slide (line ~115) and clicking it in the sidebar showed an
      // empty grid. Now: prefer `verses` (build verse-numbered slides with the
      // reference label appended, mirroring BibleMode.cardToSlide's output),
      // fall back to `slides` and `text` for older/imported payload shapes.
      const versesRaw = Array.isArray(payload.verses) ? (payload.verses as { verse?: number; text?: string }[]) : [];
      const reference = typeof payload.reference === "string" ? payload.reference : it.title;
      if (versesRaw.length > 0) {
        slides = versesRaw
          .filter((v) => typeof v.text === "string" && v.text.length > 0)
          .map((v) => ({
            kind: "text" as const,
            text: `${typeof v.verse === "number" ? `${v.verse} ` : ""}${v.text ?? ""}\n\n${reference}`,
          }));
      } else {
        const scriptureSlides = Array.isArray(payload.slides) ? (payload.slides as { text: string }[]) : [];
        slides = scriptureSlides.map((s) => ({ kind: "text" as const, text: s.text }));
        if (slides.length === 0 && typeof payload.text === "string") slides = [{ kind: "text", text: payload.text as string }];
      }
    } else if (it.type === "media" && Array.isArray(payload.mediaAssetIds)) {
      // Grouped media: one collapsible playlist item expands to N image/video
      // slides. C1 defense-in-depth: scope by churchId; preserve the stored id
      // order; silently skip any id that isn't this church's (never leaks, never
      // throws on a stale id).
      const ids = (payload.mediaAssetIds as unknown[]).filter((x): x is string => typeof x === "string");
      const fit = (payload.fitMode === "cover" ? "cover" : "contain") as "cover" | "contain";
      if (ids.length > 0) {
        const rows = await db.select().from(mediaAssets)
          .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.churchId, churchId)));
        const byId = new Map(rows.map((r) => [r.id, r]));
        const out: SlidePayload[] = [];
        const meta: { id: string; fileName: string }[] = [];
        for (const id of ids) {
          const asset = byId.get(id);
          if (!asset) continue;
          const url = await presignGet(asset.s3Key);
          out.push(asset.kind === "video" ? { kind: "video", url, fit } : { kind: "image", url, fit });
          meta.push({ id: asset.id, fileName: asset.fileName });
        }
        slides = out;
        mediaMeta = meta;
      }
    } else if (it.type === "media" && payload.mediaAssetId) {
      // C1 defense-in-depth: scope mediaAssets lookup by churchId.
      const [asset] = await db.select().from(mediaAssets)
        .where(and(eq(mediaAssets.id, String(payload.mediaAssetId)), eq(mediaAssets.churchId, churchId)))
        .limit(1);
      if (asset) {
        const url = await presignGet(asset.s3Key);
        const fit = (payload.fitMode === "cover" ? "cover" : "contain") as "cover" | "contain";
        slides = [asset.kind === "video" ? { kind: "video", url, fit } : { kind: "image", url, fit }];
      }
    } else if (it.type === "sermon" && payload.pptxImportId) {
      // C1 defense-in-depth: two-hop verify the pptx_import belongs to
      // this church, then pull its slides. Without the join, a foreign
      // payload.pptxImportId would fetch another church's slide PNGs and
      // return signed URLs.
      const [ownedImport] = await db.select({ id: pptxImports.id }).from(pptxImports)
        .where(and(eq(pptxImports.id, String(payload.pptxImportId)), eq(pptxImports.churchId, churchId)))
        .limit(1);
      if (ownedImport) {
        const rows = await db.select().from(pptxSlides).where(eq(pptxSlides.pptxImportId, ownedImport.id)).orderBy(asc(pptxSlides.order));
        // Apply a per-plan reorder override (payload.pptxSlideOrder) if the
        // operator reordered these slides — pptxSlides.order is church-global, so
        // the order lives on the plan item, not the shared slides.
        const override = Array.isArray(payload.pptxSlideOrder)
          ? (payload.pptxSlideOrder as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        const ordered = override.length === rows.length && override.every((id) => rows.some((r) => r.id === id))
          ? override.map((id) => rows.find((r) => r.id === id)!)
          : rows;
        slides = await Promise.all(ordered.map(async (r) => ({ kind: "image" as const, url: await presignGet(r.imageS3Key), fit: "contain" as const })));
      }
    } else if (it.type === "blank") {
      slides = [{ kind: "blank", bgColor: blankBgColor }];
    } else if (it.type === "logo") {
      slides = [{ kind: "logo", url: logoUrl }];
    }

    if (slides.length === 0) slides = [{ kind: "blank", bgColor: blankBgColor }];
    const extra: { pptxImportId?: string; themeId?: string } = {};
    if (it.type === "sermon" && typeof payload.pptxImportId === "string") extra.pptxImportId = payload.pptxImportId;
    if (typeof payload.themeId === "string" && payload.themeId) extra.themeId = payload.themeId;
    expanded.push({ id: it.id, order: it.order, type: it.type, title: it.title, slides, ...extra, songId, songSlideRows, mediaMeta });
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

export async function listSuggestionHistory(planId: string, churchId: string, limit = 50): Promise<SuggestionHistoryRow[] | null> {
  const db = getDb();
  const [plan] = await db.select({ id: servicePlans.id })
    .from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, churchId)))
    .limit(1);
  // Return null (not empty array) to let callers distinguish "cross-church access"
  // from "own plan with zero history" — the API route surfaces this as 404.
  if (!plan) return null;
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

export async function listThemes(churchId: string) {
  const db = getDb();
  return db.select().from(themes).where(eq(themes.churchId, churchId)).orderBy(asc(themes.sortOrder), asc(themes.name));
}
