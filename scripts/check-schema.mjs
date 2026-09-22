/**
 * Build-time schema preflight.
 *
 * WHY THIS EXISTS
 *   Migrations in this repo live in `docs/migrations/*.sql` and are applied BY
 *   HAND (that is the established convention — `scripts/migrate.ts` only reads
 *   `./drizzle`). Drizzle's `db.select()` enumerates every column in
 *   `schema.ts`, so shipping code whose schema is ahead of the database makes
 *   real reads fail: the Library rail and the operator console would 500 for
 *   every church.
 *
 *   Rather than rely on remembering the order, this check FAILS THE BUILD when
 *   a required column is missing. Vercel keeps the previous deployment live
 *   when a build fails, so the worst case becomes "the new version didn't ship"
 *   instead of "every church is broken on Sunday".
 *
 * DELIBERATELY SKIPS (never blocks a build it cannot judge):
 *   - no DATABASE_URL (local checkouts, CI without a DB)
 *   - the database is unreachable
 *   In both cases it prints a clear notice and exits 0.
 */
import pg from "pg";

/** Columns the CURRENT code requires. Add a row whenever schema.ts moves ahead. */
const REQUIRED = [
  { table: "libraries", column: "kind", migration: "2026-09-22-add-smart-folders.sql" },
  { table: "libraries", column: "rules", migration: "2026-09-22-add-smart-folders.sql" },
  { table: "service_plans", column: "kind", migration: "2026-09-22-add-smart-folders.sql" },
  { table: "service_plans", column: "rules", migration: "2026-09-22-add-smart-folders.sql" },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[check-schema] No DATABASE_URL — skipping schema preflight.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: url,
  // Supabase and most managed Postgres require TLS; don't fail on the chain.
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10_000,
});

try {
  await client.connect();
} catch (err) {
  console.log(`[check-schema] Could not reach the database (${err.message}) — skipping preflight.`);
  process.exit(0);
}

try {
  const { rows } = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (${REQUIRED.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")})`,
    REQUIRED.flatMap((r) => [r.table, r.column]),
  );
  const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  const missing = REQUIRED.filter((r) => !present.has(`${r.table}.${r.column}`));

  if (missing.length > 0) {
    const files = [...new Set(missing.map((m) => m.migration))];
    console.error("\n[check-schema] BUILD STOPPED — the database is behind this code.\n");
    console.error("  Missing column(s):");
    for (const m of missing) console.error(`    - ${m.table}.${m.column}`);
    console.error("\n  Apply this first, THEN redeploy:");
    for (const f of files) console.error(`    psql "$DATABASE_URL" -f docs/migrations/${f}`);
    console.error("\n  The migration is additive and idempotent — safe to run more than once.");
    console.error("  Rollback SQL is at the bottom of each file.\n");
    process.exit(1);
  }
  console.log(`[check-schema] OK — all ${REQUIRED.length} required column(s) present.`);
} finally {
  await client.end().catch(() => {});
}
