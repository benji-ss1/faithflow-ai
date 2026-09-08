// Cross-panel bridge for OS-file-drop → media import (Wave 3, item 4c).
//
// A drop of Finder/Explorer files onto a Library row in the LEFT rail must open
// the EXISTING MediaImportWizard (which lives in the center MediaBrowser) with
// those files queued and the dropped library preselected. Files can't ride a
// URL, so we stash them in this in-memory singleton, switch the center to the
// media browser, and fire an event. MediaBrowser consumes the pending import on
// mount AND on the event (covers both "already mounted" and "just mounted").

export type PendingImport = { files: File[]; libraryId: string | null };

const EVENT = "presentflow:os-drop-import";
let pending: PendingImport | null = null;

/** Queue an OS-file-drop import and notify any mounted MediaBrowser. */
export function requestOsDropImport(req: PendingImport): void {
  pending = req;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

/** Consume (and clear) a pending import, if any. */
export function takePendingImport(): PendingImport | null {
  const p = pending;
  pending = null;
  return p;
}

/** Subscribe to import requests. Returns an unsubscribe fn. */
export function onOsDropImport(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
