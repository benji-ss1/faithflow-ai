/**
 * song-group-preserve — pure helper for the Groups & Arrangements "don't wipe my
 * sections" mitigation (wave 6G, refined wave 6 fix pass).
 *
 * `updateSongSlides` rewrites a song's slide rows (delete + re-insert), which
 * historically dropped every slide's `group_id`. To preserve the sections:
 *
 *  - When the NEW slide count DIFFERS from the old one (a line/slide was added
 *    or removed), a positional match is ambiguous, so we DON'T guess: every new
 *    slide comes back ungrouped (null) and the operator is warned in the strip.
 *
 *  - When the counts are EQUAL, we match primarily by EXACT prior-lyric TEXT: a
 *    prior lyric → group-id FIFO queue, so a slide keeps its section label even
 *    if lines were reordered (swap-two-lines). Duplicate lyrics consume their
 *    prior group ids in original order. A new/edited lyric with no text match
 *    falls back to the group id at its INDEX (index-match as tiebreak).
 *
 * Pure: no DB, no React. Directly unit-tested.
 */
export type PriorSlide = { lyrics: string; groupId: string | null };

export function preservedGroupIds(
  prior: readonly PriorSlide[],
  newLyrics: readonly string[],
): (string | null)[] {
  const newCount = newLyrics.length;
  const sameCount = prior.length === newCount;
  const anyGrouped = prior.some((p) => p.groupId !== null);
  if (!sameCount || !anyGrouped) return new Array(newCount).fill(null);

  // Primary: exact prior-lyric text → FIFO queue of that lyric's group ids
  // (duplicate lyrics consumed in original order).
  const byLyric = new Map<string, (string | null)[]>();
  for (const p of prior) {
    const q = byLyric.get(p.lyrics);
    if (q) q.push(p.groupId);
    else byLyric.set(p.lyrics, [p.groupId]);
  }
  const priorByIndex = prior.map((p) => p.groupId);
  const result: (string | null)[] = [];
  for (let i = 0; i < newCount; i++) {
    const q = byLyric.get(newLyrics[i]);
    if (q && q.length > 0) {
      result.push(q.shift() ?? null);
    } else {
      // Tiebreak: an edited line with no surviving text match keeps its index's group.
      result.push(priorByIndex[i] ?? null);
    }
  }
  return result;
}
