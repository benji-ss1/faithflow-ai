import { eq, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { songs, songBundlePurchases } from "./db/schema";

export { SONG_BUNDLES, getSongBundle, type SongBundle } from "./song-bundles";

/** Every church starts with this many songs free before needing a bundle. */
export const SONG_LIBRARY_BASE_FREE_LIMIT = 50;

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
