/**
 * Build-time schema preflight — DERIVED from schema.ts, not a hand-kept list.
 *
 * WHY THIS EXISTS (2026-09-22, written after it bit us)
 *   Migrations in this repo live in `docs/migrations/*.sql` and are applied BY
 *   HAND. Drizzle's `db.select()` enumerates EVERY column in `schema.ts`, so
 *   shipping code whose schema is ahead of the database makes real reads fail
 *   at runtime — not at build, not in tests, but on Sunday.
 *
 *   That is not hypothetical. `2026-09-21-add-stage-layouts-and-timer-parity.sql`
 *   was written, reviewed, and never applied; the code that reads those tables
 *   shipped anyway, and production threw `relation "stage_layouts" does not
 *   exist` — which also took the TIMERS list down with it, because
 *   listTimerDefinitions does a bare db.select() over the same widened table.
 *
 * WHY IT IS DERIVED
 *   A previous version of this file existed as an ENUMERATED list of four
 *   known columns, with the instruction "add a row whenever schema.ts moves
 *   ahead". It was never committed, never wired into the build, and would not
 *   have caught this migration anyway, because nobody added the rows. A guard
 *   you have to remember to update is a guard that fails exactly when you
 *   needed it.
 *
 *   So this reads the ACTUAL Drizzle table metadata at runtime and compares
 *   every table and column against information_schema. A new table or column
 *   in schema.ts is covered the moment it is written, with no list to maintain.
 *
 * FAILS THE BUILD when the database is behind. Vercel keeps the previous
 * deployment live when a build fails, so the worst case becomes "the new
 * version didn't ship" instead of "every church is broken on Sunday".
 *
 * DELIBERATELY SKIPS (never blocks a build it cannot judge):
 *   - no DATABASE_URL (local checkouts, CI without a DB)
 *   - the database is unreachable
 *   In both cases it prints a clear notice and exits 0. A preflight that turns
 *   a missing credential into a failed deploy would get switched off.
 */
import pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/lib/db/schema";

type Expected = { table: string; columns: Set<string> };

function expectedFromSchema(): Expected[] {
  const out: Expected[] = [];
  for (const value of Object.values(schema)) {
    let cfg: ReturnType<typeof getTableConfig>;
    try {
      // Everything in schema.ts that is not a pgTable (enums, types, helpers)
      // throws here and is skipped — no allowlist to keep in sync.
      cfg = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    } catch {
      continue;
    }
    out.push({ table: cfg.name, columns: new Set(cfg.columns.map((c) => c.name)) });
  }
  return out;
}

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
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`[check-schema] Could not reach the database (${msg}) — skipping preflight.`);
  process.exit(0);
}

try {
  const expected = expectedFromSchema();
  const { rows } = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );

  const live = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = live.get(r.table_name);
    if (!s) { s = new Set(); live.set(r.table_name, s); }
    s.add(r.column_name);
  }

  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  for (const t of expected) {
    const cols = live.get(t.table);
    if (!cols) { missingTables.push(t.table); continue; }
    for (const c of t.columns) if (!cols.has(c)) missingColumns.push(`${t.table}.${c}`);
  }

  if (missingTables.length === 0 && missingColumns.length === 0) {
    console.log(`[check-schema] OK — ${expected.length} tables in schema.ts all present in the database.`);
    process.exit(0);
  }

  console.error("\n[check-schema] THE DATABASE IS BEHIND THE CODE. Build stopped.\n");
  if (missingTables.length) {
    console.error(`  Missing tables (${missingTables.length}):`);
    for (const t of missingTables.sort()) console.error(`    - ${t}`);
  }
  if (missingColumns.length) {
    console.error(`  Missing columns (${missingColumns.length}):`);
    for (const c of missingColumns.sort()) console.error(`    - ${c}`);
  }
  console.error(`
  Apply the matching migration in docs/migrations/ to this database, THEN
  redeploy. Migrations here are additive and applied by hand — see
  CLAUDE.md rule 0(d).

  Shipping anyway would not be a partial failure: Drizzle's db.select()
  lists every column in schema.ts, so any read of these tables 500s for
  every church.
`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
