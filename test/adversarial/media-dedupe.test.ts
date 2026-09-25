// Adversarial: duplicate-media merge (2026-09-23).
// RUN: npx tsx --env-file=.env.local test/adversarial/media-dedupe.test.ts
// Seeds two throwaway churches, runs mergeDuplicateMediaRows, asserts:
//  - only true duplicates of the kept row are deleted
//  - playlist items (single + group) re-point to the kept copy, none are lost
//  - Church B's rows/items are untouchable via Church A's call
// Cleans up even on failure.
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { churches, servicePlans, serviceItems, mediaAssets, songs, songSlides, themes } from "../../src/lib/db/schema";
import { mergeDuplicateMediaRows, countMediaUsage } from "../../src/lib/server/media-dedupe";

const db = getDb();
let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, e); }
}
const churchIds: string[] = [];
async function seed(name: string) {
  const [ch] = await db.insert(churches).values({ name, timezone: "UTC" }).returning();
  churchIds.push(ch.id);
  const [plan] = await db.insert(servicePlans).values({ churchId: ch.id, title: `${name} svc` }).returning();
  const mk = (fileName: string, sizeBytes: number, kind: "image" | "video" = "image") =>
    db.insert(mediaAssets).values({ churchId: ch.id, kind, fileName, s3Key: `${ch.id}/media/${Math.random()}`, mimeType: "image/png", sizeBytes }).returning().then((r) => r[0]);
  const keep = await mk("Logo.png", 500);
  const dup1 = await mk("logo.PNG ", 500);
  const dup2 = await mk("Logo.png", 500);
  const notDup = await mk("Logo.png", 501);
  return { ch, plan, keep, dup1, dup2, notDup };
}

(async () => {
  try {
    const A = await seed(`dedupeA-${Date.now()}`);
    const B = await seed(`dedupeB-${Date.now()}`);
    const [song] = await db.insert(songs).values({ churchId: A.ch.id, title: "Dup bg song", source: "church", defaultBackgroundAssetId: A.dup2.id }).returning();
    await db.insert(serviceItems).values([
      { servicePlanId: A.plan.id, order: 0, type: "media", title: "single dup", payload: { mediaAssetId: A.dup1.id } },
      { servicePlanId: A.plan.id, order: 1, type: "media", title: "group", payload: { mediaAssetIds: [A.notDup.id, A.dup2.id, A.keep.id] } },
      { servicePlanId: B.plan.id, order: 0, type: "media", title: "B single", payload: { mediaAssetId: B.dup1.id } },
    ]);

    await check("cross-church: A cannot merge B's rows", async () => {
      const r = await mergeDuplicateMediaRows(db, A.ch.id, B.keep.id, [B.dup1.id]);
      assert.equal(r.ok, false);
      const still = await db.select().from(mediaAssets).where(eq(mediaAssets.churchId, B.ch.id));
      assert.equal(still.length, 4);
    });
    await check("cross-church: A keep + B victim ids → B victim untouched", async () => {
      const r = await mergeDuplicateMediaRows(db, A.ch.id, A.keep.id, [B.dup1.id]);
      assert.equal(r.ok, false);
      assert.equal((await db.select().from(mediaAssets).where(eq(mediaAssets.id, B.dup1.id))).length, 1);
    });
    await check("non-duplicate (different size) is refused", async () => {
      const r = await mergeDuplicateMediaRows(db, A.ch.id, A.keep.id, [A.notDup.id]);
      assert.equal(r.ok, false);
    });
    await check("merge deletes only true duplicates, keeps the chosen copy", async () => {
      const r = await mergeDuplicateMediaRows(db, A.ch.id, A.keep.id, [A.dup1.id, A.dup2.id, A.notDup.id]);
      assert.ok(r.ok);
      if (r.ok) assert.deepEqual(r.removed.map((x) => x.id).sort(), [A.dup1.id, A.dup2.id].sort());
      const left = (await db.select().from(mediaAssets).where(eq(mediaAssets.churchId, A.ch.id))).map((x) => x.id).sort();
      assert.deepEqual(left, [A.keep.id, A.notDup.id].sort());
    });
    await check("playlist items re-pointed, none lost, order kept", async () => {
      const items = await db.select().from(serviceItems).where(eq(serviceItems.servicePlanId, A.plan.id));
      assert.equal(items.length, 2);
      const single = items.find((i) => i.title === "single dup")!;
      assert.equal((single.payload as { mediaAssetId: string }).mediaAssetId, A.keep.id);
      const group = items.find((i) => i.title === "group")!;
      assert.deepEqual((group.payload as { mediaAssetIds: string[] }).mediaAssetIds, [A.notDup.id, A.keep.id, A.keep.id]);
    });
    await check("shared storage object is NOT returned for deletion", async () => {
      const [k] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "video", fileName: "clip.mp4", s3Key: `${A.ch.id}/media/shared.mp4`, mimeType: "video/mp4", sizeBytes: 77 }).returning();
      const [v] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "video", fileName: "clip.mp4", s3Key: `${A.ch.id}/media/shared.mp4`, mimeType: "video/mp4", sizeBytes: 77 }).returning();
      const r = await mergeDuplicateMediaRows(db, A.ch.id, k.id, [v.id]);
      assert.ok(r.ok);
      if (r.ok) assert.equal(r.removed[0].s3Key, null);
    });
    await check("song default background re-pointed to kept copy", async () => {
      const [x] = await db.select().from(songs).where(eq(songs.id, song.id));
      assert.equal(x.defaultBackgroundAssetId, A.keep.id);
    });
    await check("non-shared own-church key IS returned for storage delete", async () => {
      const [k] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "image", fileName: "own.png", s3Key: `${A.ch.id}/media/own1.png`, mimeType: "image/png", sizeBytes: 9 }).returning();
      const [v] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "image", fileName: "own.png", s3Key: `${A.ch.id}/media/own2.png`, mimeType: "image/png", sizeBytes: 9 }).returning();
      const r = await mergeDuplicateMediaRows(db, A.ch.id, k.id, [v.id]);
      assert.ok(r.ok); if (r.ok) assert.equal(r.removed[0].s3Key, `${A.ch.id}/media/own2.png`);
    });
    await check("foreign-prefix key is NEVER returned for storage delete", async () => {
      const [k] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "image", fileName: "evil.png", s3Key: `${A.ch.id}/media/e1.png`, mimeType: "image/png", sizeBytes: 5 }).returning();
      const [v] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "image", fileName: "evil.png", s3Key: `${B.ch.id}/media/victim.png`, mimeType: "image/png", sizeBytes: 5 }).returning();
      const r = await mergeDuplicateMediaRows(db, A.ch.id, k.id, [v.id]);
      assert.ok(r.ok); if (r.ok) assert.equal(r.removed[0].s3Key, null);
    });
    await check("concurrent opposite cleans never delete both copies", async () => {
      const [x] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "image", fileName: "race.png", s3Key: `${A.ch.id}/media/rx.png`, mimeType: "image/png", sizeBytes: 3 }).returning();
      const [y] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "image", fileName: "race.png", s3Key: `${A.ch.id}/media/ry.png`, mimeType: "image/png", sizeBytes: 3 }).returning();
      await Promise.allSettled([mergeDuplicateMediaRows(db, A.ch.id, x.id, [y.id]), mergeDuplicateMediaRows(db, A.ch.id, y.id, [x.id])]);
      const left = await db.select().from(mediaAssets).where(inArray(mediaAssets.id, [x.id, y.id]));
      assert.equal(left.length, 1);
    });
    await check("zero-size rows are never merged", async () => {
      const [k] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "image", fileName: "z.png", s3Key: `${A.ch.id}/media/z1.png`, mimeType: "image/png", sizeBytes: 0 }).returning();
      const [v] = await db.insert(mediaAssets).values({ churchId: A.ch.id, kind: "image", fileName: "z.png", s3Key: `${A.ch.id}/media/z2.png`, mimeType: "image/png", sizeBytes: 0 }).returning();
      const r = await mergeDuplicateMediaRows(db, A.ch.id, k.id, [v.id]);
      assert.equal(r.ok, false);
    });
    await check("direct URL links (slide, theme, playlist bg) re-point to kept copy; B untouched", async () => {
      const mk = (c: string, key: string) => db.insert(mediaAssets).values({ churchId: c, kind: "image", fileName: "link.png", s3Key: key, mimeType: "image/png", sizeBytes: 11 }).returning().then((r) => r[0]);
      const kk = `${A.ch.id}/media/keep-link.png`, vk = `${A.ch.id}/media/victim-link.png`;
      const k = await mk(A.ch.id, kk); const v = await mk(A.ch.id, vk);
      const url = `https://bucket.s3.amazonaws.com/${vk}?X-Amz-Signature=abc`;
      const [sg] = await db.insert(songs).values({ churchId: A.ch.id, title: "link song", source: "church" }).returning();
      const [sl] = await db.insert(songSlides).values({ songId: sg.id, order: 0, lyrics: "x", objectsJson: [{ type: "image", url }] }).returning();
      const [th] = await db.insert(themes).values({ churchId: A.ch.id, name: "link theme", config: { bgImageUrl: url } }).returning();
      const [bth] = await db.insert(themes).values({ churchId: B.ch.id, name: "B theme", config: { bgImageUrl: url } }).returning();
      const [it] = await db.insert(serviceItems).values({ servicePlanId: A.plan.id, order: 9, type: "song", title: "bg", payload: { slideBackgrounds: { 0: url } } }).returning();
      const before = await countMediaUsage(db, A.ch.id, v.id);
      assert.ok(before && before.slides === 1 && before.themes === 1 && before.playlistItems === 1);
      const r = await mergeDuplicateMediaRows(db, A.ch.id, k.id, [v.id]);
      assert.ok(r.ok);
      const [sl2] = await db.select().from(songSlides).where(eq(songSlides.id, sl.id));
      const [th2] = await db.select().from(themes).where(eq(themes.id, th.id));
      const [bth2] = await db.select().from(themes).where(eq(themes.id, bth.id));
      const [it2] = await db.select().from(serviceItems).where(eq(serviceItems.id, it.id));
      assert.ok(JSON.stringify(sl2.objectsJson).includes(kk) && !JSON.stringify(sl2.objectsJson).includes(vk));
      assert.ok(JSON.stringify(th2.config).includes(kk));
      assert.ok(JSON.stringify(it2.payload).includes(kk));
      assert.ok(JSON.stringify(bth2.config).includes(vk), "Church B theme must be untouched");
      const after = await countMediaUsage(db, A.ch.id, k.id);
      assert.ok(after && after.slides === 1 && after.themes === 1);
    });
    await check("usage of another church's asset is not visible", async () => {
      assert.equal(await countMediaUsage(db, A.ch.id, B.keep.id), null);
    });
    await check("Church B's playlist item untouched", async () => {
      const [b] = await db.select().from(serviceItems).where(eq(serviceItems.servicePlanId, B.plan.id));
      assert.equal((b.payload as { mediaAssetId: string }).mediaAssetId, B.dup1.id);
    });
  } finally {
    for (const id of churchIds) {
      const plans = await db.select().from(servicePlans).where(eq(servicePlans.churchId, id));
      if (plans.length) await db.delete(serviceItems).where(inArray(serviceItems.servicePlanId, plans.map((p) => p.id)));
      await db.delete(servicePlans).where(eq(servicePlans.churchId, id));
      const ss = await db.select().from(songs).where(eq(songs.churchId, id));
      if (ss.length) await db.delete(songSlides).where(inArray(songSlides.songId, ss.map((x) => x.id)));
      await db.delete(songs).where(eq(songs.churchId, id));
      await db.delete(themes).where(eq(themes.churchId, id));
      await db.delete(mediaAssets).where(eq(mediaAssets.churchId, id));
      await db.delete(churches).where(eq(churches.id, id)).catch((e) => console.log("cleanup church", e.message));
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
