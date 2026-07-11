import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Pool max is intentionally small (2) for Vercel serverless. Supabase's
 * pooler is shared across every warm Vercel instance and any ad-hoc scripts.
 * `pg` defaults to 10 per pool — with a handful of Fluid instances that
 * quickly blows past the pooler's client cap and every request returns
 * EMAXCONNSESSION. Two connections per instance is plenty for the small
 * fan-out inside a single request; when concurrency is higher Fluid boots
 * additional instances, each with its own tiny pool.
 * `idleTimeoutMillis` releases idle clients quickly so we don't hoard
 * pooler slots across cold-start intervals.
 */
export function getDb() {
  if (_db) return _db;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10_000,
  });
  _db = drizzle(_pool, { schema });
  return _db;
}
