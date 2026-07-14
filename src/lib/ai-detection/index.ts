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

export type DetectAllContext = {
  churchId: string;
  planId?: string;
  planSongIds?: string[];
  recentSongIds?: string[];
  library?: IndexedSong[];
  prebuiltIndex?: SongIndex;
  hasVerseContext: boolean;
  hasSlideContext: boolean;
  hasSongContext: boolean;
};

export type DetectAllResult = {
  scripture: ParsedReference[];
  song: SongMatchResult[];      // title-similarity matches (from cues or free text)
  lyric: SongMatchResult[];     // lyric-fragment matches
  command: ContextCommand[];    // generic slide/verse navigation
  cue: SongCue[];               // raw song cues (for UI context)
  section: SectionCommand[];    // song section jumps (chorus/verse N)
};

export async function detectAll(chunk: string, ctx: DetectAllContext): Promise<DetectAllResult> {
  const scripture = parseReferences(chunk);
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
      if (song) {
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

  return {
    scripture,
    song: finalSong,
    lyric: finalLyric,
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
  private map = new Map<string, { ts: number; confidence: number }>();
  constructor(private cooldownMs: number = 30_000) {}

  private k(type: string, key: string): string { return `${type}::${key.toLowerCase()}`; }

  shouldEmit(type: string, key: string, confidence: number, nowMs = Date.now()): "new" | "refresh" | "suppress" {
    const k = this.k(type, key);
    const prev = this.map.get(k);
    if (!prev) { this.map.set(k, { ts: nowMs, confidence }); return "new"; }
    const elapsed = nowMs - prev.ts;
    if (elapsed >= this.cooldownMs) { this.map.set(k, { ts: nowMs, confidence }); return "new"; }
    if (confidence - prev.confidence >= 10) { this.map.set(k, { ts: nowMs, confidence }); return "refresh"; }
    return "suppress";
  }

  clear() { this.map.clear(); }
}
