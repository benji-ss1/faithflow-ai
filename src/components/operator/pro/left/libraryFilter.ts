"use client";
import { useEffect, useState } from "react";

// ProPresenter parity (Phase 3.6) — the currently-selected Library filter,
// shared between the LIBRARY rail section and the center Songs/Media browsers.
// "all" = every library (legacy behaviour); "default" = unfiled content
// (library_id IS NULL); a uuid = that library. Persisted per-session so the
// filter survives a center-mode switch, and broadcast so every consumer stays
// in sync without prop-drilling through the whole shell.

export type LibraryFilter = "all" | "default" | (string & {});

const KEY = "presentflow.pro.selectedLibrary";
const EVENT = "presentflow:library-filter";

export function getSelectedLibrary(): LibraryFilter {
  if (typeof window === "undefined") return "all";
  try { return (window.localStorage.getItem(KEY) as LibraryFilter) || "all"; } catch { return "all"; }
}

export function setSelectedLibrary(value: LibraryFilter) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, value); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent<LibraryFilter>(EVENT, { detail: value }));
}

/** Reactive read of the selected library filter. */
export function useSelectedLibrary(): [LibraryFilter, (v: LibraryFilter) => void] {
  const [value, setValue] = useState<LibraryFilter>("all");
  useEffect(() => {
    setValue(getSelectedLibrary());
    const onChange = (e: Event) => {
      const v = (e as CustomEvent<LibraryFilter>).detail;
      if (typeof v === "string") setValue(v);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return [value, setSelectedLibrary];
}

/** Convert a filter to the `?library=` query value (undefined = omit param). */
export function libraryQueryParam(filter: LibraryFilter): string | undefined {
  return filter === "all" ? undefined : filter;
}
