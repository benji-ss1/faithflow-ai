// Client-safe: no DB imports. Split out from song-limits.ts (which pulls in
// `pg` via getDb()) so client components can import bundle pricing/labels
// without dragging a Postgres driver into the browser bundle.

export type SongBundle = {
  id: string;
  label: string;
  hint: string;
  songs: number;
  priceCents: number;
  bestValue?: boolean;
};

// Mirrors the reference pricing exactly. `id` is what's stored in
// songBundlePurchases.bundleId and echoed back through Stripe metadata —
// changing an id here orphans historical purchase rows from this list, so
// treat these as stable once real purchases exist.
export const SONG_BUNDLES: SongBundle[] = [
  { id: "500", label: "500 Song Bundle", hint: "Perfect for small churches", songs: 500, priceCents: 1000 },
  { id: "1000", label: "1,000 Song Bundle", hint: "Great for growing churches", songs: 1000, priceCents: 2000 },
  { id: "1500", label: "1,500 Song Bundle", hint: "Most popular choice", songs: 1500, priceCents: 3000, bestValue: true },
  { id: "2000", label: "2,000+ Song Bundle", hint: "For large churches & ministries", songs: 2000, priceCents: 4000 },
];

export function getSongBundle(bundleId: string): SongBundle | null {
  return SONG_BUNDLES.find((b) => b.id === bundleId) ?? null;
}
