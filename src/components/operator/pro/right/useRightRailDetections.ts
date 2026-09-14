"use client";
/**
 * useRightRailDetections — owns the right-rail detection rows + the
 * dismissed / failed-lookup sets at the always-mounted RightIconBar level,
 * so (a) the icon badges count EXACTLY the rows the popover shows and
 * (b) dismissals / failed lookups survive closing the popover.
 *
 * The filter/merge logic is the pure helpers in src/lib/right-rail-visible.ts
 * (moved verbatim from AIDetectionsPanel). Reads audio state only — never
 * mutates suggestions / songSuggestions / phraseMatches or any auto-fire path.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UnifiedSuggestion, SongSuggestion, PhraseMatch } from "../../useAudioStream";
import {
  selectVisibleBibleRows, selectVisibleSongRows, selectVisiblePhraseGroups,
  pruneBibleRows, pruneSongRows,
  type BibleRow, type SongRow, type VisibleOpts,
} from "@/lib/right-rail-visible";

export type RightRailDetections = {
  bibleRows: BibleRow[];
  songRows: SongRow[];
  phraseGroups: PhraseMatch[];
  nowTick: number;
  dismiss: (kind: "bible" | "song", key: string) => void;
  markInvalid: (key: string) => void;
};

const TICK_MS = 15_000;

export function useRightRailDetections(audio: {
  suggestions: UnifiedSuggestion[];
  songSuggestions: SongSuggestion[];
  phraseMatches?: PhraseMatch[];
}, threshold: number): RightRailDetections {
  const [bibleRowsState, setBibleRows] = useState<BibleRow[]>([]);
  const [songRowsState, setSongRows] = useState<SongRow[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [invalid, setInvalid] = useState<Map<string, number>>(() => new Map());
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), TICK_MS);
    return () => clearInterval(iv);
  }, []);

  const opts = (now: number): VisibleOpts => ({ threshold, now, dismissed, invalid });

  // Client-side suggestions → Bible + Song rows (was the panel's first ingest effect).
  useEffect(() => {
    const o = opts(Date.now());
    setBibleRows((prev) => selectVisibleBibleRows(audio.suggestions, o, prev));
    setSongRows((prev) => selectVisibleSongRows({ suggestions: audio.suggestions, songSuggestions: [] }, o, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.suggestions, threshold, dismissed, invalid]);

  // Server song detections (was the panel's second ingest effect).
  useEffect(() => {
    const o = opts(Date.now());
    setSongRows((prev) => selectVisibleSongRows({ suggestions: [], songSuggestions: audio.songSuggestions }, o, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.songSuggestions, threshold, dismissed]);

  // Prune on tick.
  useEffect(() => {
    const o = opts(nowTick);
    setBibleRows((prev) => pruneBibleRows(prev, o));
    setSongRows((prev) => pruneSongRows(prev, o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick]);

  // Render-time prune too, so a count can never be stale between ticks/effects.
  const bibleRows = useMemo(() => pruneBibleRows(bibleRowsState, { threshold, now: nowTick, dismissed, invalid }), [bibleRowsState, nowTick, dismissed, invalid, threshold]);
  const songRows = useMemo(() => pruneSongRows(songRowsState, { threshold, now: nowTick, dismissed, invalid }), [songRowsState, nowTick, dismissed, invalid, threshold]);
  const phraseGroups = useMemo(() => selectVisiblePhraseGroups(audio.phraseMatches, { now: nowTick }), [audio.phraseMatches, nowTick]);

  const dismiss = useCallback((kind: "bible" | "song", key: string) => {
    setDismissed((prev) => new Set(prev).add(`${kind}:${key}`));
    if (kind === "bible") setBibleRows((prev) => prev.filter((r) => r.key !== key));
    else setSongRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const markInvalid = useCallback((key: string) => {
    setInvalid((prev) => new Map(prev).set(key, Date.now()));
    setBibleRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  return { bibleRows, songRows, phraseGroups, nowTick, dismiss, markInvalid };
}
