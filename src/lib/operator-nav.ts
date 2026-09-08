/**
 * operator-nav — pure slide-navigation helpers shared by the operator shells.
 *
 * Extracted so the boundary-walk (which must SKIP header items that carry no
 * slides, slides:[]) is unit-testable independently of React (Y5). A header is a
 * non-content section divider; navigation must step over it, never land on it
 * (which would leave slideIdx pointing at a non-existent slide, or -1 when
 * stepping back into an empty item).
 */
export interface NavPosition { itemIdx: number; slideIdx: number; }
export interface NavItem { slides: readonly unknown[]; }

/**
 * Compute the next preview position when moving `dir` (+1 / -1) from `cur` across
 * a list of items, skipping any item with zero slides. Returns `cur` unchanged
 * when there is nowhere valid to go (both ends, or no navigable slide exists).
 */
export function nextPreviewPosition(items: readonly NavItem[], cur: NavPosition, dir: 1 | -1): NavPosition {
  if (!items[cur.itemIdx]) return cur;
  let itemIdx = cur.itemIdx;
  let slideIdx = cur.slideIdx + dir;
  while (true) {
    const item = items[itemIdx];
    if (!item) return cur;
    if (slideIdx < 0) {
      if (itemIdx === 0) return cur;
      itemIdx -= 1;
      slideIdx = items[itemIdx].slides.length - 1; // -1 when empty → loop continues back
    } else if (slideIdx >= item.slides.length) {
      if (itemIdx >= items.length - 1) return cur;
      itemIdx += 1;
      slideIdx = 0;
    } else {
      return { itemIdx, slideIdx };
    }
  }
}
