/**
 * `presentflow:song-slides-changed` detail handling (pure, unit-tested).
 *
 * Structural edits (Add slide, etc.) invalidate the cache AND drop live-song
 * tracking for that song. A text-only Quick edit save passes
 * `keepLiveTracking: true`: the cache is still invalidated (re-fetch → the
 * reconcile effect re-syncs the index), but tracking is kept so a >=90% detection
 * of the same live song can't re-project slide 1 during the fetch round-trip.
 */
export type SongSlidesChangedDetail = { songId?: string; keepLiveTracking?: boolean };

export function songSlidesChangedPlan(
  detail: SongSlidesChangedDetail | null | undefined,
  liveSongId: string | null | undefined,
): { invalidate: boolean; clearLiveTracking: boolean } {
  const songId = detail?.songId;
  if (!songId) return { invalidate: false, clearLiveTracking: false };
  return {
    invalidate: true,
    clearLiveTracking: liveSongId === songId && detail?.keepLiveTracking !== true,
  };
}
