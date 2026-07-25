/**
 * CLI seeder for the first church in the database. For per-church seeding
 * from the onboarding wizard, see the `addBuiltInHymnsToMyChurch` server
 * action in src/lib/actions.ts — both paths share the HYMNS source in
 * src/lib/hymn-library.ts.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { churches, songs, songSlides } from "../src/lib/db/schema";
import { HYMNS } from "../src/lib/hymn-library";


async function main() {
  const db = getDb();
  const [church] = await db.select().from(churches).limit(1);
  if (!church) { console.error("No church seeded yet. Run npm run db:seed first."); process.exit(1); }

  let added = 0;
  for (const h of HYMNS) {
    if (h.slides.length === 0) {
      console.log(`  · Skipping "${h.title}" — ${h.verified}`);
      continue;
    }
    // Idempotent + re-runnable: if the hymn already exists but our canonical
    // slide count has changed (we expanded a hymn's lyrics), replace its
    // slides in place. Preserves the song row + its id, so any playlist
    // items referencing it don't break.
    const [existing] = await db.select().from(songs).where(and(eq(songs.churchId, church.id), eq(songs.title, h.title), eq(songs.source, "public_domain"))).limit(1);
    if (existing) {
      const currentSlides = await db.select().from(songSlides).where(eq(songSlides.songId, existing.id));
      if (currentSlides.length === h.slides.length) {
        console.log(`  · Up-to-date: "${h.title}" (${currentSlides.length} slides)`);
        continue;
      }
      await db.delete(songSlides).where(eq(songSlides.songId, existing.id));
      await db.insert(songSlides).values(h.slides.map((lyrics, i) => ({ songId: existing.id, order: i, lyrics })));
      console.log(`  ↻ Refreshed "${h.title}" (${currentSlides.length} → ${h.slides.length} slides)`);
      continue;
    }

    const [song] = await db.insert(songs).values({ churchId: church.id, title: h.title, artist: h.author, source: "public_domain" }).returning();
    await db.insert(songSlides).values(h.slides.map((lyrics, i) => ({ songId: song.id, order: i, lyrics })));
    console.log(`  ✓ Added "${h.title}" (${h.slides.length} slides)`);
    added++;
  }
  console.log(`✓ Public domain hymns seed complete (${added} added)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
