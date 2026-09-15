// Allusion v1 — client runtime glue (flag, lazy index, context, emission).
//
// Kept OUT of useAudioStream/ProOperatorShell on purpose: the hook only calls
// `allusionV1Enabled()` and `runAllusionOnFinal(...)`, so merges stay trivial
// and the whole feature can be reverted by flipping one flag.
//
// Flag (DEFAULT ON, read on EVERY call so a change applies live):
//   localStorage "presentflow.pro.allusionV1" = "0"  → OFF
//   env NEXT_PUBLIC_ALLUSION_V1 = "0"                → OFF
// OFF → useAudioStream behaves exactly as before (server phrase_matches rows +
// curated topPhraseForSpeech chips). ON → this matcher replaces both.
//
// SAFETY (CLAUDE.md rule 7): every emission is a SUGGESTION — confidence ≤74,
// isPhraseMatch:true, so the shell's auto-fire selectors (`!s.isPhraseMatch`)
// can never project it. Click loads, Shift+click sends live, as for any chip.

import type { PhraseMatch, UnifiedSuggestion } from "@/components/operator/useAudioStream";
import { parseReferences } from "@/lib/bible-parser";
import { parseLiveScriptureRef } from "@/lib/bible-antireplay";
import { cachedLookup } from "@/lib/bible-client-cache";
import { matchLyricFragment, type SongIndex } from "./lyric-fragment";
import {
  loadAllusionIndex, matchAllusion, createAllusionState,
  type AllusionIndex, type AllusionMatch, type AllusionState,
} from "./allusion-matcher";

export const ALLUSION_V1_STORAGE_KEY = "presentflow.pro.allusionV1";
/** Song-lyric overlap (0-100 Dice) at/above which a quote is treated as a lyric. */
export const ALLUSION_LYRIC_ABSTAIN_SCORE = 50;
/** Live text slide matching a library song at/above this → a song is live. */
export const ALLUSION_SONG_LIVE_SCORE = 60;

export function allusionV1Enabled(): boolean {
  if (process.env.NEXT_PUBLIC_ALLUSION_V1 === "0") return false;
  try {
    if (typeof window !== "undefined" && window.localStorage?.getItem(ALLUSION_V1_STORAGE_KEY) === "0") return false;
  } catch { /* storage blocked → default */ }
  return true;
}

export type AllusionEnv = {
  mode?: "auto" | "worship" | "preacher";
  /** Flattened text (+ reference footer) of the slide currently live. */
  liveText?: string;
};

export type AllusionRuntime = {
  state: AllusionState;
  index: AllusionIndex | null;
  loading: boolean;
  passage: { book: string; chapter: number; verse: number; atMs: number } | null;
  bookByLower: Map<string, string> | null;
  songLiveCache: { text: string; songLive: boolean } | null;
};

export function createAllusionRuntime(index: AllusionIndex | null = null): AllusionRuntime {
  return { state: createAllusionState(), index, loading: false, passage: null, bookByLower: null, songLiveCache: null };
}

/** Kick off the lazy index load at idle time; never blocks the caller. */
export function warmAllusionIndex(rt: AllusionRuntime, load: () => Promise<AllusionIndex> = loadAllusionIndex): void {
  if (rt.index || rt.loading) return;
  rt.loading = true;
  const go = () => {
    load().then((ix) => { rt.index = ix; }).catch(() => { /* retry on a later final */ }).finally(() => { rt.loading = false; });
  };
  const w = typeof window !== "undefined" ? (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }) : null;
  if (w?.requestIdleCallback) w.requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 0);
}

function canonicalBook(rt: AllusionRuntime, book: string): string {
  if (!rt.index) return book;
  if (!rt.bookByLower) {
    rt.bookByLower = new Map();
    for (const r of rt.index.refs) if (!rt.bookByLower.has(r.book.toLowerCase())) rt.bookByLower.set(r.book.toLowerCase(), r.book);
  }
  return rt.bookByLower.get(book.toLowerCase().replace(/\s+/g, " ")) ?? book;
}

/** Pure decision step (no React, no network) — unit-tested directly. */
export function decideAllusion(
  rt: AllusionRuntime,
  text: string,
  env: AllusionEnv,
  songIndex: SongIndex | null | undefined,
  nowMs: number,
): AllusionMatch | null {
  if (!rt.index) return null;
  const refs = parseReferences(text);
  const explicit = refs.find((r) => !r.isNavigationCommand && r.needsSemanticFallback === false && r.confidence >= 85);
  if (explicit) rt.passage = { book: canonicalBook(rt, explicit.book), chapter: explicit.chapter, verse: explicit.verseStart || 1, atMs: nowMs };

  const live = parseLiveScriptureRef(env.liveText);
  const liveRef = live ? { book: canonicalBook(rt, live.book), chapter: live.chapter, verse: live.verseStart } : null;
  const passage = liveRef ? { ...liveRef, atMs: nowMs } : rt.passage;

  let songLive = false;
  if (!live && env.liveText && songIndex) {
    if (rt.songLiveCache?.text !== env.liveText) {
      const top = matchLyricFragment(env.liveText, songIndex, { limit: 1 })[0];
      rt.songLiveCache = { text: env.liveText, songLive: !!top && top.score >= ALLUSION_SONG_LIVE_SCORE };
    }
    songLive = rt.songLiveCache.songLive;
  }

  const hit = matchAllusion(rt.index, rt.state, text, {
    nowMs,
    mode: env.mode,
    songLive,
    explicitRefInWindow: refs.length > 0,
    liveRef,
    passage,
  });
  if (!hit) return null;
  // Worship lyrics that quote scripture: if the quoted window is (also) a lyric
  // in this church's loaded song library, it's a song, not preaching — abstain.
  if (songIndex) {
    const lyric = matchLyricFragment(hit.matchedText, songIndex, { limit: 1 })[0];
    if (lyric && lyric.score >= ALLUSION_LYRIC_ABSTAIN_SCORE) return null;
  }
  return hit;
}

type AudioLike = { phraseMatches: PhraseMatch[]; suggestions: UnifiedSuggestion[] };

export function allusionToSuggestion(segmentId: string, hit: AllusionMatch, ts: number): UnifiedSuggestion {
  return {
    id: `al-${segmentId}-${hit.book}-${hit.chapter}-${hit.verse}`,
    type: "scripture", segmentId, ts,
    confidence: Math.min(74, hit.confidence),
    matchedText: hit.matchedText,
    ref: { book: hit.book, chapter: hit.chapter, verseStart: hit.verse, verseEnd: hit.verse },
    isPhraseMatch: true,
  };
}

export function allusionToPhraseGroup(segmentId: string, hit: AllusionMatch, ts: number, verseText = ""): PhraseMatch {
  return {
    segmentId: `al-${segmentId}`,
    matchedText: hit.matchedText,
    candidates: [{ book: hit.book, chapter: hit.chapter, verse: hit.verse, text: verseText, similarity: Math.min(74, hit.confidence) }],
    ts,
  };
}

/** State reducer: add one allusion to both the chips list and the cross-ref rail. */
export function applyAllusionToState<S extends AudioLike>(prev: S, segmentId: string, hit: AllusionMatch, ts: number): S {
  const sug = allusionToSuggestion(segmentId, hit, ts);
  const key = (x: UnifiedSuggestion) => (x.type === "scripture" ? `${x.ref.book} ${x.ref.chapter}:${x.ref.verseStart}-${x.ref.verseEnd}` : "");
  const k = key(sug);
  return {
    ...prev,
    suggestions: [sug, ...prev.suggestions.filter((s) => s.type !== "scripture" || key(s) !== k)],
    phraseMatches: [allusionToPhraseGroup(segmentId, hit, ts), ...prev.phraseMatches].slice(0, 10),
  };
}

/** The ONE call useAudioStream makes per final transcript when the flag is ON. */
export function runAllusionOnFinal<S extends AudioLike>(
  rtRef: { current: AllusionRuntime | null },
  segmentId: string,
  text: string,
  env: AllusionEnv | undefined,
  songIndex: SongIndex | null | undefined,
  setState: (fn: (prev: S) => S) => void,
): void {
  try {
    if (!rtRef.current) rtRef.current = createAllusionRuntime();
    const rt = rtRef.current;
    if (!rt.index) { warmAllusionIndex(rt); return; } // not loaded yet → emit nothing
    const ts = Date.now();
    const hit = decideAllusion(rt, text, env ?? {}, songIndex, ts);
    if (!hit) return;
    setState((prev) => applyAllusionToState(prev, segmentId, hit, ts));
    // Fill the rail row's verse text (same cached lookup the hover preview uses).
    void cachedLookup({ book: hit.book, chapter: hit.chapter, verseStart: hit.verse, verseEnd: hit.verse, translationCode: "KJV", source: "ai" })
      .then((res) => {
        const vt = (res.verses ?? []).map((v) => v.text).join(" ").replace(/\s+/g, " ").trim();
        if (!vt) return;
        const gid = `al-${segmentId}`;
        setState((prev) => ({
          ...prev,
          phraseMatches: prev.phraseMatches.map((g) => (g.segmentId === gid ? { ...g, candidates: g.candidates.map((c) => ({ ...c, text: vt })) } : g)),
        }));
      })
      .catch(() => { /* row still shows the reference; hover preview fetches on demand */ });
  } catch (e) {
    console.warn("[allusion-v1] skipped", e);
  }
}
