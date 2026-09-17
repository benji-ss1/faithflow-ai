"use server";
import { revalidatePath } from "next/cache";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import { adHocCleanupTargets, recentChurchDayKeys } from "./operator-plan-select";
import { getDb } from "./db/client";
import { bakeThemeIntoObjectsJson } from "./theme-bake";
import { sanitizeThemeLayout, sanitizeThemeNumber, THEME_NUMBER_RANGES, type ThemeLayout } from "./theme-layout";
import { mergeThemeBackup, rebakeThemeFromOriginal, reapplySourceForSlide, resetThemeOwnedFields, pruneThemeBackup, reapplyFieldsForConfigs, copyThemeBackupForDuplicate } from "./theme-rebake";
import { isHex6Color } from "./hex-color";
import { servicePlans, serviceItems, songs, songSlides, songGroups, songArrangements, mediaAssets, pptxImports, pptxSlides, settings, detectedReferences, bibleTranslations, churches, churchPreferences, aiSuggestions, sermonMetadata, sermonSummaries, transcriptSegments, announcements, announcementPresets, themes, libraries, timerDefinitions, messageTemplates, macros, scenes, type ServiceItemType } from "./db/schema";
import { GROUP_KINDS } from "../engine/arrangements";
import { stripClientSlideActions } from "./server/automations";
import { preservedGroupIds } from "./song-group-preserve";
import { cleanRenderUrl } from "./render-url";
import { validateSermonItemPayload } from "./server/service-item-guards";
import { remapSlideActionsForReorder } from "./slide-actions-remap";
import { OVERLAY_POSITIONS } from "./broadcast";
import { requireUser, requireRole, requireCap, hasCap } from "./session";
import { deleteObject, getBuffer, putBuffer, statObject, readObjectHead } from "./s3";
import { validateMediaRegistration, verifyUploadedObject, isChurchUploadKey, THUMBNAIL_MAX_SOURCE_BYTES } from "./media-types";
import { isAudioMediaSupported, AUDIO_NOT_READY_ERROR } from "./server/media-audio-support";
import { after } from "next/server";
import { generateImageThumbnail } from "./media-thumbnail";
import { validateReorderItemSlides } from "./reorder-validator";
import { newObjectId } from "./slide-objects";
import { createLimiter } from "./rate-limit";
import { getSongUsage } from "./song-limits";
import { getEffectiveSongLimit } from "./server/song-limits-server";
import { bulkInsertSongs } from "./song-bulk-insert";
import { reChunkSongCore, type ReChunkOutcome } from "./server/song-rechunk";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const addServiceItemsLimiter = createLimiter("add-service-items", 30, 60 * 1000);
// "Tidy all songs" is an expensive whole-library sweep — cap it hard.
const reChunkAllLimiter = createLimiter("rechunk-all", 3, 60 * 60 * 1000);
// Bound a single tidy-all sweep so a very large library can't blow the function
// timeout in one synchronous request; a bigger library tidies over a few runs.
const RECHUNK_ALL_MAX_PER_RUN = 300;

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
// ad-hoc (by created_at) and deletes the EMPTY rest. Church-scoped via the WHERE.
export async function cleanupAdHocServicePlans(): Promise<Result<{ deleted: number }>> {
  const user = await requireCap("operate_services");
  const db = getDb();
  const adHocs = await db
    .select({
      id: servicePlans.id,
      createdAt: servicePlans.createdAt,
      scheduledFor: servicePlans.scheduledFor,
      itemCount: sql<number>`(SELECT count(*)::int FROM service_items si WHERE si.service_plan_id = ${servicePlans.id})`,
    })
    .from(servicePlans)
    .where(and(eq(servicePlans.churchId, user.churchId), eq(servicePlans.title, "Ad-hoc service")));
  const [church] = await db.select({ timezone: churches.timezone }).from(churches).where(eq(churches.id, user.churchId)).limit(1);
  // Keep the most recently CREATED ad-hoc; skip today/yesterday (may be open);
  // never delete one that has items (service_items cascade).
  const candidates = adHocCleanupTargets(adHocs, recentChurchDayKeys(church?.timezone));
  let deleted = 0;
  for (const id of candidates) {
    // Row-lock the plan, re-check emptiness, delete — all in ONE transaction.
    // addServiceItem(s) take the same FOR UPDATE lock before inserting, so an
    // in-flight add and this delete serialize (race proven 12/30 without it).
    const removed = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: servicePlans.id })
        .from(servicePlans)
        .where(and(eq(servicePlans.id, id), eq(servicePlans.churchId, user.churchId)))
        .for("update");
      if (!locked) return 0;
      const [hasItem] = await tx.select({ id: serviceItems.id }).from(serviceItems).where(eq(serviceItems.servicePlanId, id)).limit(1);
      if (hasItem) return 0;
      const res = await tx
        .delete(servicePlans)
        .where(and(eq(servicePlans.id, id), eq(servicePlans.churchId, user.churchId)))
        .returning({ id: servicePlans.id });
      return res.length;
    });
    deleted += removed;
  }
  revalidatePath("/services");
  return { ok: true, data: { deleted } };
}

// Discriminated union guard for addServiceItem payload. Validates that the
// caller-supplied `payload` matches the `type` shape AND (where applicable)
// that referenced library items belong to the same church. Any mismatch or
// cross-church id must be rejected — this is the last-line church-scoping
// check for drop/click add flows in the operator.
// Write-path id shape check: a non-UUID id stored in a plan payload later makes
// the plan expander's uuid-column queries throw (fails the whole plan load).
const UUID_PAYLOAD_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function validateAddServiceItemPayload(
  db: ReturnType<typeof getDb>,
  churchId: string,
  type: ServiceItemType,
  payload: Record<string, unknown>,
): Promise<Result> {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "invalid payload shape" };
  }
  switch (type) {
    case "song": {
      const songId = (payload as any).songId;
      if (typeof songId !== "string" || !UUID_PAYLOAD_RE.test(songId)) return { ok: false, error: "song payload requires songId" };
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
      // A media item is EITHER a single asset (mediaAssetId) OR a group of
      // assets (mediaAssetIds[] — the collapsible playlist group). Validate that
      // every referenced asset belongs to this church (defense-in-depth; the
      // expander re-scopes by churchId too).
      const groupIdsRaw = payload.mediaAssetIds; // Record<string, unknown> → unknown, narrowed below
      if (Array.isArray(groupIdsRaw)) {
        if (!groupIdsRaw.every((x: unknown) => typeof x === "string" && UUID_PAYLOAD_RE.test(x))) return { ok: false, error: "media group ids must be valid asset ids" };
        const ids = groupIdsRaw as string[];
        if (ids.length === 0) return { ok: false, error: "media group requires at least one asset" };
        if (ids.length > 200) return { ok: false, error: "media group too large (max 200)" };
        const rows = await db.select({ id: mediaAssets.id }).from(mediaAssets)
          .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.churchId, churchId)));
        if (rows.length !== new Set(ids).size) return { ok: false, error: "one or more media assets not found in your church" };
        return { ok: true };
      }
      const mediaAssetId = (payload as any).mediaAssetId;
      if (typeof mediaAssetId !== "string" || !UUID_PAYLOAD_RE.test(mediaAssetId)) return { ok: false, error: "media payload requires mediaAssetId" };
      const [row] = await db.select({ id: mediaAssets.id }).from(mediaAssets)
        .where(and(eq(mediaAssets.id, mediaAssetId), eq(mediaAssets.churchId, churchId))).limit(1);
      if (!row) return { ok: false, error: "media asset not found in your church" };
      return { ok: true };
    }
    // Note: no `case "pptx"` — pptx items are added as "media"-style refs
    // going through the media path above. If a future caller adds "pptx" to
    // the type union, add a real case here (was previously stubbed with an
    // `as any` cast that made it unreachable dead code).
    case "header": {
      // A header is a non-content section divider. Its only payload is an
      // optional hex colour; reject any library refs that don't belong here.
      if (payload.songId || payload.mediaAssetId || payload.pptxImportId) {
        return { ok: false, error: "header payload must not include library refs" };
      }
      const color = payload.color;
      if (color !== undefined && !isHex6Color(color)) {
        return { ok: false, error: "header color must be a #rrggbb hex string" };
      }
      return { ok: true };
    }
    case "sermon": {
      // A sermon may reference ONE PowerPoint import (library "add PPTX sermon").
      // It must be a UUID that exists in pptx_imports FOR THIS CHURCH; any other
      // library ref stays rejected.
      const g = await validateSermonItemPayload(db, churchId, payload);
      return g.ok ? { ok: true } : { ok: false, error: g.error };
    }
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

export async function addServiceItem(planId: string, type: ServiceItemType, title: string, payload: Record<string, unknown>): Promise<Result<{ id: string }>> {
  const user = await requireCap("operate_services");
  const db = getDb();
  const [plan] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId))).limit(1);
  if (!plan) return { ok: false, error: "Not found" };
  const guard = await validateAddServiceItemPayload(db, user.churchId, type, payload || {});
  if (!guard.ok) return guard;
  // Lock the plan row (FOR UPDATE) for the read-existing + insert, so this add
  // serializes with cleanupAdHocServicePlans' locked delete (and with a
  // concurrent add on the same plan). If the plan was deleted meanwhile → Not found.
  const txResult = await db.transaction(async (tx): Promise<Result<{ id: string }>> => {
  const [lockedPlan] = await tx.select({ id: servicePlans.id }).from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId))).for("update");
  if (!lockedPlan) return { ok: false, error: "Not found" };
  // Order = max(existing) + 1. `existing.length` was wrong when items were
  // deleted (gaps) or when two operators added concurrently (both read
  // length=N, both insert order=N, collision + broken sort). Reading max
  // gives a monotonic order that survives deletes; concurrent inserts still
  // race but the failure mode becomes duplicate `order` (visual reorder needed)
  // rather than silent overwrite of an existing row's order.
  const existing = await tx.select({ order: serviceItems.order, type: serviceItems.type, payload: serviceItems.payload }).from(serviceItems).where(eq(serviceItems.servicePlanId, planId));
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
  // payload.slideActions is written ONLY by setServiceItemSlideActions (validated
  // + sanitized) — never trust a client-supplied copy on insert.
  const [row] = await tx.insert(serviceItems).values({ servicePlanId: planId, order: nextOrder, type, title, payload: stripClientSlideActions(payload) }).returning({ id: serviceItems.id });
  return { ok: true, data: { id: row.id } };
  });
  if (txResult.ok && txResult.data) revalidatePath(`/services/${planId}`);
  return txResult;
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

  // Same plan-row lock as addServiceItem: serializes with the ad-hoc clean-up.
  const bulk = await db.transaction(async (tx): Promise<Result<{ inserted: number; skipped: number }>> => {
  const [lockedPlan] = await tx.select({ id: servicePlans.id }).from(servicePlans).where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId))).for("update");
  if (!lockedPlan) return { ok: false, error: "Not found" };
  // Fetch existing items ONCE (not once per item).
  const existing = await tx.select({ order: serviceItems.order, type: serviceItems.type, payload: serviceItems.payload }).from(serviceItems).where(eq(serviceItems.servicePlanId, planId));

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
    toInsert.push({ servicePlanId: planId, order: nextOrder++, type: it.type, title: it.title, payload: stripClientSlideActions(payload) });
  }

  if (toInsert.length > 0) {
    await tx.insert(serviceItems).values(toInsert);
  }
  return { ok: true, data: { inserted: toInsert.length, skipped } };
  });
  if (bulk.ok) revalidatePath(`/services/${planId}`);
  return bulk;
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

  // The item row is LOCKED for the read-compute-write below, and only the keys
  // this path owns are merged back (`payload || {...}`) — so a concurrent
  // setServiceItemSlideActions (or any other single-key writer) can never be
  // clobbered by a stale snapshot, and the slideActions remap sees the latest map.
  const result: Result = await db.transaction(async (tx) => {
    const [item] = await tx.select().from(serviceItems)
      .where(and(eq(serviceItems.id, itemId), eq(serviceItems.servicePlanId, planId)))
      .limit(1)
      .for("update");
    if (!item) return { ok: false, error: "Item not part of this plan" };

    const payload = (item.payload || {}) as Record<string, unknown>;
    // perm[newIdx] = oldIdx over the reordered base slides; used to keep
    // payload.slideActions keys attached to their slides.
    const withRemappedActions = (patch: Record<string, unknown>, perm: number[] | null) => {
      if (perm) {
        const remapped = remapSlideActionsForReorder(payload.slideActions, perm);
        if (remapped) patch.slideActions = remapped;
      }
      return patch;
    };

    if (item.type === "song") {
      const songId = typeof payload.songId === "string" ? payload.songId : null;
      if (!songId) return { ok: false, error: "Song item missing songId" };
      const rows = await tx.select({ id: songSlides.id })
        .from(songSlides)
        .where(eq(songSlides.songId, songId));
      const existingIds = rows.map((r) => r.id);
      const guard = validateReorderItemSlides(newOrder, existingIds);
      if (!guard.ok) return guard;
      // Song slide actions live on song_slides rows (move with the row) — no remap.
      await mergeServiceItemPayload(tx, itemId, planId, { slideOrder: newOrder });
    } else if (item.type === "media" && Array.isArray(payload.mediaAssetIds)) {
      // Grouped media (e.g. "Images (4)", or a PowerPoint imported as images):
      // the slides ARE the mediaAssetIds in order. The client sends synthetic
      // "slide-<i>" ids (SlideGrid), so reorder the id array and persist it —
      // getExpandedServicePlan renders media in mediaAssetIds order, so both the
      // grid and the left playlist reflect the new order after refresh.
      const ids = (payload.mediaAssetIds as unknown[]).filter((x): x is string => typeof x === "string");
      if (ids.length === 0) return { ok: false, error: "Item has no reorderable slides" };
      // Align to the DISPLAYABLE subset in stored order: getExpandedServicePlan
      // renders only ids that still resolve to THIS church (skips deleted/foreign
      // ones), so the client's newOrder covers just those. Reordering that same
      // subset also self-heals — a stale/deleted id is pruned instead of
      // permanently blocking reorder with a length mismatch.
      const owned = ids.length
        ? await tx.select({ id: mediaAssets.id }).from(mediaAssets)
            .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.churchId, user.churchId)))
        : [];
      const ownedSet = new Set(owned.map((r) => r.id));
      const displayable = ids.filter((id) => ownedSet.has(id));
      if (displayable.length === 0) return { ok: false, error: "Item has no reorderable slides" };
      const existingIds = displayable.map((_, i) => `slide-${i}`);
      const guard = validateReorderItemSlides(newOrder, existingIds);
      if (!guard.ok) return guard;
      const reordered = newOrder
        .map((sid) => displayable[existingIds.indexOf(sid)])
        .filter((x): x is string => typeof x === "string");
      const perm = newOrder.map((sid) => existingIds.indexOf(sid));
      await mergeServiceItemPayload(tx, itemId, planId, withRemappedActions({ mediaAssetIds: reordered }, perm));
    } else if (item.type === "sermon" && typeof payload.pptxImportId === "string" && UUID_PAYLOAD_RE.test(payload.pptxImportId)) {
      // Grouped PowerPoint slides come from pptxSlides (shared, church-global).
      // Reorder PER-PLAN via a payload.pptxSlideOrder override (mirrors song's
      // slideOrder) so we never mutate the shared pptxSlides.order.
      const [owned] = await tx.select({ id: pptxImports.id }).from(pptxImports)
        .where(and(eq(pptxImports.id, payload.pptxImportId), eq(pptxImports.churchId, user.churchId)))
        .limit(1);
      if (!owned) return { ok: false, error: "Presentation not found" };
      const rows = await tx.select({ id: pptxSlides.id }).from(pptxSlides)
        .where(eq(pptxSlides.pptxImportId, owned.id)).orderBy(asc(pptxSlides.order));
      const baseIds = rows.map((r) => r.id);
      if (baseIds.length === 0) return { ok: false, error: "Item has no reorderable slides" };
      const prev = Array.isArray(payload.pptxSlideOrder)
        ? (payload.pptxSlideOrder as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      // Current display order = a valid existing override, else pptxSlides.order.
      const curOrder = prev.length === baseIds.length && prev.every((id) => baseIds.includes(id)) ? prev : baseIds;
      const existingIds = curOrder.map((_, i) => `slide-${i}`);
      const guard = validateReorderItemSlides(newOrder, existingIds);
      if (!guard.ok) return guard;
      const reordered = newOrder
        .map((sid) => curOrder[existingIds.indexOf(sid)])
        .filter((x): x is string => typeof x === "string");
      const perm = newOrder.map((sid) => existingIds.indexOf(sid));
      await mergeServiceItemPayload(tx, itemId, planId, withRemappedActions({ pptxSlideOrder: reordered }, perm));
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
      // Only remap when payload.slides IS what getExpandedServicePlan projects:
      // a scripture item without renderable `verses`. (Sermon/media render from
      // pptx/media ids, and scripture prefers `verses`, so reordering `slides`
      // there doesn't move the displayed slides — keys must stay put.)
      const verses = Array.isArray(payload.verses) ? (payload.verses as { text?: unknown }[]) : [];
      const slidesAreDisplayed = item.type === "scripture"
        && !verses.some((v) => v && typeof v.text === "string" && v.text.length > 0);
      const perm = slidesAreDisplayed ? newOrder.map((id) => existingIds.indexOf(id)) : null;
      await mergeServiceItemPayload(tx, itemId, planId, withRemappedActions({ slides: reordered }, perm));
    } else {
      return { ok: false, error: `Cannot reorder slides for item type ${item.type}` };
    }
    return { ok: true };
  });
  if (!result.ok) return result;

  revalidatePath(`/services/${planId}`);
  return { ok: true };
}

type PayloadTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type PayloadWriter = ReturnType<typeof getDb> | PayloadTx;

/** Atomically merge ONLY `patch`'s top-level keys into service_items.payload
 *  (`payload || patch`) — equivalent to `{ ...payload, ...patch }` without
 *  rewriting (and so clobbering) any key another writer touched concurrently. */
async function mergeServiceItemPayload(q: PayloadWriter, itemId: string, planId: string | null, patch: Record<string, unknown>): Promise<void> {
  await q.execute(sql`UPDATE service_items SET payload = (coalesce(payload, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)
    WHERE id = ${itemId} AND (${planId}::uuid IS NULL OR service_plan_id = ${planId}::uuid)`);
}

/** Atomically remove ONE top-level key from service_items.payload. */
async function removeServiceItemPayloadKey(q: PayloadWriter, itemId: string, planId: string | null, key: string): Promise<void> {
  await q.execute(sql`UPDATE service_items SET payload = (coalesce(payload, '{}'::jsonb) - ${key}::text)
    WHERE id = ${itemId} AND (${planId}::uuid IS NULL OR service_plan_id = ${planId}::uuid)`);
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

  // Atomic single-key write (never rewrites the rest of the payload).
  if (themeId) await mergeServiceItemPayload(db, itemId, planId, { themeId });
  else await removeServiceItemPayloadKey(db, itemId, planId, "themeId");
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

// ── Libraries (ProPresenter parity, Phase 3.6) ──────────────────────────────
// Named content buckets. Content with a NULL library_id is the implicit
// "Default" library, which is never a real row (so it can't be deleted/renamed).

export type LibraryRow = { id: string; name: string; order: number; color: string | null; songCount: number; mediaCount: number };

export async function listLibraries(): Promise<Result<{ libraries: LibraryRow[]; defaultSongCount: number; defaultMediaCount: number }>> {
  const user = await requireUser();
  const db = getDb();
  const rows = await db.select().from(libraries).where(eq(libraries.churchId, user.churchId)).orderBy(asc(libraries.order), asc(libraries.createdAt));
  // Counts per library (+ the implicit Default bucket where library_id IS NULL).
  const songCounts = await db.execute(sql`SELECT library_id, count(*)::int AS n FROM songs WHERE church_id = ${user.churchId} GROUP BY library_id`);
  const mediaCounts = await db.execute(sql`SELECT library_id, count(*)::int AS n FROM media_assets WHERE church_id = ${user.churchId} GROUP BY library_id`);
  const sc = new Map<string | null, number>();
  const mc = new Map<string | null, number>();
  for (const r of (songCounts as unknown as { rows: { library_id: string | null; n: number }[] }).rows) sc.set(r.library_id, r.n);
  for (const r of (mediaCounts as unknown as { rows: { library_id: string | null; n: number }[] }).rows) mc.set(r.library_id, r.n);
  return {
    ok: true,
    data: {
      libraries: rows.map((r) => ({ id: r.id, name: r.name, order: r.order, color: r.color ?? null, songCount: sc.get(r.id) ?? 0, mediaCount: mc.get(r.id) ?? 0 })),
      defaultSongCount: sc.get(null) ?? 0,
      defaultMediaCount: mc.get(null) ?? 0,
    },
  };
}

export async function createLibrary(name: string): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return { ok: false, error: "Library name required" };
  const db = getDb();
  const existing = await db.select({ order: libraries.order }).from(libraries).where(eq(libraries.churchId, user.churchId));
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.order)) + 1 : 0;
  const [row] = await db.insert(libraries).values({ churchId: user.churchId, name: trimmed, order: nextOrder }).returning({ id: libraries.id });
  return { ok: true, data: { id: row.id } };
}

export async function renameLibrary(id: string, name: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return { ok: false, error: "Library name required" };
  const db = getDb();
  const res = await db.update(libraries).set({ name: trimmed }).where(and(eq(libraries.id, id), eq(libraries.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Library not found" };
  return { ok: true };
}

export async function deleteLibrary(id: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  // ON DELETE SET NULL on songs/media returns their content to the Default
  // bucket — content is never lost, only un-filed.
  const res = await db.delete(libraries).where(and(eq(libraries.id, id), eq(libraries.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Library not found" };
  return { ok: true };
}

export async function setLibraryColor(id: string, color: string | null): Promise<Result> {
  const user = await requireCap("edit_library");
  // null clears the label; a non-null value must be a #rrggbb hex string.
  if (color !== null && !isHex6Color(color)) return { ok: false, error: "color must be a #rrggbb hex string" };
  const db = getDb();
  const res = await db.update(libraries).set({ color }).where(and(eq(libraries.id, id), eq(libraries.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Library not found" };
  return { ok: true };
}

// Move a song / media asset into a library (null → the Default bucket). The
// target library (when non-null) must belong to the caller's church.
async function assertOwnLibrary(db: ReturnType<typeof getDb>, churchId: string, libraryId: string | null): Promise<boolean> {
  if (libraryId === null) return true;
  const [row] = await db.select({ id: libraries.id }).from(libraries).where(and(eq(libraries.id, libraryId), eq(libraries.churchId, churchId))).limit(1);
  return !!row;
}

export async function setSongLibrary(songId: string, libraryId: string | null): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  if (!(await assertOwnLibrary(db, user.churchId, libraryId))) return { ok: false, error: "Library not found in your church" };
  const res = await db.update(songs).set({ libraryId }).where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Song not found" };
  return { ok: true };
}

export async function setMediaLibrary(assetId: string, libraryId: string | null): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  if (!(await assertOwnLibrary(db, user.churchId, libraryId))) return { ok: false, error: "Library not found in your church" };
  const res = await db.update(mediaAssets).set({ libraryId }).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Media asset not found" };
  return { ok: true };
}

// ── Playlist section headers (ProPresenter parity, Phase 3.6) ────────────────
// A header is a non-content service item; it reuses the service_items table
// (type "header", payload.color) so it reorders/persists exactly like any item.

export async function addPlaylistHeader(planId: string, title: string, color?: string): Promise<Result<{ id: string }>> {
  const trimmed = (title || "Section").trim().slice(0, 120) || "Section";
  const payload: Record<string, unknown> = {};
  if (color) payload.color = color;
  return addServiceItem(planId, "header", trimmed, payload);
}

export async function setHeaderColor(itemId: string, color: string): Promise<Result> {
  const user = await requireCap("operate_services");
  if (!isHex6Color(color)) return { ok: false, error: "color must be a #rrggbb hex string" };
  const db = getDb();
  // Church-scope via the parent plan; merge the color into the existing payload.
  const res = await db.execute(sql`
    UPDATE service_items si
    SET payload = jsonb_set(coalesce(si.payload, '{}'::jsonb), '{color}', ${JSON.stringify(color)}::jsonb, true)
    FROM service_plans sp
    WHERE si.id = ${itemId}
      AND si.service_plan_id = sp.id
      AND sp.church_id = ${user.churchId}
      AND si.type = 'header'
  `);
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Header not found" };
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
  // Groups & Arrangements preservation (wave 6G): the rewrite-all path below
  // deletes every slide row and re-inserts, which historically DROPPED each
  // slide's group_id (the whole song became ungrouped after a quick-edit /
  // lyrics autosave). When the NEW slide count EQUALS the old one — the common
  // case for an in-place text edit that doesn't add or remove lines — carry the
  // old group_id across matching by EXACT prior-lyric TEXT first (so a swapped
  // pair of lines keeps its correct labels), with the slide INDEX as tiebreak
  // for an edited line. When the count differs (a line was added/removed), a
  // positional match is ambiguous, so we DON'T guess — those slides come back
  // ungrouped (surfaced to the operator as a strip warning). No cross-song
  // leakage (song_id is pinned on every row).
  const priorRows = await db.select({ lyrics: songSlides.lyrics, groupId: songSlides.groupId })
    .from(songSlides).where(eq(songSlides.songId, songId)).orderBy(asc(songSlides.order));
  const carriedGroupIds = preservedGroupIds(
    priorRows.map((r) => ({ lyrics: r.lyrics, groupId: r.groupId })),
    slides.map((s) => s.lyrics),
  );
  // Delete + insert must be atomic — a concurrent autosave hitting this
  // route mid-delete could otherwise leave the song with zero slides for
  // a few ms, breaking any operator sending live at that instant. Wrap
  // in a transaction so the delete + insert commit or roll back together.
  try {
    await db.transaction(async (tx) => {
      await tx.delete(songSlides).where(eq(songSlides.songId, songId));
      if (slides.length > 0) {
        await tx.insert(songSlides).values(slides.map((s, i) => ({
          songId, order: i, lyrics: s.lyrics, groupId: carriedGroupIds[i] ?? null,
        })));
      }
    });
  } catch (err) {
    console.error("[updateSongSlides]", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "Save failed — please try again" };
  }
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true };
}

/**
 * Re-chunk ONE song's slides into cleaner, phrase-broken slides (A2 — "tidy
 * slides"). Rejoins the song's existing slide texts into a body and re-runs the
 * shared `chunkLyrics` engine, so an already-imported clunky song gets the same
 * tidy chunking new imports get. Spec: docs/SONG_SLIDE_CHUNKING_SPEC.md §3a.
 *
 * Three guards (design-review folds):
 *  - Rule 2: SKIP songs with any rich `objects_json` slide (or per-slide media)
 *    — re-chunking would orphan that per-slide styling. Reported, not silent.
 *  - Rule 4: in the SAME transaction, clear any `serviceItems.payload.slideOrder`
 *    override that referenced this song's (now-deleted) slide UUIDs, so service
 *    plans fall back to the new full slide list instead of pointing at dangling
 *    IDs (blank slides — the `project_faithflow_song_refs` incident).
 *  - Church-scoped + `edit_library` cap (mirrors updateSongSlides).
 */
export async function reChunkSong(songId: string): Promise<Result<ReChunkOutcome>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  try {
    const res = await reChunkSongCore(db, user.churchId, songId);
    if (res === null) return { ok: false, error: "Song not found" };
    if (!res.skipped) revalidatePath(`/library/songs/${songId}`);
    return { ok: true, data: res };
  } catch (err) {
    console.error("[reChunkSong]", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "Tidy failed — please try again" };
  }
}

/**
 * Bulk "tidy" every song in the caller's library (A2). Per-song + on-demand
 * (Speed fold: no giant single transaction) — each song re-chunks in its own
 * transaction via reChunkSong, so one failure never rolls back the rest.
 * Returns a summary. Bounded by the church's own library size.
 */
export async function reChunkAllSongs(): Promise<Result<{ tidied: number; skipped: number; failed: number; remaining: number; totalSlidesBefore: number; totalSlidesAfter: number }>> {
  const user = await requireCap("edit_library"); // authenticate ONCE for the whole sweep
  if (!(await reChunkAllLimiter(user.id))) return { ok: false, error: "Please wait a moment before tidying the whole library again." };
  const db = getDb();
  const all = await db.select({ id: songs.id }).from(songs).where(eq(songs.churchId, user.churchId)).orderBy(asc(songs.title));
  // Bound one run so a huge library can't blow the function timeout; the caller
  // sees `remaining` and can run again to finish the rest.
  const batch = all.slice(0, RECHUNK_ALL_MAX_PER_RUN);
  const remaining = all.length - batch.length;
  let tidied = 0, skipped = 0, failed = 0, before = 0, after = 0;
  for (const { id } of batch) {
    try {
      const res = await reChunkSongCore(db, user.churchId, id); // no per-song re-auth
      if (res === null) { failed++; continue; }
      before += res.before; after += res.after;
      if (res.skipped) skipped++; else tidied++;
    } catch (err) {
      console.error("[reChunkAllSongs]", err instanceof Error ? err.message : String(err));
      failed++;
    }
  }
  if (tidied > 0) revalidatePath("/library/songs"); // once for the whole sweep
  return { ok: true, data: { tidied, skipped, failed, remaining, totalSlidesBefore: before, totalSlidesAfter: after } };
}

// --- Phase 5D: rich slide editing ------------------------------------------
// Verify the slide belongs to a song owned by the caller's church. Two-hop
// join: song_slides → songs → churches.
async function assertSlideOwned(db: ReturnType<typeof getDb>, slideId: string, churchId: string) {
  if (typeof slideId !== "string" || !UUID_PAYLOAD_RE.test(slideId)) return null; // clean not-found, no Postgres uuid throw
  const [row] = await db.select({ id: songSlides.id, songId: songSlides.songId })
    .from(songSlides)
    .innerJoin(songs, eq(songs.id, songSlides.songId))
    .where(and(eq(songSlides.id, slideId), eq(songs.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

async function assertSongOwned(db: ReturnType<typeof getDb>, songId: string, churchId: string) {
  if (typeof songId !== "string" || !UUID_PAYLOAD_RE.test(songId)) return null; // clean not-found, no Postgres uuid throw
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

// Quick Edit save (2026-08-25): update ONE slide's text, preserving its designed
// layout. Unlike updateSongSlides (rewrite-all, lyrics-only → DROPS objectsJson),
// this loads the slide's current objectsJson and replaces only the FIRST text
// object's text — keeping every object's geometry/style/background — so a quick
// text tweak works "no matter the design of the song or slide". Plain-lyric slides
// (no objectsJson) just update `lyrics`. Single slide, church-scoped, bounded.
export async function updateSongSlideText(slideId: string, newText: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const owned = await assertSlideOwned(db, slideId, user.churchId);
  if (!owned) return { ok: false, error: "Slide not found" };
  const text = typeof newText === "string" ? newText : "";
  if (text.length > 5000) return { ok: false, error: "Slide text too long (max 5000)" };
  const [row] = await db.select({ objectsJson: songSlides.objectsJson }).from(songSlides).where(eq(songSlides.id, slideId)).limit(1);
  const oj = (row?.objectsJson ?? null) as { bgColor?: string; bgImageUrl?: string; objects?: Array<Record<string, unknown>> } | null;
  const objects = Array.isArray(oj?.objects) ? oj!.objects : null;
  if (objects && objects.some((o) => o && o.kind === "text")) {
    // Designed slide: replace the first text object's text; keep everything else.
    let replaced = false;
    const nextObjects = objects.map((o) => {
      if (!replaced && o && o.kind === "text") { replaced = true; return { ...o, text }; }
      return o;
    });
    await db.update(songSlides).set({ objectsJson: { ...oj, objects: nextObjects }, lyrics: text }).where(eq(songSlides.id, slideId));
  } else {
    // Plain-lyric slide: no designed objects to preserve.
    await db.update(songSlides).set({ lyrics: text }).where(eq(songSlides.id, slideId));
  }
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
  let objects = initial?.objects ?? [];
  let bgColor = initial?.bgColor;
  let bgImageUrl = initial?.bgImageUrl;

  // STYLE INHERITANCE (2026-09-06): when adding a BLANK slide (no objects
  // supplied — both "Add slide" buttons do this), copy the styling of a sibling
  // slide in this SAME song so the new slide matches its fonts, size, colour,
  // alignment, decorative objects (logos/shapes) and background — instead of
  // falling back to global defaults and looking different from the rest of the
  // song. The editor's own save path always passes real objects, so it's
  // unaffected. Only inherits when a styled sibling actually exists.
  if (objects.length === 0) {
    const templateId = existing[idx - 1]?.id ?? existing[existing.length - 1]?.id;
    if (templateId) {
      const [tpl] = await db.select({ objectsJson: songSlides.objectsJson })
        .from(songSlides).where(eq(songSlides.id, templateId)).limit(1);
      const tplJson = tpl?.objectsJson as { bgColor?: string; bgImageUrl?: string; objects?: Array<Record<string, unknown>> } | null;
      if (tplJson?.objects?.length) {
        const newText = (initial?.lyrics ?? "").trim();
        let usedTextSlot = false;
        // Keep every object's full style; regenerate ids; put the new lyrics in
        // the FIRST text object and blank any further text objects. Decorative
        // (shape/image/video) objects are copied verbatim so the look matches.
        objects = tplJson.objects.map((o) => {
          const cloned: Record<string, unknown> = { ...o, id: newObjectId() };
          if (o.kind === "text") {
            cloned.text = usedTextSlot ? "" : newText;
            usedTextSlot = true;
          }
          return cloned;
        });
        bgColor = bgColor ?? tplJson.bgColor;
        bgImageUrl = bgImageUrl ?? tplJson.bgImageUrl;
      }
    }
  }

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
      bgColor,
      bgImageUrl,
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
  // Theme Editor PR 1: the copy inherits the source slide's pre-theme snapshot,
  // so re-apply/revert treat it like the original (not an already-themed look).
  // Same row lock as apply/revert/re-apply so a concurrent theme write can't
  // overwrite (or be overwritten by) this backup copy.
  await db.transaction(async (tx) => {
    const [songRow] = await tx.select({ settings: songs.settings }).from(songs)
      .where(and(eq(songs.id, src.songId), eq(songs.churchId, user.churchId))).limit(1).for("update");
    const withCopy = songRow ? copyThemeBackupForDuplicate(songRow.settings, slideId, row.id) : null;
    if (withCopy) {
      await tx.update(songs).set({ settings: withCopy })
        .where(and(eq(songs.id, src.songId), eq(songs.churchId, user.churchId)));
    }
  });
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true, data: { id: row.id } };
}

// ── Media-bin drag/drop (field fix wave 6A) ─────────────────────────────────
// Two dedicated, church-scoped song-slide mutations for the Media Bin → slide
// grid drag/drop. Kept separate from createSongSlide's style-inheritance path so
// a full-screen image slide never inherits a sibling's text objects, and so a
// per-slide background set preserves any existing designed objects.

// Set ONE slide's background image (per-slide bg — behaviour (a): drop a media
// thumbnail ONTO a slide). Preserves the slide's existing objectsJson (objects +
// bgColor); only swaps bgImageUrl. Plain-lyric slides gain a minimal objectsJson
// carrying just the background, so the drop is durable either way.
export async function setSongSlideBackgroundImage(slideId: string, url: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const owned = await assertSlideOwned(db, slideId, user.churchId);
  if (!owned) return { ok: false, error: "Slide not found" };
  const clean = cleanRenderUrl(url);
  if (!clean) {
    return { ok: false, error: "That media has no usable image URL" };
  }
  const [row] = await db.select({ objectsJson: songSlides.objectsJson }).from(songSlides).where(eq(songSlides.id, slideId)).limit(1);
  const oj = (row?.objectsJson ?? null) as { bgColor?: string; bgImageUrl?: string; objects?: Array<Record<string, unknown>> } | null;
  const nextJson = {
    bgColor: oj?.bgColor,
    bgImageUrl: clean,
    objects: Array.isArray(oj?.objects) ? oj!.objects : [],
  };
  await db.update(songSlides).set({ objectsJson: nextJson }).where(eq(songSlides.id, slideId));
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true };
}

// A4 (2026-09-09): remove the per-slide background IMAGE from one slide. The
// inverse of setSongSlideBackgroundImage — clears bgImageUrl while preserving the
// slide's text objects and bgColor. Church-scoped via assertSlideOwned.
export async function clearSongSlideBackgroundImage(slideId: string): Promise<Result<{ cleared: boolean }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const owned = await assertSlideOwned(db, slideId, user.churchId);
  if (!owned) return { ok: false, error: "Slide not found" };
  const [row] = await db.select({ objectsJson: songSlides.objectsJson }).from(songSlides).where(eq(songSlides.id, slideId)).limit(1);
  const oj = (row?.objectsJson ?? null) as Record<string, unknown> | null;
  if (!oj || !oj.bgImageUrl) return { ok: true, data: { cleared: false } }; // nothing to clear
  // Spread the existing objectsJson and ONLY drop the image — preserve bgColor,
  // bgType, bgColor2, transition and any other persisted background fields.
  const nextJson = { ...oj, bgImageUrl: undefined };
  await db.update(songSlides).set({ objectsJson: nextJson }).where(eq(songSlides.id, slideId));
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true, data: { cleared: true } };
}


// A4 (2026-09-09): set the SAME background image on EVERY slide of a song
// ("use this image for all slides"). Preserves each slide's other fields.
export async function setAllSongSlidesBackgroundImage(songId: string, url: string): Promise<Result<{ count: number }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const song = await assertSongOwned(db, songId, user.churchId);
  if (!song) return { ok: false, error: "Song not found" };
  const clean = cleanRenderUrl(url);
  if (!clean) {
    return { ok: false, error: "That media has no usable image URL" };
  }
  const rows = await db.select({ id: songSlides.id, objectsJson: songSlides.objectsJson })
    .from(songSlides).where(eq(songSlides.songId, songId));
  let count = 0;
  for (const r of rows) {
    const oj = (r.objectsJson ?? null) as Record<string, unknown> | null;
    const nextJson = oj ? { ...oj, bgImageUrl: clean } : { bgColor: undefined, bgImageUrl: clean, objects: [] };
    await db.update(songSlides).set({ objectsJson: nextJson }).where(eq(songSlides.id, r.id));
    count++;
  }
  if (count > 0) revalidatePath(`/library/songs/${songId}`);
  return { ok: true, data: { count } };
}

// A4 (2026-09-09): remove the per-slide background IMAGE from EVERY slide of a
// song ("Remove all backgrounds"). Idempotent — slides with no image are skipped.
export async function clearAllSongSlideBackgrounds(songId: string): Promise<Result<{ count: number }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const song = await assertSongOwned(db, songId, user.churchId);
  if (!song) return { ok: false, error: "Song not found" };
  const rows = await db.select({ id: songSlides.id, objectsJson: songSlides.objectsJson })
    .from(songSlides).where(eq(songSlides.songId, songId));
  let count = 0;
  for (const r of rows) {
    const oj = (r.objectsJson ?? null) as Record<string, unknown> | null;
    if (!oj || !oj.bgImageUrl) continue;
    // Spread + drop only the image (preserve gradient/transition/etc).
    await db.update(songSlides).set({ objectsJson: { ...oj, bgImageUrl: undefined } }).where(eq(songSlides.id, r.id));
    count++;
  }
  if (count > 0) revalidatePath(`/library/songs/${songId}`);
  return { ok: true, data: { count } };
}

// Create a NEW full-screen image slide at a position (behaviour (b): drop a
// media thumbnail into empty grid space). The image fills the slide via
// bgImageUrl with no text — deliberately NOT routed through createSongSlide so
// it can't inherit a sibling slide's lyrics/objects.
export async function createSongImageSlide(songId: string, atIndex: number | undefined, url: string): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const song = await assertSongOwned(db, songId, user.churchId);
  if (!song) return { ok: false, error: "Song not found" };
  const clean = cleanRenderUrl(url);
  if (!clean) {
    return { ok: false, error: "That media has no usable image URL" };
  }
  const existing = await db.select({ id: songSlides.id, order: songSlides.order })
    .from(songSlides).where(eq(songSlides.songId, songId)).orderBy(asc(songSlides.order));
  const idx = typeof atIndex === "number" ? Math.max(0, Math.min(atIndex, existing.length)) : existing.length;
  for (let i = existing.length - 1; i >= idx; i--) {
    await db.update(songSlides).set({ order: i + 1 }).where(eq(songSlides.id, existing[i].id));
  }
  const [row] = await db.insert(songSlides).values({
    songId,
    order: idx,
    lyrics: "",
    objectsJson: { bgColor: "#000000", bgImageUrl: clean, objects: [] },
  }).returning({ id: songSlides.id });
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true, data: { id: row.id } };
}

// ── Generic per-item slide backgrounds (field fix wave 6C: decoupling) ───────
// Backgrounds and full-screen image slides are NOT song-only. For a NON-song
// plan item (scripture / media / sermon) the slides are derived from the item
// payload on every load, so a dropped background is persisted as an additive
// override map on the item payload and re-applied by getExpandedServicePlan.
// Church-scoped two-hop (serviceItems → servicePlans). Songs keep their own
// durable path (setSongSlideBackgroundImage / createSongImageSlide).

const ITEM_BG_MAX_SLIDES = 500; // guard against an unbounded override map

async function assertServiceItemOwned(
  db: ReturnType<typeof getDb>,
  itemId: string,
  churchId: string,
): Promise<{ id: string; planId: string; type: ServiceItemType; payload: Record<string, unknown> } | null> {
  if (typeof itemId !== "string" || !UUID_PAYLOAD_RE.test(itemId)) return null; // clean not-found, no Postgres uuid throw
  const [it] = await db
    .select({ id: serviceItems.id, planId: serviceItems.servicePlanId, type: serviceItems.type, payload: serviceItems.payload })
    .from(serviceItems)
    .innerJoin(servicePlans, eq(servicePlans.id, serviceItems.servicePlanId))
    .where(and(eq(serviceItems.id, itemId), eq(servicePlans.churchId, churchId)))
    .limit(1);
  if (!it) return null;
  return { id: it.id, planId: it.planId, type: it.type, payload: (it.payload || {}) as Record<string, unknown> };
}

// Set (or clear, with url="") ONE non-song slide's background image. Stored as
// payload.slideBackgrounds[slideIndex]. Additive — never touches the item's
// other content. For a SONG item, callers must use setSongSlideBackgroundImage
// (durable per-slide row) instead; this rejects songs so the two never diverge.
export async function setServiceItemSlideBackground(itemId: string, slideIndex: number, url: string): Promise<Result> {
  const user = await requireCap("operate_services");
  const db = getDb();
  const it = await assertServiceItemOwned(db, itemId, user.churchId);
  if (!it) return { ok: false, error: "Item not found" };
  if (it.type === "song") return { ok: false, error: "Use the song slide background action for songs" };
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= ITEM_BG_MAX_SLIDES) {
    return { ok: false, error: "Invalid slide" };
  }
  let clean: string | null = null;
  if (url !== "") {
    clean = cleanRenderUrl(url);
    if (!clean) return { ok: false, error: "That media has no usable image URL" };
  }
  // Lock the row, re-read ONLY slideBackgrounds, and merge back just that key —
  // same resulting payload as before, but no stale snapshot of other keys.
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ payload: serviceItems.payload }).from(serviceItems)
      .where(eq(serviceItems.id, itemId)).limit(1).for("update");
    if (!row) return;
    const raw = ((row.payload || {}) as Record<string, unknown>).slideBackgrounds;
    const map: Record<string, string> = (raw && typeof raw === "object" && !Array.isArray(raw)) ? { ...(raw as Record<string, string>) } : {};
    if (clean === null) delete map[String(slideIndex)];
    else map[String(slideIndex)] = clean;
    await mergeServiceItemPayload(tx, itemId, it.planId, { slideBackgrounds: map });
  });
  revalidatePath(`/services/${it.planId}`);
  return { ok: true };
}

// Append a full-screen image slide to a NON-song plan item (drop into empty grid
// space). Stored as payload.extraImageSlides (a url list) so it survives reloads
// and is re-applied by getExpandedServicePlan. Songs use createSongImageSlide.
export async function addServiceItemImageSlide(itemId: string, url: string): Promise<Result> {
  const user = await requireCap("operate_services");
  const db = getDb();
  const it = await assertServiceItemOwned(db, itemId, user.churchId);
  if (!it) return { ok: false, error: "Item not found" };
  if (it.type === "song") return { ok: false, error: "Use the song image-slide action for songs" };
  const clean = cleanRenderUrl(url);
  if (!clean) return { ok: false, error: "That media has no usable image URL" };
  // Lock the row, re-read ONLY extraImageSlides, append, merge back just that key.
  const tooMany = await db.transaction(async (tx) => {
    const [row] = await tx.select({ payload: serviceItems.payload }).from(serviceItems)
      .where(eq(serviceItems.id, itemId)).limit(1).for("update");
    if (!row) return false;
    const raw = ((row.payload || {}) as Record<string, unknown>).extraImageSlides;
    const list: string[] = Array.isArray(raw) ? (raw as unknown[]).filter((u): u is string => typeof u === "string") : [];
    if (list.length >= ITEM_BG_MAX_SLIDES) return true;
    await mergeServiceItemPayload(tx, itemId, it.planId, { extraImageSlides: [...list, clean] });
    return false;
  });
  if (tooMany) return { ok: false, error: "Too many image slides on this item" };
  revalidatePath(`/services/${it.planId}`);
  return { ok: true };
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

// Persist songs already parsed on the client (e.g. VideoPsalm .vpagd). Reuses the
// SAME church-scoped sink as ProPresenter/paste import: dedupe-by-title, song-limit
// headroom, invalid-row skipping. Client-side parsing keeps the server contract a
// plain {title, artist, slides[]} list, format-agnostic.
export async function importParsedSongs(
  candidates: { title: string; artist?: string | null; slides: string[] }[],
): Promise<Result<{ added: number; skipped: number; duplicateSkipped: number; limitSkipped: number }>> {
  const user = await requireCap("edit_library");
  // Bound the payload like importPro6Files does — client-side parsing means we can't
  // trust sizes: cap songs/file, slides/song, and per-slide length.
  const MAX_SONGS = 2000, MAX_SLIDES = 500, MAX_SLIDE_LEN = 5000;
  const clean = (Array.isArray(candidates) ? candidates : [])
    .slice(0, MAX_SONGS)
    .filter((c) => c && typeof c.title === "string")
    .map((c) => ({
      title: c.title.trim().slice(0, 200),
      artist: typeof c.artist === "string" ? c.artist.trim().slice(0, 120) || null : null,
      slides: (Array.isArray(c.slides) ? c.slides : [])
        .slice(0, MAX_SLIDES)
        .map((s) => String(s).slice(0, MAX_SLIDE_LEN))
        .filter((s) => s.trim().length > 0),
      source: "imported" as const,
    }))
    .filter((c) => c.title && c.slides.length > 0);
  if (clean.length === 0) return { ok: false, error: "No songs with lyrics were found in that file." };
  const [limit, usage] = await Promise.all([getEffectiveSongLimit(user.churchId), getSongUsage(user.churchId)]);
  const headroom = Math.max(0, limit - usage);
  const { added, skipped, duplicateSkipped, limitSkipped } = await bulkInsertSongs(user.churchId, clean, headroom);
  revalidatePath("/library/songs");
  return { ok: true, data: { added, skipped, duplicateSkipped, limitSkipped } };
}

export async function deleteSong(id: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  await db.delete(songs).where(and(eq(songs.id, id), eq(songs.churchId, user.churchId)));
  revalidatePath("/library/songs");
  return { ok: true };
}

// Media ----------------------------------------------------------------------
export async function registerMediaAsset(data: { kind: "image" | "video" | "audio"; fileName: string; s3Key: string; mimeType: string; sizeBytes: number; libraryId?: string | null }): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  // SECURITY (media-upload hardening): never trust the client's s3Key / mimeType
  // / kind. The key must be one THIS church was issued (`${churchId}/media/<uuid>.<ext>`),
  // the MIME must be on the shared allowlist, and kind must match the MIME.
  const check = validateMediaRegistration(data, user.churchId);
  if (!check.ok) return { ok: false, error: check.error };
  if (check.kind === "audio" && !(await isAudioMediaSupported())) return { ok: false, error: AUDIO_NOT_READY_ERROR };
  const db = getDb();
  // A key that already backs a media row is never re-registered (duplicate
  // rows / delete-one-breaks-the-other) — and never deleted below.
  const [existing] = await db.select({ id: mediaAssets.id }).from(mediaAssets)
    .where(and(eq(mediaAssets.churchId, user.churchId), eq(mediaAssets.s3Key, check.s3Key))).limit(1);
  if (existing) return { ok: false, error: "This upload is already in your library" };
  // Verify the stored object: real size within cap + magic bytes match the kind.
  // Only a DEFINITE mismatch deletes the object (and never one a row references);
  // a storage/read hiccup keeps it and returns a retryable error.
  const verified = await verifyUploadedObject(check.s3Key, check.mimeType, check.kind, {
    head: statObject,
    readHead: readObjectHead,
    remove: deleteObject,
    isReferenced: async (k) => {
      const [r] = await db.select({ id: mediaAssets.id }).from(mediaAssets)
        .where(sql`${mediaAssets.s3Key} = ${k} OR ${mediaAssets.thumbS3Key} = ${k}`).limit(1);
      return !!r;
    },
  });
  if (!verified.ok) return { ok: false, error: verified.error };
  // Wave 3 (item 4c): an OS-file drop onto a Library row files the upload into
  // that library. Validate ownership; a bad/foreign id falls back to Default
  // (NULL) rather than failing the whole upload.
  const { libraryId } = data;
  const { kind, fileName, s3Key } = check;
  const mimeType = verified.mimeType; // SNIFFED type when known (e.g. a PNG saved as .jpg)
  const sizeBytes = verified.sizeBytes; // the REAL stored size, not the client's claim
  const resolvedLibraryId = libraryId && (await assertOwnLibrary(db, user.churchId, libraryId)) ? libraryId : null;
  // Explicit whitelist of the columns we persist — never spread caller input
  // into the insert, so a future extra field on `data` can't silently write an
  // unintended column.
  const [row] = await db.insert(mediaAssets).values({
    kind, fileName, s3Key, mimeType, sizeBytes,
    libraryId: resolvedLibraryId, churchId: user.churchId,
  }).returning();
  revalidatePath("/library/media");

  // Generate a 320x180 grid thumbnail AFTER responding (non-blocking) so the
  // browse grid loads a ~15KB preview instead of the full-res original (often
  // MBs) into a tiny cell — the dominant media-grid slowness. The full-res
  // s3Key is untouched and still used for actual projection. Fail-soft: if the
  // thumb can't be made, the row keeps thumbS3Key=null and the read path falls
  // back to the original. Videos are skipped (generateImageThumbnail returns
  // null for non-raster types).
  if (kind === "image" && sizeBytes > THUMBNAIL_MAX_SOURCE_BYTES) {
    // Huge originals (>25 MB) aren't buffered in a function just for a grid
    // thumb: stamp the sentinel so the read path serves the original and the
    // backfill doesn't keep re-selecting it.
    await db.update(mediaAssets).set({ thumbS3Key: s3Key })
      .where(and(eq(mediaAssets.id, row.id), eq(mediaAssets.churchId, user.churchId))).catch(() => {});
  } else if (kind === "image") {
    const churchId = user.churchId;
    after(async () => {
      try {
        const original = await getBuffer(s3Key);
        if (!original) return; // transient (e.g. just-written) — backfill retries later
        const thumb = await generateImageThumbnail(original, mimeType);
        // If the image can't be decoded (e.g. SVG), stamp a SENTINEL
        // (thumbS3Key = s3Key) so the read path serves the original AND the
        // backfill loop doesn't keep re-selecting this row forever.
        const thumbKey = thumb ? `${s3Key}.thumb.jpg` : s3Key;
        if (thumb) await putBuffer(thumbKey, thumb.buffer, thumb.mimeType);
        // Church-scoped update — the insert above is this church's row.
        await getDb().update(mediaAssets)
          .set({ thumbS3Key: thumbKey })
          .where(and(eq(mediaAssets.id, row.id), eq(mediaAssets.churchId, churchId)));
      } catch { /* thumb is best-effort; original still serves */ }
    });
  }

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
  // SECURITY: the source key must be a pptx key issued to THIS church, otherwise
  // the converter could be pointed at (and leak) another tenant's object.
  if (!isChurchUploadKey(s3Key, user.churchId, "pptx")) return { ok: false, error: "Invalid upload reference" };
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
  // Explicit field whitelist BEFORE any .set()/.values() — never spread the raw
  // `data` object into the DB write. This is the ONLY server action that writes
  // church_preferences from client input, so a poisoned/extra property (most
  // importantly `layersV2`, which is ONLY writable via the dedicated admin action
  // `setLayersEngineEnabled` — never through this general settings action) can never reach a
  // column. Only keys present in `data` are copied through.
  const patch: Partial<typeof churchPreferences.$inferInsert> = {};
  if ("defaultTranslationId" in data) patch.defaultTranslationId = data.defaultTranslationId;
  if ("aiListeningDefault" in data) patch.aiListeningDefault = data.aiListeningDefault;
  if ("audioInputDeviceLabel" in data) patch.audioInputDeviceLabel = data.audioInputDeviceLabel;
  if ("detectionConfidenceThreshold" in data) patch.detectionConfidenceThreshold = data.detectionConfidenceThreshold;
  if ("productionMode" in data) patch.productionMode = data.productionMode;
  if ("transcriptRetentionDays" in data) patch.transcriptRetentionDays = data.transcriptRetentionDays;
  if ("commandPrefix" in data) patch.commandPrefix = data.commandPrefix;
  if ("autoApproveEnabled" in data) patch.autoApproveEnabled = data.autoApproveEnabled;
  if ("autoApproveThreshold" in data) patch.autoApproveThreshold = data.autoApproveThreshold;
  if ("autoSendToLive" in data) patch.autoSendToLive = data.autoSendToLive;

  const [existing] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1);
  if (existing) {
    await db.update(churchPreferences).set({ ...patch, updatedAt: new Date() }).where(eq(churchPreferences.id, existing.id));
  } else {
    await db.insert(churchPreferences).values({ churchId: user.churchId, ...patch });
  }
  revalidatePath("/settings");
  return { ok: true };
}

// Layers engine opt-out (2026-09-16, user-directed: Layers on by default, a
// church can turn it off). A DEDICATED admin-only action — `updatePreferences`
// still whitelists `layersV2` OUT so a general settings save can never flip it.
// Church-scoped: writes only the caller's own church_preferences row.
export async function setLayersEngineEnabled(enabled: boolean): Promise<Result> {
  // requireUser + explicit role check (NOT requireRole): requireRole redirects,
  // and a redirect from a server action called inside the desktop operator would
  // navigate away from the live console. Return a clean error instead.
  const user = await requireUser();
  if (user.role !== "admin") return { ok: false, error: "Only a church admin can change Layers" };
  if (typeof enabled !== "boolean") return { ok: false, error: "Invalid value" };
  const db = getDb();
  const [existing] = await db.select({ id: churchPreferences.id }).from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1);
  if (existing) {
    await db.update(churchPreferences).set({ layersV2: enabled, updatedAt: new Date() }).where(and(eq(churchPreferences.id, existing.id), eq(churchPreferences.churchId, user.churchId)));
  } else {
    // Upsert on the unique church_id so a double-click with no prefs row can't
    // hit the unique constraint.
    await db.insert(churchPreferences).values({ churchId: user.churchId, layersV2: enabled })
      .onConflictDoUpdate({ target: churchPreferences.churchId, set: { layersV2: enabled, updatedAt: new Date() } });
  }
  revalidatePath("/settings");
  revalidatePath("/operator");
  return { ok: true };
}

/** Team members + pending invites for the desktop Settings window (same data as
 *  /settings/team). Admin-only, returns an error instead of redirecting so the
 *  live operator is never navigated away. Church-scoped. */
export async function getTeamData(): Promise<Result<{
  currentUserId: string;
  members: { id: string; email: string; name: string; role: "admin" | "operator" | "volunteer" | "pastor" | "viewer"; jobTitle: string | null; emailVerified: boolean; lastActiveAt: string | null }[];
  pendingInvites: { id: string; email: string; role: "admin" | "operator" | "volunteer" | "pastor" | "viewer"; expiresAt: string }[];
}>> {
  const user = await requireUser();
  if (user.role !== "admin") return { ok: false, error: "Only a church admin can manage the team." };
  const db = getDb();
  const { users, invitations } = await import("./db/schema");
  const { isNull, gte } = await import("drizzle-orm");
  const members = await db.select({
    id: users.id, email: users.email, name: users.name, role: users.role, jobTitle: users.jobTitle,
    emailVerifiedAt: users.emailVerifiedAt, lastActiveAt: users.lastActiveAt,
  }).from(users).where(eq(users.churchId, user.churchId));
  const pending = await db.select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt }).from(invitations).where(and(
    eq(invitations.churchId, user.churchId), isNull(invitations.acceptedAt), gte(invitations.expiresAt, new Date()),
  ));
  return { ok: true, data: {
    currentUserId: user.id,
    members: members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role as "admin", jobTitle: m.jobTitle, emailVerified: !!m.emailVerifiedAt, lastActiveAt: m.lastActiveAt ? m.lastActiveAt.toISOString() : null })),
    pendingInvites: pending.map((p) => ({ id: p.id, email: p.email, role: p.role as "admin", expiresAt: p.expiresAt.toISOString() })),
  } };
}

/** Everything the church preferences form needs, for the desktop Settings window
 *  (same values the /settings page reads). Church-scoped, read-only. */
export async function getDesktopPreferences(): Promise<Result<{
  display: { blankBgColor: string };
  prefs: {
    defaultTranslationId: string | null; aiListeningDefault: boolean; audioInputDeviceLabel: string | null;
    detectionConfidenceThreshold: number; productionMode: boolean; transcriptRetentionDays: number;
    commandPrefix: string; autoApproveEnabled: boolean; autoApproveThreshold: number; autoSendToLive: boolean;
  };
  translations: { id: string; code: string; name: string }[];
}>> {
  const user = await requireUser();
  const db = getDb();
  const [display] = await db.select({ blankBgColor: settings.blankBgColor }).from(settings).where(eq(settings.churchId, user.churchId)).limit(1);
  const [p] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1);
  const { listTranslations } = await import("./server/bible");
  const translations = (await listTranslations()).filter((t) => !t.licenseRequired).map((t) => ({ id: t.id, code: t.code, name: t.name }));
  return { ok: true, data: {
    display: { blankBgColor: display?.blankBgColor || "#000000" },
    prefs: {
      defaultTranslationId: p?.defaultTranslationId || null,
      aiListeningDefault: p?.aiListeningDefault ?? false,
      audioInputDeviceLabel: p?.audioInputDeviceLabel || null,
      detectionConfidenceThreshold: p?.detectionConfidenceThreshold ?? 60,
      productionMode: p?.productionMode ?? false,
      transcriptRetentionDays: p?.transcriptRetentionDays ?? 90,
      commandPrefix: p?.commandPrefix ?? "presentflow",
      autoApproveEnabled: p?.autoApproveEnabled ?? false,
      autoApproveThreshold: p?.autoApproveThreshold ?? 90,
      autoSendToLive: p?.autoSendToLive ?? false,
    },
    translations,
  } };
}

/** Read the Layers setting for the desktop Settings window (any signed-in role
 *  may read; only admins may change it). Default ON when no row exists. */
export async function getLayersEngineSetting(): Promise<Result<{ enabled: boolean; canEdit: boolean }>> {
  const user = await requireUser();
  const db = getDb();
  const [row] = await db.select({ layersV2: churchPreferences.layersV2 }).from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1);
  return { ok: true, data: { enabled: row?.layersV2 ?? true, canEdit: user.role === "admin" } };
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
  if (typeof input?.pptxImportId !== "string" || !UUID_PAYLOAD_RE.test(input.pptxImportId)) return { ok: false, error: "Import not found" };
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
  // Theme Editor (PR 1) — PP7-style multi-slide layout + extra look controls.
  // Saved now; the projector reads layout/scripture/transition in PR 2.
  layout?: ThemeLayout;
  bgAngle?: number;                        // gradient angle 0..360
  dim?: number;                            // background dim 0..1
  logoOpacity?: number;                    // 0..1
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
  "layout", "bgAngle", "dim", "logoOpacity",
];

function sanitizeThemeConfig(input: unknown): { config: ThemeConfig; rejected: string[] } {
  const rejected: string[] = [];
  const out: ThemeConfig = {};
  if (!input || typeof input !== "object") return { config: out, rejected };
  const obj = input as Record<string, unknown>;
  // The three URL-bearing theme fields render straight into an output channel
  // (logo, slide background image, background video), so value-validate them
  // with the SAME scheme/length check as a dropped media URL — an off-scheme or
  // oversized value is rejected rather than persisted onto the theme.
  const URL_KEYS = new Set(["logoUrl", "bgImageUrl", "bgVideoUrl"]);
  for (const k of Object.keys(obj)) {
    if ((THEME_ALLOWED_KEYS as string[]).includes(k)) {
      if (k === "layout") {
        // Dedicated validator: objects via isValidSlideObject, urls via
        // cleanRenderUrl, capped slides/objects/bytes. Invalid parts dropped.
        if (obj[k] === undefined || obj[k] === null) continue;
        const layout = sanitizeThemeLayout(obj[k]);
        if (layout) out.layout = layout; else rejected.push(k);
      } else if (k in THEME_NUMBER_RANGES) {
        // bgAngle/dim/logoOpacity + font size/weight: clamped (a 0/NaN font
        // size baked into songs made lyrics vanish).
        if (obj[k] === undefined || obj[k] === null) continue;
        const n = sanitizeThemeNumber(k, obj[k]);
        if (n === undefined) rejected.push(k); else (out as Record<string, unknown>)[k] = n;
      } else if (URL_KEYS.has(k) && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
        const clean = cleanRenderUrl(obj[k]);
        if (clean) {
          (out as Record<string, unknown>)[k] = clean;
        } else {
          rejected.push(k);
        }
      } else {
        (out as Record<string, unknown>)[k] = obj[k];
      }
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

export async function updateTheme(id: string, patch: { name?: string; config?: ThemeConfig }): Promise<Result<{ rejected: string[] }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  let rejected: string[] = [];
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.config !== undefined) {
    const clean = sanitizeThemeConfig(patch.config);
    rejected = clean.rejected;
    // A rejected layout must never DELETE the layout already saved on the
    // theme — keep the prior one and tell the caller (no silent drop).
    if (rejected.includes("layout")) {
      const [prev] = await db.select({ config: themes.config }).from(themes)
        .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId))).limit(1);
      const prevLayout = (prev?.config as ThemeConfig | undefined)?.layout;
      if (prevLayout) clean.config.layout = prevLayout;
    }
    updates.config = clean.config;
  }
  await db.update(themes).set(updates)
    .where(and(eq(themes.id, id), eq(themes.churchId, user.churchId)));
  return { ok: true, data: { rejected } };
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

// ── Wave 7: timer definitions (church-scoped) ────────────────────────────────
export type TimerDefInput = {
  name?: string;
  type?: "countdown" | "countdown_to" | "elapsed";
  durationSec?: number;
  targetClock?: string | null;
};

function sanitizeTimerDef(input: TimerDefInput): {
  name: string; type: "countdown" | "countdown_to" | "elapsed"; durationSec: number; targetClock: string | null;
} {
  const type = input.type === "countdown_to" || input.type === "elapsed" ? input.type : "countdown";
  const durationSec = Math.max(0, Math.min(24 * 60 * 60, Math.round(Number(input.durationSec) || 0)));
  // targetClock: accept "HH:MM" only (0-23:0-59); anything else → null.
  const tc = typeof input.targetClock === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(input.targetClock.trim())
    ? input.targetClock.trim() : null;
  return { name: (input.name ?? "Timer").trim().slice(0, 120) || "Timer", type, durationSec, targetClock: tc };
}

export async function listTimerDefinitions(): Promise<Result<Array<{ id: string; name: string; type: string; durationSec: number; targetClock: string | null; sortOrder: number }>>> {
  const user = await requireUser();
  const db = getDb();
  const rows = await db.select().from(timerDefinitions)
    .where(eq(timerDefinitions.churchId, user.churchId))
    .orderBy(asc(timerDefinitions.sortOrder), asc(timerDefinitions.createdAt));
  return { ok: true, data: rows.map((r) => ({ id: r.id, name: r.name, type: r.type, durationSec: r.durationSec, targetClock: r.targetClock, sortOrder: r.sortOrder })) };
}

export async function createTimerDefinition(input: TimerDefInput): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const clean = sanitizeTimerDef(input);
  const existing = await db.select({ sortOrder: timerDefinitions.sortOrder }).from(timerDefinitions).where(eq(timerDefinitions.churchId, user.churchId));
  if (existing.length >= MAX_TIMER_DEFS) return { ok: false, error: `Timer limit reached (${MAX_TIMER_DEFS}). Delete an existing timer to add another.` };
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.sortOrder)) + 1 : 0;
  const [row] = await db.insert(timerDefinitions).values({ churchId: user.churchId, ...clean, sortOrder: nextOrder }).returning({ id: timerDefinitions.id });
  return { ok: true, data: { id: row.id } };
}

export async function updateTimerDefinition(id: string, input: TimerDefInput): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const clean = sanitizeTimerDef(input);
  const res = await db.update(timerDefinitions).set({ ...clean, updatedAt: new Date() })
    .where(and(eq(timerDefinitions.id, id), eq(timerDefinitions.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Timer not found" };
  return { ok: true };
}

export async function deleteTimerDefinition(id: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const res = await db.delete(timerDefinitions)
    .where(and(eq(timerDefinitions.id, id), eq(timerDefinitions.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Timer not found" };
  return { ok: true };
}

// ── Wave 7: message templates (church-scoped) ────────────────────────────────
export type MessageTemplateInput = {
  name?: string;
  text?: string;
  position?: string;
  config?: Record<string, unknown>;
};

const MSG_TEMPLATE_CONFIG_KEYS = new Set(["scroll", "scrollDir", "scrollSec", "allowWeb", "dismiss", "timerId"]);
// Single source of truth for valid overlay positions — the wire contract in
// broadcast.ts (no local drift-prone copy).
const OVERLAY_POSITION_STRINGS = new Set<string>(OVERLAY_POSITIONS);
// Server-side whitelist for the auto-dismiss enum (mirrors MSG_DISMISS_MS keys +
// "manual" in pro/hooks.ts). A value outside this set is dropped rather than
// stored, so a hostile/garbage dismiss can never reach a renderer.
const MSG_DISMISS_VALUES = new Set(["manual", "5s", "10s", "30s", "1min", "5min"]);
// Per-church row cap for timer definitions + message templates. These are
// operator convenience lists, not bulk data — a runaway/hostile creator must
// not be able to grow them without bound (defence-in-depth alongside RLS).
const MAX_TIMER_DEFS = 50;
const MAX_MESSAGE_TEMPLATES = 50;

function sanitizeMessageTemplate(input: MessageTemplateInput): { name: string; text: string; position: string; config: Record<string, unknown> } {
  const name = (input.name ?? "Message").trim().slice(0, 120) || "Message";
  const text = (input.text ?? "").slice(0, 2000);
  const position = typeof input.position === "string" && OVERLAY_POSITION_STRINGS.has(input.position) ? input.position : "lower-third";
  const config: Record<string, unknown> = {};
  const src = input.config && typeof input.config === "object" ? input.config : {};
  for (const k of Object.keys(src)) {
    if (!MSG_TEMPLATE_CONFIG_KEYS.has(k)) continue;
    const v = (src as Record<string, unknown>)[k];
    if (k === "scroll" || k === "allowWeb") { if (typeof v === "boolean") config[k] = v; }
    else if (k === "scrollDir") { if (v === "ltr" || v === "rtl") config[k] = v; }
    else if (k === "scrollSec") { const n = Number(v); if (Number.isFinite(n)) config[k] = Math.max(4, Math.min(120, Math.round(n))); }
    else if (k === "dismiss") { if (typeof v === "string" && MSG_DISMISS_VALUES.has(v)) config[k] = v; }
    else if (k === "timerId") { if (typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v)) config[k] = v; }
  }
  return { name, text, position, config };
}

export async function listMessageTemplates(): Promise<Result<Array<{ id: string; name: string; text: string; position: string; config: Record<string, unknown>; sortOrder: number }>>> {
  const user = await requireUser();
  const db = getDb();
  const rows = await db.select().from(messageTemplates)
    .where(eq(messageTemplates.churchId, user.churchId))
    .orderBy(asc(messageTemplates.sortOrder), asc(messageTemplates.createdAt));
  return { ok: true, data: rows.map((r) => ({ id: r.id, name: r.name, text: r.text, position: r.position, config: (r.config as Record<string, unknown>) ?? {}, sortOrder: r.sortOrder })) };
}

export async function createMessageTemplate(input: MessageTemplateInput): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const clean = sanitizeMessageTemplate(input);
  const existing = await db.select({ sortOrder: messageTemplates.sortOrder }).from(messageTemplates).where(eq(messageTemplates.churchId, user.churchId));
  if (existing.length >= MAX_MESSAGE_TEMPLATES) return { ok: false, error: `Template limit reached (${MAX_MESSAGE_TEMPLATES}). Delete an existing template to add another.` };
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.sortOrder)) + 1 : 0;
  const [row] = await db.insert(messageTemplates).values({ churchId: user.churchId, ...clean, sortOrder: nextOrder }).returning({ id: messageTemplates.id });
  return { ok: true, data: { id: row.id } };
}

export async function updateMessageTemplate(id: string, input: MessageTemplateInput): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const clean = sanitizeMessageTemplate(input);
  const res = await db.update(messageTemplates).set({ ...clean, updatedAt: new Date() })
    .where(and(eq(messageTemplates.id, id), eq(messageTemplates.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Template not found" };
  return { ok: true };
}

export async function deleteMessageTemplate(id: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const res = await db.delete(messageTemplates)
    .where(and(eq(messageTemplates.id, id), eq(messageTemplates.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Template not found" };
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

// Batched, song-scoped slide write: ONE UPDATE … FROM (VALUES …) per chunk
// instead of one round trip per slide (re-apply timeouts on long songs). The
// song_id predicate keeps it tenant-safe — song_slides has no church_id, so the
// caller must pass a church-verified (row-locked) song id.
type ThemeTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
async function writeSongSlideObjects(tx: ThemeTx, songId: string, rows: { id: string; objectsJson: unknown }[]) {
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    if (chunk.length === 0) continue;
    const values = sql.join(chunk.map((r) => sql`(${r.id}::uuid, ${JSON.stringify(r.objectsJson ?? null)}::jsonb)`), sql`, `);
    await tx.execute(sql`UPDATE song_slides AS s SET objects_json = v.oj
      FROM (VALUES ${values}) AS v(id, oj)
      WHERE s.id = v.id AND s.song_id = ${songId}::uuid`);
  }
}

export async function applyThemeToSong(themeId: string, songId: string): Promise<Result<{ slidesUpdated: number }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const [theme] = await db.select().from(themes)
    .where(and(eq(themes.id, themeId), eq(themes.churchId, user.churchId))).limit(1);
  if (!theme) return { ok: false, error: "Theme not found" };
  const cfg = (theme.config as ThemeConfig) ?? {};
  const res = await db.transaction(async (tx): Promise<Result<{ slidesUpdated: number }>> => {
    const [song] = await tx.select().from(songs)
      .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId))).for("update");
    if (!song) return { ok: false, error: "Song not found" };
    const slides = await tx.select({ id: songSlides.id, objectsJson: songSlides.objectsJson })
      .from(songSlides).where(eq(songSlides.songId, songId));
    const prevSettings = (song.settings as Record<string, unknown>) ?? {};
    // Snapshot every slide's prior objectsJson so revertSongTheme can restore the
    // look. Revert-bug fix (Theme Editor PR 1): the FIRST snapshot is preserved
    // across repeated applies (theme A then theme B used to overwrite the backup
    // with A's baked slides, so "undo" restored A, never the original). Slides
    // created after the first apply are added; entries for deleted slides pruned.
    const merged0 = mergeThemeBackup(prevSettings.themeBackup, slides.map((s) => ({ id: s.id, objectsJson: s.objectsJson ?? null })), themeId);
    const backup = pruneThemeBackup(merged0, slides.map((s) => s.id)) ?? merged0;
    // The bake (contrast guard, black-bg sentinel, gradient pass-through, theme
    // wins) lives in ONE place — theme-bake.ts — shared with the per-slide
    // override and the theme-editor re-apply (see test/theme-bake.test.ts).
    await writeSongSlideObjects(tx, songId, slides.map((s) => ({ id: s.id, objectsJson: bakeThemeIntoObjectsJson(cfg, s.objectsJson) })));
    // A whole-song apply re-bakes EVERY slide, so per-slide overrides are
    // superseded — clear their (now-stale) backups.
    await tx.update(songs).set({
      settings: { ...prevSettings, appliedThemeId: themeId, themeBackup: backup, slideThemeBackups: {} },
    }).where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId)));
    return { ok: true, data: { slidesUpdated: slides.length } };
  });
  if (!res.ok) return res;
  revalidatePath("/library/songs");
  revalidatePath(`/library/songs/${songId}`);
  return res;
}

/**
 * Per-slide theme override (Victor's ProPresenter parity ask 2026-09-10:
 * "individually select the theme for each slide"). Bakes ONE theme into ONE
 * slide's objectsJson via the same helper the whole-song bake uses — the look
 * lives in the slide, so preview and live render it identically and the other
 * slides are untouched. The pre-bake objectsJson is snapshotted per-slide in
 * song.settings.slideThemeBackups so removeThemeFromSongSlide can restore it.
 */
export async function applyThemeToSongSlide(themeId: string, songId: string, slideId: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const [theme] = await db.select().from(themes)
    .where(and(eq(themes.id, themeId), eq(themes.churchId, user.churchId))).limit(1);
  if (!theme) return { ok: false, error: "Theme not found" };
  const cfg = (theme.config as ThemeConfig) ?? {};
  const res = await db.transaction(async (tx): Promise<Result> => {
    const [song] = await tx.select().from(songs)
      .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId))).for("update");
    if (!song) return { ok: false, error: "Song not found" };
    const [slide] = await tx.select().from(songSlides)
      .where(and(eq(songSlides.id, slideId), eq(songSlides.songId, songId))).limit(1);
    if (!slide) return { ok: false, error: "Slide not found" };
    const prevSettings = (song.settings as Record<string, unknown>) ?? {};
    const backups = { ...((prevSettings.slideThemeBackups as Record<string, unknown>) ?? {}) };
    // Only snapshot the ORIGINAL look once, so re-applying different themes to the
    // same slide still reverts to the pre-override state. themeId records which
    // theme owns the override (theme-editor re-apply skips other themes' slides).
    if (!(slideId in backups)) backups[slideId] = { objectsJson: slide.objectsJson ?? null, themeId };
    else backups[slideId] = { ...(backups[slideId] as Record<string, unknown>), themeId };
    const merged = bakeThemeIntoObjectsJson(cfg, slide.objectsJson);
    await tx.update(songSlides).set({ objectsJson: merged })
      .where(and(eq(songSlides.id, slideId), eq(songSlides.songId, songId)));
    await tx.update(songs).set({ settings: { ...prevSettings, slideThemeBackups: backups } })
      .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId)));
    return { ok: true };
  });
  if (!res.ok) return res;
  revalidatePath("/library/songs");
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true };
}

/** Undo a per-slide theme override — restore that slide's snapshotted objectsJson. */
export async function removeThemeFromSongSlide(songId: string, slideId: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const [song] = await db.select().from(songs)
    .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId))).limit(1);
  if (!song) return { ok: false, error: "Song not found" };
  const prevSettings = (song.settings as Record<string, unknown>) ?? {};
  const backups = { ...((prevSettings.slideThemeBackups as Record<string, unknown>) ?? {}) };
  const snap = backups[slideId] as { objectsJson?: unknown } | undefined;
  if (!snap) return { ok: false, error: "No per-slide theme to remove" };
  await db.update(songSlides)
    .set({ objectsJson: (snap.objectsJson ?? null) as typeof songSlides.$inferInsert.objectsJson })
    .where(and(eq(songSlides.id, slideId), eq(songSlides.songId, songId)));
  delete backups[slideId];
  await db.update(songs).set({ settings: { ...prevSettings, slideThemeBackups: backups } })
    .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId)));
  revalidatePath("/library/songs");
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true };
}

/**
 * Reverse applyThemeToSong — restore every slide's THEME-OWNED fields (bg,
 * transition, text font/size/weight/colour/align) from the snapshot in
 * song.settings.themeBackup, keeping the slide's CURRENT content (lyrics/text,
 * objects added since) so reverting never loses a lyric edit. Clears the
 * applied-theme markers. Returns an error if there's nothing to revert.
 */
export async function revertSongTheme(songId: string): Promise<Result<{ slidesRestored: number }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const res = await db.transaction(async (tx): Promise<Result<{ slidesRestored: number }>> => {
    const [song] = await tx.select().from(songs)
      .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId))).for("update");
    if (!song) return { ok: false, error: "Song not found" };
    const settings = (song.settings as Record<string, unknown>) ?? {};
    const backup = settings.themeBackup as { slides?: { id: string; objectsJson: unknown }[] } | undefined;
    if (!backup?.slides?.length) return { ok: false, error: "Nothing to undo" };
    const current = await tx.select({ id: songSlides.id, objectsJson: songSlides.objectsJson })
      .from(songSlides).where(eq(songSlides.songId, songId));
    const byId = new Map(current.map((c) => [c.id, c]));
    const rows: { id: string; objectsJson: unknown }[] = [];
    for (const b of backup.slides) {
      const cur = byId.get(b.id);
      if (!cur) continue; // slide deleted since the apply
      rows.push({ id: b.id, objectsJson: resetThemeOwnedFields(cur.objectsJson, b.objectsJson) });
    }
    await writeSongSlideObjects(tx, songId, rows);
    const nextSettings = { ...settings };
    delete (nextSettings as Record<string, unknown>).themeBackup;
    delete (nextSettings as Record<string, unknown>).appliedThemeId;
    // Reverting the whole song restores every slide's pre-theme look, so any
    // per-slide override snapshots are now meaningless — drop them.
    delete (nextSettings as Record<string, unknown>).slideThemeBackups;
    await tx.update(songs).set({ settings: nextSettings })
      .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId)));
    return { ok: true, data: { slidesRestored: rows.length } };
  });
  if (!res.ok) return res;
  revalidatePath("/library/songs");
  revalidatePath(`/library/songs/${songId}`);
  return res;
}

// ── Theme Editor (PR 1) — re-apply an edited theme to every song using it ──
//
// A song "uses" a theme when it was whole-song applied (settings.appliedThemeId)
// or when any of its slides carries a per-slide override of that theme
// (settings.slideThemeBackups[slideId].themeId). Tenant safety: the theme is
// re-selected by church, songs are filtered by church_id, and — because
// song_slides has NO church_id — every slide read/write is filtered by the
// song_id of a church-verified, row-locked song.
const THEME_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function songsUsingThemeWhere(churchId: string, themeId: string) {
  return and(
    eq(songs.churchId, churchId),
    sql`(${songs.settings}->>'appliedThemeId' = ${themeId} OR EXISTS (
      SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(${songs.settings}->'slideThemeBackups') = 'object'
        THEN ${songs.settings}->'slideThemeBackups' ELSE '{}'::jsonb END) AS e
      WHERE e.value->>'themeId' = ${themeId}))`,
  );
}

export async function countSongsUsingTheme(themeId: string, opts: { checkSongId?: string | null } = {}): Promise<Result<{ count: number; includesCheckedSong: boolean }>> {
  const user = await requireCap("edit_library");
  if (!THEME_UUID_RE.test(themeId)) return { ok: false, error: "Theme not found" };
  const db = getDb();
  const [theme] = await db.select({ id: themes.id }).from(themes)
    .where(and(eq(themes.id, themeId), eq(themes.churchId, user.churchId))).limit(1);
  if (!theme) return { ok: false, error: "Theme not found" };
  const where = songsUsingThemeWhere(user.churchId, themeId);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(songs).where(where);
  let includesCheckedSong = false;
  const check = opts.checkSongId;
  if (typeof check === "string" && THEME_UUID_RE.test(check)) {
    const [hit] = await db.select({ id: songs.id }).from(songs).where(and(where, eq(songs.id, check))).limit(1);
    includesCheckedSong = !!hit;
  }
  return { ok: true, data: { count: Number(row?.n ?? 0), includesCheckedSong } };
}

export async function reapplyThemeToSongs(
  themeId: string,
  opts: { cursor?: string | null; limit?: number; previousConfig?: unknown } = {},
): Promise<Result<{ updated: number; nextCursor: string | null }>> {
  const user = await requireCap("edit_library");
  if (!THEME_UUID_RE.test(themeId)) return { ok: false, error: "Theme not found" };
  const cursor = opts.cursor ?? null;
  if (cursor !== null && (typeof cursor !== "string" || !THEME_UUID_RE.test(cursor))) {
    return { ok: false, error: "Invalid cursor" };
  }
  const db = getDb();
  const limit = Math.max(1, Math.min(25, Math.floor(opts.limit ?? 10)));
  const [theme] = await db.select().from(themes)
    .where(and(eq(themes.id, themeId), eq(themes.churchId, user.churchId))).limit(1);
  if (!theme) return { ok: false, error: "Theme not found" };
  const cfg = (theme.config as ThemeConfig) ?? {};
  // Background fields are ALWAYS reset from the snapshot (no leftover bg when
  // the key union misses a removed field). TEXT fields: only those the theme
  // sets NOW or SET BEFORE are reset — an operator's own value for a field no
  // theme version set is left alone. previousConfig is only read for WHICH
  // keys exist (whitelisted field names).
  const fields = reapplyFieldsForConfigs([cfg, opts.previousConfig]);
  const base = songsUsingThemeWhere(user.churchId, themeId);
  const page = await db.select({ id: songs.id }).from(songs)
    .where(cursor ? and(base, sql`${songs.id} > ${cursor}::uuid`) : base)
    .orderBy(asc(songs.id)).limit(limit);
  let updated = 0;
  for (const { id: songId } of page) {
    const changed = await db.transaction(async (tx) => {
      const [song] = await tx.select().from(songs)
        .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId))).for("update");
      if (!song) return false;
      const settings = (song.settings as Record<string, unknown>) ?? {};
      const slides = await tx.select({ id: songSlides.id, objectsJson: songSlides.objectsJson })
        .from(songSlides).where(eq(songSlides.songId, songId));
      const additions: { id: string; objectsJson: unknown }[] = [];
      const rows: { id: string; objectsJson: unknown }[] = [];
      for (const sl of slides) {
        const src = reapplySourceForSlide(themeId, sl, settings);
        if (!src) continue; // per-slide override of another theme, or not this theme
        if (src.addToBackup) additions.push({ id: sl.id, objectsJson: sl.objectsJson ?? null });
        rows.push({ id: sl.id, objectsJson: rebakeThemeFromOriginal(cfg, sl.objectsJson, src.original, fields) });
      }
      await writeSongSlideObjects(tx, songId, rows);
      if (settings.appliedThemeId === themeId) {
        const merged = additions.length > 0 ? mergeThemeBackup(settings.themeBackup, additions, themeId) : settings.themeBackup;
        const pruned = pruneThemeBackup(merged, slides.map((x) => x.id));
        if (pruned) {
          await tx.update(songs).set({ settings: { ...settings, themeBackup: pruned } })
            .where(and(eq(songs.id, songId), eq(songs.churchId, user.churchId)));
        }
      }
      return rows.length > 0;
    });
    if (changed) updated += 1;
  }
  if (updated > 0) revalidatePath("/library/songs");
  const nextCursor = page.length === limit ? page[page.length - 1]!.id : null;
  return { ok: true, data: { updated, nextCursor } };
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

// ── Groups & Arrangements (ProPresenter §12 / MVP §9) ───────────────────────
// All group/arrangement mutations are church-scoped via assertSongOwned (song
// editing => `edit_library`). Field whitelists + hard caps below; the arrangement
// PIN on a playlist item is `operate_services` (running a service, not editing a
// song). Deleting a group NEVER deletes its slides (group_id ON DELETE SET NULL).

const MAX_GROUPS_PER_SONG = 60;         // generous; a song rarely exceeds ~12 sections
const MAX_ARRANGEMENTS_PER_SONG = 30;
const MAX_ARRANGEMENT_LEN = 200;        // group refs in one arrangement order

function normalizeGroupKind(kind: unknown): string {
  return typeof kind === "string" && (GROUP_KINDS as readonly string[]).includes(kind) ? kind : "custom";
}

/** Verify a group belongs to a song owned by the caller's church. */
async function assertGroupOwned(db: ReturnType<typeof getDb>, groupId: string, churchId: string) {
  if (typeof groupId !== "string" || !UUID_PAYLOAD_RE.test(groupId)) return null;
  const [row] = await db.select({ id: songGroups.id, songId: songGroups.songId })
    .from(songGroups)
    .innerJoin(songs, eq(songs.id, songGroups.songId))
    .where(and(eq(songGroups.id, groupId), eq(songGroups.churchId, churchId), eq(songs.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

async function assertArrangementOwned(db: ReturnType<typeof getDb>, arrangementId: string, churchId: string) {
  if (typeof arrangementId !== "string" || !UUID_PAYLOAD_RE.test(arrangementId)) return null;
  const [row] = await db.select({ id: songArrangements.id, songId: songArrangements.songId })
    .from(songArrangements)
    .innerJoin(songs, eq(songs.id, songArrangements.songId))
    .where(and(eq(songArrangements.id, arrangementId), eq(songArrangements.churchId, churchId), eq(songs.churchId, churchId)))
    .limit(1);
  return row ?? null;
}

export async function createSongGroup(songId: string, name: string, kind?: string, color?: string | null): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const song = await assertSongOwned(db, songId, user.churchId);
  if (!song) return { ok: false, error: "Song not found" };
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { ok: false, error: "Group name required" };
  if (trimmed.length > 60) return { ok: false, error: "Group name too long (max 60)" };
  if (color != null && !isHex6Color(color)) return { ok: false, error: "color must be a #rrggbb hex string" };
  const existing = await db.select({ id: songGroups.id, order: songGroups.order })
    .from(songGroups).where(and(eq(songGroups.songId, songId), eq(songGroups.churchId, user.churchId))).orderBy(asc(songGroups.order));
  if (existing.length >= MAX_GROUPS_PER_SONG) return { ok: false, error: `Cap of ${MAX_GROUPS_PER_SONG} groups per song` };
  const nextOrder = existing.length ? Math.max(...existing.map((g) => g.order)) + 1 : 0;
  const [row] = await db.insert(songGroups).values({
    churchId: user.churchId, songId, name: trimmed, kind: normalizeGroupKind(kind), color: color ?? null, order: nextOrder,
  }).returning({ id: songGroups.id });
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true, data: { id: row.id } };
}

export async function renameSongGroup(groupId: string, name: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const owned = await assertGroupOwned(db, groupId, user.churchId);
  if (!owned) return { ok: false, error: "Group not found" };
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { ok: false, error: "Group name required" };
  if (trimmed.length > 60) return { ok: false, error: "Group name too long (max 60)" };
  await db.update(songGroups).set({ name: trimmed }).where(and(eq(songGroups.id, groupId), eq(songGroups.churchId, user.churchId)));
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true };
}

export async function recolorSongGroup(groupId: string, color: string | null, kind?: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const owned = await assertGroupOwned(db, groupId, user.churchId);
  if (!owned) return { ok: false, error: "Group not found" };
  if (color != null && !isHex6Color(color)) return { ok: false, error: "color must be a #rrggbb hex string" };
  const patch: { color: string | null; kind?: string } = { color: color ?? null };
  if (kind !== undefined) patch.kind = normalizeGroupKind(kind);
  await db.update(songGroups).set(patch).where(and(eq(songGroups.id, groupId), eq(songGroups.churchId, user.churchId)));
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true };
}

export async function deleteSongGroup(groupId: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const owned = await assertGroupOwned(db, groupId, user.churchId);
  if (!owned) return { ok: false, error: "Group not found" };
  // group_id ON DELETE SET NULL => slides survive, just become ungrouped.
  // Also strip the id from any of this song's arrangements so their order stays clean.
  const arrs = await db.select().from(songArrangements).where(and(eq(songArrangements.songId, owned.songId), eq(songArrangements.churchId, user.churchId)));
  await db.transaction(async (tx) => {
    await tx.delete(songGroups).where(and(eq(songGroups.id, groupId), eq(songGroups.churchId, user.churchId)));
    for (const a of arrs) {
      const order = Array.isArray(a.order) ? (a.order as unknown[]).filter((x): x is string => typeof x === "string") : [];
      if (order.includes(groupId)) {
        await tx.update(songArrangements).set({ order: order.filter((g) => g !== groupId) }).where(and(eq(songArrangements.id, a.id), eq(songArrangements.churchId, user.churchId)));
      }
    }
  });
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true };
}

/** Assign (or clear, groupId=null) a set of slides to a group. All slides + the
 *  group must belong to ONE song owned by the caller's church. */
export async function assignSlidesToGroup(songId: string, slideIds: string[], groupId: string | null): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const song = await assertSongOwned(db, songId, user.churchId);
  if (!song) return { ok: false, error: "Song not found" };
  const ids = Array.isArray(slideIds) ? slideIds.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) return { ok: false, error: "No slides given" };
  if (ids.length > 500) return { ok: false, error: "Too many slides in one assignment (max 500)" };
  if (groupId !== null) {
    const g = await assertGroupOwned(db, groupId, user.churchId);
    if (!g || g.songId !== songId) return { ok: false, error: "Group not found for this song" };
  }
  // Scope the update to THIS song's slides only (defence-in-depth: a foreign
  // slide id can never be reassigned because song_id is pinned in the WHERE).
  await db.update(songSlides).set({ groupId }).where(and(eq(songSlides.songId, songId), inArray(songSlides.id, ids)));
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true };
}

export async function createArrangement(songId: string, name: string, order?: string[]): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const song = await assertSongOwned(db, songId, user.churchId);
  if (!song) return { ok: false, error: "Song not found" };
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { ok: false, error: "Arrangement name required" };
  if (trimmed.length > 80) return { ok: false, error: "Arrangement name too long (max 80)" };
  const existing = await db.select({ id: songArrangements.id, sort: songArrangements.sort })
    .from(songArrangements).where(and(eq(songArrangements.songId, songId), eq(songArrangements.churchId, user.churchId)));
  if (existing.length >= MAX_ARRANGEMENTS_PER_SONG) return { ok: false, error: `Cap of ${MAX_ARRANGEMENTS_PER_SONG} arrangements per song` };
  const cleanOrder = await sanitizeArrangementOrder(db, songId, order, user.churchId);
  if (cleanOrder === null) return { ok: false, error: "Arrangement order too long" };
  const nextSort = existing.length ? Math.max(...existing.map((a) => a.sort)) + 1 : 0;
  const [row] = await db.insert(songArrangements).values({
    churchId: user.churchId, songId, name: trimmed, isDefault: false, order: cleanOrder, sort: nextSort,
  }).returning({ id: songArrangements.id });
  revalidatePath(`/library/songs/${songId}`);
  return { ok: true, data: { id: row.id } };
}

export async function renameArrangement(arrangementId: string, name: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const owned = await assertArrangementOwned(db, arrangementId, user.churchId);
  if (!owned) return { ok: false, error: "Arrangement not found" };
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { ok: false, error: "Arrangement name required" };
  if (trimmed.length > 80) return { ok: false, error: "Arrangement name too long (max 80)" };
  await db.update(songArrangements).set({ name: trimmed }).where(and(eq(songArrangements.id, arrangementId), eq(songArrangements.churchId, user.churchId)));
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true };
}

export async function deleteArrangement(arrangementId: string): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const owned = await assertArrangementOwned(db, arrangementId, user.churchId);
  if (!owned) return { ok: false, error: "Arrangement not found" };
  await db.delete(songArrangements).where(and(eq(songArrangements.id, arrangementId), eq(songArrangements.churchId, user.churchId)));
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true };
}

/** Replace an arrangement's group order (the two-row editor's save). Repeatable
 *  group ids allowed; every id is validated to belong to THIS song. */
export async function reorderArrangement(arrangementId: string, order: string[]): Promise<Result> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const owned = await assertArrangementOwned(db, arrangementId, user.churchId);
  if (!owned) return { ok: false, error: "Arrangement not found" };
  const cleanOrder = await sanitizeArrangementOrder(db, owned.songId, order, user.churchId);
  if (cleanOrder === null) return { ok: false, error: "Arrangement order too long" };
  await db.update(songArrangements).set({ order: cleanOrder }).where(and(eq(songArrangements.id, arrangementId), eq(songArrangements.churchId, user.churchId)));
  revalidatePath(`/library/songs/${owned.songId}`);
  return { ok: true };
}

/** Clean an incoming arrangement order: keep only string group ids that belong
 *  to this song (repeats preserved), enforce the length cap. Returns null if too
 *  long. An empty/absent order yields []. */
async function sanitizeArrangementOrder(db: ReturnType<typeof getDb>, songId: string, order: unknown, churchId: string): Promise<string[] | null> {
  const arr = Array.isArray(order) ? (order as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (arr.length > MAX_ARRANGEMENT_LEN) return null;
  if (arr.length === 0) return [];
  const groups = await db.select({ id: songGroups.id }).from(songGroups).where(and(eq(songGroups.songId, songId), eq(songGroups.churchId, churchId)));
  const valid = new Set(groups.map((g) => g.id));
  return arr.filter((id) => valid.has(id));
}

/** PIN (or clear, arrangementId=null) which arrangement a playlist item uses.
 *  `operate_services` — this is running a service, not editing a song. Scoped to
 *  the item's plan → church. Verifies the arrangement belongs to the item's song. */
export async function setServiceItemArrangement(itemId: string, arrangementId: string | null): Promise<Result> {
  const user = await requireCap("operate_services");
  const db = getDb();
  // Load the item + its plan (church-scoped) + its songId payload.
  const [item] = await db.select({ id: serviceItems.id, type: serviceItems.type, payload: serviceItems.payload })
    .from(serviceItems)
    .innerJoin(servicePlans, eq(servicePlans.id, serviceItems.servicePlanId))
    .where(and(eq(serviceItems.id, itemId), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!item) return { ok: false, error: "Item not found" };
  if (item.type !== "song") return { ok: false, error: "Arrangements apply to song items only" };
  if (arrangementId !== null) {
    const owned = await assertArrangementOwned(db, arrangementId, user.churchId);
    if (!owned) return { ok: false, error: "Arrangement not found" };
    const payloadSongId = (item.payload as { songId?: unknown })?.songId;
    if (typeof payloadSongId === "string" && owned.songId !== payloadSongId) {
      return { ok: false, error: "Arrangement does not belong to this song" };
    }
  }
  if (arrangementId === null) {
    await db.execute(sql`UPDATE service_items SET payload = (coalesce(payload,'{}'::jsonb) - 'arrangementId') WHERE id = ${itemId}`);
  } else {
    await db.execute(sql`UPDATE service_items SET payload = jsonb_set(coalesce(payload,'{}'::jsonb), '{arrangementId}', ${JSON.stringify(arrangementId)}::jsonb, true) WHERE id = ${itemId}`);
  }
  return { ok: true };
}

/** Read a song's full groups + arrangements model (for the editor UI). */
export async function getSongArrangementModel(songId: string): Promise<Result<{
  groups: { id: string; name: string; kind: string; color: string | null; order: number }[];
  arrangements: { id: string; name: string; isDefault: boolean; order: string[]; sort: number }[];
  slideGroups: { slideId: string; groupId: string | null }[];
}>> {
  const user = await requireCap("view_library");
  const db = getDb();
  const song = await assertSongOwned(db, songId, user.churchId);
  if (!song) return { ok: false, error: "Song not found" };
  const [groups, arrangements, slides] = await Promise.all([
    db.select().from(songGroups).where(and(eq(songGroups.songId, songId), eq(songGroups.churchId, user.churchId))).orderBy(asc(songGroups.order)),
    db.select().from(songArrangements).where(and(eq(songArrangements.songId, songId), eq(songArrangements.churchId, user.churchId))).orderBy(asc(songArrangements.sort)),
    db.select({ id: songSlides.id, groupId: songSlides.groupId }).from(songSlides).where(eq(songSlides.songId, songId)).orderBy(asc(songSlides.order)),
  ]);
  return {
    ok: true,
    data: {
      groups: groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind, color: g.color, order: g.order })),
      arrangements: arrangements.map((a) => ({ id: a.id, name: a.name, isDefault: a.isDefault, order: Array.isArray(a.order) ? (a.order as unknown[]).filter((x): x is string => typeof x === "string") : [], sort: a.sort })),
      slideGroups: slides.map((s) => ({ slideId: s.id, groupId: s.groupId })),
    },
  };
}

// ── Phase 4: Slide Actions (per-slide attached ActionSpec[]) ─────────────────
//
// Slide actions are validated NON-destructive on write (guarded blank/kill/
// clear_all rejected) AND on dispatch (src/engine/slide-actions). Song slides
// store them on `song_slides.actions`; non-song items store them in
// `service_items.payload.slideActions[slideIdx]` (JSONB, no column).

/** Persist a song slide's attached actions. Church-scoped (slide → song →
 *  church); validated, then whitelist-rebuilt (drops guarded/invalid/extra keys)
 *  before write. DB core: src/lib/server/automations.ts. */
export async function setSongSlideActions(slideId: string, actions: unknown): Promise<Result> {
  const user = await requireCap("edit_library");
  const { setSongSlideActionsCore } = await import("./server/automations");
  const res = await setSongSlideActionsCore(getDb(), user.churchId, slideId, actions);
  if (!res.ok) return res;
  if (res.data?.songId) revalidatePath(`/library/songs/${res.data.songId}`);
  return { ok: true };
}

/** Persist a NON-song item's per-slide actions into service_items.payload.
 *  slideActions (sparse map { [slideIdx]: ActionSpec[] }). Church-scoped in the
 *  UPDATE itself; atomic single-key jsonb write (no read-modify-write). This is
 *  the ONLY writer of payload.slideActions — addServiceItem(s) strip it. */
export async function setServiceItemSlideActions(itemId: string, slideIdx: number, actions: unknown): Promise<Result> {
  const user = await requireCap("operate_services");
  const { setServiceItemSlideActionsCore } = await import("./server/automations");
  return setServiceItemSlideActionsCore(getDb(), user.churchId, itemId, slideIdx, actions);
}

// ── Phase 4: Automations (macros) — church-scoped CRUD ───────────────────────
// Thin session wrappers; the church-scoped DB logic (cap-safe create, typed
// input normalization, .returning()-based not-found) is in server/automations.

export type MacroInput = { name?: string; actions?: unknown; enabled?: boolean };

/** Listing needs `operate_services` — the same capability that creates/edits/
 *  deletes Automations and that fires slides live. The operator page itself is
 *  only requireUser-gated, so a view-only role (pastor/viewer) can open it; for
 *  them this returns a clean `{ok:false}` (NO redirect — a redirect from a
 *  background console fetch would yank them off the page). The console treats a
 *  failed load as "no automations" (macros are optional). */
export async function listMacros(): Promise<Result<Array<{ id: string; name: string; actions: unknown[]; enabled: boolean; sortOrder: number }>>> {
  const user = await requireUser();
  if (!hasCap(user.role, "operate_services")) return { ok: false, error: "Not permitted" };
  const { listMacrosCore } = await import("./server/automations");
  return { ok: true, data: await listMacrosCore(getDb(), user.churchId) };
}

export async function createMacro(input: MacroInput): Promise<Result<{ id: string }>> {
  const user = await requireCap("operate_services");
  const { createMacroCore } = await import("./server/automations");
  return createMacroCore(getDb(), user.churchId, input);
}

export async function updateMacro(id: string, input: MacroInput): Promise<Result> {
  const user = await requireCap("operate_services");
  const { updateMacroCore } = await import("./server/automations");
  return updateMacroCore(getDb(), user.churchId, id, input);
}

export async function deleteMacro(id: string): Promise<Result> {
  const user = await requireCap("operate_services");
  const { deleteMacroCore } = await import("./server/automations");
  return deleteMacroCore(getDb(), user.churchId, id);
}

// ── Scenes (church-scoped) ──────────────────────────────────────────────────
// ProPresenter parity (spec §2/§22.2 "Looks"). A scene stores ROUTING ONLY —
// which layers each output screen shows, plus an optional per-screen theme id.
// The 5 built-ins live in code (src/lib/scenes.ts), so these actions only ever
// touch a church's OWN custom scenes. Same shape as the timer/template CRUD:
// church-scoped predicate IS the authorization, row cap + whitelist on write.
export type SceneInput = { name?: string; config?: Record<string, unknown> };

const MAX_SCENES = 50;

/** A safe uuid shape — a non-uuid id would otherwise throw a Postgres 22P02 out
 *  of the server action instead of returning a clean "not found". */
const SCENE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sanitizeSceneInput(input: SceneInput): Promise<{ name: string; config: Record<string, unknown> }> {
  // sanitizeSceneConfig whitelist-REBUILDS the config (unknown screens/layers
  // and out-of-range values are dropped, never stored). `name` is defensively
  // coerced: a non-string from a hand-rolled caller must not throw on .trim().
  const { sanitizeSceneConfig } = await import("./scenes");
  const rawName = typeof input.name === "string" ? input.name : "Scene";
  const name = rawName.trim().slice(0, 120) || "Scene";
  return { name, config: sanitizeSceneConfig(input.config) as unknown as Record<string, unknown> };
}

export async function listScenes(): Promise<Result<Array<{ id: string; name: string; config: Record<string, unknown>; isBuiltIn: boolean; sortOrder: number }>>> {
  const user = await requireUser();
  // Same shape as listMacros: a view-only role gets a clean {ok:false} rather
  // than a redirect (a redirect from a background console fetch would yank the
  // operator off the page).
  if (!hasCap(user.role, "operate_services")) return { ok: false, error: "Not permitted" };
  const db = getDb();
  const rows = await db.select().from(scenes)
    .where(eq(scenes.churchId, user.churchId))
    .orderBy(asc(scenes.sortOrder), asc(scenes.createdAt));
  return { ok: true, data: rows.map((r) => ({ id: r.id, name: r.name, config: (r.config as Record<string, unknown>) ?? {}, isBuiltIn: r.isBuiltIn, sortOrder: r.sortOrder })) };
}

export async function createScene(input: SceneInput): Promise<Result<{ id: string }>> {
  const user = await requireCap("edit_library");
  const db = getDb();
  const clean = await sanitizeSceneInput(input);
  const existing = await db.select({ sortOrder: scenes.sortOrder }).from(scenes).where(eq(scenes.churchId, user.churchId));
  if (existing.length >= MAX_SCENES) return { ok: false, error: `Scene limit reached (${MAX_SCENES}). Delete an existing scene to add another.` };
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.sortOrder)) + 1 : 0;
  const [row] = await db.insert(scenes).values({ churchId: user.churchId, ...clean, sortOrder: nextOrder }).returning({ id: scenes.id });
  return { ok: true, data: { id: row.id } };
}

export async function updateScene(id: string, input: SceneInput): Promise<Result> {
  const user = await requireCap("edit_library");
  if (!SCENE_UUID_RE.test(id)) return { ok: false, error: "Scene not found" };
  const db = getDb();
  const clean = await sanitizeSceneInput(input);
  // PARTIAL update: only write the fields the caller actually sent, so a
  // config-only save can never silently rename the scene to "Scene".
  const patch: { name?: string; config?: Record<string, unknown>; updatedAt: Date } = { updatedAt: new Date() };
  if (typeof input.name === "string") patch.name = clean.name;
  if (input.config !== undefined) patch.config = clean.config;
  const res = await db.update(scenes).set(patch)
    .where(and(eq(scenes.id, id), eq(scenes.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Scene not found" };
  return { ok: true };
}

export async function deleteScene(id: string): Promise<Result> {
  const user = await requireCap("edit_library");
  if (!SCENE_UUID_RE.test(id)) return { ok: false, error: "Scene not found" };
  const db = getDb();
  const res = await db.delete(scenes)
    .where(and(eq(scenes.id, id), eq(scenes.churchId, user.churchId)));
  if ((res as { rowCount?: number }).rowCount === 0) return { ok: false, error: "Scene not found" };
  return { ok: true };
}
