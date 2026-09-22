/**
 * Smart Folders — adversarial end-to-end test against a REAL database.
 *
 * Run: npx tsx --env-file=.env.local test/adversarial/smart-folders-cross-church.test.ts
 *
 * CLAUDE.md rule 5: every new DB path that filters tenant content needs an
 * adversarial cross-church test. Smart folders add a brand-new predicate to
 * listSongs/listMedia, so the question this file answers is blunt:
 *
 *   Can church A's smart folder EVER return church B's content?
 *
 * It also exercises the real rule semantics end to end (not mocked), because
 * the unit tests only prove the SQL compiles — not that Postgres agrees with
 * what we think the SQL means.
 *
 * Everything is created under two throwaway churches and removed in `finally`.
 */
import assert from "node:assert";
import { getDb } from "../../src/lib/db/client";
import { churches, libraries, songs } from "../../src/lib/db/schema";
import { listSongs } from "../../src/lib/server/services";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

async function main() {
  const db = getDb();
  const [chA] = await db.insert(churches).values({ name: "SF Test A" }).returning({ id: churches.id });
  const [chB] = await db.insert(churches).values({ name: "SF Test B" }).returning({ id: churches.id });

  try {
    // Church A: a smart folder matching titles containing "christmas".
    const [folderA] = await db.insert(libraries).values({
      churchId: chA.id, name: "Christmas", kind: "smart",
      rules: { match: "all", rules: [{ field: "title", op: "contains", value: "christmas" }] },
    }).returning({ id: libraries.id });

    // A manual library in the same church, for the no-regression check.
    const [manualA] = await db.insert(libraries).values({
      churchId: chA.id, name: "Manual", kind: "manual",
    }).returning({ id: libraries.id });

    await db.insert(songs).values([
      { churchId: chA.id, title: "Christmas Morning", source: "church" },
      { churchId: chA.id, title: "O Holy Night (christmas)", source: "church" },
      { churchId: chA.id, title: "Amazing Grace", source: "church", libraryId: manualA.id },
      // Church B has a matching title — it must NEVER surface in A's folder.
      { churchId: chB.id, title: "Christmas In Lagos", source: "church" },
    ]);

    await check("smart folder returns only MATCHING songs of its OWN church", async () => {
      const rows = await listSongs(chA.id, folderA.id);
      const titles = rows.map((r) => r.title).sort();
      assert.deepStrictEqual(titles, ["Christmas Morning", "O Holy Night (christmas)"]);
    });

    await check("CROSS-CHURCH: church B's matching song never leaks into A's folder", async () => {
      const rows = await listSongs(chA.id, folderA.id);
      assert.ok(!rows.some((r) => r.title === "Christmas In Lagos"), "LEAK: church B content returned");
      assert.ok(rows.every((r) => r.churchId === chA.id), "LEAK: foreign church_id in results");
    });

    await check("CROSS-CHURCH: church B querying A's folder id gets NOTHING", async () => {
      // B passes A's smart-folder UUID. The folder lookup is church-scoped, so
      // it resolves to "not my folder" and must not evaluate A's rules.
      const rows = await listSongs(chB.id, folderA.id);
      assert.strictEqual(rows.length, 0, `LEAK: ${rows.length} rows returned across churches`);
    });

    await check("a smart folder with NO usable rules matches NOTHING (not everything)", async () => {
      const [emptyFolder] = await db.insert(libraries).values({
        churchId: chA.id, name: "Empty", kind: "smart", rules: { match: "all", rules: [] },
      }).returning({ id: libraries.id });
      const rows = await listSongs(chA.id, emptyFolder.id);
      assert.strictEqual(rows.length, 0, `empty smart folder returned ${rows.length} songs`);
    });

    await check("a folder whose stored rules are CORRUPT matches nothing, and does not throw", async () => {
      const [bad] = await db.insert(libraries).values({
        churchId: chA.id, name: "Corrupt", kind: "smart",
        rules: { match: "all", rules: [{ field: "password_hash", op: "contains", value: "x" }] },
      }).returning({ id: libraries.id });
      const rows = await listSongs(chA.id, bad.id);
      assert.strictEqual(rows.length, 0);
    });

    await check("'any' mode really ORs the rules", async () => {
      const [anyFolder] = await db.insert(libraries).values({
        churchId: chA.id, name: "Any", kind: "smart",
        rules: { match: "any", rules: [
          { field: "title", op: "contains", value: "christmas" },
          { field: "title", op: "contains", value: "amazing" },
        ] },
      }).returning({ id: libraries.id });
      const rows = await listSongs(chA.id, anyFolder.id);
      assert.strictEqual(rows.length, 3, `expected 3 (2 christmas + 1 amazing), got ${rows.length}`);
    });

    await check("a LIKE wildcard in a rule value matches literally, not as a wildcard", async () => {
      const [pctFolder] = await db.insert(libraries).values({
        churchId: chA.id, name: "Pct", kind: "smart",
        rules: { match: "all", rules: [{ field: "title", op: "contains", value: "%" }] },
      }).returning({ id: libraries.id });
      const rows = await listSongs(chA.id, pctFolder.id);
      assert.strictEqual(rows.length, 0, "a bare % matched rows — wildcard was not escaped");
    });

    // --- NO REGRESSION: the manual paths must be untouched ------------------

    await check("NO REGRESSION: a MANUAL library still filters by library_id", async () => {
      const rows = await listSongs(chA.id, manualA.id);
      assert.deepStrictEqual(rows.map((r) => r.title), ["Amazing Grace"]);
    });

    await check("NO REGRESSION: the Default bucket (null) still returns unfiled songs", async () => {
      const rows = await listSongs(chA.id, null);
      assert.ok(rows.length >= 2 && rows.every((r) => r.libraryId === null), "Default bucket changed");
    });

    await check("NO REGRESSION: undefined filter still returns the whole church library", async () => {
      const rows = await listSongs(chA.id);
      assert.strictEqual(rows.length, 3, `expected all 3 church-A songs, got ${rows.length}`);
      assert.ok(rows.every((r) => r.churchId === chA.id));
    });

  } finally {
    // Clean up both tenants regardless of outcome.
    for (const id of [chA.id, chB.id]) {
      await db.delete(songs).where(eq(songs.churchId, id));
      await db.delete(libraries).where(eq(libraries.churchId, id));
      await db.delete(churches).where(eq(churches.id, id));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
