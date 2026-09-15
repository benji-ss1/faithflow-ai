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
  matchAllusion, createAllusionState, decodeAllusionIndexChunked,
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
  /** Church/session Bible translation for the rail verse text (KJV fallback). */
  translationCode?: string;
};

/** Max suggestions kept in audio state (mirrors useAudioStream's cap). */
export const ALLUSION_SUGGESTIONS_CAP = 40;
/** At most one failed index-load retry per this window. */
export const ALLUSION_LOAD_RETRY_MS = 60_000;

export type AllusionRuntime = {
  state: AllusionState;
  index: AllusionIndex | null;
  loading: boolean;
  passage: { book: string; chapter: number; verse: number; atMs: number } | null;
  bookByLower: Map<string, string> | null;
  songLiveCache: { text: string; songLive: boolean } | null;
  lastFailAt: number;
};

export function createAllusionRuntime(index: AllusionIndex | null = null): AllusionRuntime {
  return { state: createAllusionState(), index, loading: false, passage: null, bookByLower: null, songLiveCache: null, lastFailAt: 0 };
}

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
function onIdle(cb: () => void): void {
  const w = typeof window !== "undefined" ? (window as IdleWindow) : null;
  if (w?.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 3000 });
  else setTimeout(cb, 0);
}
const idleYield = () => new Promise<void>((r) => onIdle(r));

/** Default loader: lazy chunk import, then decode one array per idle slice. */
export async function loadAllusionIndexIdle(): Promise<AllusionIndex> {
  const m = await import("@/data/allusion-index.generated.json");
  const json = ((m as { default?: unknown }).default ?? m) as Parameters<typeof decodeAllusionIndexChunked>[0];
  return decodeAllusionIndexChunked(json, idleYield);
}

/** Shared runtime so the console can warm it before the first final transcript. */
const shared: { current: AllusionRuntime | null } = { current: null };
export function sharedAllusionRuntime(): { current: AllusionRuntime | null } {
  if (!shared.current) shared.current = createAllusionRuntime();
  return shared;
}

/** Kick off the lazy index load at idle time; never blocks the caller.
 *  Failed loads retry at most once per ALLUSION_LOAD_RETRY_MS. After load, one
 *  warm-up match runs inside an idle callback (JIT + lazy tables). */
export function warmAllusionIndex(
  rt: AllusionRuntime,
  load: () => Promise<AllusionIndex> = loadAllusionIndexIdle,
  nowMs: number = Date.now(),
): void {
  if (rt.index || rt.loading) return;
  if (rt.lastFailAt && nowMs - rt.lastFailAt < ALLUSION_LOAD_RETRY_MS) return;
  rt.loading = true;
  onIdle(() => {
    load()
      .then((ix) => {
        rt.index = ix;
        onIdle(() => {
          try { matchAllusion(ix, createAllusionState(), "surely goodness and mercy shall follow me", { nowMs: 0 }); } catch { /* warm-up only */ }
        });
      })
      .catch(() => { rt.lastFailAt = Date.now(); })
      .finally(() => { rt.loading = false; });
  });
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

/** State reducer: add one allusion to both the chips list and the cross-ref rail.
 *  - never replaces an explicit (non-phrase) suggestion for the same verse;
 *  - one rail group per verse (a repeat quote refreshes it, keeping its text);
 *  - suggestions trimmed to ALLUSION_SUGGESTIONS_CAP. */
export function applyAllusionToState<S extends AudioLike>(prev: S, segmentId: string, hit: AllusionMatch, ts: number): S {
  const sug = allusionToSuggestion(segmentId, hit, ts);
  const key = (x: UnifiedSuggestion) => (x.type === "scripture" ? `${x.ref.book} ${x.ref.chapter}:${x.ref.verseStart}-${x.ref.verseEnd}` : "");
  const k = key(sug);
  const hasExplicit = prev.suggestions.some((s) => s.type === "scripture" && !s.isPhraseMatch && key(s) === k);
  const suggestions = hasExplicit
    ? prev.suggestions
    : [sug, ...prev.suggestions.filter((s) => !(s.type === "scripture" && s.isPhraseMatch && key(s) === k))].slice(0, ALLUSION_SUGGESTIONS_CAP);
  const sameVerse = (g: PhraseMatch) =>
    g.segmentId.startsWith("al-") && g.candidates.length === 1 &&
    g.candidates[0].book === hit.book && g.candidates[0].chapter === hit.chapter && g.candidates[0].verse === hit.verse;
  const old = prev.phraseMatches.find(sameVerse);
  const group = allusionToPhraseGroup(segmentId, hit, ts, old?.candidates[0]?.text ?? "");
  return {
    ...prev,
    suggestions,
    phraseMatches: [group, ...prev.phraseMatches.filter((g) => !sameVerse(g))].slice(0, 10),
  };
}

async function lookupVerseText(hit: AllusionMatch, code: string): Promise<string> {
  const res = await cachedLookup({ book: hit.book, chapter: hit.chapter, verseStart: hit.verse, verseEnd: hit.verse, translationCode: code, source: "ai" });
  return (res.verses ?? []).map((v) => v.text).join(" ").replace(/\s+/g, " ").trim();
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
    if (!rt.index) { warmAllusionIndex(rt); return; } // not loaded yet → emit nothing (load is idle, retry-limited)
    const ts = Date.now();
    const hit = decideAllusion(rt, text, env ?? {}, songIndex, ts);
    if (!hit) return;
    setState((prev) => applyAllusionToState(prev, segmentId, hit, ts));
    // Fill the rail row's verse text (same cached lookup the hover preview uses).
    const code = env?.translationCode || "KJV";
    void lookupVerseText(hit, code)
      .catch(() => (code !== "KJV" ? lookupVerseText(hit, "KJV") : ""))
      .then((vt) => {
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
