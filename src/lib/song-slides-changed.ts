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
 * Relocate a tracked lyric slide after the song's slides changed (edit/insert/
 * delete). Repeated choruses make text alone ambiguous, so:
 *  (1) same copy count of the live text in old and fresh → keep the ordinal
 *      (the k-th chorus stays the k-th chorus);
 *  (2) otherwise score each fresh copy +1 per prev/next neighbour matching the
 *      old neighbours;
 *  (3) tie → nearest the expected index (shifted by the length delta when the
 *      edit happened at/before the old index, via shared-prefix length); still
 *      tied → the later copy.
 * Returns -1 when the live text is no longer in the fresh slides.
 */
export function relocateLyricIndex(
  oldSlides: string[],
  oldIdx: number,
  freshSlides: string[],
  liveNorm: string,
  normalize: (s: string) => string,
): number {
  const oldN = oldSlides.map(normalize);
  const freshN = freshSlides.map(normalize);
  const freshCopies: number[] = [];
  freshN.forEach((t, i) => { if (t === liveNorm) freshCopies.push(i); });
  if (freshCopies.length === 0) return -1;
  const oldCopies: number[] = [];
  oldN.forEach((t, i) => { if (t === liveNorm) oldCopies.push(i); });
  const ordinal = oldCopies.indexOf(oldIdx);
  if (ordinal >= 0 && oldCopies.length === freshCopies.length) return freshCopies[ordinal];
  const oldPrev = oldN[oldIdx - 1];
  const oldNext = oldN[oldIdx + 1];
  let p = 0;
  while (p < oldN.length && p < freshN.length && oldN[p] === freshN[p]) p++;
  const expected = oldIdx >= p ? oldIdx + (freshN.length - oldN.length) : oldIdx;
  let best = -1, bestScore = -1, bestDist = Infinity;
  for (const c of freshCopies) {
    const score = (freshN[c - 1] === oldPrev ? 1 : 0) + (freshN[c + 1] === oldNext ? 1 : 0);
    const dist = Math.abs(c - expected);
    // Iterating ascending, `<=` on distance ties lets the later copy win.
    if (score > bestScore || (score === bestScore && dist <= bestDist)) {
      best = c; bestScore = score; bestDist = dist;
    }
  }
  return best;
}

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
  const idx = relocateLyricIndex(live.slides, live.currentIdx, freshSlides, liveNorm, normalize);
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
