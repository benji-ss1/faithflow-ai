"use server";
import { revalidatePath } from "next/cache";
import { eq, and, asc, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { servicePlans, serviceItems, songs, songSlides, mediaAssets, pptxImports, pptxSlides, settings, detectedReferences, bibleTranslations, churches, churchPreferences, aiSuggestions, sermonMetadata, sermonSummaries, transcriptSegments, announcements, announcementPresets, themes } from "./db/schema";
import { requireUser, requireRole, requireCap } from "./session";
import { deleteObject } from "./s3";
import { validateReorderItemSlides } from "./reorder-validator";
import { createLimiter } from "./rate-limit";
import { getSongUsage } from "./song-limits";
import { getEffectiveSongLimit } from "./server/song-limits-server";
import { bulkInsertSongs } from "./song-bulk-insert";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const addServiceItemsLimiter = createLimiter("add-service-items", 30, 60 * 1000);

// Service plans ---------------------------------------------------------------
export async function createServicePlan(formData: FormData): Promise<Result<{ id: string }>> {
  const user = await requireCap("operate_services");
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
  const user = await requireCap("operate_services");
  const db = getDb();
  await db.delete(servicePlans).where(and(eq(servicePlans.id, id), eq(servicePlans.churchId, user.churchId)));
  revalidatePath("/services");
  return { ok: true };
}

// Bulk cleanup of leftover "Ad-hoc service" plans that pile up from repeated
// operator opens without a scheduled plan. Keeps the single most recent
// ad-hoc (by id desc) and deletes the rest. Church-scoped via the WHERE.
export async function cleanupAdHocServicePlans(): Promise<Result<{ deleted: number }>> {
  const user = await requireCap("operate_services");
  const db = getDb();
  const adHocs = await db
    .select({ id: servicePlans.id })
    .from(servicePlans)
    .where(and(eq(servicePlans.churchId, user.churchId), eq(servicePlans.title, "Ad-hoc service")));
  if (adHocs.length <= 1) return { ok: true, data: { deleted: 0 } };
  // Keep the last (largest id — most recent insert); delete the rest one-by-one
  // via the existing single-delete path so we get the same church-scoped WHERE
  // discipline and cascade behavior.
  const sorted = [...adHocs].sort((a, b) => a.id.localeCompare(b.id));
  const toDelete = sorted.slice(0, -1);
  for (const row of toDelete) {
    await db.delete(servicePlans).where(and(eq(servicePlans.id, row.id), eq(servicePlans.churchId, user.churchId)));
  }
  revalidatePath("/services");
  return { ok: true, data: { deleted: toDelete.length } };
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

export async function addServiceItem(planId: string, type: "song" | "scripture" | "media" | "sermon" | "blank" | "logo", title: string, payload: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const user = await requireCap("operate_services");
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
  const existing = await db.select({ order: serviceItems.order, type: serviceItems.type, payload: serviceItems.payload }).from(serviceItems).where(eq(serviceItems.servicePlanId, planId));
  // Idempotency guard: a rapid double-click (or any repeat call) on the same
  // library item can fire addServiceItem twice before the first insert lands.
  // If an item of the same type + identifying key already exists in this
  // plan, no-op instead of inserting a duplicate row.
  type DedupPayload = { songId?: string; reference?: string };
  if (type === "song") {
    const songId = (payload as DedupPayload)?.songId;
    if (songId && existing.some((e) => e.type === "song" && (e.payload as DedupPayload)?.songId === songId)) {
      return { ok: true };
    }
  } else if (type === "scripture") {
    const reference = (payload as DedupPayload)?.reference;
    if (reference && existing.some((e) => e.type === "scripture" && (e.payload as DedupPayload)?.reference === reference)) {
      return { ok: true };
    }
  }
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.order)) + 1 : 0;
  const [row] = await db.insert(serviceItems).values({ servicePlanId: planId, order: nextOrder, type, title, payload }).returning({ id: serviceItems.id });
  revalidatePath(`/services/${planId}`);
  return { ok: true, data: { id: row.id } };
}

/**
 * Bulk version of addServiceItem — used by "Add all verses" so adding an
 * N-verse passage is one DB round trip (one read of existing items, one
 * multi-row insert) instead of N sequential add calls. Mirrors
 * addServiceItem's auth + church-scoping + dedup logic exactly; does not
 * weaken it for the batch path.
 */
export async function addServiceItems(
  planId: string,
  items: Array<{ type: "song" | "scripture" | "media" | "sermon" | "blank" | "logo"; title: string; payload: Record<string, unknown> }>,
): Promise<Result<{ inserted: number; skipped: number }>> {
  const user = await requireCap("operate_services");
  if (!(await addServiceItemsLimiter(user.id))) {
    return { ok: false, error: "Too many bulk-add requests. Please wait a moment before retrying." };
  }
  const db = getDb();
  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId))).limit(1);
  if (!plan) return { ok: false, error: "Not found" };
  if (!Array.isArray(items) || items.length === 0) return { ok: true, data: { inserted: 0, skipped: 0 } };

  // Validate every item's payload shape / church-scoping BEFORE touching the
  // DB — same guard addServiceItem runs per-item, run here per-item too.
  for (const it of items) {
    const guard = await validateAddServiceItemPayload(db, user.churchId, it.type, it.payload || {});
    if (!guard.ok) return guard;
  }

  // Fetch existing items ONCE (not once per item).
  const existing = await db.select({ order: serviceItems.order, type: serviceItems.type, payload: serviceItems.payload }).from(serviceItems).where(eq(serviceItems.servicePlanId, planId));

  type DedupPayload = { songId?: string; reference?: string };
  const existingSongIds = new Set(
    existing.filter((e) => e.type === "song").map((e) => (e.payload as DedupPayload)?.songId).filter(Boolean),
  );
  const existingRefs = new Set(
    existing.filter((e) => e.type === "scripture").map((e) => (e.payload as DedupPayload)?.reference).filter(Boolean),
  );

  let nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.order)) + 1 : 0;
  const toInsert: { servicePlanId: string; order: number; type: typeof items[number]["type"]; title: string; payload: Record<string, unknown> }[] = [];
  let skipped = 0;

  for (const it of items) {
    const payload = it.payload || {};
    if (it.type === "song") {
      const songId = (payload as DedupPayload).songId;
      if (songId && existingSongIds.has(songId)) { skipped++; continue; }
      if (songId) existingSongIds.add(songId); // also dedup within this same batch
    } else if (it.type === "scripture") {
      const reference = (payload as DedupPayload).reference;
      if (reference && existingRefs.has(reference)) { skipped++; continue; }
      if (reference) existingRefs.add(reference); // also dedup within this same batch
    }
    toInsert.push({ servicePlanId: planId, order: nextOrder++, type: it.type, title: it.title, payload });
  }

  if (toInsert.length > 0) {
    await db.insert(serviceItems).values(toInsert);
  }
  revalidatePath(`/services/${planId}`);
  return { ok: true, data: { inserted: toInsert.length, skipped } };
}

export async function removeServiceItem(id: string): Promise<Result> {
  const user = await requireCap("operate_services");
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
  const user = await requireCap("operate_services");
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
  const user = await requireCap("operate_services");
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

// Themes 2c — assign a "section theme" to one service item (or clear it with
// null). Stored on serviceItems.payload.themeId; the operator resolves it for
// that item, falling back to the church default when unset. Two-hop church
// scoping (plan → item), and a non-null themeId must belong to this church.
export async function setServiceItemTheme(planId: string, itemId: string, themeId: string | null): Promise<Result> {
  const user = await requireCap("operate_services");
  const db = getDb();
  const [plan] = await db.select().from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan not found" };
  const [item] = await db.select().from(serviceItems)
    .where(and(eq(serviceItems.id, itemId), eq(serviceItems.servicePlanId, planId)))
    .limit(1);
  if (!item) return { ok: false, error: "Item not part of this plan" };

  if (themeId) {
    const [theme] = await db.select({ id: themes.id }).from(themes)
      .where(and(eq(themes.id, themeId), eq(themes.churchId, user.churchId)))
      .limit(1);
    if (!theme) return { ok: false, error: "Theme not found" };
  }

  const payload = (item.payload || {}) as Record<string, unknown>;
  const nextPayload = { ...payload };
  if (themeId) nextPayload.themeId = themeId;
  else delete nextPayload.themeId;
  await db.update(serviceItems).set({ payload: nextPayload }).where(eq(serviceItems.id, itemId));
  revalidatePath(`/services/${planId}`);
  return { ok: true };
}

// Songs ----------------------------------------------------------------------
export async function createSong(formData: FormData): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const title = String(formData.get("title") || "").trim().slice(0, 200);
  const artistRaw = String(formData.get("artist") || "").trim().slice(0, 120);
  const artist = artistRaw || null;
  if (!title) return { ok: false, error: "Title required" };
  const [usage, limit] = await Promise.all([getSongUsage(user.churchId), getEffectiveSongLimit(user.churchId)]);
  if (usage >= limit) {
    return { ok: false, error: `Song library limit reached (${usage}/${limit}) — buy a bundle to add more.` };
  }
  const db = getDb();
  const [row] = await db.insert(songs).values({ churchId: user.churchId, title, artist }).returning();
  revalidatePath("/library/songs");
  return { ok: true, data: { id: row.id } };
}

// Rename a song (works for imported songs too — no `source` gate). Mirrors
// renameMediaAsset: church-scoped UPDATE, then propagate the new title to any
// service items that reference this song so the playlist sidebar stays in sync.
export async function renameSong(songId: string, newTitle: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const trimmed = newTitle.trim().slice(0, 200);
  if (!trimmed) return { ok: false, error: "Title required" };
  const db = getDb();
  const upd = await db.update(songs)
    .set({ title: trimmed })
    .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId)));
  if ((upd as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Song not found" };

  await db.execute(sql`
    UPDATE service_items si
    SET title = ${trimmed}
    FROM service_plans sp
    WHERE si.service_plan_id = sp.id
      AND sp.church_id = ${user.churchId}
      AND si.type = 'song'
      AND si.payload->>'songId' = ${songId}
  `);

  revalidatePath("/library/songs");
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true };
}

/**
 * Rename a single playlist/service item (its display title only — does NOT
 * touch the underlying song). Works for every item type (blank, scripture,
 * media, sermon, logo, and songs whose display label the operator wants to
 * differ from the library title). Church-scoped via the two-hop join through
 * service_plans.
 */
export async function renameServiceItem(itemId: string, newTitle: string): Promise<Result> {
  const user = await requireCap("operate_services");
  const trimmed = newTitle.trim().slice(0, 200);
  if (!trimmed) return { ok: false, error: "Title required" };
  const db = getDb();
  const res = await db.execute(sql`
    UPDATE service_items si
    SET title = ${trimmed}
    FROM service_plans sp
    WHERE si.id = ${itemId}
      AND si.service_plan_id = sp.id
      AND sp.church_id = ${user.churchId}
  `);
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Item not found" };
  return { ok: true };
}

export async function updateSongSlides(songId: string, slides: { lyrics: string }[]): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const [song] = await db.select().from(songs).where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId))).limit(1);
  if (!song) return { ok: false, error: "Song not found" };
  // Bound the size — autosave (1.5s debounce) can fire hundreds of times
  // during a long editing session; a mistake or paste-loop shouldn't be
  // able to write 10k slides per call. Server matches the client-side cap.
  if (slides.length > 500) {
    return { ok: false, error: "Song has too many slides (max 500)" };
  }
  for (const s of slides) {
    if (typeof s?.lyrics !== "string") return { ok: false, error: "Bad slide payload" };
    if (s.lyrics.length > 5000) return { ok: false, error: "Slide text too long (max 5000)" };
  }
  // Delete + insert must be atomic — a concurrent autosave hitting this
  // route mid-delete could otherwise leave the song with zero slides for
  // a few ms, breaking any operator sending live at that instant. Wrap
  // in a transaction so the delete + insert commit or roll back together.
  try {
    await db.transaction(async (tx) => {
      await tx.delete(songSlides).where(eq(songSlides.songId, songId));
      if (slides.length > 0) {
        await tx.insert(songSlides).values(slides.map((s, i) => ({ songId, order: i, lyrics: s.lyrics })));
      }
    });
  } catch (err) {
    console.error("[updateSongSlides]", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "Save failed — please try again" };
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
  const user = await requireCap("edit_library");
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
  const user = await requireCap("edit_library");
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
  const user = await requireCap("edit_library");
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
  const user = await requireCap("edit_library");
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
  const user = await requireCap("edit_library");
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

const PRO6_IMPORT_MAX_FILES = 500;
const PRO6_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB — real .pro6 lyric files are <100KB
const PRO6_TITLE_MAX = 200;
const PRO6_SLIDE_MAX = 5000;

export async function importPro6Files(files: { name: string; content: string }[]): Promise<Result<{ added: number; skipped: number; duplicates: number; limitSkipped: number; failed: number; warnings: { file: string; warnings: string[] }[] }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const { parsePro6 } = await import("./pro6-parser");

  if (!Array.isArray(files) || files.length === 0) return { ok: false, error: "No files provided" };
  if (files.length > PRO6_IMPORT_MAX_FILES) return { ok: false, error: `Too many files (max ${PRO6_IMPORT_MAX_FILES} per import)` };

  let parseSkipped = 0;
  const warnings: { file: string; warnings: string[] }[] = [];
  const [__limit, __usage] = await Promise.all([getEffectiveSongLimit(user.churchId), getSongUsage(user.churchId)]);
  const remainingHeadroom = Math.max(0, __limit - __usage);

  // Parsing stays per-file (each file can fail/warn independently), but the
  // DB write is now ONE batched call instead of a per-file round trip.
  const candidates: { title: string; artist?: string | null; slides: string[]; source: "imported" }[] = [];
  for (const f of files) {
    try {
      if (typeof f?.name !== "string" || typeof f?.content !== "string") {
        parseSkipped++;
        warnings.push({ file: String(f?.name ?? "unknown"), warnings: ["Invalid file payload"] });
        continue;
      }
      if (f.content.length > PRO6_IMPORT_MAX_FILE_BYTES) {
        parseSkipped++;
        warnings.push({ file: f.name, warnings: ["File too large (max 2MB) — not a lyric document"] });
        continue;
      }
      const parsed = parsePro6(f.content);
      // Many real .pro6 exports omit CCLISongTitle — fall back to the filename.
      const title = (parsed.title.trim()
        || f.name.split(/[/\\]/).pop()!.replace(/\.(pro6|pro5|pro)$/i, "").trim()).slice(0, PRO6_TITLE_MAX);
      if (!title || parsed.slides.length === 0) {
        parseSkipped++;
        if (parsed.warnings.length) warnings.push({ file: f.name, warnings: parsed.warnings });
        continue;
      }
      candidates.push({
        title,
        artist: parsed.artist ? parsed.artist.slice(0, 120) : null,
        slides: parsed.slides.map((s) => s.slice(0, PRO6_SLIDE_MAX)),
        source: "imported",
      });
      if (parsed.warnings.length) warnings.push({ file: f.name, warnings: parsed.warnings });
    } catch (e) {
      parseSkipped++;
      warnings.push({ file: f.name, warnings: [e instanceof Error ? e.message : "Parse failed"] });
    }
  }
  const { added, skipped: bulkSkipped, duplicateSkipped, limitSkipped } = await bulkInsertSongs(user.churchId, candidates, remainingHeadroom);
  revalidatePath("/library/songs");
  // `skipped` keeps the legacy combined meaning (MigrationStep renders it);
  // `duplicates` / `limitSkipped` / `failed` let newer UIs report
  // "Imported N, M duplicates skipped, K skipped (limit), J failed" honestly —
  // plan-limit skips are NOT duplicates and are no longer mislabeled as such.
  if (limitSkipped > 0) {
    warnings.push({ file: "*", warnings: [`${limitSkipped} song${limitSkipped === 1 ? "" : "s"} skipped — song limit reached`] });
  }
  return { ok: true, data: { added, skipped: parseSkipped + bulkSkipped, duplicates: duplicateSkipped, limitSkipped, failed: parseSkipped, warnings } };
}

export async function importSongsCsv(text: string): Promise<Result<{ added: number; skipped: number }>> {
  const user = await requireCap("edit_library");
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

  const [__limit, __usage] = await Promise.all([getEffectiveSongLimit(user.churchId), getSongUsage(user.churchId)]);
  const remainingHeadroom = Math.max(0, __limit - __usage);
  const { added, skipped } = await bulkInsertSongs(
    user.churchId,
    drafts.map((d) => ({ title: d.title, artist: d.artist ?? null, slides: d.slides, source: "imported" as const })),
    remainingHeadroom,
  );
  revalidatePath("/library/songs");
  return { ok: true, data: { added, skipped } };
}

export async function deleteSong(id: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  await db.delete(songs).where(and(eq(songs.id, id), eq(songs.churchId, user.churchId)));
  revalidatePath("/library/songs");
  return { ok: true };
}

// Media ----------------------------------------------------------------------
export async function registerMediaAsset(data: { kind: "image" | "video"; fileName: string; s3Key: string; mimeType: string; sizeBytes: number }): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const [row] = await db.insert(mediaAssets).values({ ...data, churchId: user.churchId }).returning();
  revalidatePath("/library/media");
  return { ok: true, data: { id: row.id } };
}

export async function deleteMediaAsset(id: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const [row] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.churchId, user.churchId))).limit(1);
  if (!row) return { ok: false, error: "Not found" };
  // DB-first: delete the authoritative record before touching S3.
  // If S3 cleanup subsequently fails the objects become orphaned storage
  // (recoverable — keys logged above). The reverse order (S3 first) risks
  // permanent unrecoverable media loss if the DB write then fails.
  await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
  // Remove any serviceItems in this church's plans that reference this asset
  // via payload.mediaAssetId. Mirrors the renameMediaAsset cleanup; without
  // this, deleted assets leave ghost items in plans that show 0 slides.
  await db.execute(sql`
    DELETE FROM service_items si
    USING service_plans sp
    WHERE si.service_plan_id = sp.id
      AND sp.church_id = ${user.churchId}
      AND si.type = 'media'
      AND si.payload->>'mediaAssetId' = ${id}
  `);
  try { await deleteObject(row.s3Key); } catch { /* orphan — recoverable */ }
  if (row.thumbS3Key) try { await deleteObject(row.thumbS3Key); } catch { /* orphan — recoverable */ }
  revalidatePath("/library/media");
  return { ok: true };
}

export async function renameMediaAsset(id: string, newName: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const trimmed = newName.trim().slice(0, 200);
  if (!trimmed) return { ok: false, error: "Name required" };
  const db = getDb();
  // Church-scoped UPDATE — no row-level pre-check needed since the WHERE
  // enforces ownership. Zero rowCount = wrong church or gone.
  const upd = await db.update(mediaAssets)
    .set({ fileName: trimmed })
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.churchId, user.churchId)));
  if ((upd as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Not found" };

  // Propagate the new name to any service items in this church's plans that
  // reference this asset via payload.mediaAssetId. Keeps the playlist sidebar
  // title in sync without a separate refetch by the caller.
  await db.execute(sql`
    UPDATE service_items si
    SET title = ${trimmed}
    FROM service_plans sp
    WHERE si.service_plan_id = sp.id
      AND sp.church_id = ${user.churchId}
      AND si.type = 'media'
      AND si.payload->>'mediaAssetId' = ${id}
  `);

  revalidatePath("/library/media");
  return { ok: true };
}

// PPTX -----------------------------------------------------------------------
export async function createPptxImport(fileName: string, s3Key: string): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const [row] = await db.insert(pptxImports).values({ churchId: user.churchId, originalFileName: fileName, sourceS3Key: s3Key, status: "pending" }).returning();
  revalidatePath("/library/imports");
  return { ok: true, data: { id: row.id } };
}

export async function deletePptxImport(id: string): Promise<Result> {
  const user = await requireCap("edit_library");
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
// Branding + display defaults. When `logoS3Key` is touched:
//   - Require admin role (operators/pastors shouldn't be able to change the
//     church's public-facing logo without admin sign-off).
//   - Validate the key starts with `${churchId}/` so a caller with a known
//     foreign S3 key can't plant it and receive a 6h presigned GET via the
//     layout's read. `""` is coerced to `null` to keep the column tidy.
export async function updateSettings(data: { blankBgColor?: string; logoS3Key?: string | null }): Promise<Result> {
  const modifiesLogo = Object.prototype.hasOwnProperty.call(data, "logoS3Key");
  const user = modifiesLogo ? await requireRole("admin") : await requireUser();

  const patch: { blankBgColor?: string; logoS3Key?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (data.blankBgColor !== undefined) patch.blankBgColor = data.blankBgColor;
  if (modifiesLogo) {
    const raw = data.logoS3Key;
    if (raw === null || raw === undefined || raw === "") {
      patch.logoS3Key = null;
    } else {
      if (typeof raw !== "string") return { ok: false, error: "Invalid logo key" };
      // Prefix check: must belong to this church. Presign route mints keys
      // as `${churchId}/media/${uuid}.${ext}` so anything else is either a
      // foreign key or a poisoned client value.
      if (!raw.startsWith(`${user.churchId}/`)) {
        return { ok: false, error: "Logo key must belong to your church" };
      }
      patch.logoS3Key = raw;
    }
  }

  const db = getDb();
  const [existing] = await db.select().from(settings).where(eq(settings.churchId, user.churchId)).limit(1);
  if (existing) {
    await db.update(settings).set(patch).where(eq(settings.id, existing.id));
  } else {
    await db.insert(settings).values({ churchId: user.churchId, ...patch });
  }
  revalidatePath("/settings");
  // Sidebar reads settings.logoS3Key from the (app) layout — revalidate the
  // whole layout so the pill picks up the new logo without a hard reload.
  revalidatePath("/organization");
  revalidatePath("/", "layout");
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

// Extended per Section 4 of the visual-overhaul brief. Existing fields kept
// so applyThemeToSong (which reads a subset) keeps working. New fields are
// pure additive — the operator projector uses whatever's defined and falls
// back to defaults elsewhere. downstream operator surface will pick these
// up in its own commit; the editor UI can already read/write them today.
type ThemeConfig = {
  // Typography
  fontFamily?: string;                    // headline (also song lyrics for now)
  fontBodyFamily?: string;                // body / caption
  fontSizePx?: number;                    // lyrics size
  fontSizeScripturePx?: number;           // scripture verse size
  fontWeight?: number;                    // headline / lyrics weight
  textColor?: string;
  textShadow?: boolean;
  align?: "left" | "center" | "right";
  // Background
  bgType?: "solid" | "gradient" | "image" | "video";
  bgColor?: string;                       // solid + gradient stop 1
  bgColor2?: string;                      // gradient stop 2
  bgImageUrl?: string;                    // used when bgType === "image"
  bgVideoUrl?: string;                    // used when bgType === "video" (autoplay muted loop)
  bgOpacity?: number;                     // 0..1
  bgAnimation?: "none" | "drift" | "aurora" | "pulse"; // Themes 3: motion for solid/gradient bg
  // Layout
  logoPosition?:
    | "top-left" | "top-center" | "top-right"
    | "middle-left" | "middle-center" | "middle-right"
    | "bottom-left" | "bottom-center" | "bottom-right"
    | "none";
  logoSizePx?: number;
  logoUrl?: string;                        // church-uploaded logo image (presigned GET URL)
  churchNameVisible?: boolean;
  churchNamePosition?: "top" | "bottom";
  // Lower third
  lowerThirdEnabled?: boolean;
  lowerThirdStyle?: "bar" | "gradient-fade" | "minimal";
  lowerThirdColor?: string;
  // Scripture
  scriptureShowReference?: boolean;
  scriptureReferencePosition?: "above" | "below" | "inline";
  scriptureTranslationVisible?: boolean;
  // Transitions (existing "transition" kept for backwards compat; simpler
  // pair below is what the editor UI reads/writes)
  transition?: { effectId: string; durationMs: number; easing: string };
  transitionType?: "fade" | "slide" | "none";
  transitionDurationMs?: number;
  // Layout misc
  safeArea?: boolean;
};

const THEME_ALLOWED_KEYS: (keyof ThemeConfig)[] = [
  "fontFamily", "fontBodyFamily", "fontSizePx", "fontSizeScripturePx",
  "fontWeight", "textColor", "textShadow", "align",
  "bgType", "bgColor", "bgColor2", "bgImageUrl", "bgVideoUrl", "bgOpacity", "bgAnimation",
  "logoPosition", "logoSizePx", "logoUrl", "churchNameVisible", "churchNamePosition",
  "lowerThirdEnabled", "lowerThirdStyle", "lowerThirdColor",
  "scriptureShowReference", "scriptureReferencePosition", "scriptureTranslationVisible",
  "transition", "transitionType", "transitionDurationMs",
  "safeArea",
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
  const user = await requireCap("edit_library");
  if (!name?.trim()) return { ok: false, error: "Theme name required" };
  const db = getDb();
  const { config: clean } = sanitizeThemeConfig(config);
  const [row] = await db.insert(themes).values({
    churchId: user.churchId, name: name.trim(), config: clean,
  }).returning({ id: themes.id });
  return { ok: true, data: { id: row.id } };
}

export async function updateTheme(id: string, patch: { name?: string; config?: ThemeConfig }): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.config !== undefined) updates.config = sanitizeThemeConfig(patch.config).config;
  await db.update(themes).set(updates)
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId)));
  return { ok: true };
}

export async function duplicateTheme(id: string): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
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
  const user = await requireCap("edit_library");
  const db = getDb();
  await db.delete(themes)
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId)));
  return { ok: true };
}

// Persist a new display order for the church's themes. `orderedIds` is
// the full list of theme ids in the intended visual order. Any id not
// belonging to this church is silently skipped — dnd-kit shouldn't emit
// foreign ids, but this defends against a malformed client payload.
export async function reorderThemes(orderedIds: string[]): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { ok: true };
  // Fetch the church's own themes so we can filter out any foreign ids
  // in one pass — cheaper than N per-row ownership checks.
  const owned = new Set(
    (await db.select({ id: themes.id }).from(themes).where(eq(themes.churchId, user.churchId))).map((r) => r.id),
  );
  const now = new Date();
  let position = 0;
  for (const id of orderedIds) {
    if (!owned.has(id)) continue;
    await db.update(themes).set({ sortOrder: position, updatedAt: now })
      .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId)));
    position++;
  }
  revalidatePath("/library/themes");
  return { ok: true };
}

// Sets the given theme as the church's default. Idempotent — calling with
// the same id twice leaves state unchanged. Two-step within a single call:
//   1. Unset any existing default in this church
//   2. Set the target theme as default (church-scoped by AND clause)
// Not wrapped in a DB transaction on purpose — a partial failure between
// steps leaves at most zero defaults, never two, which is the safer state
// than a partially-mutated pair. A dedicated tx wrapper can come later.
export async function setDefaultTheme(id: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  // Confirm target belongs to this church BEFORE we clear the current
  // default — otherwise a caller sending a foreign id could leave the
  // church with no default at all.
  const [target] = await db.select({ id: themes.id }).from(themes)
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId))).limit(1);
  if (!target) return { ok: false, error: "Theme not found" };
  await db.update(themes).set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(themes.churchId, user.churchId), eq(themes.isDefault, true)));
  await db.update(themes).set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId)));
  revalidatePath("/library/themes");
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
  const user = await requireCap("edit_library");
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
  const user = await requireCap("edit_library");
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

// Themes 4 — extract a dominant-colour palette from a theme's logo so the editor
// can suggest a colourway. Done SERVER-SIDE (a browser can't read pixels from a
// cross-origin S3 logo). SSRF-guarded: only fetches https URLs from our own
// media store, never an arbitrary host.
function isAllowedMediaHost(host: string): boolean {
  const ep = process.env.S3_ENDPOINT;
  if (ep) { try { return new URL(ep).host === host; } catch { return false; } }
  // Real-AWS fallback: pin to THIS bucket, not any *.amazonaws.com host.
  const bucket = process.env.S3_BUCKET;
  return !!bucket && host.endsWith(".amazonaws.com") && host.includes(bucket);
}
const rgbToHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");

export async function extractLogoPalette(logoUrl: string): Promise<Result<{ colors: string[] }>> {
  await requireCap("edit_library");
  let u: URL;
  try { u = new URL(logoUrl); } catch { return { ok: false, error: "Invalid image URL" }; }
  if (u.protocol !== "https:") return { ok: false, error: "Image URL must be https" };
  if (!isAllowedMediaHost(u.host)) return { ok: false, error: "Image must be from your media library" };

  let buf: Buffer;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000); // no slow-loris on the function
  try {
    // redirect:"error" closes the SSRF-via-redirect vector — an allow-listed
    // host must not be able to bounce us to an internal address.
    const res = await fetch(logoUrl, { redirect: "error", signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: "Could not load the logo" };
    buf = Buffer.from(await res.arrayBuffer());
    // A logo is small; 8MB caps a decompression-bomb's compressed size.
    if (buf.length > 8 * 1024 * 1024) return { ok: false, error: "Logo image too large (max 8MB)" };
  } catch {
    return { ok: false, error: "Could not load the logo" };
  } finally {
    clearTimeout(timer);
  }

  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(buf);
    // Guard against absurd dimensions before allocating the sample canvas.
    if (!img.width || !img.height || img.width * img.height > 40_000_000) {
      return { ok: false, error: "Logo image dimensions unsupported" };
    }
    const W = 48, H = 48;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue; // skip transparent
      let r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 240 && mn > 236) continue; // skip near-white (logo bg)
      if (mx < 22) continue;              // skip near-black
      r &= 0xE0; g &= 0xE0; b &= 0xE0;    // quantise to reduce buckets
      const key = `${r},${g},${b}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const colors = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => { const [r, g, b] = k.split(",").map(Number); return rgbToHex(r, g, b); });
    if (colors.length === 0) return { ok: false, error: "No dominant colours found in the logo" };
    return { ok: true, data: { colors } };
  } catch {
    return { ok: false, error: "Could not read the logo image" };
  }
}

export async function updateSongSettings(songId: string, patch: Record<string, unknown>): Promise<Result> {
  const user = await requireCap("edit_library");
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
  const user = await requireCap("edit_library");
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
  const [usage, limit] = await Promise.all([getSongUsage(user.churchId), getEffectiveSongLimit(user.churchId)]);
  if (usage >= limit) {
    return { ok: false, error: `Song library limit reached (${usage}/${limit}) — buy a bundle to add more.` };
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

// Church profile edit — powers /organization. Admin-only. All fields
// optional; nulls clear the value. congregationSize is coerced from
// FormData string to positive integer or null. Timezone accepts any
// IANA string; we don't validate against the tz database on the
// server (browser Intl provides the picker).
const CONGREGATION_MAX = 200_000;
export async function updateChurch(patch: {
  name?: string;
  city?: string | null;
  country?: string | null;
  timezone?: string;
  congregationSize?: number | null;
  denomination?: string | null;
}): Promise<Result> {
  const admin = await requireRole("admin");
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 200);
    if (!name) return { ok: false, error: "Church name is required" };
    updates.name = name;
  }
  if (patch.timezone !== undefined) {
    const tz = patch.timezone.trim().slice(0, 64);
    if (!tz) return { ok: false, error: "Timezone is required" };
    updates.timezone = tz;
  }
  if (patch.city !== undefined) updates.city = patch.city ? patch.city.trim().slice(0, 120) : null;
  if (patch.country !== undefined) updates.country = patch.country ? patch.country.trim().slice(0, 120) : null;
  if (patch.denomination !== undefined) updates.denomination = patch.denomination ? patch.denomination.trim().slice(0, 120) : null;
  if (patch.congregationSize !== undefined) {
    if (patch.congregationSize === null) updates.congregationSize = null;
    else {
      const n = Math.floor(Number(patch.congregationSize));
      if (!Number.isFinite(n) || n < 0 || n > CONGREGATION_MAX) return { ok: false, error: "Congregation size looks off" };
      updates.congregationSize = n;
    }
  }
  if (Object.keys(updates).length === 0) return { ok: true };
  const db = getDb();
  await db.update(churches).set(updates).where(eq(churches.id, admin.churchId));
  revalidatePath("/organization");
  revalidatePath("/dashboard");
  return { ok: true };
}

// Onboarding + library helper: bulk-seed the built-in public-domain hymn
// library for the caller's church. Idempotent — if a hymn already exists
// (matched by title + public_domain source in this church), it's skipped
// rather than duplicated. Empty-slide entries in the library (deliberate
// PD-safety placeholders like the non-PD English "How Great Thou Art"
// translation) are always skipped.
//
// Rate limit (F1 from Phase 3B security sweep): 3 calls / hour / user. Each
// call is up to ~150 DB round trips (50 hymns × existence check + insert +
// slide bulk insert), so an unrated call is a real DoS surface for the
// Postgres pool. Legitimate use is one-shot from the onboarding wizard,
// occasionally re-run on the songs empty state — 3/hour is comfortable.
const hymnSeedLimiter = createLimiter("hymn-seed", 3, 60 * 60 * 1000);

export async function addBuiltInHymnsToMyChurch(): Promise<Result<{ added: number; skipped: number }>> {
  const user = await requireCap("edit_library");
  if (!(await hymnSeedLimiter(user.id))) {
    return { ok: false, error: "You've hit the hourly limit for bulk hymn imports. Try again later." };
  }
  const { HYMNS } = await import("./hymn-library");
  const db = getDb();
  let added = 0;
  let skipped = 0;
  for (const h of HYMNS) {
    if (h.slides.length === 0) { skipped++; continue; }
    const [existing] = await db.select({ id: songs.id }).from(songs)
      .where(and(
        eq(songs.churchId, user.churchId),
        eq(songs.title, h.title),
        eq(songs.source, "public_domain"),
      )).limit(1);
    if (existing) { skipped++; continue; }
    const [row] = await db.insert(songs).values({
      churchId: user.churchId,
      title: h.title,
      artist: h.author,
      source: "public_domain",
    }).returning({ id: songs.id });
    await db.insert(songSlides).values(
      h.slides.map((lyrics, i) => ({ songId: row.id, order: i, lyrics })),
    );
    added++;
  }
  revalidatePath("/library/songs");
  return { ok: true, data: { added, skipped } };
}
