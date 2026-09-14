/**
 * right-rail-visible — the single source of truth for what the right-rail
 * Bible / Songs / Cross-references panels SHOW, and therefore what their
 * icon badges COUNT.
 *
 * This is the exact filter/merge logic that previously lived inline in
 * AIDetectionsPanel's ingest effects (same thresholds, 10-min expiry,
 * mergeBibleRows / mergeSongRows dedupe, MAX_ROWS=8 cap, dismissed set,
 * time-limited failed-lookup set, 5-min / max-3 phrase groups), moved here
 * as pure functions so the badge and the panel can never disagree.
 *
 * The panel rows are an ACCUMULATION over time (a row stays visible for up
 * to 10 min even after it rolls out of `audio.suggestions`), so the Bible /
 * Song helpers are reducer steps: (prevRows, data, opts) → nextRows.
 * `prevRows` defaults to [] for a from-scratch selection.
 *
 * Pure: no React, no Date.now() (callers pass `now`), no I/O.
 */
import type { UnifiedSuggestion, SongSuggestion, PhraseMatch } from "@/components/operator/useAudioStream";

export const MAX_ROWS = 8;
export const EXPIRY_MS = 10 * 60 * 1000; // 10 min
export const INVALID_REF_TTL_MS = 10 * 60 * 1000; // 10 min
export const PHRASE_MATCH_EXPIRY_MS = 5 * 60 * 1000;
export const MAX_PHRASE_GROUPS = 3;

export type BibleRow = {
  key: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  confidence: number;
  ts: number;
  preview?: string;       // first 40 chars of verse text
  invalid?: boolean;      // db lookup returned 0 verses
  isPhraseMatch?: boolean; // fuzzy quote match (✦ badge), not a spoken reference
};

export type SongRow = {
  key: string;             // songId
  songId: string;
  title: string;
  artist: string | null;
  confidence: number;
  ts: number;
  preview?: string;        // first line of first slide
  matchType: "Title" | "Lyric" | "PD";
  source: "playlist" | "local_library" | "public_domain";
};

export type VisibleOpts = {
  threshold: number;
  now: number;
  /** Keys like `bible:John 3:16-16` / `song:<songId>`. */
  dismissed: ReadonlySet<string>;
  /** Bible row key → epoch ms the lookup failed. Entries older than INVALID_REF_TTL_MS are ignored. */
  invalid: ReadonlyMap<string, number>;
};

export function isInvalidRef(invalid: ReadonlyMap<string, number>, key: string, now: number): boolean {
  const at = invalid.get(key);
  if (at === undefined) return false;
  return now - at <= INVALID_REF_TTL_MS;
}

/** Bible dedupe/merge. */
export function mergeBibleRows(prev: BibleRow[], incoming: BibleRow): BibleRow[] {
  const idx = prev.findIndex((r) => r.key === incoming.key);
  if (idx >= 0) {
    if (incoming.confidence >= prev[idx].confidence) {
      const merged = [incoming, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      return merged.slice(0, MAX_ROWS);
    }
    const bumped = { ...prev[idx], ts: incoming.ts };
    return [bumped, ...prev.slice(0, idx), ...prev.slice(idx + 1)].slice(0, MAX_ROWS);
  }
  return [incoming, ...prev].slice(0, MAX_ROWS);
}

/** Song dedupe/merge. */
export function mergeSongRows(prev: SongRow[], incoming: SongRow): SongRow[] {
  const idx = prev.findIndex((r) => r.key === incoming.key);
  if (idx >= 0) {
    if (incoming.confidence >= prev[idx].confidence) {
      const merged = [incoming, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      return merged.slice(0, MAX_ROWS);
    }
    const bumped = { ...prev[idx], ts: incoming.ts };
    return [bumped, ...prev.slice(0, idx), ...prev.slice(idx + 1)].slice(0, MAX_ROWS);
  }
  return [incoming, ...prev].slice(0, MAX_ROWS);
}

/** Canonical Bible key: "Book chapter:vs-ve". */
export function bibleKey(book: string, chapter: number, vs: number, ve: number): string {
  return `${book} ${chapter}:${vs}-${ve}`;
}

/** Raw suggestion → Bible row candidate (null for partial/malformed refs). */
export function bibleRowFromSuggestion(s: UnifiedSuggestion): BibleRow | null {
  if (s.type !== "scripture") return null;
  const { book, chapter, verseStart, verseEnd } = s.ref;
  if (!book || !chapter || chapter <= 0) return null;
  if (!verseStart || verseStart <= 0) return null;
  return {
    key: bibleKey(book, chapter, verseStart, verseEnd),
    book, chapter, verseStart, verseEnd,
    confidence: s.confidence,
    ts: s.ts,
    ...(s.isPhraseMatch ? { isPhraseMatch: true } : {}),
  };
}

/** Server (Fly bridge) song detection → SongRow. `now` stamps the row (was Date.now()). */
export function songRowFromServerSuggestion(s: SongSuggestion, now: number = Date.now()): SongRow | null {
  if (!s.songId) return null;
  return {
    key: s.songId,
    songId: s.songId,
    title: s.title,
    artist: null,
    confidence: s.confidence,
    ts: now,
    preview: s.matchedText ? s.matchedText.slice(0, 60) : undefined,
    matchType: "Title",
    source: "local_library",
  };
}

export function songRowFromSuggestion(s: UnifiedSuggestion): SongRow | null {
  if (s.type !== "song" && s.type !== "lyric") return null;
  const m = s.match;
  if (!m || !m.songId) return null;
  const matchType: SongRow["matchType"] =
    s.type === "lyric" ? "Lyric"
      : m.source === "public_domain" ? "PD"
      : "Title";
  return {
    key: m.songId,
    songId: m.songId,
    title: m.title,
    artist: m.artist ?? null,
    confidence: s.confidence,
    ts: s.ts,
    preview: m.matchedLine ? m.matchedLine.split(/\r?\n/)[0].slice(0, 60) : undefined,
    matchType,
    source: m.source,
  };
}

/**
 * Bible ingest step (was the scripture branch of the panel's suggestions
 * effect + its expiry prune). Returns prev unchanged-identity when nothing
 * changed is NOT guaranteed — callers compare lengths/keys if they care.
 */
export function selectVisibleBibleRows(
  suggestions: readonly UnifiedSuggestion[],
  opts: VisibleOpts,
  prev: BibleRow[] = [],
): BibleRow[] {
  const { threshold, now, dismissed, invalid } = opts;
  let rows = prev;
  for (const s of suggestions) {
    if (s.type !== "scripture") continue;
    if (s.confidence < threshold) continue;
    if (now - s.ts > EXPIRY_MS) continue;
    const row = bibleRowFromSuggestion(s);
    if (!row) continue;
    if (isInvalidRef(invalid, row.key, now)) continue;
    if (dismissed.has(`bible:${row.key}`)) continue;
    rows = mergeBibleRows(rows, row);
  }
  return pruneBibleRows(rows, opts);
}

/** Expiry / invalid / dismissed prune for already-accumulated Bible rows. */
export function pruneBibleRows(rows: BibleRow[], opts: VisibleOpts): BibleRow[] {
  const { now, dismissed, invalid } = opts;
  return rows.filter((r) => now - r.ts < EXPIRY_MS && !isInvalidRef(invalid, r.key, now) && !dismissed.has(`bible:${r.key}`));
}

/**
 * Song ingest step: client-side song/lyric suggestions first, then the
 * server songSuggestions (merged/deduped by songId), then expiry prune.
 * Either source may be omitted (pass []).
 */
export function selectVisibleSongRows(
  data: { suggestions: readonly UnifiedSuggestion[]; songSuggestions: readonly SongSuggestion[] },
  opts: VisibleOpts,
  prev: SongRow[] = [],
): SongRow[] {
  const { threshold, now, dismissed } = opts;
  let rows = prev;
  for (const s of data.suggestions) {
    if (s.type !== "song" && s.type !== "lyric") continue;
    if (s.confidence < threshold) continue;
    if (now - s.ts > EXPIRY_MS) continue;
    const row = songRowFromSuggestion(s);
    if (!row) continue;
    if (dismissed.has(`song:${row.key}`)) continue;
    rows = mergeSongRows(rows, row);
  }
  for (const s of data.songSuggestions) {
    const row = songRowFromServerSuggestion(s, now);
    if (!row) continue;
    if (row.confidence < threshold) continue;
    if (dismissed.has(`song:${row.key}`)) continue;
    rows = mergeSongRows(rows, row);
  }
  return pruneSongRows(rows, opts);
}

export function pruneSongRows(rows: SongRow[], opts: VisibleOpts): SongRow[] {
  const { now, dismissed } = opts;
  return rows.filter((r) => now - r.ts < EXPIRY_MS && !dismissed.has(`song:${r.key}`));
}

/** Cross-reference groups: newer than 5 min, max 3. */
export function selectVisiblePhraseGroups(phraseMatches: readonly PhraseMatch[] | undefined, opts: { now: number }): PhraseMatch[] {
  return (phraseMatches ?? []).filter((g) => opts.now - g.ts < PHRASE_MATCH_EXPIRY_MS).slice(0, MAX_PHRASE_GROUPS);
}
