/**
 * Right-rail detection badges: badge count === rows the panel renders.
 * Run: npx tsx --test test/right-rail-badges.test.ts
 *
 * The badge (RightIconBar) and panel (AIDetectionsPanel) both read the rows
 * produced by the pure helpers in src/lib/right-rail-visible.ts via
 * useRightRailDetections. These tests replay the hook's effect sequence
 * (ingest → server-song ingest → tick prune → render prune) headlessly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectVisibleBibleRows, selectVisibleSongRows, selectVisiblePhraseGroups,
  pruneBibleRows, pruneSongRows, EXPIRY_MS, INVALID_REF_TTL_MS, MAX_ROWS,
  type BibleRow, type SongRow, type VisibleOpts,
} from "../src/lib/right-rail-visible";
import type { UnifiedSuggestion, SongSuggestion, PhraseMatch } from "../src/components/operator/useAudioStream";

const T0 = 1_800_000_000_000;
const opts = (o: Partial<VisibleOpts> = {}): VisibleOpts => ({
  threshold: 50, now: T0, dismissed: new Set(), invalid: new Map(), ...o,
});

let n = 0;
function verse(book: string, ch: number, v: number, confidence = 80, ts = T0): UnifiedSuggestion {
  return { id: `s${n++}`, type: "scripture", segmentId: "seg", ts, confidence, matchedText: "", ref: { book, chapter: ch, verseStart: v, verseEnd: v } };
}
function song(songId: string | null, confidence = 80, ts = T0, type: "song" | "lyric" = "lyric"): UnifiedSuggestion {
  return { id: `s${n++}`, type, segmentId: "seg", ts, confidence, matchedText: "",
    match: { songId, title: `T-${songId}`, artist: null, source: "local_library", matchedLine: "line" } as never } as UnifiedSuggestion;
}
function server(songId: string | null, confidence = 80): SongSuggestion {
  return { suggestionId: `x${n++}`, segmentId: "seg", songId, title: `T-${songId}`, confidence, matchedText: "m" };
}

// Reference implementation = the panel's ORIGINAL inline logic (pre-refactor),
// used to prove the helpers are behaviour-identical.
function legacyPanel(sugs: UnifiedSuggestion[], srv: SongSuggestion[], o: VisibleOpts) {
  let bible: BibleRow[] = [];
  let songs: SongRow[] = [];
  const merge = <R extends { key: string; confidence: number; ts: number }>(prev: R[], inc: R): R[] => {
    const idx = prev.findIndex((r) => r.key === inc.key);
    if (idx >= 0) {
      if (inc.confidence >= prev[idx].confidence) return [inc, ...prev.slice(0, idx), ...prev.slice(idx + 1)].slice(0, 8);
      return [{ ...prev[idx], ts: inc.ts }, ...prev.slice(0, idx), ...prev.slice(idx + 1)].slice(0, 8);
    }
    return [inc, ...prev].slice(0, 8);
  };
  const inv = (k: string) => { const at = o.invalid.get(k); return at !== undefined && !(o.now - at > 600000); };
  for (const s of sugs) {
    if (s.confidence < o.threshold) continue;
    if (o.now - s.ts > 600000) continue;
    if (s.type === "scripture") {
      const { book, chapter, verseStart, verseEnd } = s.ref;
      if (!book || !chapter || chapter <= 0 || !verseStart || verseStart <= 0) continue;
      const key = `${book} ${chapter}:${verseStart}-${verseEnd}`;
      if (inv(key) || o.dismissed.has(`bible:${key}`)) continue;
      bible = merge(bible, { key, book, chapter, verseStart, verseEnd, confidence: s.confidence, ts: s.ts });
    } else if (s.type === "song" || s.type === "lyric") {
      if (!s.match?.songId) continue;
      const key = s.match.songId;
      if (o.dismissed.has(`song:${key}`)) continue;
      songs = merge(songs, { key, confidence: s.confidence, ts: s.ts } as SongRow);
    }
  }
  bible = bible.filter((r) => o.now - r.ts < 600000 && !inv(r.key));
  songs = songs.filter((r) => o.now - r.ts < 600000);
  for (const s of srv) {
    if (!s.songId || s.confidence < o.threshold || o.dismissed.has(`song:${s.songId}`)) continue;
    songs = merge(songs, { key: s.songId, confidence: s.confidence, ts: o.now } as SongRow);
  }
  songs = songs.filter((r) => o.now - r.ts < 600000);
  return { bible, songs };
}

// Hook replay: exactly what useRightRailDetections does.
function hook(sugs: UnifiedSuggestion[], srv: SongSuggestion[], o: VisibleOpts, prev = { bible: [] as BibleRow[], songs: [] as SongRow[] }) {
  let bible = selectVisibleBibleRows(sugs, o, prev.bible);
  let songs = selectVisibleSongRows({ suggestions: sugs, songSuggestions: [] }, o, prev.songs);
  songs = selectVisibleSongRows({ suggestions: [], songSuggestions: srv }, o, songs);
  bible = pruneBibleRows(bible, o);
  songs = pruneSongRows(songs, o);
  return { bible, songs };
}

function rng(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31); }

test("randomized parity: badge counts === panel rows (vs legacy logic)", () => {
  const r = rng(42);
  const books = ["John", "Genesis", "Psalms", "Romans"];
  for (let i = 0; i < 500; i++) {
    const sugs: UnifiedSuggestion[] = [];
    const count = Math.floor(r() * 40);
    for (let j = 0; j < count; j++) {
      const ts = T0 - Math.floor(r() * 15 * 60_000);
      const conf = Math.floor(r() * 100);
      if (r() < 0.6) sugs.push(verse(books[Math.floor(r() * 4)], Math.floor(r() * 4), Math.floor(r() * 5), conf, ts));
      else sugs.push(song(r() < 0.15 ? null : `song${Math.floor(r() * 12)}`, conf, ts));
    }
    const srv = Array.from({ length: Math.floor(r() * 10) }, () => server(r() < 0.2 ? null : `song${Math.floor(r() * 12)}`, Math.floor(r() * 100)));
    const dismissed = new Set<string>(r() < 0.5 ? ["bible:John 1:1-1", "song:song3"] : []);
    const invalid = new Map<string, number>(r() < 0.5 ? [["Genesis 2:2-2", T0 - Math.floor(r() * 20 * 60_000)]] : []);
    const o = opts({ threshold: Math.floor(r() * 90), dismissed, invalid });
    const legacy = legacyPanel(sugs, srv, o);
    const got = hook(sugs, srv, o);
    assert.deepEqual(got.bible.map((x) => x.key), legacy.bible.map((x) => x.key), `bible iter ${i}`);
    assert.deepEqual(got.songs.map((x) => x.key), legacy.songs.map((x) => x.key), `songs iter ${i}`);
    assert.ok(got.bible.length <= MAX_ROWS && got.songs.length <= MAX_ROWS);
  }
});

test("below threshold → 0", () => {
  const h = hook([verse("John", 3, 16, 40), song("a", 30)], [server("b", 20)], opts({ threshold: 50 }));
  assert.equal(h.bible.length, 0);
  assert.equal(h.songs.length, 0);
});

test("expired suggestions → 0", () => {
  const old = T0 - EXPIRY_MS - 1;
  const h = hook([verse("John", 3, 16, 90, old), song("a", 90, old)], [], opts());
  assert.equal(h.bible.length + h.songs.length, 0);
});

test("same verse 5x → 1", () => {
  const sugs = [1, 2, 3, 4, 5].map((i) => verse("John", 3, 16, 70 + i, T0 - i * 1000));
  assert.equal(hook(sugs, [], opts()).bible.length, 1);
});

test("dismissed excluded and persists after popover close (store-level)", () => {
  const sugs = [verse("John", 3, 16), song("a")];
  const dismissed = new Set(["bible:John 3:16-16", "song:a"]);
  // "close" = panel unmount; the sets live in the RightIconBar store, so a
  // re-ingest (re-open, or new suggestions arriving) still excludes them.
  const first = hook(sugs, [server("a")], opts({ dismissed }));
  assert.equal(first.bible.length + first.songs.length, 0);
  const reopened = hook([...sugs, verse("John", 3, 16, 99)], [server("a", 99)], opts({ dismissed, now: T0 + 60_000 }), first);
  assert.equal(reopened.bible.length + reopened.songs.length, 0);
  // Previously-accumulated rows are pruned once dismissed.
  const acc = hook(sugs, [], opts());
  assert.equal(pruneBibleRows(acc.bible, opts({ dismissed })).length, 0);
});

test("failed lookup excluded, counted again after 10 min", () => {
  const key = "John 99:99-99";
  const invalid = new Map([[key, T0]]);
  assert.equal(hook([verse("John", 99, 99, 90, T0)], [], opts({ invalid })).bible.length, 0);
  const later = T0 + INVALID_REF_TTL_MS + 1;
  assert.equal(hook([verse("John", 99, 99, 90, later)], [], opts({ invalid, now: later })).bible.length, 1);
});

test("server-only song counted; dual-source song counted once", () => {
  assert.equal(hook([], [server("srv")], opts()).songs.length, 1);
  assert.equal(hook([], [server(null)], opts()).songs.length, 0);
  assert.equal(hook([song("dual")], [server("dual")], opts()).songs.length, 1);
});

test("phrase groups ≤ 3, 5-min expiry, matching panel", () => {
  const groups: PhraseMatch[] = Array.from({ length: 10 }, (_, i) => ({ segmentId: `g${i}`, matchedText: "x", candidates: [], ts: T0 - i * 60_000 }));
  assert.equal(selectVisiblePhraseGroups(groups, { now: T0 }).length, 3);
  const legacy = groups.filter((g) => T0 + 4 * 60_000 - g.ts < 5 * 60_000).slice(0, 3);
  assert.deepEqual(selectVisiblePhraseGroups(groups, { now: T0 + 4 * 60_000 }), legacy);
  assert.equal(selectVisiblePhraseGroups(groups, { now: T0 + 15 * 60_000 }).length, 0);
  assert.equal(selectVisiblePhraseGroups(undefined, { now: T0 }).length, 0);
});

test("advancing the clock past expiry → 0 (tick prune, no new suggestions)", () => {
  const h = hook([verse("John", 3, 16), song("a")], [server("b")], opts());
  assert.equal(h.bible.length, 1);
  assert.equal(h.songs.length, 2);
  const later = opts({ now: T0 + EXPIRY_MS });
  assert.equal(pruneBibleRows(h.bible, later).length, 0);
  assert.equal(pruneSongRows(h.songs, later).length, 0);
});
