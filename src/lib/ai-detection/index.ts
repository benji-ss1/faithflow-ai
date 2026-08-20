// Unified detection engine for the operator console (Phase 5A).
//
// Every detector here operates on a transcript chunk plus a small
// context object. No detector fetches anything from the open web.
// Song / lyric matching is delegated to song-match.ts which enforces
// the local + licensed rule.

import { parseReferences, type ParsedReference } from "@/lib/bible-parser";
import { parseContextCommand, type ContextCommand } from "@/lib/context-parser";
import { detectSongCues, type SongCue } from "./song-cue";
import { detectSectionCommand, type SectionCommand } from "./section-command";
import { matchSongCue, type SongMatchResult, type MatchContext } from "./song-match";
import { detectSongInTranscript, resetSongDedupe } from "./song-detection";
export { resetSongDedupe };
import type { IndexedSong, SongIndex } from "./lyric-fragment";
import { topPhraseForSpeech } from "@/services/bible/phraseSearch";

// Widened ParsedReference — carries the phrase-match provenance flag so
// downstream renderers can display a ✦ badge instead of the default AI badge.
// Threaded end-to-end (2026-07-27): useAudioStream copies it onto the
// scripture UnifiedSuggestion (re-clamping confidence to 74 and excluding
// phrase matches from chapter-context + forceLive), the ProOperatorShell
// chips bar and AIDetectionsPanel Bible rows render the ✦ badge, and the
// shell's auto-fire selector explicitly filters `!s.isPhraseMatch`.
export type PhraseMatchParsedReference = ParsedReference & { isPhraseMatch?: boolean };

// Service mode — an operator-facing detection bias. Does NOT touch capture or
// the auto-fire gates; it only adjusts the confidences those gates already read.
//   "auto" (default) → no-op, today's behaviour exactly.
//   "worship"        → narrow song-matching to the setlist + boost it, and hold
//                      scripture at chip-tier (a sung lyric can't flash a verse).
//   "preacher"       → hold songs at chip-tier (no zero-click song off speech).
export type ServiceMode = "auto" | "worship" | "preacher";

// Detection-bias caps. Kept in lock-step with the gate thresholds (hardcoded
// here, like the SUGGEST_CAP=84 below, so this lib doesn't import operator-dir
// constants — the drift-guard test in test/service-mode.test.ts asserts these
// stay exactly one below the live bars):
//   BIBLE_AUTOFIRE_CONFIDENCE = 75  → worship caps scripture at 74 (chip, not auto)
//   SONG_AUTOLIVE_CONFIDENCE  = 90  → preacher caps songs at 89 (chip, not auto)
// NOTE (2026-08-20): the WORSHIP scripture cap set here on detectAll's output is
// belt-and-braces only — the AUTHORITATIVE worship scripture cap lives in
// useAudioStream.runDetectAll where the final confidence is minted (detectAll's
// parserConf is re-blended with the Deepgram confidence there, which would
// otherwise lift a 74 back to ~84 and re-clear the 75 bar). Both sites exempt
// navigation commands so voice "next verse" still projects in worship mode.
export const WORSHIP_SCRIPTURE_CAP = 74;
export const PREACHER_SONG_CAP = 89;

export type DetectAllContext = {
  churchId: string;
  planId?: string;
  planSongIds?: string[];
  recentSongIds?: string[];
  library?: IndexedSong[];
  prebuiltIndex?: SongIndex;
  mode?: ServiceMode;
  hasVerseContext: boolean;
  hasSlideContext: boolean;
  hasSongContext: boolean;
};

export type DetectAllResult = {
  scripture: PhraseMatchParsedReference[];
  song: SongMatchResult[];      // title-similarity matches (from cues or free text)
  lyric: SongMatchResult[];     // lyric-fragment matches
  command: ContextCommand[];    // generic slide/verse navigation
  cue: SongCue[];               // raw song cues (for UI context)
  section: SectionCommand[];    // song section jumps (chorus/verse N)
};

// Phrase-match cooldown — keyed by reference (e.g. "Psalms 23:1"). Phrases
// repeat naturally in preaching, so we cool longer (15s) than the direct-
// reference SuggestionDedupe (30s wall / bypassed on refresh). Entries older
// than 60s are pruned to keep the map bounded for a 12h service.
const PHRASE_COOLDOWN_MS = 15_000;
const PHRASE_TTL_MS = 60_000;
const phraseCooldown = new Map<string, number>();
function phraseCooldownAllows(ref: string, nowMs: number): boolean {
  // Sweep older entries — cheap linear pass, map stays tiny (<50 refs).
  for (const [k, ts] of phraseCooldown) {
    if (nowMs - ts > PHRASE_TTL_MS) phraseCooldown.delete(k);
  }
  const prev = phraseCooldown.get(ref);
  if (prev !== undefined && nowMs - prev < PHRASE_COOLDOWN_MS) return false;
  phraseCooldown.set(ref, nowMs);
  return true;
}
export function _resetPhraseCooldown() { phraseCooldown.clear(); }

/** Take the last N words of a transcript window — matches the AI-detection
 *  budget so we don't rescan a 30-minute rolling buffer on every interim. */
function lastWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= n) return text.trim();
  return words.slice(-n).join(" ");
}

export async function detectAll(chunk: string, ctx: DetectAllContext): Promise<DetectAllResult> {
  const mode: ServiceMode = ctx.mode ?? "auto";
  const scripture: PhraseMatchParsedReference[] = parseReferences(chunk);

  // Phrase-match fallback (CLAUDE.md #9-tier signal): if the direct-reference
  // parser found nothing, run a spoken-phrase lookup on the last 40 words of
  // the transcript window. Direct references ALWAYS win — this branch is
  // guarded on scripture.length === 0.
  if (scripture.length === 0) {
    const window = lastWords(chunk, 40);
    const top = window ? topPhraseForSpeech(window) : null;
    if (top && phraseCooldownAllows(top.entry.reference, Date.now())) {
      const e = top.entry;
      scripture.push({
        book: e.book,
        chapter: e.chapter,
        verseStart: e.verse,
        verseEnd: e.verseEnd ?? e.verse,
        // 2026-07-28 user sign-off: phrase-quote matches must NEVER auto-fire.
        // The Bible auto-approve confidenceFloor defaults to 90 and phrase
        // scores range up to 90 — capping at 74 keeps every phrase match
        // strictly below the default floor, so it surfaces as a chip the
        // operator can click but cannot zero-click project (CLAUDE.md rule 7:
        // extending auto-projection to a new detection path needs sign-off,
        // and the sign-off given was "cap below auto-fire"). If the approve
        // path ever gains an explicit isPhraseMatch filter, this cap becomes
        // belt-and-braces rather than the primary guard.
        confidence: Math.min(top.confidence, 74),
        matchedText: e.phrase,
        needsSemanticFallback: true,
        isPhraseMatch: true,
      });
    }
  }

  const cue = detectSongCues(chunk);
  // Min-word gate for song detection: only fire on transcripts with >=4
  // words unless a cue phrase was recognized (in which case a short
  // "let's sing X" is fine).
  const wordCount = chunk.trim().split(/\s+/).filter(Boolean).length;
  const allowSong = wordCount >= 4 || cue.length > 0;
  const cmd = parseContextCommand(chunk, {
    hasVerseContext: ctx.hasVerseContext,
    hasSlideContext: ctx.hasSlideContext,
    hasSongContext: ctx.hasSongContext,
  });
  const section = ctx.hasSongContext ? [detectSectionCommand(chunk)].filter(Boolean) as SectionCommand[] : [];

  const matchCtx: MatchContext = {
    churchId: ctx.churchId,
    planId: ctx.planId,
    planSongIds: ctx.planSongIds,
    recentSongIds: ctx.recentSongIds,
    library: ctx.library,
    prebuiltIndex: ctx.prebuiltIndex,
    spokenCuePrefix: cue.length > 0,
    // Worship mode narrows song-matching to today's setlist and boosts it.
    restrictToPlan: mode === "worship",
    worshipBoost: mode === "worship",
  };

  // Resolve songs — prefer cue candidate titles when we have them, else
  // fall back to the whole chunk (lyric-fragment matching).
  const songResults: SongMatchResult[] = [];
  const lyricResults: SongMatchResult[] = [];

  // Priority-6 R1: run the trigger-phrase song-detection first. When it
  // returns an exact or substring match, prefer it over the more permissive
  // title-similarity path. Dedupe is handled by the caller's
  // SuggestionDedupe, so we opt-out of song-detection's own map with
  // useDedupe:false to avoid double-suppression.
  let triggerHit: SongMatchResult | null = null;
  if (allowSong && ctx.library && ctx.library.length > 0) {
    const hit = detectSongInTranscript(chunk, ctx.library, { useDedupe: false });
    if (hit && (hit.matchType === "exact" || hit.matchType === "substring")) {
      const song = ctx.library.find((s) => s.songId === hit.songId);
      // SAFETY GATE (same invariant as matchSongCue): a song whose slides
      // carry no lyric text must never become a candidate — there is
      // nothing to project, and an exact-title trigger hit was surfacing
      // it at 98% with an empty previewPayload. This path was built after
      // the gate and missed it.
      const hasLyrics = !!song && song.slides.some((s) => s.lyrics && s.lyrics.trim().length > 0);
      if (song && hasLyrics) {
        const planIdSet = new Set(ctx.planSongIds || []);
        const source: SongMatchResult["source"] = planIdSet.has(song.songId)
          ? "playlist"
          : (song.source === "public_domain" ? "public_domain" : "local_library");
        const slides = song.slides.slice().sort((a, b) => a.order - b.order);
        const first = slides[0];
        triggerHit = {
          songId: song.songId,
          title: song.title,
          artist: song.artist ?? null,
          source,
          confidence: hit.confidence,
          matchedSection: null,
          matchedLine: first?.lyrics ?? "",
          matchedSlideOrder: first?.order ?? 0,
          previewPayload: first ? { kind: "text", text: first.lyrics } : { kind: "empty" },
        };
        songResults.push(triggerHit);
      }
    }
  }

  if (allowSong && cue.length > 0) {
    for (const c of cue) {
      const query = c.candidateTitle || chunk;
      const matches = await matchSongCue(query, matchCtx);
      for (const m of matches) songResults.push(m);
    }
  }

  const lyricMatches = allowSong
    ? await matchSongCue(chunk, { ...matchCtx, spokenCuePrefix: false })
    : [];
  for (const m of lyricMatches) {
    // Anything with a matched lyric line goes into "lyric"; things without
    // a body match but with a strong title match go into "song".
    if (m.matchedLine && m.matchedLine.length > 0 && m.confidence >= 40 && !cue.length) {
      lyricResults.push(m);
    } else if (!cue.length && m.confidence >= 60) {
      songResults.push(m);
    }
  }

  // Dedupe by songId, preferring the higher-confidence variant
  const dedupe = (arr: SongMatchResult[]): SongMatchResult[] => {
    const seen = new Map<string, SongMatchResult>();
    for (const r of arr) {
      const prev = seen.get(r.songId);
      if (!prev || r.confidence > prev.confidence) seen.set(r.songId, r);
    }
    return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  };

  // Cross-bucket dedupe: if the same songId shows up in BOTH song (title /
  // cue-match) and lyric (lyric-fragment), surface it only in the bucket
  // where it has higher confidence.
  const dedupedSong = dedupe(songResults);
  const dedupedLyric = dedupe(lyricResults);
  const bySong = new Map(dedupedSong.map((m) => [m.songId, m.confidence]));
  const byLyric = new Map(dedupedLyric.map((m) => [m.songId, m.confidence]));
  const finalSong = dedupedSong.filter((m) => {
    const l = byLyric.get(m.songId);
    return l === undefined || m.confidence >= l;
  });
  const finalLyric = dedupedLyric.filter((m) => {
    const s = bySong.get(m.songId);
    return s === undefined || m.confidence > s;
  });

  // ── Verse-vs-song arbitration (2026-08-14) ────────────────────────────────
  // "Deeper listening" for spoken scripture vs sung lyrics. When someone READS
  // or ANNOUNCES a verse, the verse words routinely overlap a song's lyrics
  // (many worship songs quote scripture), so the lyric-fragment matcher fires a
  // coincidental song — e.g. "turn to Psalm 23 … the Lord is my shepherd"
  // spuriously matching a shepherd song.
  //
  // We do NOT use the "let's sing X" cue as the signal for song intent, because
  // congregations frequently just START singing without announcing it (esp.
  // African-gospel worship). Instead we grade by MATCH STRENGTH: a genuinely
  // sung song produces a STRONG, sustained lyric match (high confidence, boosted
  // if it's in the plan), whereas verse-words grazing a song's lyrics produce a
  // WEAK/mid coincidental match. So when the chunk carries an EXPLICIT direct
  // reference (book + chapter + verse, fully parsed, high confidence — NOT a
  // phrase-quote, NOT an ambiguous bare number), we keep only STRONG song/lyric
  // matches (≥ VERSE_OVERRIDE_SONG_CONF) plus an exact/substring TITLE trigger
  // hit or any explicit "let's sing" cue match, and drop the weak coincidental
  // ones. A song sung right as a verse is quoted still survives if it's clearly
  // sung; if it's borderline it resurfaces on the next chunk once the reference
  // scrolls out of the window. Scripture itself is always preserved.
  // ── Service-mode biasing (Worship / Preacher) ─────────────────────────────
  // Applied as confidence caps on the OUTPUT of the engine so the fragile
  // ProOperatorShell auto-fire gates stay untouched — a capped detection simply
  // lands in the manual-chip tier the gates already understand.
  //   worship  → scripture below the Bible auto bar (chip, never zero-click).
  //   preacher → songs below the song auto bar (chip, never zero-click).
  const scriptureOut: PhraseMatchParsedReference[] = mode === "worship"
    ? scripture.map((r) =>
        // Never cap a navigation command ("next verse", bare "verse N") — those
        // are explicit operator/preacher intent and must still project in
        // worship mode (2026-08-18 voice-nav invariant). Phrase matches are
        // already ≤74. This detectAll-level cap is defensive; the authoritative
        // one is in useAudioStream (see the note by the constant above).
        r.isPhraseMatch || r.isNavigationCommand || r.confidence <= WORSHIP_SCRIPTURE_CAP
          ? r
          : { ...r, confidence: WORSHIP_SCRIPTURE_CAP })
    : scripture;
  const capSongs = (arr: SongMatchResult[]): SongMatchResult[] =>
    mode === "preacher"
      ? arr.map((m) => (m.confidence > PREACHER_SONG_CAP ? { ...m, confidence: PREACHER_SONG_CAP } : m))
      : arr;

  const hasExplicitVerse = scripture.some(
    (r) => !r.isPhraseMatch && r.needsSemanticFallback === false && r.confidence >= 85,
  );
  // In Worship mode songs are the point — don't let a co-occurring spoken verse
  // cap them (and scripture is already held at chip-tier above), so skip the
  // verse-vs-song arbitration entirely.
  if (hasExplicitVerse && mode !== "worship") {
    // SAFE arbitration — never HIDE a song (missing real spontaneous worship is
    // the worst outcome), and don't rely on match confidence to tell "real
    // singing" from "coincidental overlap" (a full sung hymn line can score
    // below the auto bar). Instead we CAP co-occurring song/lyric matches into
    // the manual-chip tier: while a verse is being spoken a song can still be
    // seen and pushed live by the operator, but it won't ZERO-CLICK auto-project
    // (which is where a wrong song on the projector during a reading hurts). If
    // it's genuinely being sung, the reference scrolls out of the transcript
    // window within a chunk or two and the song re-fires at full confidence and
    // auto-projects normally. An explicit "let's sing" cue or an exact/substring
    // TITLE trigger is treated as clear song intent and passes through uncapped.
    const SUGGEST_CAP = 84; // one below the song auto-project bar (see operatorConstants SONG_AUTOLIVE_CONFIDENCE=85)
    const hasCue = cue.length > 0;
    const cap = (m: SongMatchResult): SongMatchResult =>
      hasCue || m.songId === triggerHit?.songId || m.confidence <= SUGGEST_CAP
        ? m
        : { ...m, confidence: SUGGEST_CAP };
    const cappedSong = finalSong.map(cap);
    const cappedLyric = finalLyric.map(cap);
    const capped = finalSong.concat(finalLyric).filter((m) => m.confidence > SUGGEST_CAP).length;
    if (capped > 0 && !hasCue) {
      console.log(
        `[verse-vs-song] explicit scripture reference present → holding ${capped} co-occurring song/lyric match(es) at chip-tier (no zero-click) until the reference clears (trigger=${triggerHit?.songId ?? "none"})`,
      );
    }
    return {
      scripture: scriptureOut,
      song: capSongs(cappedSong),
      lyric: capSongs(cappedLyric),
      command: cmd ? [cmd] : [],
      cue,
      section,
    };
  }

  return {
    scripture: scriptureOut,
    song: capSongs(finalSong),
    lyric: capSongs(finalLyric),
    command: cmd ? [cmd] : [],
    cue,
    section,
  };
}

// -----------------------------------------------------------------------
// Dedupe / cooldown primitive for the streaming pipeline.
// -----------------------------------------------------------------------

export type SuggestionKey = { type: string; key: string };

/**
 * In-memory cooldown map. Keeps track of (type, key) → { ts, confidence }.
 * Callers use shouldEmit() to decide whether to push a new suggestion.
 *
 * Rules:
 *  - Same (type, key) within cooldownMs of the last emission is suppressed
 *  - EXCEPT if new confidence is >= 10 higher than the last recorded value,
 *    in which case we allow a refresh (returns "refresh").
 */
export class SuggestionDedupe {
  // R6: TTL sweep + LRU cap so a 12h service can't grow this map unbounded.
  // Map's insertion-order iteration gives us free LRU eviction.
  private map = new Map<string, { ts: number; confidence: number }>();
  private lastSweep = 0;
  private static readonly TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly SWEEP_INTERVAL_MS = 60 * 1000; // sweep at most once/min
  private static readonly MAX_ENTRIES = 500;

  constructor(private cooldownMs: number = 30_000) {}

  private k(type: string, key: string): string { return `${type}::${key.toLowerCase()}`; }

  private sweep(nowMs: number) {
    if (nowMs - this.lastSweep < SuggestionDedupe.SWEEP_INTERVAL_MS) return;
    this.lastSweep = nowMs;
    const cutoff = nowMs - SuggestionDedupe.TTL_MS;
    for (const [k, v] of this.map) {
      if (v.ts < cutoff) this.map.delete(k);
    }
  }

  private evictIfOverCap() {
    while (this.map.size >= SuggestionDedupe.MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  private set(k: string, ts: number, confidence: number) {
    // Delete-then-set so the key moves to the tail (most-recently-inserted)
    // for LRU eviction semantics.
    this.map.delete(k);
    this.evictIfOverCap();
    this.map.set(k, { ts, confidence });
  }

  shouldEmit(type: string, key: string, confidence: number, nowMs = Date.now()): "new" | "refresh" | "suppress" {
    this.sweep(nowMs);
    const k = this.k(type, key);
    const prev = this.map.get(k);
    if (!prev) { this.set(k, nowMs, confidence); return "new"; }
    const elapsed = nowMs - prev.ts;
    if (elapsed >= this.cooldownMs) { this.set(k, nowMs, confidence); return "new"; }
    if (confidence - prev.confidence >= 10) { this.set(k, nowMs, confidence); return "refresh"; }
    return "suppress";
  }

  size(): number { return this.map.size; }
  clear() { this.map.clear(); }
}
