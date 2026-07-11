/**
 * One-shot: applies the `churches.is_demo` column to whatever DB is at
 * DATABASE_URL. Idempotent (ADD COLUMN IF NOT EXISTS). Meant to be run with
 * `--env-file=.env.production.local` to target prod without editing
 * drizzle.config.ts (which hardcodes .env.local).
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const before = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='churches' AND column_name='is_demo'`
    );
    console.log(`is_demo column present before: ${before.rows.length > 0}`);
    await pool.query(
      `ALTER TABLE churches ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false`
    );
    const after = await pool.query(
      `SELECT column_name, data_type, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='churches' AND column_name='is_demo'`
    );
    console.log("is_demo column after:", after.rows[0]);
    console.log("✓ done");
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
