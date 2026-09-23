// Adversarial RLS POLICY test (2026-09-23).
//
// PURPOSE
//   Every other adversarial suite proves the APP filters by church_id. This one
//   proves the DATABASE would too — that the church_isolation policies actually
//   isolate, under a role that does NOT have rolbypassrls.
//
//   It exists because the policies are currently INERT: the app's role bypasses
//   RLS, so nothing else in the suite can tell a correct policy from a typo, a
//   policy on a table where RLS was never enabled, or a policy that fails OPEN.
//   Two real defects were caught this way while writing it:
//     1. the migration created 38 policies but never ran ENABLE ROW LEVEL
//        SECURITY — on a fresh database the policies were never consulted;
//     2. an early withServiceRole set an `app.bypass_rls` GUC that no policy
//        reads, which under a non-bypassing role returns zero rows while
//        looking like it escalated.
//   Both were invisible to every owner-role test.
//
// WHEN TO RUN
//   In CI's database job, and before the step-2 role cutover. Any FAIL = do NOT
//   cut over: after the cutover a fail-open policy leaks another church's data,
//   and a fail-shut one blanks the projector mid-service.
//
// RUN
//   npx tsx --env-file=.env.local test/adversarial/rls-policies.test.ts
//
// SKIPS (loudly) when the policies are not present, so it never reports a
// false green on a database that simply has not had the migration applied.
import { sql } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";

const ROLE = "pf_rls_probe";

let pass = 0, fail = 0;
function record(name: string, ok: boolean, detail = "") {
  if (ok) { console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ""}`); pass++; }
  else { console.error(`[FAIL] ${name}${detail ? ` — ${detail}` : ""}`); fail++; }
}

async function scalar(tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, q: ReturnType<typeof sql>) {
  const r = (await tx.execute(q)) as unknown as { rows: Record<string, unknown>[] };
  return Object.values(r.rows[0] ?? {})[0];
}

async function main() {
  const db = getDb();

  const policyCount = Number(await scalar(db, sql`
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'church_isolation'`));
  if (policyCount === 0) {
    console.error("[SKIP] no church_isolation policies in this database — apply docs/migrations/2026-09-23-rls-church-isolation-policies.sql first");
    process.exit(1);
  }
  record("church_isolation policies present", policyCount >= 38, `${policyCount} policies`);

  // A policy on a table with RLS OFF is never consulted. This is defect (1).
  const rlsOff = (await db.execute(sql`
    SELECT c.relname FROM pg_policies p
    JOIN pg_class c ON c.relname = p.tablename
    WHERE p.schemaname = 'public' AND p.policyname = 'church_isolation'
      AND c.relrowsecurity = false`) as unknown as { rows: { relname: string }[] }).rows;
  record("every policed table has RLS ENABLED", rlsOff.length === 0,
    rlsOff.length ? `RLS off on: ${rlsOff.map((r) => r.relname).join(", ")}` : "0 tables with a policy but RLS off");

  await db.execute(sql`DROP ROLE IF EXISTS ${sql.raw(ROLE)}`);
  await db.execute(sql`CREATE ROLE ${sql.raw(ROLE)} NOLOGIN NOBYPASSRLS`);
  await db.execute(sql`GRANT USAGE ON SCHEMA public TO ${sql.raw(ROLE)}`);
  await db.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${sql.raw(ROLE)}`);

  const stamp = Date.now();
  const rows = (await db.execute(sql`
    INSERT INTO churches (name) VALUES (${`ZZ RLS A ${stamp}`}), (${`ZZ RLS B ${stamp}`})
    RETURNING id`) as unknown as { rows: { id: string }[] }).rows;
  const [a, b] = [rows[0].id, rows[1].id];

  try {
    await db.execute(sql`INSERT INTO songs (church_id, title) VALUES (${a}, ${`ZZ A ${stamp}`}), (${b}, ${`ZZ B ${stamp}`})`);

    // Each probe runs in its own transaction as the NON-bypassing role. SET
    // LOCAL only applies inside a transaction — a SET LOCAL outside one warns
    // and silently does nothing, which is how an earlier hand-run of these
    // checks produced a false "policies don't work" reading.
    const asProbe = async <T>(churchId: string | null, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE ${sql.raw(ROLE)}`);
        if (churchId !== null) await tx.execute(sql`SELECT set_config('app.current_church_id', ${churchId}, true)`);
        return fn(tx);
      });

    const seenByA = await asProbe(a, (tx) => scalar(tx, sql`SELECT count(*) FROM songs WHERE title LIKE ${`ZZ % ${stamp}`}`));
    record("scoped to A, sees only A's song", Number(seenByA) === 1, `saw ${seenByA}`);

    const leaked = await asProbe(a, (tx) => scalar(tx, sql`SELECT count(*) FROM songs WHERE church_id = ${b}`));
    record("scoped to A, explicitly asking for B's rows returns 0", Number(leaked) === 0, `saw ${leaked}`);

    // Unset GUC must return NOTHING rather than everything (fail closed)...
    const unset = await asProbe(null, (tx) => scalar(tx, sql`SELECT count(*) FROM songs`));
    record("no church scope set → 0 rows (fails closed, not open)", Number(unset) === 0, `saw ${unset}`);

    // ...and must not THROW. `''::uuid` raises "invalid input syntax for type
    // uuid", so without the nullif() an unscoped query errors instead of
    // returning nothing — a worse failure than the one being prevented.
    let emptyErr: string | null = null;
    const empty = await asProbe(null, async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_church_id', '', true)`);
      try { return await scalar(tx, sql`SELECT count(*) FROM songs`); }
      catch (e) { emptyErr = String(e); return -1; }
    });
    record("empty-string church scope → 0 rows, no uuid syntax error", Number(empty) === 0, emptyErr ?? `saw ${empty}`);

    // WITH CHECK: writes are policed too, not just reads.
    let blocked = false;
    try {
      await asProbe(a, (tx) => tx.execute(sql`INSERT INTO songs (church_id, title) VALUES (${b}, ${`ZZ SMUGGLED ${stamp}`})`));
    } catch { blocked = true; }
    record("scoped to A, INSERT into B is rejected by WITH CHECK", blocked);
    const smuggled = await scalar(db, sql`SELECT count(*) FROM songs WHERE title = ${`ZZ SMUGGLED ${stamp}`}`);
    record("no smuggled row landed", Number(smuggled) === 0, `found ${smuggled}`);

    // The whole point of shipping phase 1 separately: today's app is untouched.
    const ownerSees = await scalar(db, sql`SELECT count(*) FROM songs WHERE title LIKE ${`ZZ % ${stamp}`}`);
    record("owner role (rolbypassrls) still sees both — app behaviour unchanged", Number(ownerSees) === 2, `saw ${ownerSees}`);
  } finally {
    await db.execute(sql`DELETE FROM songs WHERE church_id IN (${a}, ${b})`);
    await db.execute(sql`DELETE FROM churches WHERE id IN (${a}, ${b})`);
    await db.execute(sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${sql.raw(ROLE)}`);
    await db.execute(sql`REVOKE USAGE ON SCHEMA public FROM ${sql.raw(ROLE)}`);
    await db.execute(sql`DROP ROLE IF EXISTS ${sql.raw(ROLE)}`);
  }

  console.log(`\nRLS policies: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
