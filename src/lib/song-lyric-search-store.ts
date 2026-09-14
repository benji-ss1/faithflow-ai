"use client";
/**
 * Shared, lazily-built lyric-search index for the operator console.
 *
 * OperatorConsole already loads /api/songs/library (church-scoped, all songs +
 * slide lyrics) for the detector; it publishes that array here so the Songs
 * search bar and Cmd+K reuse it instead of a second fetch. If nothing has been
 * published (e.g. a surface outside OperatorConsole), the first search fetches
 * /api/songs/library once. The MiniSearch index is built on first use (first
 * keystroke), never at render, and rebuilt only when the published library
 * changes. Read-only: never feeds the AI detector.
 */
import { useEffect, useMemo, useState } from "react";
import { buildSongLyricIndex, searchSongLyrics, type LyricLibrarySong, type SongLyricHit, type SongLyricIndex } from "./song-lyric-search";

let library: LyricLibrarySong[] | null = null;
let version = 0;
let index: SongLyricIndex | null = null;
let indexVersion = -1;
let fetching: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function publishSongLibrary(next: LyricLibrarySong[]): void {
  library = Array.isArray(next) ? next : [];
  version++;
  listeners.forEach((l) => l());
}

function ensureLibrary(): void {
  if (library || fetching || typeof window === "undefined") return;
  fetching = fetch("/api/songs/library")
    .then((r) => (r.ok ? r.json() : null))
    .then((res) => {
      if (!library && res && Array.isArray(res.songs)) publishSongLibrary(res.songs as LyricLibrarySong[]);
    })
    .catch(() => { /* non-fatal: lyric search just stays empty */ })
    .finally(() => { fetching = null; });
}

function getIndex(): SongLyricIndex | null {
  if (!library) return null;
  if (!index || indexVersion !== version) {
    index = buildSongLyricIndex(library);
    indexVersion = version;
  }
  return index;
}

/** Lyric hits for `query`; inert (no fetch, no build) until `enabled` && query non-empty. */
export function useSongLyricSearch(query: string, enabled: boolean, limit = 20): SongLyricHit[] {
  const [ver, setVer] = useState(version);
  useEffect(() => {
    const l = () => setVer(version);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const active = enabled && query.trim().length > 0;
  useEffect(() => { if (active) ensureLibrary(); }, [active]);
  return useMemo(() => {
    if (!active) return [];
    try { return searchSongLyrics(getIndex(), query, limit); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, query, limit, ver]);
}
