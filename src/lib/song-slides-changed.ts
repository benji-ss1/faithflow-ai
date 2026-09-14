/**
 * `presentflow:song-slides-changed` detail handling (pure, unit-tested).
 *
 * Structural edits (Add slide, etc.) invalidate the cache AND drop live-song
 * tracking for that song. A text-only Quick edit save passes
 * `keepLiveTracking: true`: the cache is still invalidated (re-fetch → the
 * reconcile effect re-syncs the index), but tracking is kept so a >=90% detection
 * of the same live song can't re-project slide 1 during the fetch round-trip.
 */
/**
 * Refresh a kept live-song track against its (re)loaded cache entry. When the
 * cache holds a different slides list than the track (an edit re-fetched it),
 * swap in the NEW slides and recompute currentIdx for the live text nearest the
 * old index — so auto-advance / jump suggestions read post-edit lyrics and the
 * post-edit indices. Returns the same object when nothing changed, and null when
 * the live text is no longer in the song (caller falls back to a full search,
 * exactly as main's clear-and-rebuild did).
 */
export function refreshTrackedSong<T extends { slides: string[]; currentIdx: number }>(
  live: T,
  freshSlides: string[] | undefined,
  liveNorm: string,
  normalize: (s: string) => string,
): T | null {
  if (!freshSlides || freshSlides === live.slides) return live;
  const norms = freshSlides.map(normalize);
  const prev = live.currentIdx;
  let idx = prev >= 0 && prev < norms.length && norms[prev] === liveNorm ? prev : -1;
  if (idx < 0) {
    for (let k = 0; k < norms.length; k++) {
      if (norms[k] !== liveNorm) continue;
      if (idx < 0 || Math.abs(k - prev) < Math.abs(idx - prev)) idx = k;
    }
  }
  if (idx < 0) return null;
  return { ...live, slides: freshSlides, currentIdx: idx };
}

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
