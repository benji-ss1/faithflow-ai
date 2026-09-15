"use client";
/**
 * Shared lyric-search index for the operator console.
 *
 * OperatorConsole already loads /api/songs/library (church-scoped, all songs +
 * slide lyrics) for the detector; it publishes that array here so the Songs
 * search bar and Cmd+K reuse it instead of a second fetch. If nothing has been
 * published, the first search fetches /api/songs/library once.
 *
 * PERF: the index is NEVER built inside render. After a library is published it
 * is built during idle time in 500-slide chunks (requestIdleCallback, setTimeout
 * fallback), yielding between chunks so no single task blocks audio detection,
 * auto-advance or projection. Until ready, lyric search returns [] with
 * `indexing: true` (title search is unaffected). Read-only: never feeds the detector.
 */
import { useEffect, useMemo, useState } from "react";
import {
  createSongLyricIndexBuilder,
  searchSongLyrics,
  type LyricLibrarySong,
  type SongLyricHit,
  type SongLyricIndex,
} from "./song-lyric-search";

// ~2k slides measured ~65ms/step and 1k ~30-60ms on an M-series Mac under load
// (50ms long-task budget, low-end PCs are 2-3x slower); 500 keeps chunks small.
const BATCH_SLIDES = 500;
const DEBOUNCE_MS = 150;

let library: LyricLibrarySong[] | null = null;
let index: SongLyricIndex | null = null;
let buildToken = 0;
let building = false;
let fetching = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

type IdleHandle = { cancel: () => void };
function whenIdle(fn: () => void): IdleHandle {
  const w = typeof window !== "undefined" ? (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }) : null;
  if (w?.requestIdleCallback) {
    const h = w.requestIdleCallback(fn, { timeout: 1000 });
    return { cancel: () => w.cancelIdleCallback?.(h) };
  }
  const h = setTimeout(fn, 16);
  return { cancel: () => clearTimeout(h) };
}

function scheduleBuild(): void {
  if (!library) return;
  const token = ++buildToken;
  const builder = createSongLyricIndexBuilder(library, BATCH_SLIDES);
  building = true;
  notify();
  const tick = () => {
    if (token !== buildToken) return; // superseded by a newer library
    let finished = false;
    try { finished = builder.step(); } catch { building = false; notify(); return; }
    if (finished) {
      index = builder.index;
      building = false;
      notify();
    } else {
      whenIdle(tick); // yield to the main thread between chunks
    }
  };
  whenIdle(tick);
}

export function publishSongLibrary(next: LyricLibrarySong[]): void {
  library = Array.isArray(next) ? next : [];
  // Keep serving the previous index while the new one builds in the background.
  scheduleBuild();
}

// A failed fallback fetch must not leave "Indexing lyrics…" up forever: it is
// recorded, excluded from `indexing`, and retried at most once per window.
const FETCH_RETRY_MS = 30_000;
let fetchFailedAt: number | null = null;

type LibraryFetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Fallback fetch of /api/songs/library (only when nothing was published). Exported for tests. */
export function requestSongLibrary(
  fetcher: LibraryFetcher = (u) => fetch(u),
  now: number = Date.now(),
): Promise<void> {
  if (library || fetching) return Promise.resolve();
  if (fetchFailedAt !== null && now - fetchFailedAt < FETCH_RETRY_MS) return Promise.resolve();
  fetching = true;
  notify();
  return fetcher("/api/songs/library")
    .then((r) => (r.ok ? r.json() : null))
    .then((res) => {
      const songs = (res as { songs?: unknown } | null)?.songs;
      if (Array.isArray(songs)) {
        fetchFailedAt = null;
        if (!library) publishSongLibrary(songs as LyricLibrarySong[]);
      } else {
        fetchFailedAt = now; // non-OK or malformed
      }
    })
    .catch(() => { fetchFailedAt = now; /* non-fatal: lyric search just stays empty */ })
    .finally(() => { fetching = false; notify(); });
}

function ensureLibrary(): void {
  if (typeof window === "undefined") return;
  void requestSongLibrary();
}

/** Indexing hint: only while a library is actually loading/building — never after a failed fetch. */
function isIndexing(): boolean {
  if (index) return false;
  if (building || fetching) return true;
  return !library && fetchFailedAt === null;
}

/** Test-only view of the store. */
export function __lyricStoreStatus(): { indexing: boolean; ready: boolean; fetchFailed: boolean } {
  return { indexing: isIndexing(), ready: !!index, fetchFailed: fetchFailedAt !== null };
}
/** Test-only: lyric hits against the current index (no debounce). */
export function __lyricStoreSearch(query: string, limit = 20): SongLyricHit[] {
  return index ? searchSongLyrics(index, query, limit) : [];
}

export type LyricSearchState = { hits: SongLyricHit[]; indexing: boolean };

/**
 * Debounced lyric search. Inert (no fetch) until `enabled` && query non-empty.
 * Returns `indexing: true` while the index is still being built.
 */
export function useSongLyricSearch(query: string, enabled: boolean, limit = 20): LyricSearchState {
  const [, setVer] = useState(0);
  useEffect(() => {
    const l = () => setVer((v) => v + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  const active = enabled && query.trim().length > 0;
  const [debounced, setDebounced] = useState(active ? query : "");
  useEffect(() => {
    if (!active) { setDebounced(""); return; }
    const h = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query, active]);
  useEffect(() => { if (active) ensureLibrary(); }, [active]);

  const idx = index;
  const hits = useMemo(() => {
    if (!active || !debounced || !idx) return [];
    try { return searchSongLyrics(idx, debounced, limit); } catch { return []; }
  }, [active, debounced, limit, idx]);
  return { hits, indexing: active && isIndexing() };
}
