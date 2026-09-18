import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let audioDb: ReturnType<typeof drizzle<typeof schema>> | null = null;
let audioPool: Pool | null = null;

/**
 * Database client for the long-running Fly audio bridge.
 *
 * This pool is intentionally separate from the request-oriented Vercel pool
 * so live audio sessions cannot consume its connections.
 */
export function getAudioDb() {
  if (audioDb) return audioDb;

  audioPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.AUDIO_DB_POOL_MAX ?? 6),
    min: 1,
    idleTimeoutMillis: 45_000,
    connectionTimeoutMillis: 8_000,
    keepAlive: true,
  });

  audioDb = drizzle(audioPool, { schema });
  return audioDb;
}
