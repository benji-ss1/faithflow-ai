/**
 * Populates the `embedding` column on bible_verses using @xenova/transformers
 * (all-MiniLM-L6-v2, 384 dims). Local, offline after first run.
 *
 * Idempotent: only embeds verses where embedding IS NULL.
 * Resumable: crash-safe, run again to continue.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { embedBatch, toVectorLiteral } from "../src/lib/embeddings";

const BATCH_SIZE = 32;

async function main() {
  const db = getDb();

  const [{ total }] = await db.execute(sql<{ total: number }>`SELECT COUNT(*)::int AS total FROM bible_verses WHERE embedding IS NULL`).then((r) => r.rows as { total: number }[]);
  if (!total || total === 0) {
    console.log("✓ All verses already embedded. Nothing to do.");
    process.exit(0);
  }
  console.log(`→ Embedding ${total} verses (batch size ${BATCH_SIZE}). First run downloads ~90MB model.`);

  const start = Date.now();
  let done = 0;

  while (true) {
    const rows = (await db.execute(sql`SELECT id, text FROM bible_verses WHERE embedding IS NULL ORDER BY book_order, chapter, verse LIMIT ${BATCH_SIZE}`)).rows as { id: string; text: string }[];
    if (rows.length === 0) break;

    const vectors = await embedBatch(rows.map((r) => r.text));

    // Batch update. Use one UPDATE per row inside a single transaction for speed.
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const lit = toVectorLiteral(vectors[i]);
        await tx.execute(sql.raw(`UPDATE bible_verses SET embedding = '${lit}'::vector WHERE id = '${rows[i].id}'`));
      }
    });

    done += rows.length;
    const elapsed = (Date.now() - start) / 1000;
    const rate = done / elapsed;
    const remaining = (total - done) / Math.max(rate, 0.001);
    process.stdout.write(`\r  · ${done} / ${total}  (${rate.toFixed(1)}/s, ~${Math.round(remaining)}s left)     `);
  }
  process.stdout.write("\n");
  console.log(`✓ Embedded ${done} verses in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
