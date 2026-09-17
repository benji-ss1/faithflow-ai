// ProPresenter-style multi-select for the slide grid. PURE (no React/DOM) so the
// click rules are unit-testable.
//   plain click        → clears the multi-selection (normal select/go-live path)
//   cmd/ctrl + click   → toggle that slide in the selection
//   shift + click      → range from the anchor (the previewed slide) to the click
// Returned ids are always in grid order and de-duplicated.
import type { ThemeAppearance, SlideObjectWire } from "./broadcast";

export type SelectMods = { toggle?: boolean; range?: boolean };

export function slideRange(orderedIds: readonly string[], anchorIdx: number, clickedIdx: number): string[] {
  const n = orderedIds.length;
  if (n === 0 || clickedIdx < 0 || clickedIdx >= n) return [];
  const a = anchorIdx >= 0 && anchorIdx < n ? anchorIdx : clickedIdx;
  const lo = Math.min(a, clickedIdx), hi = Math.max(a, clickedIdx);
  return orderedIds.slice(lo, hi + 1).filter((id) => !!id);
}

export function nextSlideSelection(
  prev: readonly string[], orderedIds: readonly string[], clickedIdx: number, anchorIdx: number, mods: SelectMods,
): string[] {
  const clicked = orderedIds[clickedIdx];
  if (!clicked) return [...prev];
  if (mods.range) {
    const range = new Set(slideRange(orderedIds, anchorIdx, clickedIdx));
    // Shift ADDS the range to a cmd-built selection (PP7/Finder behaviour).
    if (mods.toggle) for (const id of prev) range.add(id);
    return orderedIds.filter((id) => range.has(id));
  }
  if (mods.toggle) {
    const set = new Set(prev);
    // First cmd-click with an empty selection also includes the anchor slide,
    // so "select slide 2, cmd-click slide 5" selects both.
    if (set.size === 0 && anchorIdx >= 0 && anchorIdx < orderedIds.length && anchorIdx !== clickedIdx && orderedIds[anchorIdx]) set.add(orderedIds[anchorIdx]!);
    if (set.has(clicked)) set.delete(clicked); else set.add(clicked);
    return orderedIds.filter((id) => set.has(id));
  }
  return [];
}

/** Grid thumbnails never decode theme video: drop video decor objects (same
 *  rule as the Themes popover thumbs). Returns the input when nothing to strip. */
export function stripVideoDecor(a: ThemeAppearance | null | undefined): ThemeAppearance | undefined {
  if (!a) return undefined;
  const l = a.layout;
  if (!l) return a;
  const hasVideo = (d?: SlideObjectWire[]) => !!d?.some((o) => o.kind === "video");
  if (!hasVideo(l.lyrics?.decor) && !hasVideo(l.scripture?.decor)) return a;
  const still = (d?: SlideObjectWire[]) => d?.filter((o) => o.kind !== "video");
  return {
    ...a,
    layout: {
      ...l,
      ...(l.lyrics ? { lyrics: { ...l.lyrics, decor: still(l.lyrics.decor) } } : {}),
      ...(l.scripture ? { scripture: { ...l.scripture, decor: still(l.scripture.decor) } } : {}),
    },
  };
}

/**
 * Esc with a slide multi-selection: clears the selection and SWALLOWS the key so
 * the global Esc = kill-live hotkey never fires (it would blank the projector).
 * With no selection (or typing in a field) returns false and touches nothing, so
 * Esc behaves exactly as before. Registered in the CAPTURE phase on window.
 */
export function consumeSelectionEscape(
  e: { key: string; preventDefault(): void; stopImmediatePropagation(): void },
  selectionCount: number,
  activeEl: { tagName?: string; isContentEditable?: boolean } | null,
  clear: () => void,
  /** A Radix menu/dialog is open: let IT take Esc (closes) and keep the selection. */
  overlayOpen = false,
): boolean {
  if (e.key !== "Escape" || selectionCount === 0 || overlayOpen) return false;
  if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  clear();
  return true;
}
