/**
 * arrangement-strip — pure helper for the operator centre "arrangement strip"
 * (Groups & Arrangements, wave 6D). Turns the expanded per-slide group-id list
 * into an ordered list of BLOCKS (one chip per block) so the operator can see
 * the arrangement's group sequence and jump to any block's first slide.
 *
 * Two modes:
 *  - PINNED (an arrangement's `order` is given): one block PER order entry, so a
 *    repeated group renders as multiple chips (the whole point of arrangements).
 *    Each order entry consumes that group's slides from the expanded sequence.
 *  - MASTER (order === null): walk the expanded per-slide group ids and coalesce
 *    consecutive equal ids into blocks. Ungrouped (null) slides produce no chip
 *    but still advance the slide cursor so `startSlide` stays accurate.
 *
 * Pure: no React, no DB. `orderIndex` is the position in the arrangement order
 * (null in master mode) — the strip uses it to remove a specific instance.
 */
export type StripBlock = {
  groupId: string;
  startSlide: number; // index into the expanded `slides` array
  slideCount: number;
  orderIndex: number | null; // position in arrangement.order (null = master)
};

/** Count occurrences of `gid` in an id list. */
function countIn(ids: readonly (string | null)[] | readonly string[], gid: string): number {
  let n = 0;
  for (const x of ids) if (x === gid) n++;
  return n;
}

export function computeArrangementBlocks(
  slideGroupIds: readonly (string | null)[],
  order: readonly string[] | null,
): StripBlock[] {
  if (order && order.length > 0) {
    // Per-group slide size: total slides of the group divided by how many times
    // the group repeats in the order (all instances share the same slides).
    const sizeCache = new Map<string, number>();
    const sizeOf = (gid: string): number => {
      const cached = sizeCache.get(gid);
      if (cached !== undefined) return cached;
      const reps = countIn(order, gid);
      const total = countIn(slideGroupIds, gid);
      const size = reps > 0 ? Math.floor(total / reps) : 0;
      sizeCache.set(gid, size);
      return size;
    };
    const out: StripBlock[] = [];
    let cursor = 0;
    order.forEach((gid, i) => {
      const size = sizeOf(gid);
      if (size <= 0) return; // group has no slides (defensive)
      out.push({ groupId: gid, startSlide: cursor, slideCount: size, orderIndex: i });
      cursor += size;
    });
    return out;
  }

  // Master mode: coalesce consecutive equal group ids; skip nulls.
  const out: StripBlock[] = [];
  let i = 0;
  while (i < slideGroupIds.length) {
    const gid = slideGroupIds[i];
    if (gid == null) { i++; continue; }
    const start = i;
    let count = 0;
    while (i < slideGroupIds.length && slideGroupIds[i] === gid) { count++; i++; }
    out.push({ groupId: gid, startSlide: start, slideCount: count, orderIndex: null });
  }
  return out;
}

/** Which block contains a given slide index (or null if none). */
export function blockAtSlide(blocks: readonly StripBlock[], slideIdx: number): number | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (slideIdx >= b.startSlide && slideIdx < b.startSlide + b.slideCount) return i;
  }
  return null;
}
