/**
 * Smart Playlists — adversarial end-to-end test against a REAL database.
 *
 * Run: npx tsx --env-file=.env.local test/adversarial/smart-playlists.test.ts
 *
 * A smart playlist owns NO `service_items` rows — its item list is synthesised
 * at read time from rules, exactly like smart-folder membership. The questions
 * this file answers:
 *   1. Does it actually produce the right items, in the right shape?
 *   2. Can it leak another church's songs?  (CLAUDE.md rule 5)
 *   3. Do the manual playlist paths still behave EXACTLY as before?
 */
import assert from "node:assert";
import { getDb } from "../../src/lib/db/client";
import { churches, servicePlans, serviceItems, songs, songSlides } from "../../src/lib/db/schema";
import { getExpandedServicePlan } from "../../src/lib/server/services";
import { eq } from "drizzle-orm";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

async function main() {
  const db = getDb();
  const [chA] = await db.insert(churches).values({ name: "SP Test A" }).returning({ id: churches.id });
  const [chB] = await db.insert(churches).values({ name: "SP Test B" }).returning({ id: churches.id });

  try {
    // Songs in both churches, with matching titles.
    const inserted = await db.insert(songs).values([
      { churchId: chA.id, title: "Carol One", source: "church" },
      { churchId: chA.id, title: "Carol Two", source: "church" },
      { churchId: chA.id, title: "Hymn Alpha", source: "church" },
      { churchId: chB.id, title: "Carol Foreign", source: "church" },
    ]).returning({ id: songs.id, title: songs.title });
    // Slides so the expansion pipeline has something real to expand.
    for (const s of inserted) {
      await db.insert(songSlides).values({ songId: s.id, order: 0, lyrics: `${s.title} line one` });
    }

    const [smartPlan] = await db.insert(servicePlans).values({
      churchId: chA.id, title: "All Carols", kind: "smart",
      rules: { match: "all", rules: [{ field: "title", op: "contains", value: "carol" }] },
    }).returning({ id: servicePlans.id });

    const [manualPlan] = await db.insert(servicePlans).values({
      churchId: chA.id, title: "Hand Built", kind: "manual",
    }).returning({ id: servicePlans.id });
    await db.insert(serviceItems).values({
      servicePlanId: manualPlan.id, order: 0, type: "song",
      title: "Hymn Alpha", payload: { songId: inserted[2].id },
    });

    await check("smart playlist derives its items from the rules", async () => {
      const plan = await getExpandedServicePlan(smartPlan.id, chA.id);
      assert.ok(plan, "plan not found");
      assert.strictEqual(plan!.kind, "smart");
      assert.deepStrictEqual(plan!.items.map((i) => i.title).sort(), ["Carol One", "Carol Two"]);
    });

    await check("derived items are fully EXPANDED (slides present), not stubs", async () => {
      const plan = await getExpandedServicePlan(smartPlan.id, chA.id);
      const first = plan!.items[0];
      assert.strictEqual(first.type, "song");
      assert.ok(first.slides.length > 0, "derived item has no slides — expansion pipeline did not run");
    });

    await check("derived item ids are `smart:` sentinels, never real service_items ids", async () => {
      const plan = await getExpandedServicePlan(smartPlan.id, chA.id);
      assert.ok(plan!.items.every((i) => String(i.id).startsWith("smart:")),
        `non-sentinel id: ${JSON.stringify(plan!.items.map((i) => i.id))}`);
      const rows = await db.select().from(serviceItems).where(eq(serviceItems.servicePlanId, smartPlan.id));
      assert.strictEqual(rows.length, 0, "a smart playlist must own NO service_items rows");
    });

    await check("CROSS-CHURCH: another church's matching song never appears", async () => {
      const plan = await getExpandedServicePlan(smartPlan.id, chA.id);
      assert.ok(!plan!.items.some((i) => i.title === "Carol Foreign"), "LEAK: foreign song in smart playlist");
    });

    await check("CROSS-CHURCH: church B cannot open church A's smart playlist", async () => {
      const plan = await getExpandedServicePlan(smartPlan.id, chB.id);
      assert.strictEqual(plan, null, "LEAK: foreign church opened the plan");
    });

    await check("a smart playlist with unusable rules is EMPTY, not everything", async () => {
      const [bad] = await db.insert(servicePlans).values({
        churchId: chA.id, title: "Broken", kind: "smart",
        rules: { match: "all", rules: [{ field: "password_hash", op: "is", value: "x" }] },
      }).returning({ id: servicePlans.id });
      const plan = await getExpandedServicePlan(bad.id, chA.id);
      assert.strictEqual(plan!.items.length, 0, `empty-rule plan returned ${plan!.items.length} items`);
    });

    await check("rulesSummary is exposed for the rail subtitle", async () => {
      const plan = await getExpandedServicePlan(smartPlan.id, chA.id);
      assert.ok(plan!.rulesSummary && plan!.rulesSummary.length > 0, "no rules summary");
    });

    // --- NO REGRESSION ------------------------------------------------------

    await check("NO REGRESSION: a manual plan still reads its service_items rows", async () => {
      const plan = await getExpandedServicePlan(manualPlan.id, chA.id);
      assert.strictEqual(plan!.kind, "manual");
      assert.deepStrictEqual(plan!.items.map((i) => i.title), ["Hymn Alpha"]);
      assert.ok(!String(plan!.items[0].id).startsWith("smart:"), "manual item got a sentinel id");
    });

    await check("NO REGRESSION: a plan with no `kind` set behaves as manual", async () => {
      const [legacy] = await db.insert(servicePlans).values({
        churchId: chA.id, title: "Legacy",
      }).returning({ id: servicePlans.id });
      const plan = await getExpandedServicePlan(legacy.id, chA.id);
      assert.strictEqual(plan!.kind, "manual");
      assert.deepStrictEqual(plan!.items, []);
    });

  } finally {
    for (const id of [chA.id, chB.id]) {
      const plans = await db.select({ id: servicePlans.id }).from(servicePlans).where(eq(servicePlans.churchId, id));
      for (const p of plans) await db.delete(serviceItems).where(eq(serviceItems.servicePlanId, p.id));
      await db.delete(servicePlans).where(eq(servicePlans.churchId, id));
      const ss = await db.select({ id: songs.id }).from(songs).where(eq(songs.churchId, id));
      for (const s of ss) await db.delete(songSlides).where(eq(songSlides.songId, s.id));
      await db.delete(songs).where(eq(songs.churchId, id));
      await db.delete(churches).where(eq(churches.id, id));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
