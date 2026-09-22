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
/**
 * 2026-09-21: pool size is now configurable, because the two consumers of this
 * function have opposite shapes and were sharing one number:
 *
 *  - VERCEL: many short-lived Fluid instances, each opening its OWN pool. Total
 *    connections = instances x max, so a big `max` here multiplies badly.
 *  - THE FLY AUDIO BRIDGE: two long-lived processes serving EVERY church at
 *    once. A small `max` here is a hard ceiling — a burst of simultaneous
 *    detections queues on it and surfaces as "verse lookup timed out".
 *
 * Verified on the live DB: `max_connections = 60` (57 usable) and the app
 * reaches Postgres through Supavisor (Supabase's pooler), which multiplexes
 * client connections onto far fewer server ones. That is what makes raising the
 * bridge's pool safe; on a DIRECT connection it would not be.
 *
 * Default stays 6 so nothing changes unless PG_POOL_MAX is set (the Fly bridge
 * sets it in fly.toml). Clamped so a typo cannot exhaust the database.
 */
export const DEFAULT_PG_POOL_MAX = 6;

function poolMax(): number {
  const raw = Number(process.env.PG_POOL_MAX);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PG_POOL_MAX;
  return Math.max(1, Math.min(24, Math.floor(raw)));
}

/**
 * The Fly audio bridge is a LONG-LIVED process; Vercel functions are not. Two
 * settings matter only for the long-lived case, and adopting them here (rather
 * than in a second DB module, which would be a second way to do one thing) was
 * the good idea in PR #75:
 *   - `min: 1` keeps one connection warm, so the first detection of a service
 *     does not pay a fresh TCP + TLS + auth handshake.
 *   - `keepAlive` stops an idle connection being silently dropped by a NAT or
 *     load balancer between Sunday services, which surfaces later as a
 *     mysterious first-query failure.
 * Both are inert for a short-lived function, so they are safe everywhere, but
 * we only turn them on where a pool size was deliberately configured.
 */
const LONG_LIVED = process.env.PG_POOL_MAX !== undefined;

export function getDb() {
  if (_db) return _db;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: poolMax(),
    ...(LONG_LIVED ? { min: 1, keepAlive: true } : {}),
    // 45s keeps a pool opened for one lookup alive long enough to serve the
    // next without a full reconnect. It is also why a TEST process appears to
    // hang for 45 seconds after its assertions finish: node will not exit while
    // an idle pooled socket is open. CI sets this to ~1s so the database suite
    // takes seconds instead of ~8 minutes of pure waiting.
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 45_000,
    connectionTimeoutMillis: 8_000,
  });
  _db = drizzle(_pool, { schema });
  return _db;
}
