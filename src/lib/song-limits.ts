import { eq, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { songs, songBundlePurchases } from "./db/schema";

export { SONG_BUNDLES, getSongBundle, type SongBundle } from "./song-bundles";

/** Every church starts with this many songs free before needing a bundle.
 *  2026-08-14: raised 50 → 5000 so real church libraries (JPD imported 500+
 *  from ProPresenter) aren't silently blocked at import. The old 50 cap made a
 *  full-library import skip every song once 50 existed. Effectively unlimited
 *  for any real congregation; bundle purchases still stack on top. Lower this
 *  (and grant JPD a bundle instead) if the freemium cap needs re-tightening. */
export const SONG_LIBRARY_BASE_FREE_LIMIT = 5000;

/** Base free limit + every bundle ever purchased by this church. */
export async function getSongLimit(churchId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${songBundlePurchases.songsGranted}), 0)` })
    .from(songBundlePurchases)
    .where(eq(songBundlePurchases.churchId, churchId));
  return SONG_LIBRARY_BASE_FREE_LIMIT + Number(row?.total ?? 0);
}

export async function getSongUsage(churchId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(songs)
    .where(eq(songs.churchId, churchId));
  return Number(row?.total ?? 0);
}
