/**
 * Remembers the operator's last text selection inside a slide text box.
 *
 * WHY THIS EXISTS: the formatting buttons live in the properties panel, outside
 * the `contentEditable` box. Clicking one blurs the box and the browser throws
 * the selection away — so by the time the handler runs there is nothing to
 * apply the formatting to. Every rich-text editor solves this the same way:
 * remember the last selection while it is still live, and use that.
 *
 * Deliberately a tiny module-level store rather than context: it is transient
 * UI state that must survive a blur, it is never persisted, and threading it
 * through props would touch several components for no benefit.
 */
export type TextSelection = { objectId: string; start: number; end: number };

let current: TextSelection | null = null;
const listeners = new Set<() => void>();

export function setTextSelection(sel: TextSelection | null): void {
  // Ignore empty selections — a caret is not a range, and clearing on every
  // click would defeat the whole point of remembering it.
  if (sel && sel.end <= sel.start) return;
  current = sel;
  listeners.forEach((l) => l());
}

export function getTextSelection(): TextSelection | null {
  return current;
}

/** The selection, but only if it belongs to this object. */
export function selectionFor(objectId: string | undefined): TextSelection | null {
  if (!objectId || !current || current.objectId !== objectId) return null;
  return current;
}

export function subscribeTextSelection(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function clearTextSelection(): void {
  current = null;
  listeners.forEach((l) => l());
}

/**
 * Character offsets of the current DOM selection within `el`, or null.
 *
 * Uses a Range clone rather than anchorOffset so it is correct when the
 * contentEditable contains several child nodes — which it does as soon as a
 * formatting run has been applied and the text renders as spans.
 */
export function selectionOffsetsWithin(el: HTMLElement): { start: number; end: number } | null {
  try {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const end = start + range.toString().length;
    if (end <= start) return null;
    return { start, end };
  } catch { return null; }
}
