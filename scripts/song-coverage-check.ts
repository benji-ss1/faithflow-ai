/**
 * Read-only: verifies song library has usable content for AI song detection.
 * A demo needs at least a handful of hymns/songs seeded, each with slides.
 */

import { getDb } from "../src/lib/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();

  const totals = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM songs) AS total_songs,
      (SELECT COUNT(*) FROM song_slides) AS total_slides,
      (SELECT COUNT(DISTINCT church_id) FROM songs) AS distinct_churches
  `);
  const r = totals.rows[0];
  console.log(`songs: ${r.total_songs}  slides: ${r.total_slides}  distinct_churches: ${r.distinct_churches}`);

  const perChurch = await db.execute(sql`
    SELECT c.id, c.name, c.is_demo, COUNT(s.id) AS song_count
    FROM churches c
    LEFT JOIN songs s ON s.church_id = c.id
    GROUP BY c.id, c.name, c.is_demo
    ORDER BY song_count DESC
    LIMIT 20
  `);
  console.log("\nper-church song counts (top 20):");
  for (const row of perChurch.rows) {
    const demoTag = row.is_demo ? " [demo]" : "";
    console.log(`  ${row.name}${demoTag}: ${row.song_count} songs`);
  }

  // Songs missing slides = won't project cleanly
  const orphan = await db.execute(sql`
    SELECT COUNT(*) AS n FROM songs s
    WHERE NOT EXISTS (SELECT 1 FROM song_slides ss WHERE ss.song_id = s.id)
  `);
  console.log(`\nsongs with zero slides: ${orphan.rows[0]?.n}`);

  console.log("\nSTATUS: song library snapshot complete");
}
main().catch((e) => { console.error(e); process.exit(1); });
