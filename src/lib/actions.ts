"use server";
import { revalidatePath } from "next/cache";
import { eq, and, asc, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { servicePlans, serviceItems, songs, songSlides, mediaAssets, pptxImports, pptxSlides, settings, detectedReferences, bibleTranslations, churchPreferences, aiSuggestions, sermonMetadata, sermonSummaries, transcriptSegments, announcements, announcementPresets, themes } from "./db/schema";
import { requireUser } from "./session";
import { deleteObject } from "./s3";
import { validateReorderItemSlides } from "./reorder-validator";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

// Service plans ---------------------------------------------------------------
export async function createServicePlan(formData: FormData): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const title = String(formData.get("title") || "").trim().slice(0, 200);
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

// Discriminated union guard for addServiceItem payload. Validates that the
// caller-supplied `payload` matches the `type` shape AND (where applicable)
// that referenced library items belong to the same church. Any mismatch or
// cross-church id must be rejected — this is the last-line church-scoping
// check for drop/click add flows in the operator.
async function validateAddServiceItemPayload(
  db: ReturnType<typeof getDb>,
  churchId: string,
  type: "song" | "scripture" | "media" | "sermon" | "blank" | "logo",
  payload: Record<string, unknown>,
): Promise<Result> {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "invalid payload shape" };
  }
  switch (type) {
    case "song": {
      const songId = (payload as any).songId;
      if (typeof songId !== "string" || !songId) return { ok: false, error: "song payload requires songId" };
      const [row] = await db.select({ id: songs.id }).from(songs)
        .where(and(eq(songs.id, songId), eq(songs.churchId, churchId))).limit(1);
      if (!row) return { ok: false, error: "song not found in your church" };
      return { ok: true };
    }
    case "scripture": {
      const reference = (payload as any).reference;
      if (typeof reference !== "string" || !reference) return { ok: false, error: "scripture payload requires reference" };
      // verses optional but if present must be array-shaped
      const verses = (payload as any).verses;
      if (verses !== undefined && !Array.isArray(verses)) return { ok: false, error: "scripture verses must be array" };
      return { ok: true };
    }
    case "media": {
      const mediaAssetId = (payload as any).mediaAssetId;
      if (typeof mediaAssetId !== "string" || !mediaAssetId) return { ok: false, error: "media payload requires mediaAssetId" };
      const [row] = await db.select({ id: mediaAssets.id }).from(mediaAssets)
        .where(and(eq(mediaAssets.id, mediaAssetId), eq(mediaAssets.churchId, churchId))).limit(1);
      if (!row) return { ok: false, error: "media asset not found in your church" };
      return { ok: true };
    }
    // Note: no `case "pptx"` — pptx items are added as "media"-style refs
    // going through the media path above. If a future caller adds "pptx" to
    // the type union, add a real case here (was previously stubbed with an
    // `as any` cast that made it unreachable dead code).
    case "sermon":
    case "blank":
    case "logo":
      // No referenced library id; empty payload OK. Reject unknown ref keys
      // that look like they should be church-scoped but aren't validated.
      if ((payload as any).songId || (payload as any).mediaAssetId || (payload as any).pptxImportId) {
        return { ok: false, error: `${type} payload must not include library refs` };
      }
      return { ok: true };
    default:
      return { ok: false, error: "unknown item type" };
  }
}

export async function addServiceItem(planId: string, type: "song" | "scripture" | "media" | "sermon" | "blank" | "logo", title: string, payload: Record<string, unknown>): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId))).limit(1);
  if (!plan) return { ok: false, error: "Not found" };
  const guard = await validateAddServiceItemPayload(db, user.churchId, type, payload || {});
  if (!guard.ok) return guard;
  // Order = max(existing) + 1. `existing.length` was wrong when items were
  // deleted (gaps) or when two operators added concurrently (both read
  // length=N, both insert order=N, collision + broken sort). Reading max
  // gives a monotonic order that survives deletes; concurrent inserts still
  // race but the failure mode becomes duplicate `order` (visual reorder needed)
  // rather than silent overwrite of an existing row's order.
  const existing = await db.select({ order: serviceItems.order }).from(serviceItems).where(eq(serviceItems.servicePlanId, planId));
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.order)) + 1 : 0;
  await db.insert(serviceItems).values({ servicePlanId: planId, order: nextOrder, type, title, payload });
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

// validateReorderItemSlides moved to ./reorder-validator (see import above)

/**
 * Reorder slides within a single service item.
 *
 * SONG items: DO NOT touch songSlides.order — that column is church-global
 * and mutating it would reorder that song's slides across every plan and
 * every church using the same song row. Instead we write a per-plan-item
 * override at serviceItems.payload.slideOrder (string[] of songSlideId).
 * getExpandedServicePlan reads this override before falling back to
 * songSlides.order.
 *
 * SCRIPTURE / SERMON / MEDIA / other items: reorder payload.slides in
 * place. newOrder here is treated as an array of slide IDs matching
 * payload.slides[i].id — if payload.slides lack ids, we accept a
 * stringified numeric index instead.
 */
export async function reorderItemSlides(
  planId: string,
  itemId: string,
  newOrder: string[]
): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  // Two-hop ownership check: plan.churchId === user.churchId, AND item
  // belongs to that plan.
  const [plan] = await db.select()
    .from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan not found" };

  const [item] = await db.select().from(serviceItems)
    .where(and(eq(serviceItems.id, itemId), eq(serviceItems.servicePlanId, planId)))
    .limit(1);
  if (!item) return { ok: false, error: "Item not part of this plan" };

  const payload = (item.payload || {}) as Record<string, unknown>;

  if (item.type === "song") {
    const songId = typeof payload.songId === "string" ? payload.songId : null;
    if (!songId) return { ok: false, error: "Song item missing songId" };
    const rows = await db.select({ id: songSlides.id })
      .from(songSlides)
      .where(eq(songSlides.songId, songId));
    const existingIds = rows.map((r) => r.id);
    const guard = validateReorderItemSlides(newOrder, existingIds);
    if (!guard.ok) return guard;
    const nextPayload = { ...payload, slideOrder: newOrder };
    await db.update(serviceItems)
      .set({ payload: nextPayload })
      .where(eq(serviceItems.id, itemId));
  } else if (item.type === "scripture" || item.type === "sermon" || item.type === "media") {
    // For payload.slides — treat newOrder as slide IDs when present,
    // otherwise as stringified indices ("0", "1", …).
    const slides = Array.isArray(payload.slides) ? [...(payload.slides as unknown[])] : [];
    if (slides.length === 0) return { ok: false, error: "Item has no reorderable slides" };
    const existingIds = slides.map((s, i) => {
      const rec = s as Record<string, unknown>;
      return typeof rec?.id === "string" ? rec.id : String(i);
    });
    const guard = validateReorderItemSlides(newOrder, existingIds);
    if (!guard.ok) return guard;
    const byId = new Map(existingIds.map((id, i) => [id, slides[i]]));
    const reordered = newOrder.map((id) => byId.get(id));
    const nextPayload = { ...payload, slides: reordered };
    await db.update(serviceItems)
      .set({ payload: nextPayload })
      .where(eq(serviceItems.id, itemId));
  } else {
    return { ok: false, error: `Cannot reorder slides for item type ${item.type}` };
  }

  revalidatePath(`/services/${planId}`);
  return { ok: true };
}

// Songs ----------------------------------------------------------------------
export async function createSong(formData: FormData): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const title = String(formData.get("title") || "").trim().slice(0, 200);
  const artistRaw = String(formData.get("artist") || "").trim().slice(0, 120);
  const artist = artistRaw || null;
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

// ============================================================================
// Phase 5D-2 — Announcements
// ============================================================================

type AnnouncementInput = {
  name: string;
  line1: string;
  line2?: string | null;
  position?: "lower_third" | "top_banner" | "ticker" | "center_card";
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number;
  textColor?: string;
  bgColor?: string;
  bgOpacity?: number;
  padding?: number;
  borderRadius?: number;
  align?: "left" | "center" | "right";
};

export async function createAnnouncement(input: AnnouncementInput): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  if (!input.name?.trim() || !input.line1?.trim()) return { ok: false, error: "Name and line1 required" };
  const db = getDb();
  const [row] = await db.insert(announcements).values({
    churchId: user.churchId,
    name: input.name.trim(),
    line1: input.line1,
    line2: input.line2 ?? null,
    position: input.position ?? "lower_third",
    fontFamily: input.fontFamily ?? "Inter",
    fontSizePx: input.fontSizePx ?? 32,
    fontWeight: input.fontWeight ?? 600,
    textColor: input.textColor ?? "#ffffff",
    bgColor: input.bgColor ?? "#000000",
    bgOpacity: input.bgOpacity ?? 70,
    padding: input.padding ?? 20,
    borderRadius: input.borderRadius ?? 8,
    align: input.align ?? "left",
  }).returning({ id: announcements.id });
  return { ok: true, data: { id: row.id } };
}

export async function updateAnnouncement(id: string, patch: Partial<AnnouncementInput>): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of Object.keys(patch) as (keyof AnnouncementInput)[]) {
    if (patch[k] !== undefined) updates[k] = patch[k];
  }
  await db.update(announcements).set(updates)
    .where(and(eq(announcements.id, id), eq(announcements.churchId, user.churchId)));
  return { ok: true };
}

export async function deleteAnnouncement(id: string): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  await db.delete(announcements)
    .where(and(eq(announcements.id, id), eq(announcements.churchId, user.churchId)));
  return { ok: true };
}

export async function saveAnnouncementPreset(name: string, config: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  if (!name?.trim()) return { ok: false, error: "Preset name required" };
  const db = getDb();
  const [row] = await db.insert(announcementPresets).values({
    churchId: user.churchId,
    name: name.trim(),
    config,
  }).returning({ id: announcementPresets.id });
  return { ok: true, data: { id: row.id } };
}

export async function deleteAnnouncementPreset(id: string): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  await db.delete(announcementPresets)
    .where(and(eq(announcementPresets.id, id), eq(announcementPresets.churchId, user.churchId)));
  return { ok: true };
}

// ============================================================================
// Phase 5D-2 — Themes
// ============================================================================

type ThemeConfig = {
  bgColor?: string;
  bgImageUrl?: string;
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number;
  textColor?: string;
  align?: "left" | "center" | "right";
  safeArea?: boolean;
  transition?: { effectId: string; durationMs: number; easing: string };
};

const THEME_ALLOWED_KEYS: (keyof ThemeConfig)[] = [
  "bgColor", "bgImageUrl", "fontFamily", "fontSizePx", "fontWeight",
  "textColor", "align", "safeArea", "transition",
];

function sanitizeThemeConfig(input: unknown): { config: ThemeConfig; rejected: string[] } {
  const rejected: string[] = [];
  const out: ThemeConfig = {};
  if (!input || typeof input !== "object") return { config: out, rejected };
  const obj = input as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if ((THEME_ALLOWED_KEYS as string[]).includes(k)) {
      (out as Record<string, unknown>)[k] = obj[k];
    } else {
      rejected.push(k);
    }
  }
  return { config: out, rejected };
}

export async function createTheme(name: string, config: ThemeConfig): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  if (!name?.trim()) return { ok: false, error: "Theme name required" };
  const db = getDb();
  const { config: clean } = sanitizeThemeConfig(config);
  const [row] = await db.insert(themes).values({
    churchId: user.churchId, name: name.trim(), config: clean,
  }).returning({ id: themes.id });
  return { ok: true, data: { id: row.id } };
}

export async function updateTheme(id: string, patch: { name?: string; config?: ThemeConfig }): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.config !== undefined) updates.config = sanitizeThemeConfig(patch.config).config;
  await db.update(themes).set(updates)
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId)));
  return { ok: true };
}

export async function duplicateTheme(id: string): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const db = getDb();
  const [existing] = await db.select().from(themes)
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId))).limit(1);
  if (!existing) return { ok: false, error: "Theme not found" };
  const [row] = await db.insert(themes).values({
    churchId: user.churchId,
    name: `${existing.name} copy`,
    config: existing.config as Record<string, unknown>,
  }).returning({ id: themes.id });
  return { ok: true, data: { id: row.id } };
}

export async function deleteTheme(id: string): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  await db.delete(themes)
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId)));
  return { ok: true };
}

export async function exportTheme(id: string): Promise<Result<{ name: string; config: ThemeConfig }>> {
  const user = await requireUser();
  const db = getDb();
  const [row] = await db.select().from(themes)
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId))).limit(1);
  if (!row) return { ok: false, error: "Theme not found" };
  return { ok: true, data: { name: row.name, config: (row.config as ThemeConfig) ?? {} } };
}

export async function importTheme(json: unknown): Promise<Result<{ id: string; rejectedFields: string[] }>> {
  const user = await requireUser();
  if (!json || typeof json !== "object") return { ok: false, error: "Invalid theme JSON" };
  const obj = json as { name?: unknown; config?: unknown };
  const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Imported theme";
  const { config, rejected } = sanitizeThemeConfig(obj.config);
  if (rejected.length > 0) console.warn("[importTheme] rejected fields:", rejected);
  const db = getDb();
  const [row] = await db.insert(themes).values({
    churchId: user.churchId, name, config,
  }).returning({ id: themes.id });
  return { ok: true, data: { id: row.id, rejectedFields: rejected } };
}

export async function applyThemeToSong(themeId: string, songId: string): Promise<Result<{ slidesUpdated: number }>> {
  const user = await requireUser();
  const db = getDb();
  const [theme] = await db.select().from(themes)
    .where(and(eq(themes.id, themeId), eq(themes.churchId, user.churchId))).limit(1);
  if (!theme) return { ok: false, error: "Theme not found" };
  const [song] = await db.select().from(songs)
    .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId))).limit(1);
  if (!song) return { ok: false, error: "Song not found" };
  const cfg = (theme.config as ThemeConfig) ?? {};
  const slides = await db.select().from(songSlides).where(eq(songSlides.songId, songId));
  let updated = 0;
  for (const s of slides) {
    const raw = (s.objectsJson as Record<string, unknown> | null) ?? {};
    const objects = Array.isArray(raw.objects) ? (raw.objects as Record<string, unknown>[]) : [];
    // Merge theme into slide bg + text-object defaults (do not overwrite explicit values already set)
    const merged: Record<string, unknown> = {
      ...raw,
      bgColor: raw.bgColor ?? cfg.bgColor,
      bgImageUrl: raw.bgImageUrl ?? cfg.bgImageUrl,
      transition: raw.transition ?? cfg.transition,
      objects: objects.map((o) => {
        if (o?.kind !== "text") return o;
        return {
          ...o,
          fontFamily: o.fontFamily ?? cfg.fontFamily,
          fontSize: o.fontSize ?? cfg.fontSizePx,
          fontWeight: o.fontWeight ?? cfg.fontWeight,
          color: o.color ?? cfg.textColor,
          align: o.align ?? cfg.align,
        };
      }),
    };
    await db.update(songSlides).set({ objectsJson: merged }).where(eq(songSlides.id, s.id));
    updated += 1;
  }
  // Track applied theme id on the song
  const prevSettings = (song.settings as Record<string, unknown>) ?? {};
  await db.update(songs).set({
    settings: { ...prevSettings, appliedThemeId: themeId },
  }).where(eq(songs.id, songId));
  return { ok: true, data: { slidesUpdated: updated } };
}

export async function updateSongSettings(songId: string, patch: Record<string, unknown>): Promise<Result> {
  const user = await requireUser();
  const db = getDb();
  const [song] = await db.select().from(songs)
    .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId))).limit(1);
  if (!song) return { ok: false, error: "Song not found" };
  const prev = (song.settings as Record<string, unknown>) ?? {};
  await db.update(songs).set({ settings: { ...prev, ...patch } }).where(eq(songs.id, songId));
  return { ok: true };
}

// -----------------------------------------------------------------------
// Public-domain hymn import (from /api/songs/public-domain/search results)
// -----------------------------------------------------------------------
/**
 * Import a public-domain hymn candidate into the church library.
 *
 * Church-scoped: writes to the caller's churchId only. Marks the row as
 * source = "public_domain" so downstream detection knows the licensing
 * story. Idempotent on (churchId, title, source) — a duplicate call returns
 * the existing songId instead of inserting a second copy.
 */
export async function importPublicDomainSong(input: {
  title: string;
  author?: string | null;
  lyrics: string[];
  source: "hymnary" | "llm";
}): Promise<Result<{ id: string; duplicate: boolean }>> {
  const user = await requireUser();
  const title = String(input?.title || "").trim().slice(0, 200);
  if (!title) return { ok: false, error: "Title required" };
  const artist = input?.author ? String(input.author).trim().slice(0, 120) : null;
  const rawLyrics = Array.isArray(input?.lyrics) ? input.lyrics : [];
  const lyricSlides = rawLyrics
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 24);
  if (lyricSlides.length === 0) return { ok: false, error: "No lyrics provided" };
  if (input?.source !== "hymnary" && input?.source !== "llm") {
    return { ok: false, error: "Invalid source" };
  }

  const db = getDb();
  // Idempotency guard: dedupe by (churchId, title, source=public_domain).
  const [existing] = await db.select({ id: songs.id })
    .from(songs)
    .where(and(
      eq(songs.churchId, user.churchId),
      eq(songs.title, title),
      eq(songs.source, "public_domain"),
    ))
    .limit(1);
  if (existing) {
    return { ok: true, data: { id: existing.id, duplicate: true } };
  }

  const [row] = await db.insert(songs).values({
    churchId: user.churchId,
    title,
    artist,
    source: "public_domain",
    settings: { importedFrom: input.source },
  }).returning();
  await db.insert(songSlides).values(
    lyricSlides.map((lyrics, i) => ({ songId: row.id, order: i, lyrics })),
  );
  revalidatePath("/library/songs");
  return { ok: true, data: { id: row.id, duplicate: false } };
}

// Per-church Deepgram keyterm override -----------------------------------------
// Writes to `config/deepgram-keyterms/<churchId>.json`. Church-scoped +
// ownership-guarded via requireUser. Admin UI wiring is a follow-up; the
// action exists so the UI can call it once built. Terms are trimmed, dedup'd,
// length-capped, and count-capped to protect the URL length limit on
// the Deepgram streaming endpoint.
export async function updateChurchKeyterms(terms: string[]): Promise<Result<{ count: number }>> {
  const user = await requireUser();
  if (!Array.isArray(terms)) return { ok: false, error: "terms must be an array" };
  const cleaned = Array.from(new Set(
    terms
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= 64),
  )).slice(0, 200);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = process.env.PF_CONFIG_DIR || path.resolve(process.cwd(), "config");
  const targetDir = path.join(dir, "deepgram-keyterms");
  await fs.mkdir(targetDir, { recursive: true });
  // Church IDs are UUIDs; still, guard against path traversal defensively.
  if (!/^[a-zA-Z0-9_-]+$/.test(user.churchId)) return { ok: false, error: "invalid churchId format" };
  const file = path.join(targetDir, `${user.churchId}.json`);
  await fs.writeFile(file, JSON.stringify({ terms: cleaned }, null, 2) + "\n", "utf8");
  // Invalidate in-process cache so the bridge picks up the change on next
  // connection (within one 5-min TTL window at most).
  const mod = await import("./deepgram-keyterms");
  mod._clearKeytermCache();
  return { ok: true, data: { count: cleaned.length } };
}
