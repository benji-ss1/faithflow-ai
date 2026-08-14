import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { churches } from "@/lib/db/schema";
import { getSongLimit } from "@/lib/song-limits";
import { getEntitlement, canUseMax } from "./entitlement";

// Effectively-unlimited cap for Max/pilot/demo churches (a real congregation
// never approaches this). Finite so headroom math + UI never hit Infinity.
const UNLIMITED_SONGS = 1_000_000;

/**
 * The song-library cap a church is ENTITLED to, enforcing the freemium gate:
 *   - Demo churches (isDemo) and Max/pilot subscribers → effectively unlimited.
 *   - Everyone else (free/gated) → base free limit (50) + purchased bundles.
 *
 * Server-only (queries subscriptions + churches). Callers that enforce the song
 * limit — bulk import, single create — must use THIS, not the raw getSongLimit,
 * so the demo account has everything while real free accounts stay gated.
 */
export async function getEffectiveSongLimit(churchId: string): Promise<number> {
  const [ent, isDemo] = await Promise.all([
    getEntitlement(churchId),
    (async () => {
      try {
        const db = getDb();
        const [row] = await db.select({ isDemo: churches.isDemo }).from(churches).where(eq(churches.id, churchId)).limit(1);
        return !!row?.isDemo;
      } catch { return false; }
    })(),
  ]);
  if (isDemo || canUseMax(ent)) return UNLIMITED_SONGS;
  return getSongLimit(churchId);
}
