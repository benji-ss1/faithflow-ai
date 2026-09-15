"use client";
/**
 * useRightRailDetections — owns the right-rail detection rows + the
 * dismissed / failed-lookup sets at the always-mounted RightIconBar level,
 * so (a) the icon badges count EXACTLY the rows the popover shows,
 * (b) dismissals / failed lookups survive closing the popover, and
 * (c) invalid refs (lookup returns 0 verses) are dropped even while closed.
 *
 * Filter/merge logic: pure helpers in src/lib/right-rail-visible.ts.
 * Reads audio state only — never mutates suggestions / songSuggestions /
 * phraseMatches or any auto-fire path.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnifiedSuggestion, SongSuggestion, PhraseMatch } from "../../useAudioStream";
import { cachedLookup } from "@/lib/bible-client-cache";
import { isInternalEvent } from "@/lib/internal-events";
import {
  selectVisibleBibleRows, selectVisibleSongRows, selectVisiblePhraseGroups,
  pruneBibleRows, pruneSongRows, pruneInvalid,
  type BibleRow, type SongRow, type VisibleOpts,
} from "@/lib/right-rail-visible";

export type RightRailDetections = {
  bibleRows: BibleRow[];
  songRows: SongRow[];
  phraseGroups: PhraseMatch[];
  /** Bible row key → first 40 chars of verse text (display only). */
  previews: ReadonlyMap<string, string>;
  nowTick: number;
  dismiss: (kind: "bible" | "song", key: string) => void;
  markInvalid: (key: string) => void;
  clearAll: () => void;
};

export const RIGHT_RAIL_CLEAR_EVENT = "presentflow:right-rail-clear";
const TICK_MS = 15_000;

export function useRightRailDetections(audio: {
  suggestions: UnifiedSuggestion[];
  songSuggestions: SongSuggestion[];
  phraseMatches?: PhraseMatch[];
}, threshold: number, extra: { planId?: string; translationCode: string }): RightRailDetections {
  const [bibleRowsState, setBibleRows] = useState<BibleRow[]>([]);
  const [songRowsState, setSongRows] = useState<SongRow[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [invalid, setInvalid] = useState<Map<string, number>>(() => new Map());
  const [clearedAt, setClearedAt] = useState(-Infinity);
  const [previews, setPreviews] = useState<Map<string, string>>(() => new Map());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const serverFirstSeenRef = useRef<Map<string, number>>(new Map());
  const lookupRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), TICK_MS);
    return () => clearInterval(iv);
  }, []);

  const opts = (now: number): VisibleOpts => ({ threshold, now, dismissed, invalid, clearedAt, serverFirstSeen: serverFirstSeenRef.current });

  useEffect(() => {
    const o = opts(Date.now());
    setBibleRows((prev) => selectVisibleBibleRows(audio.suggestions, o, prev));
    setSongRows((prev) => selectVisibleSongRows({ suggestions: audio.suggestions, songSuggestions: [] }, o, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.suggestions, threshold, dismissed, invalid, clearedAt]);

  useEffect(() => {
    const o = opts(Date.now());
    setSongRows((prev) => selectVisibleSongRows({ suggestions: [], songSuggestions: audio.songSuggestions }, o, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.songSuggestions, threshold, dismissed, clearedAt]);

  useEffect(() => {
    const o = opts(nowTick);
    setBibleRows((prev) => pruneBibleRows(prev, o));
    setSongRows((prev) => pruneSongRows(prev, o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick]);

  const o = { threshold, now: nowTick, dismissed, invalid, clearedAt };
  const bibleRows = useMemo(() => pruneBibleRows(bibleRowsState, o), [bibleRowsState, nowTick, dismissed, invalid, threshold, clearedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const songRows = useMemo(() => pruneSongRows(songRowsState, o), [songRowsState, nowTick, dismissed, threshold, clearedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const phraseGroups = useMemo(() => selectVisiblePhraseGroups(audio.phraseMatches, { now: nowTick, clearedAt }), [audio.phraseMatches, nowTick, clearedAt]);

  const dismiss = useCallback((kind: "bible" | "song", key: string) => {
    setDismissed((prev) => new Set(prev).add(`${kind}:${key}`));
    if (kind === "bible") setBibleRows((prev) => prev.filter((r) => r.key !== key));
    else setSongRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const markInvalid = useCallback((key: string) => {
    const now = Date.now();
    setInvalid((prev) => pruneInvalid(prev, now).set(key, now));
    setBibleRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const clearAll = useCallback(() => {
    // setClearedAt uses the clock at click; items with ts <= it stay hidden.
    const now = Date.now();
    setClearedAt(now);
    setNowTick(now);
    setBibleRows([]);
    setSongRows([]);
  }, []);

  // Verse validation lookup (moved from the panel): runs while the popover is
  // closed. Same cachedLookup, one fetch per key, invalid TTL via markInvalid.
  const translationCode = extra.translationCode;
  useEffect(() => {
    for (const row of bibleRows) {
      if (lookupRef.current.has(row.key)) continue;
      lookupRef.current.add(row.key);
      (async () => {
        try {
          const res = await cachedLookup({
            book: row.book, chapter: row.chapter,
            verseStart: row.verseStart, verseEnd: row.verseEnd,
            translationCode,
          });
          if (!res.verses || res.verses.length === 0) { markInvalid(row.key); return; }
          const preview = res.verses[0]?.text?.slice(0, 40) ?? "";
          if (!preview) return; // shape drift — skip rather than render empty
          setPreviews((prev) => new Map(prev).set(row.key, preview));
        } catch { /* leave without preview */ }
      })();
    }
  }, [bibleRows, translationCode, markInvalid]);

  // Chips-bar "Clear" (ProOperatorShell) → reset the rail too.
  useEffect(() => {
    const onClear = (e: Event) => { if (isInternalEvent(e)) clearAll(); };
    window.addEventListener(RIGHT_RAIL_CLEAR_EVENT, onClear);
    return () => window.removeEventListener(RIGHT_RAIL_CLEAR_EVENT, onClear);
  }, [clearAll]);

  // Plan change → same reset.
  const planRef = useRef(extra.planId);
  useEffect(() => {
    if (planRef.current === extra.planId) return;
    planRef.current = extra.planId;
    clearAll();
  }, [extra.planId, clearAll]);

  return { bibleRows, songRows, phraseGroups, previews, nowTick, dismiss, markInvalid, clearAll };
}
