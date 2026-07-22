import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Pool max was 2, sized for "one Fluid instance = mostly one request at a
 * time." That assumption breaks under real usage: Fluid Compute REUSES a
 * warm instance across concurrent requests rather than spinning up a fresh
 * one per request, and a burst of 3+ simultaneous AI Bible detections (a
 * normal sermon moment — several references land within the same second)
 * all hit the SAME warm instance and queue for the same 2 connections. The
 * 3rd+ request then waits on pg's internal pool queue, which has no timeout
 * of its own — it can sit well past the client's fetch-abort timeout,
 * surfacing as "Verse lookup timed out" even though the DB itself is fine.
 * Raised to 6 — still small per Supabase pooler session, but enough for a
 * realistic multi-detection burst on one instance. `connectionTimeoutMillis`
 * makes a genuinely exhausted pool fail fast with a clear pg error instead
 * of hanging silently past our own timeouts.
 * `idleTimeoutMillis` releases idle clients so we don't hoard pooler slots
 * indefinitely. 45s (was 10s) lets a pool opened for one lookup survive long
 * enough to serve the next one without a full reconnect, while still well
 * under Supabase's pooler-side idle limits.
 */
export function getDb() {
  if (_db) return _db;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 6,
    idleTimeoutMillis: 45_000,
    connectionTimeoutMillis: 8_000,
  });
  _db = drizzle(_pool, { schema });
  return _db;
}
