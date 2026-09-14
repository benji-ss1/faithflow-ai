// Pure helpers for the slide-grid copy/paste flow (field fix 5B-2).
//
// The slide clipboard itself lives in slide-clipboard.ts; these are the small
// decision/positioning primitives the grid uses, extracted so they're unit-
// testable without React or the DOM.

/**
 * Clamp a requested insert position into a valid splice index for an array of
 * `length` slides. A paste "after slide N" passes N+1; "at end" passes length;
 * out-of-range / NaN fail-soft to the end. Mirrors the clamp every other DnD
 * insertion path uses so paste can never drop the slide.
 */
export function pasteInsertIndex(requested: number, length: number): number {
  if (!Number.isFinite(requested)) return length;
  return Math.max(0, Math.min(Math.trunc(requested), length));
}

/**
 * Why "Paste slide" is unavailable, as an honest operator-facing string — or
 * `null` when paste IS allowed. Non-null means the menu item shows disabled with
 * this as its tooltip (never silence): the operator sees WHY, not a missing item.
 *
 *  - no clipboard slide           → nothing to paste yet
 *  - target item isn't an editable song → Bible / media / blank slides have no
 *    editable text store, so paste legitimately can't apply there
 */
export function pasteDisabledReason(hasClipboard: boolean, isEditableSong: boolean): string | null {
  if (!hasClipboard) return "Copy a slide first — right-click any slide and choose “Copy Slide”.";
  if (!isEditableSong) return "Paste works only inside a song — Bible and media items aren’t editable here.";
  return null;
}

/** True iff a copied slide can be pasted into this item. */
export function canPasteSlide(hasClipboard: boolean, isEditableSong: boolean): boolean {
  return pasteDisabledReason(hasClipboard, isEditableSong) === null;
}
