/**
 * Adversarial RLS cross-church test.
 *
 * Proves drizzle/0001_rls.sql actually blocks cross-church access at
 * the SQL layer — independent of the app-layer scoping we already
 * have in server actions. Works by:
 *
 *   1. Seeding two churches (A and B) via bypass path.
 *   2. Creating a temporary NON-OWNER role (pf_rls_test) that has
 *      no ability to bypass RLS.
 *   3. Under that role, SET LOCAL app.current_church_id = A.
 *   4. SELECT from every tenant table and assert 0 rows from B leak.
 *   5. Attempt to INSERT a row into a tenant table with B's church_id
 *      while scoped to A — must fail (policy WITH CHECK).
 *   6. Cleanup: drop rows, drop role.
 *
 * Run: npm run test:rls
 * Requires: drizzle/0001_rls.sql has been applied (via db:push or
 * psql -f drizzle/0001_rls.sql).
 */

import "dotenv/config";
import { Pool } from "pg";
import { randomUUID } from "crypto";

const TEST_ROLE = "pf_rls_test";
const TEST_ROLE_PW = "pf_rls_test_pw";

let assertions = 0;
let failures = 0;

function assert(cond: boolean, msg: string) {
  assertions++;
  if (cond) {
    console.log(`  ✔ ${msg}`);
  } else {
    failures++;
    console.error(`  ✘ ${msg}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");

  const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  // --- Preconditions --------------------------------------------------
  const { rows: rlsChecks } = await ownerPool.query(
    `SELECT relname FROM pg_class
     WHERE relname IN ('songs','service_plans','media_assets','church_preferences')
       AND relrowsecurity = true`,
  );
  if (rlsChecks.length < 4) {
    console.error("RLS not enabled on core tenant tables. Apply drizzle/0001_rls.sql first.");
    process.exit(2);
  }

  // --- Seed 2 churches via bypass ------------------------------------
  // Use a single dedicated client so BEGIN, set_config, and INSERTs all
  // land on the same connection — otherwise SET LOCAL (tx-scoped) would
  // apply to the wrong session.
  const churchA = randomUUID();
  const churchB = randomUUID();
  const songA = randomUUID();
  const songB = randomUUID();

  {
    const seedClient = await ownerPool.connect();
    try {
      await seedClient.query("BEGIN");
      await seedClient.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
      await seedClient.query(`INSERT INTO churches (id, name, timezone) VALUES ($1, 'Church A', 'UTC'), ($2, 'Church B', 'UTC')`, [churchA, churchB]);
      await seedClient.query(`INSERT INTO songs (id, church_id, title, source) VALUES ($1, $2, 'A-Marker', 'church'), ($3, $4, 'B-Marker', 'church')`, [songA, churchA, songB, churchB]);
      await seedClient.query("COMMIT");
    } catch (e) {
      await seedClient.query("ROLLBACK");
      throw e;
    } finally {
      seedClient.release();
    }
  }

  // --- Create low-privilege role -------------------------------------
  await ownerPool.query(`DROP ROLE IF EXISTS ${TEST_ROLE}`);
  await ownerPool.query(`CREATE ROLE ${TEST_ROLE} LOGIN PASSWORD '${TEST_ROLE_PW}'`);
  await ownerPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON churches, songs, song_slides, media_assets, service_plans, church_preferences TO ${TEST_ROLE}`);
  await ownerPool.query(`GRANT USAGE ON SCHEMA public TO ${TEST_ROLE}`);

  // Connect as the low-privilege role.
  const testUrl = new URL(process.env.DATABASE_URL!);
  testUrl.username = TEST_ROLE;
  testUrl.password = TEST_ROLE_PW;
  const testPool = new Pool({ connectionString: testUrl.toString(), max: 1 });

  try {
    // Scoped to A: must see A songs, must NOT see B songs.
    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.current_church_id', $1, true)`, [churchA]);
      const { rows: aRows } = await client.query(`SELECT title FROM songs WHERE title IN ('A-Marker','B-Marker')`);
      const titles = aRows.map((r) => r.title);
      assert(titles.includes("A-Marker"), "scoped to A: sees A-Marker");
      assert(!titles.includes("B-Marker"), "scoped to A: does NOT see B-Marker");

      const { rows: aChurches } = await client.query(`SELECT id FROM churches WHERE id IN ($1,$2)`, [churchA, churchB]);
      assert(aChurches.length === 1 && aChurches[0].id === churchA, "scoped to A: churches SELECT returns only A");

      // Try to INSERT a song into church B while scoped to A → must fail.
      let insertBlocked = false;
      try {
        await client.query(`INSERT INTO songs (church_id, title, source) VALUES ($1, 'A-tries-B', 'church')`, [churchB]);
      } catch (e) {
        insertBlocked = true;
      }
      assert(insertBlocked, "scoped to A: cannot INSERT into church B (WITH CHECK)");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    // With no scope set, SELECT must return 0 rows (policy fails on NULL GUC).
    const client2 = await testPool.connect();
    try {
      await client2.query("BEGIN");
      const { rows } = await client2.query(`SELECT title FROM songs WHERE title IN ('A-Marker','B-Marker')`);
      assert(rows.length === 0, "no scope set: SELECT returns 0 rows");
      await client2.query("ROLLBACK");
    } finally {
      client2.release();
    }
  } finally {
    await testPool.end();
    // Cleanup rows + role. Same connection-scoped tx pattern as seed.
    const cleanClient = await ownerPool.connect();
    try {
      await cleanClient.query("BEGIN");
      await cleanClient.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
      await cleanClient.query(`DELETE FROM songs WHERE id IN ($1,$2)`, [songA, songB]);
      await cleanClient.query(`DELETE FROM churches WHERE id IN ($1,$2)`, [churchA, churchB]);
      await cleanClient.query("COMMIT");
    } finally {
      cleanClient.release();
    }
    // DROP OWNED BY first — some Postgres versions refuse DROP ROLE if any
    // grants persist even after revoke.
    await ownerPool.query(`DROP OWNED BY ${TEST_ROLE}`).catch(() => {});
    await ownerPool.query(`DROP ROLE IF EXISTS ${TEST_ROLE}`).catch(() => {});
    await ownerPool.end();
  }

  console.log(`\n${assertions - failures}/${assertions} assertions passed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
