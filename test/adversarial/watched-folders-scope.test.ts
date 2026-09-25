/**
 * Watched media folders — adversarial test against a REAL database.
 *
 * Run: npx tsx --env-file=.env.local test/adversarial/watched-folders-scope.test.ts
 *
 * CLAUDE.md rule 5: a new DB path that touches tenant content needs an
 * adversarial cross-church test. The questions here are blunt:
 *   1. Can church A's watched folder ever hold or un-file church B's media?
 *   2. Does un-filing DESTROY anything? (It must not — see Decision 3.)
 *   3. Do manual and smart libraries still behave exactly as before?
 */
import assert from "node:assert";
import { getDb } from "../../src/lib/db/client";
import { churches, libraries, mediaAssets } from "../../src/lib/db/schema";
import { listMedia } from "../../src/lib/server/services";
import { and, eq } from "drizzle-orm";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

async function main() {
  const db = getDb();
  const [chA] = await db.insert(churches).values({ name: "WF Test A" }).returning({ id: churches.id });
  const [chB] = await db.insert(churches).values({ name: "WF Test B" }).returning({ id: churches.id });

  try {
    const [watchedA] = await db.insert(libraries).values({
      churchId: chA.id, name: "Backgrounds", kind: "watched", watchPath: "/Volumes/Media/Backgrounds",
    }).returning({ id: libraries.id });
    const [manualA] = await db.insert(libraries).values({
      churchId: chA.id, name: "Manual", kind: "manual",
    }).returning({ id: libraries.id });

    const mk = (churchId: string, fileName: string, libraryId: string | null, sourceRelPath: string | null) => ({
      churchId, kind: "image" as const, fileName, s3Key: `${churchId}/media/${fileName}`,
      mimeType: "image/jpeg", sizeBytes: 100, libraryId, sourceRelPath,
    });
    const inserted = await db.insert(mediaAssets).values([
      mk(chA.id, "a.jpg", watchedA.id, "a.jpg"),
      mk(chA.id, "sub-a.jpg", watchedA.id, "sub/a.jpg"),
      mk(chA.id, "manual.jpg", manualA.id, null),
      mk(chB.id, "foreign.jpg", null, "a.jpg"),   // same rel path, other church
    ]).returning({ id: mediaAssets.id, fileName: mediaAssets.fileName });

    await check("a watched library lists its OWN media like a normal library", async () => {
      const rows = await listMedia(chA.id, watchedA.id, { includeAudio: true });
      assert.deepStrictEqual(rows.map((r) => r.fileName).sort(), ["a.jpg", "sub-a.jpg"]);
    });

    await check("CROSS-CHURCH: church B's media never appears in A's watched folder", async () => {
      const rows = await listMedia(chA.id, watchedA.id, { includeAudio: true });
      assert.ok(!rows.some((r) => r.fileName === "foreign.jpg"), "LEAK: foreign media in watched folder");
      assert.ok(rows.every((r) => r.churchId === chA.id), "LEAK: foreign church_id returned");
    });

    await check("CROSS-CHURCH: church B querying A's watched library id gets nothing", async () => {
      const rows = await listMedia(chB.id, watchedA.id, { includeAudio: true });
      assert.strictEqual(rows.length, 0, `LEAK: ${rows.length} rows across churches`);
    });

    await check("un-filing removes from the folder but DESTROYS NOTHING", async () => {
      const target = inserted.find((r) => r.fileName === "a.jpg")!;
      // Exactly what unfileMissingWatchedAssets does, church+library scoped.
      await db.update(mediaAssets).set({ libraryId: null, sourceRelPath: null })
        .where(and(eq(mediaAssets.churchId, chA.id), eq(mediaAssets.libraryId, watchedA.id), eq(mediaAssets.id, target.id)));

      const still = await db.select({ id: mediaAssets.id, libraryId: mediaAssets.libraryId })
        .from(mediaAssets).where(eq(mediaAssets.id, target.id));
      assert.strictEqual(still.length, 1, "un-filing DELETED the asset — it must not");
      assert.strictEqual(still[0].libraryId, null, "asset should be un-filed to Default");

      const inFolder = await listMedia(chA.id, watchedA.id, { includeAudio: true });
      assert.deepStrictEqual(inFolder.map((r) => r.fileName), ["sub-a.jpg"], "un-filed asset still in folder");

      const inDefault = await listMedia(chA.id, null, { includeAudio: true });
      assert.ok(inDefault.some((r) => r.id === target.id), "un-filed asset did not land in Default");
    });

    await check("NO REGRESSION: a manual library is unaffected", async () => {
      const rows = await listMedia(chA.id, manualA.id, { includeAudio: true });
      assert.deepStrictEqual(rows.map((r) => r.fileName), ["manual.jpg"]);
    });

    await check("NO REGRESSION: the whole-church view still returns everything", async () => {
      const rows = await listMedia(chA.id, undefined, { includeAudio: true });
      assert.strictEqual(rows.length, 3, `expected 3 church-A assets, got ${rows.length}`);
      assert.ok(rows.every((r) => r.churchId === chA.id));
    });

    await check("the DB refuses an unknown library kind", async () => {
      await assert.rejects(
        () => db.insert(libraries).values({ churchId: chA.id, name: "Bad", kind: "sneaky" }).returning(),
        /libraries_kind_check|violates check constraint/i,
      );
    });

  } finally {
    for (const id of [chA.id, chB.id]) {
      await db.delete(mediaAssets).where(eq(mediaAssets.churchId, id));
      await db.delete(libraries).where(eq(libraries.churchId, id));
      await db.delete(churches).where(eq(churches.id, id));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
