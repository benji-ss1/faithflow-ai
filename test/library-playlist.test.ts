/**
 * Library + Playlist parity data-layer tests (ProPresenter Phase 3.6).
 * Run: npx tsx --env-file=.env.local --test test/library-playlist.test.ts
 *
 * Exercises the DB/loader layer directly (no auth session needed):
 *   • libraries + library_id membership (cross-library moves, tolerant NULL)
 *   • listSongs / listMedia library filtering
 *   • header service items: insertion, ordering, loader emits type "header"
 *     with its colour and slides:[] (never projectable)
 *
 * All rows are created under a throwaway church and torn down at the end.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { churches, libraries, songs, mediaAssets, servicePlans, serviceItems } from "../src/lib/db/schema";
import { getExpandedServicePlan, listSongs, listMedia } from "../src/lib/server/services";

const db = getDb();
let churchId = "";
let planId = "";

async function seed() {
  const [ch] = await db.insert(churches).values({ name: `__test_lib_${Date.now()}` }).returning();
  churchId = ch.id;
  const [plan] = await db.insert(servicePlans).values({ churchId, title: "Test Plan" }).returning();
  planId = plan.id;
}

after(async () => {
  // FK cascade from churches isn't defined for all tables, so delete children first.
  if (planId) await db.delete(serviceItems).where(eq(serviceItems.servicePlanId, planId));
  if (churchId) {
    await db.delete(servicePlans).where(eq(servicePlans.churchId, churchId));
    await db.delete(songs).where(eq(songs.churchId, churchId));
    await db.delete(mediaAssets).where(eq(mediaAssets.churchId, churchId));
    await db.delete(libraries).where(eq(libraries.churchId, churchId));
    await db.delete(churches).where(eq(churches.id, churchId));
  }
});

test("setup", async () => { await seed(); assert.ok(churchId && planId); });

test("libraries + cross-library moves + filtered lists", async () => {
  const [songsLib] = await db.insert(libraries).values({ churchId, name: "Songs", order: 0 }).returning();
  const [countdownLib] = await db.insert(libraries).values({ churchId, name: "Countdowns", order: 1 }).returning();

  // Two songs: one filed into Songs, one left unfiled (Default bucket).
  const [filed] = await db.insert(songs).values({ churchId, title: "Filed Song", libraryId: songsLib.id }).returning();
  const [unfiled] = await db.insert(songs).values({ churchId, title: "Unfiled Song" }).returning();

  // Filter: undefined = all, null = Default bucket, id = that library.
  assert.equal((await listSongs(churchId)).length, 2, "all → both songs");
  assert.equal((await listSongs(churchId, songsLib.id)).length, 1, "Songs → 1");
  assert.equal((await listSongs(churchId, null)).length, 1, "Default (NULL) → 1");

  // Cross-library move: unfiled → Countdowns.
  await db.update(songs).set({ libraryId: countdownLib.id }).where(eq(songs.id, unfiled.id));
  assert.equal((await listSongs(churchId, countdownLib.id)).length, 1, "moved into Countdowns");
  assert.equal((await listSongs(churchId, null)).length, 0, "Default now empty");

  // ON DELETE SET NULL: deleting a library returns its content to Default,
  // never orphaning it.
  await db.delete(libraries).where(eq(libraries.id, songsLib.id));
  const [reread] = await db.select().from(songs).where(eq(songs.id, filed.id));
  assert.equal(reread.libraryId, null, "deleted library → content falls back to Default");

  // Media membership filters the same way.
  await db.insert(mediaAssets).values({ churchId, kind: "image", fileName: "a.jpg", s3Key: "k1", mimeType: "image/jpeg", sizeBytes: 1, libraryId: countdownLib.id });
  await db.insert(mediaAssets).values({ churchId, kind: "image", fileName: "b.jpg", s3Key: "k2", mimeType: "image/jpeg", sizeBytes: 1 });
  assert.equal((await listMedia(churchId)).length, 2, "all media");
  assert.equal((await listMedia(churchId, countdownLib.id)).length, 1, "media in Countdowns");
  assert.equal((await listMedia(churchId, null)).length, 1, "unfiled media");
});

test("header insertion + ordering + non-projectable loader output", async () => {
  // Order: [header(worship), blank]. Headers are ordinary service_items so they
  // reorder + persist exactly like content.
  await db.insert(serviceItems).values({ servicePlanId: planId, order: 0, type: "header", title: "Worship", payload: { color: "#16a34a" } });
  await db.insert(serviceItems).values({ servicePlanId: planId, order: 1, type: "blank", title: "Blank", payload: {} });

  const plan = await getExpandedServicePlan(planId, churchId);
  assert.ok(plan, "plan loads");
  assert.equal(plan!.items.length, 2);

  const header = plan!.items[0];
  assert.equal(header.order, 0, "header preserves order");
  assert.equal(header.type, "header");
  assert.equal(header.title, "Worship");
  assert.equal((header as { color?: string }).color, "#16a34a", "colour surfaced from payload");
  assert.equal(header.slides.length, 0, "header is NON-content — never a projectable slide");

  // The blank item still synthesises exactly one blank slide (no regression).
  assert.equal(plan!.items[1].type, "blank");
  assert.equal(plan!.items[1].slides.length, 1, "blank item unchanged");
});

test("library colour label round-trips (Wave 3 item 3b)", async () => {
  // Additive `color` column: a #rrggbb label persists and a NULL clears it.
  const [lib] = await db.insert(libraries).values({ churchId, name: "Live Elements", order: 5, color: "#dc2626" }).returning();
  const [read1] = await db.select().from(libraries).where(eq(libraries.id, lib.id));
  assert.equal(read1.color, "#dc2626", "colour persisted");
  await db.update(libraries).set({ color: null }).where(eq(libraries.id, lib.id));
  const [read2] = await db.select().from(libraries).where(eq(libraries.id, lib.id));
  assert.equal(read2.color, null, "colour cleared to NULL");
});

test("registerMediaAsset library filing round-trips via library_id", async () => {
  // The upload path files a new asset into a library (item 4c). Exercise the
  // DB layer directly (the action wraps this with auth + ownership checks).
  const [lib] = await db.insert(libraries).values({ churchId, name: "Backgrounds", order: 6 }).returning();
  const [asset] = await db.insert(mediaAssets).values({ churchId, kind: "image", fileName: "bg.jpg", s3Key: "kbg", mimeType: "image/jpeg", sizeBytes: 1, libraryId: lib.id }).returning();
  assert.equal(asset.libraryId, lib.id, "asset filed into the target library");
  assert.equal((await listMedia(churchId, lib.id)).length, 1, "filtered list shows the filed asset");
});
