// Single source of truth for "which theme does this plan item project with" and
// "which plan item is live". Used by BOTH the slide thumbnails
// (appearanceForItem) and the live output (effectiveAppearance) so the two can
// never diverge again (2026-09-17 prod bug: thumbnails showed the song
// content-type theme's background while /live fell back to the church default).
// Pure + client-safe (unit-tested in test/live-item-theme.test.ts).
import type { SlidePayload } from "@/lib/broadcast";

export type ThemedPlanItem = {
  type?: string;
  themeId?: string | null;
  songAppliedThemeId?: string | null;
  slides?: SlidePayload[];
};

export type ContentStylesLike = { song?: string | null; scripture?: string | null };

/**
 * The theme CONFIG a plan item projects with: item theme → song's applied theme
 * → content-type style (song / scripture) → null (= church default). Only ids
 * present in the loaded theme cache count (an uncached id falls through).
 */
export function resolveItemThemeConfig(
  item: ThemedPlanItem | undefined | null,
  contentStyles: ContentStylesLike,
  byId: (id: string) => unknown,
): unknown | null {
  if (!item) return null;
  const ct = item.type === "song" ? contentStyles.song : item.type === "scripture" ? contentStyles.scripture : undefined;
  for (const id of [item.themeId, item.songAppliedThemeId, ct]) {
    if (!id) continue;
    const cfg = byId(id);
    if (cfg && typeof cfg === "object") return cfg;
  }
  return null;
}

/** Stamp recorded at send time: the exact plan item a slide was sent from. */
export type LiveItemStamp = { itemIdx: number; identity: string };

/**
 * Index of the plan item currently live (-1 if none).
 * 1. A send-time stamp wins when it still describes the live slide (same
 *    content identity) and the item exists — this picks the EXACT item when the
 *    same song appears several times in the plan.
 * 2. Otherwise today's content match: byte-equal plan slide, then content
 *    identity (raw, pre-layout source, or plan slide run through the layout).
 */
export function resolveLiveItemIdx(
  items: ThemedPlanItem[],
  live: SlidePayload,
  stamp: LiveItemStamp | null,
  fns: { identity: (s: SlidePayload) => string; source: (s: SlidePayload) => SlidePayload; layout: (s: SlidePayload, item: ThemedPlanItem) => SlidePayload },
): number {
  let liveKey = "";
  try { liveKey = JSON.stringify(live); } catch { return -1; }
  if (!liveKey) return -1;
  try {
    if (stamp && stamp.itemIdx >= 0 && stamp.itemIdx < items.length && stamp.identity === fns.identity(live)) {
      // Only trust the stamp while that item still holds the live slide (a plan
      // reorder/delete mid-hold must not hand live another item's theme).
      const held = (items[stamp.itemIdx].slides ?? []).some((sl) => {
        try { return fns.identity(sl) === stamp.identity || fns.identity(fns.layout(sl, items[stamp.itemIdx])) === stamp.identity; } catch { return false; }
      });
      if (held) return stamp.itemIdx;
    }
  } catch { /* fall through to the content match */ }
  for (let i = 0; i < items.length; i++) {
    const slides = items[i].slides ?? [];
    for (let j = 0; j < slides.length; j++) {
      if (slides[j].kind !== live.kind) continue;
      try { if (JSON.stringify(slides[j]) === liveKey) return i; } catch { /* continue */ }
    }
  }
  try {
    const liveId = fns.identity(live);
    const srcId = fns.identity(fns.source(live));
    for (let i = 0; i < items.length; i++) {
      for (const ps of items[i].slides ?? []) {
        if (ps.kind !== live.kind) continue;
        const pid = fns.identity(ps);
        if (pid === srcId || pid === liveId) return i;
        if (fns.identity(fns.layout(ps, items[i])) === liveId) return i;
      }
    }
  } catch { /* fall through */ }
  return -1;
}
