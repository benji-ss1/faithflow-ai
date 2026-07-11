/**
 * Sharded Bible embedding worker.
 *
 * Env:
 *   DATABASE_URL     required
 *   WORKER_INDEX     0..WORKER_COUNT-1
 *   WORKER_COUNT     total workers (defaults 1)
 *
 * Each worker only processes rows where hashtext(id::text) mod WORKER_COUNT
 * equals WORKER_INDEX, so N workers can run concurrently without stepping
 * on each other. Writes are per-row UPDATE inside batched transactions —
 * pgvector accepts concurrent writes on the same table without conflicts,
 * and Supabase's pgbouncer pooler handles the connection multiplexing.
 *
 * Idempotent: skips rows with embedding IS NOT NULL. Resumable: on kill,
 * re-run and it picks up where it left off.
 */
import { Pool } from "pg";
import { pipeline } from "@xenova/transformers";

const WORKER_INDEX = Number(process.env.WORKER_INDEX ?? 0);
const WORKER_COUNT = Number(process.env.WORKER_COUNT ?? 1);
const BATCH_SIZE = 32;
const TAG = `[worker ${WORKER_INDEX}/${WORKER_COUNT}]`;

// Last-resort safety net: pg can emit an 'error' on a Client that's not
// currently being awaited (idle socket kill by Supabase pooler between
// batches). Instead of crashing, log and let the next iteration reconnect.
process.on("uncaughtException", (err) => {
  const msg = (err as { message?: string; code?: string })?.message ?? String(err);
  const code = (err as { code?: string })?.code;
  console.warn(`${TAG} uncaughtException swallowed:`, code || "", msg);
});
process.on("unhandledRejection", (reason) => {
  console.warn(`${TAG} unhandledRejection swallowed:`, reason);
});

function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => x.toFixed(8)).join(",")}]`;
}

// Non-negative modulo. `abs(hashtext(...))` throws integer-out-of-range if
// the hash is exactly INT_MIN (~1/2^31 per row, ~1/9600 across 222k rows).
// The `((x % n) + n) % n` form handles negative results without abs().
const SHARD_PRED = `((hashtext(id::text) % $1) + $1) % $1 = $2`;

async function main() {
  if (!process.env.DATABASE_URL) { console.error(`${TAG} DATABASE_URL missing`); process.exit(1); }
  // Pool max=1: only one connection per worker. On Supabase's transaction
  // pooler the total budget is shared across ALL clients (including the
  // Vercel serverless app), so N workers × 1 conn caps our footprint at N.
  // With 2 workers running here we consume 2 pooler slots, leaving plenty
  // for prod traffic during the embed backfill.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  // Supabase pooler drops idle TCP sockets; without this handler an async
  // socket error surfaces as an unhandled 'error' event and crashes the
  // process. Log it and let the next query trigger pg's reconnect path.
  pool.on("error", (err) => console.warn(`${TAG} pool error (ignored):`, err.message));

  const totalR = await pool.query(
    `SELECT COUNT(*)::int AS n FROM bible_verses
     WHERE embedding IS NULL AND ${SHARD_PRED}`,
    [WORKER_COUNT, WORKER_INDEX]
  );
  const total = totalR.rows[0].n as number;
  if (total === 0) { console.log(`${TAG} nothing to do`); await pool.end(); return; }
  console.log(`${TAG} will embed ${total} rows`);

  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const embedBatch = async (texts: string[]): Promise<number[][]> => {
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    const arr = out.tolist() as number[][];
    return arr;
  };

  const start = Date.now();
  let done = 0;

  while (true) {
    // No ORDER BY: repeatedly sorting the same prefix wastes I/O; the
    // WHERE embedding IS NULL filter narrows the working set every batch,
    // and embed order doesn't affect the output vectors.
    // Retry loop on any pg-side transient error. The batch (SELECT + UPDATE)
    // is fully idempotent, so re-running it is safe.
    let rows: { id: string; text: string }[] = [];
    let attempt = 0;
    while (true) {
      try {
        rows = (await pool.query(
          `SELECT id, text FROM bible_verses
           WHERE embedding IS NULL AND ${SHARD_PRED}
           LIMIT $3`,
          [WORKER_COUNT, WORKER_INDEX, BATCH_SIZE]
        )).rows as { id: string; text: string }[];
        break;
      } catch (e) {
        attempt++;
        const backoff = Math.min(30_000, 500 * 2 ** attempt);
        console.warn(`${TAG} SELECT retry ${attempt} after ${backoff}ms:`, (e as Error).message);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    if (rows.length === 0) break;

    const vectors = await embedBatch(rows.map((r) => r.text));

    // Retry the write batch too. Each UPDATE has `AND embedding IS NULL` so
    // partial replays are no-ops.
    attempt = 0;
    while (true) {
      let client;
      try {
        client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (let i = 0; i < rows.length; i++) {
            await client.query(
              `UPDATE bible_verses SET embedding = $1::vector WHERE id = $2 AND embedding IS NULL`,
              [toVectorLiteral(vectors[i]), rows[i].id]
            );
          }
          await client.query("COMMIT");
          break;
        } catch (e) {
          try { await client.query("ROLLBACK"); } catch { /* ignore */ }
          throw e;
        } finally {
          client.release(true); // destroy the connection so pool grabs a fresh one
        }
      } catch (e) {
        attempt++;
        const backoff = Math.min(30_000, 500 * 2 ** attempt);
        console.warn(`${TAG} UPDATE retry ${attempt} after ${backoff}ms:`, (e as Error).message);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    done += rows.length;
    if (done % 320 === 0 || done === total) {
      const elapsed = (Date.now() - start) / 1000;
      const rate = done / elapsed;
      const remaining = Math.max(0, (total - done) / Math.max(rate, 0.001));
      console.log(`${TAG} ${done}/${total} (${rate.toFixed(1)}/s, ~${Math.round(remaining)}s left)`);
    }
  }

  console.log(`${TAG} ✓ done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  await pool.end();
}
main().catch((e) => { console.error(`${TAG} FATAL`, e); process.exit(1); });
