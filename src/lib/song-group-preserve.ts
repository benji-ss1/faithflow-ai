/**
 * song-group-preserve — pure helper for the Groups & Arrangements "don't wipe my
 * sections" mitigation (wave 6G).
 *
 * `updateSongSlides` rewrites a song's slide rows (delete + re-insert), which
 * historically dropped every slide's `group_id`. When the NEW slide count equals
 * the OLD one — the common case for an in-place text edit that keeps the same
 * number of lines/slides — we carry the prior group ids across BY INDEX so the
 * sections survive. When the counts differ (a line/slide was added or removed) a
 * positional match is ambiguous, so we DON'T guess: every new slide comes back
 * ungrouped (null) and the operator is warned in the strip.
 *
 * Pure: no DB, no React. Directly unit-tested.
 */
export function preservedGroupIds(
  priorGroupIds: readonly (string | null)[],
  newCount: number,
): (string | null)[] {
  const sameCount = priorGroupIds.length === newCount;
  const anyGrouped = priorGroupIds.some((g) => g !== null);
  if (!sameCount || !anyGrouped) return new Array(newCount).fill(null);
  return priorGroupIds.slice(0, newCount).map((g) => g ?? null);
}
