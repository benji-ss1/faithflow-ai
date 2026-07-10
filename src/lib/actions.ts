"use server";
import { revalidatePath } from "next/cache";
import { eq, and, asc, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { servicePlans, serviceItems, songs, songSlides, mediaAssets, pptxImports, pptxSlides, settings, detectedReferences, bibleTranslations, churchPreferences, aiSuggestions, sermonMetadata, sermonSummaries, transcriptSegments } from "./db/schema";
import { requireUser } from "./session";
import { deleteObject } from "./s3";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

// Service plans ---------------------------------------------------------------
export async function createServicePlan(formData: FormData): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const title = String(formData.get("title") || "").trim();
  const applySuggestion = formData.get("applySuggestion") === "1";
  if (!title) return { ok: false, error: "Title required" };
  const db = getDb();
  const [row] = await db.insert(servicePlans).values({ churchId: user.churchId, title }).returning();
  if (applySuggestion) {
    const { suggestPlanStructure } = await import("./server/service-patterns");
    const { items } = await suggestPlanStructure(user.churchId);
    if (items.length > 0) {
      await db.insert(serviceItems).values(items.map((it, i) => ({
        servicePlanId: row.id, order: i, type: it.type, title: it.title, payload: {},
      })));
    }
  }
  // Fire-and-forget pattern recompute — don't block the create response
  import("./server/service-patterns").then((m) => m.recomputeChurchPatterns(user.churchId)).catch(() => { /* ignore */ });
  revalidatePath("/services");
  return { ok: true, data: { id: row.id } };
}

export async function deleteServicePlan(id: string): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  await db.delete(servicePlans).where(and(eq(servicePlans.id, id), eq(servicePlans.churchId, user.churchId)));
  revalidatePath("/services");
  return { ok: true };
}

export async function addServiceItem(planId: string, type: "song" | "scripture" | "media" | "sermon" | "blank" | "logo", title: string, payload: Record<string, unknown>): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId))).limit(1);
  if (!plan) return { ok: false, error: "Not found" };
  const existing = await db.select().from(serviceItems).where(eq(serviceItems.servicePlanId, planId));
  await db.insert(serviceItems).values({ servicePlanId: planId, order: existing.length, type, title, payload });
  revalidatePath(`/services/${planId}`);
  return { ok: true };
}

export async function removeServiceItem(id: string): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  // Join to the parent plan and require it belongs to the caller's church.
  const [it] = await db.select({ id: serviceItems.id, planId: serviceItems.servicePlanId })
    .from(serviceItems)
    .innerJoin(servicePlans, eq(servicePlans.id, serviceItems.servicePlanId))
    .where(and(eq(serviceItems.id, id), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!it) return { ok: false, error: "Not found" };
  await db.delete(serviceItems).where(eq(serviceItems.id, id));
  revalidatePath(`/services/${it.planId}`);
  return { ok: true };
}

export async function reorderServiceItems(planId: string, orderedIds: string[]): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  // Verify the plan belongs to the caller's church, THEN verify every
  // orderedId belongs to that plan. Two-hop check prevents a client
  // sending a foreign plan's item ids inside a valid planId.
  const [plan] = await db.select().from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!plan) return { ok: false, error: "Not found" };
  const existing = await db.select({ id: serviceItems.id }).from(serviceItems).where(eq(serviceItems.servicePlanId, planId));
  const existingSet = new Set(existing.map((e) => e.id));
  for (const id of orderedIds) if (!existingSet.has(id)) return { ok: false, error: "Item not part of this plan" };
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(serviceItems)
      .set({ order: i })
      .where(and(eq(serviceItems.id, orderedIds[i]), eq(serviceItems.servicePlanId, planId)));
  }
  revalidatePath(`/services/${planId}`);
  return { ok: true };
}

// Songs ----------------------------------------------------------------------
export async function createSong(formData: FormData): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const title = String(formData.get("title") || "").trim();
  const artist = String(formData.get("artist") || "").trim() || null;
  if (!title) return { ok: false, error: "Title required" };
  const db = getDb();
  const [row] = await db.insert(songs).values({ churchId: user.churchId, title, artist }).returning();
  revalidatePath("/library/songs");
  return { ok: true, data: { id: row.id } };
}

export async function updateSongSlides(songId: string, slides: { lyrics: string }[]): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const [song] = await db.select().from(songs).where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId))).limit(1);
  if (!song) return { ok: false, error: "Song not found" };
  await db.delete(songSlides).where(eq(songSlides.songId, songId));
  if (slides.length > 0) {
    await db.insert(songSlides).values(slides.map((s, i) => ({ songId, order: i, lyrics: s.lyrics })));
  }
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true };
}

// --- Phase 5D: rich slide editing ------------------------------------------
// Verify the slide belongs to a song owned by the caller's church. Two-hop
// join: song_slides → songs → churches.
async function assertSlideOwned(db: ReturnType<typeof getDb>, slideId: string, churchId: string) {
  const [row] = await db.select({ id: songSlides.id, songId: songSlides.songId })
    .from(songSlides)
    .innerJoin(songs, eq(songs.id, songSlides.songId))
    .where(and(eq(songSlides.id, slideId), eq(songs.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

async function assertSongOwned(db: ReturnType<typeof getDb>, songId: string, churchId: string) {
  const [row] = await db.select().from(songs)
    .where(and(eq(songs.id, songId), eq(songs.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

type EditableSlideInput = {
  bgColor?: string;
  bgImageUrl?: string;
  objects: unknown[];
  lyrics?: string;
};

export async function saveSlideObjects(slideId: string, editable: EditableSlideInput): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const owned = await assertSlideOwned(db, slideId, user.churchId);
  if (!owned) return { ok: false, error: "Slide not found" };
  // Regenerate lyrics from text objects so downstream matching stays healthy.
  const textObjects = Array.isArray(editable.objects)
    ? editable.objects.filter((o): o is { kind: string; text?: string } => typeof o === "object" && o !== null && (o as { kind?: unknown }).kind === "text")
    : [];
  const derivedLyrics = textObjects
    .map((o) => (typeof o.text === "string" ? o.text.trim() : ""))
    .filter(Boolean)
    .join("\n") || editable.lyrics || "";
  await db.update(songSlides).set({
    objectsJson: {
      bgColor: editable.bgColor,
      bgImageUrl: editable.bgImageUrl,
      objects: editable.objects,
    },
    lyrics: derivedLyrics,
  }).where(eq(songSlides.id, slideId));
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true };
}

export async function createSongSlide(songId: string, atIndex?: number, initial?: EditableSlideInput): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const song = await assertSongOwned(db, songId, user.churchId);
  if (!song) return { ok: false, error: "Song not found" };
  const existing = await db.select({ id: songSlides.id, order: songSlides.order })
    .from(songSlides).where(eq(songSlides.songId, songId)).orderBy(asc(songSlides.order));
  const idx = typeof atIndex === "number" ? Math.max(0, Math.min(atIndex, existing.length)) : existing.length;
  // Shift subsequent orders up by 1 to make room.
  for (let i = existing.length - 1; i >= idx; i--) {
    await db.update(songSlides).set({ order: i + 1 }).where(eq(songSlides.id, existing[i].id));
  }
  const objects = initial?.objects ?? [];
  const textObjects = objects.filter((o): o is { kind: string; text?: string } =>
    typeof o === "object" && o !== null && (o as { kind?: unknown }).kind === "text");
  const derivedLyrics = textObjects
    .map((o) => (typeof o.text === "string" ? o.text.trim() : ""))
    .filter(Boolean)
    .join("\n") || initial?.lyrics || "";
  const [row] = await db.insert(songSlides).values({
    songId,
    order: idx,
    lyrics: derivedLyrics,
    objectsJson: objects.length > 0 ? {
      bgColor: initial?.bgColor,
      bgImageUrl: initial?.bgImageUrl,
      objects,
    } : null,
  }).returning({ id: songSlides.id });
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true, data: { id: row.id } };
}

export async function deleteSongSlide(slideId: string): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const owned = await assertSlideOwned(db, slideId, user.churchId);
  if (!owned) return { ok: false, error: "Slide not found" };
  await db.delete(songSlides).where(eq(songSlides.id, slideId));
  // Re-pack order.
  const rest = await db.select({ id: songSlides.id })
    .from(songSlides).where(eq(songSlides.songId, owned.songId)).orderBy(asc(songSlides.order));
  for (let i = 0; i < rest.length; i++) {
    await db.update(songSlides).set({ order: i }).where(eq(songSlides.id, rest[i].id));
  }
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true };
}

export async function duplicateSongSlide(slideId: string): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const owned = await assertSlideOwned(db, slideId, user.churchId);
  if (!owned) return { ok: false, error: "Slide not found" };
  const [src] = await db.select().from(songSlides).where(eq(songSlides.id, slideId)).limit(1);
  if (!src) return { ok: false, error: "Slide not found" };
  // Shift subsequent orders up.
  const rest = await db.select({ id: songSlides.id, order: songSlides.order })
    .from(songSlides).where(eq(songSlides.songId, src.songId)).orderBy(asc(songSlides.order));
  const srcIdx = rest.findIndex((r) => r.id === slideId);
  for (let i = rest.length - 1; i > srcIdx; i--) {
    await db.update(songSlides).set({ order: rest[i].order + 1 }).where(eq(songSlides.id, rest[i].id));
  }
  const [row] = await db.insert(songSlides).values({
    songId: src.songId,
    order: src.order + 1,
    lyrics: src.lyrics,
    objectsJson: src.objectsJson,
  }).returning({ id: songSlides.id });
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true, data: { id: row.id } };
}

export async function reorderSongSlides(songId: string, orderedIds: string[]): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const song = await assertSongOwned(db, songId, user.churchId);
  if (!song) return { ok: false, error: "Song not found" };
  const existing = await db.select({ id: songSlides.id }).from(songSlides).where(eq(songSlides.songId, songId));
  const existingSet = new Set(existing.map((e) => e.id));
  for (const id of orderedIds) if (!existingSet.has(id)) return { ok: false, error: "Slide not part of this song" };
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(songSlides).set({ order: i })
      .where(and(eq(songSlides.id, orderedIds[i]), eq(songSlides.songId, songId)));
  }
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true };
}

export async function importPro6Files(files: { name: string; content: string }[]): Promise<Result<{ added: number; skipped: number; warnings: { file: string; warnings: string[] }[] }>> {
  const user = await requireUser();
  const db = getDb();
  const { parsePro6 } = await import("./pro6-parser");

  let added = 0, skipped = 0;
  const warnings: { file: string; warnings: string[] }[] = [];

  for (const f of files) {
    try {
      const parsed = parsePro6(f.content);
      if (!parsed.title.trim() || parsed.slides.length === 0) {
        skipped++;
        if (parsed.warnings.length) warnings.push({ file: f.name, warnings: parsed.warnings });
        continue;
      }
      const [dup] = await db.select().from(songs)
        .where(and(eq(songs.churchId, user.churchId), eq(songs.title, parsed.title)))
        .limit(1);
      if (dup) { skipped++; continue; }
      const [row] = await db.insert(songs).values({
        churchId: user.churchId, title: parsed.title, artist: parsed.artist, source: "imported",
      }).returning();
      await db.insert(songSlides).values(parsed.slides.map((lyrics, i) => ({ songId: row.id, order: i, lyrics })));
      added++;
      if (parsed.warnings.length) warnings.push({ file: f.name, warnings: parsed.warnings });
    } catch (e) {
      skipped++;
      warnings.push({ file: f.name, warnings: [e instanceof Error ? e.message : "Parse failed"] });
    }
  }
  revalidatePath("/library/songs");
  return { ok: true, data: { added, skipped, warnings } };
}

export async function importSongsCsv(text: string): Promise<Result<{ added: number; skipped: number }>> {
  const user = await requireUser();
  const db = getDb();

  // Two formats supported:
  // 1) Plain text: songs separated by a line of "---" or "===";
  //    first non-blank line is title; second (if starts with "by ") is artist;
  //    remaining slides split on blank lines.
  // 2) CSV: title,artist,slide1,slide2,...  (one row per song, empty cells trimmed)
  const src = text.replace(/\r/g, "").trim();
  if (!src) return { ok: false, error: "Empty file" };

  type Draft = { title: string; artist?: string | null; slides: string[] };
  const drafts: Draft[] = [];

  if (src.split("\n")[0].includes(",") && !src.startsWith("#")) {
    // Very small CSV parser: no quoted commas support, keep it dumb + honest
    // about scope. Volunteers editing spreadsheets usually don't quote fields.
    for (const line of src.split("\n")) {
      if (!line.trim()) continue;
      const cells = line.split(",").map((c) => c.trim());
      const [title, artist, ...slides] = cells;
      if (!title) continue;
      drafts.push({ title, artist: artist || null, slides: slides.filter(Boolean) });
    }
  } else {
    const blocks = src.split(/\n\s*(?:---|===)\s*\n/);
    for (const block of blocks) {
      const lines = block.split("\n");
      let title = "";
      let artist: string | null = null;
      const rest: string[] = [];
      let sawTitle = false;
      for (const raw of lines) {
        const line = raw.trim();
        if (!sawTitle) {
          if (!line) continue;
          title = line;
          sawTitle = true;
          continue;
        }
        if (!artist && /^by\s+/i.test(line)) { artist = line.replace(/^by\s+/i, "").trim(); continue; }
        rest.push(raw);
      }
      if (!title) continue;
      const slides = rest.join("\n").split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
      drafts.push({ title, artist, slides });
    }
  }

  let added = 0, skipped = 0;
  for (const d of drafts) {
    const [dup] = await db.select().from(songs).where(and(eq(songs.churchId, user.churchId), eq(songs.title, d.title))).limit(1);
    if (dup) { skipped++; continue; }
    const [row] = await db.insert(songs).values({ churchId: user.churchId, title: d.title, artist: d.artist ?? null, source: "imported" }).returning();
    if (d.slides.length > 0) {
      await db.insert(songSlides).values(d.slides.map((s, i) => ({ songId: row.id, order: i, lyrics: s })));
    }
    added++;
  }
  revalidatePath("/library/songs");
  return { ok: true, data: { added, skipped } };
}

export async function deleteSong(id: string): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  await db.delete(songs).where(and(eq(songs.id, id), eq(songs.churchId, user.churchId)));
  revalidatePath("/library/songs");
  return { ok: true };
}

// Media ----------------------------------------------------------------------
export async function registerMediaAsset(data: { kind: "image" | "video"; fileName: string; s3Key: string; mimeType: string; sizeBytes: number }): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const [row] = await db.insert(mediaAssets).values({ ...data, churchId: user.churchId }).returning();
  revalidatePath("/library/media");
  return { ok: true, data: { id: row.id } };
}

export async function deleteMediaAsset(id: string): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const [row] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.churchId, user.churchId))).limit(1);
  if (!row) return { ok: false, error: "Not found" };
  try { await deleteObject(row.s3Key); } catch { /* ignore */ }
  await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
  revalidatePath("/library/media");
  return { ok: true };
}

// PPTX -----------------------------------------------------------------------
export async function createPptxImport(fileName: string, s3Key: string): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const [row] = await db.insert(pptxImports).values({ churchId: user.churchId, originalFileName: fileName, sourceS3Key: s3Key, status: "pending" }).returning();
  revalidatePath("/library/imports");
  return { ok: true, data: { id: row.id } };
}

export async function deletePptxImport(id: string): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  // Ownership check FIRST. Previous version deleted the row + S3 objects
  // before verifying, so passing a foreign church's import id would delete
  // their content. Never touch storage until we're sure.
  const [imp] = await db.select().from(pptxImports)
    .where(and(eq(pptxImports.id, id), eq(pptxImports.churchId, user.churchId)))
    .limit(1);
  if (!imp) return { ok: false, error: "Not found" };
  const slides = await db.select().from(pptxSlides).where(eq(pptxSlides.pptxImportId, id));
  for (const s of slides) { try { await deleteObject(s.imageS3Key); } catch { /* ignore */ } }
  if (imp.sourceS3Key) { try { await deleteObject(imp.sourceS3Key); } catch { /* ignore */ } }
  await db.delete(pptxImports).where(and(eq(pptxImports.id, id), eq(pptxImports.churchId, user.churchId)));
  revalidatePath("/library/imports");
  return { ok: true };
}

// Detections -----------------------------------------------------------------
export async function updateDetectionStatus(id: string, status: "approved" | "rejected"): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  // detected_references → transcript_segments → service_plans → churches
  const rows = await db.execute(sql`
    SELECT dr.id FROM detected_references dr
    JOIN transcript_segments ts ON ts.id = dr.transcript_segment_id
    JOIN service_plans sp ON sp.id = ts.service_plan_id
    WHERE dr.id = ${id} AND sp.church_id = ${user.churchId}
    LIMIT 1
  `);
  if (rows.rows.length === 0) return { ok: false, error: "Not found" };
  await db.update(detectedReferences).set({ status }).where(eq(detectedReferences.id, id));
  return { ok: true };
}

export async function updateAiSuggestionStatus(
  id: string,
  status: "approved" | "rejected",
  opts?: { actionTaken?: "auto_approved" | "manual_approved" | "rejected"; reason?: string },
): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const [row] = await db.select({ id: aiSuggestions.id })
    .from(aiSuggestions)
    .innerJoin(servicePlans, eq(servicePlans.id, aiSuggestions.servicePlanId))
    .where(and(eq(aiSuggestions.id, id), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!row) return { ok: false, error: "Not found" };
  const actionTaken = opts?.actionTaken
    ?? (status === "approved" ? "manual_approved" as const : "rejected" as const);
  await db.update(aiSuggestions).set({
    status,
    actionTaken,
    reason: opts?.reason ?? null,
    resolvedAt: new Date(),
    resolvedBy: user.id,
  }).where(eq(aiSuggestions.id, id));
  return { ok: true };
}

export async function editAiSuggestion(id: string, patch: Record<string, unknown>): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const [row] = await db.select({ id: aiSuggestions.id, payload: aiSuggestions.payload })
    .from(aiSuggestions)
    .innerJoin(servicePlans, eq(servicePlans.id, aiSuggestions.servicePlanId))
    .where(and(eq(aiSuggestions.id, id), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!row) return { ok: false, error: "Not found" };
  const merged = { ...(row.payload as Record<string, unknown>), ...patch };
  await db.update(aiSuggestions).set({
    status: "approved",
    actionTaken: "edited",
    editedPayload: merged,
    reason: "Operator edited before staging",
    resolvedAt: new Date(),
    resolvedBy: user.id,
  }).where(eq(aiSuggestions.id, id));
  return { ok: true };
}

// Sermon summary -------------------------------------------------------------
export async function generateSermonSummaryAction(planId: string): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId))).limit(1);
  if (!plan) return { ok: false, error: "Plan not found" };
  try {
    const mod = await import("./server/sermon-summary");
    const data = await mod.generateSermonSummary(planId);
    const { id } = await mod.upsertSermonSummary(planId, data);
    revalidatePath("/archive");
    revalidatePath(`/archive/${id}`);
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Summary failed" };
  }
}

// Settings -------------------------------------------------------------------
export async function updateSettings(data: { blankBgColor?: string; logoS3Key?: string }): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const [existing] = await db.select().from(settings).where(eq(settings.churchId, user.churchId)).limit(1);
  if (existing) {
    await db.update(settings).set({ ...data, updatedAt: new Date() }).where(eq(settings.id, existing.id));
  } else {
    await db.insert(settings).values({ churchId: user.churchId, ...data });
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function updatePreferences(data: {
  defaultTranslationId?: string | null;
  aiListeningDefault?: boolean;
  audioInputDeviceLabel?: string | null;
  detectionConfidenceThreshold?: number;
  productionMode?: boolean;
  transcriptRetentionDays?: number;
  commandPrefix?: string;
  autoApproveEnabled?: boolean;
  autoApproveThreshold?: number;
  autoSendToLive?: boolean;
}): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const [existing] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1);
  if (existing) {
    await db.update(churchPreferences).set({ ...data, updatedAt: new Date() }).where(eq(churchPreferences.id, existing.id));
  } else {
    await db.insert(churchPreferences).values({ churchId: user.churchId, ...data });
  }
  revalidatePath("/settings");
  return { ok: true };
}

// Phase 6: sermon deck metadata --------------------------------------------
export async function upsertSermonMetadata(input: {
  pptxImportId: string;
  sermonTitle?: string | null;
  speakerName?: string | null;
  series?: string | null;
  mainScripture?: string | null;
  notes?: string | null;
  serviceDate?: string | null; // YYYY-MM-DD
}): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const [imp] = await db.select().from(pptxImports)
    .where(and(eq(pptxImports.id, input.pptxImportId), eq(pptxImports.churchId, user.churchId)))
    .limit(1);
  if (!imp) return { ok: false, error: "Import not found" };

  const [existing] = await db.select().from(sermonMetadata)
    .where(eq(sermonMetadata.pptxImportId, input.pptxImportId)).limit(1);

  const patch = {
    sermonTitle: input.sermonTitle ?? null,
    speakerName: input.speakerName ?? null,
    series: input.series ?? null,
    mainScripture: input.mainScripture ?? null,
    notes: input.notes ?? null,
    serviceDate: input.serviceDate ?? null,
  };

  if (existing) {
    await db.update(sermonMetadata).set({ ...patch, updatedAt: new Date() }).where(eq(sermonMetadata.id, existing.id));
    revalidatePath("/library/imports");
    return { ok: true, data: { id: existing.id } };
  }
  const [row] = await db.insert(sermonMetadata).values({
    pptxImportId: input.pptxImportId,
    churchId: user.churchId,
    ...patch,
  }).returning({ id: sermonMetadata.id });
  revalidatePath("/library/imports");
  return { ok: true, data: { id: row.id } };
}

// Phase 6: scaffold post-service archive. Non-destructive upsert.
export async function scaffoldSermonArchive(planId: string): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const [plan] = await db.select().from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan not found" };

  const segments = await db.select().from(transcriptSegments)
    .where(eq(transcriptSegments.servicePlanId, planId))
    .orderBy(asc(transcriptSegments.ts));
  if (segments.length === 0) return { ok: false, error: "No transcript segments yet — start the service before archiving." };
  const fullText = segments.map((s) => s.text).join(" ").trim();
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  const refsRes = await db.execute(sql`
    SELECT dr.book, dr.chapter, dr.verse_start AS "verseStart", dr.verse_end AS "verseEnd"
    FROM detected_references dr
    JOIN transcript_segments ts ON ts.id = dr.transcript_segment_id
    WHERE ts.service_plan_id = ${planId}
      AND dr.status IN ('approved', 'pending')
    GROUP BY dr.book, dr.chapter, dr.verse_start, dr.verse_end
    ORDER BY dr.book, dr.chapter, dr.verse_start
  `);
  const scriptureList = refsRes.rows as { book: string; chapter: number; verseStart: number; verseEnd: number }[];

  const sermonItems = await db.select().from(serviceItems)
    .where(and(eq(serviceItems.servicePlanId, planId), eq(serviceItems.type, "sermon")));
  const slideNote = sermonItems.length > 0
    ? ` Deck references: ${sermonItems.map((s) => s.title).join(", ")}.`
    : "";

  const stubOverview = `Auto-generated scaffold from ${segments.length} transcript segment${segments.length === 1 ? "" : "s"} (${wordCount} words) and ${scriptureList.length} scripture reference${scriptureList.length === 1 ? "" : "s"}.${slideNote} Run "Regenerate summary" to produce the final AI overview.`;

  const [existing] = await db.select().from(sermonSummaries)
    .where(eq(sermonSummaries.servicePlanId, planId)).limit(1);

  if (existing) {
    await db.update(sermonSummaries).set({
      overview: stubOverview,
      scriptureList,
      wordCount,
      generatedAt: new Date(),
      model: "scaffold",
    }).where(eq(sermonSummaries.id, existing.id));
    revalidatePath("/archive");
    return { ok: true, data: { id: existing.id } };
  }
  const [row] = await db.insert(sermonSummaries).values({
    servicePlanId: planId,
    title: plan.title || "Untitled sermon",
    overview: stubOverview,
    keyPoints: [],
    scriptureList,
    notableQuotes: [],
    actionPoints: [],
    wordCount,
    model: "scaffold",
  }).returning({ id: sermonSummaries.id });
  revalidatePath("/archive");
  return { ok: true, data: { id: row.id } };
}
