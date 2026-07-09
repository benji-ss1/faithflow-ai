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
import type { IndexedSong } from "./lyric-fragment";

export type DetectAllContext = {
  churchId: string;
  planId?: string;
  planSongIds?: string[];
  recentSongIds?: string[];
  library?: IndexedSong[];
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
    spokenCuePrefix: cue.length > 0,
  };

  // Resolve songs — prefer cue candidate titles when we have them, else
  // fall back to the whole chunk (lyric-fragment matching).
  const songResults: SongMatchResult[] = [];
  const lyricResults: SongMatchResult[] = [];

  if (cue.length > 0) {
    for (const c of cue) {
      const query = c.candidateTitle || chunk;
      const matches = await matchSongCue(query, matchCtx);
      for (const m of matches) songResults.push(m);
    }
  }

  const lyricMatches = await matchSongCue(chunk, { ...matchCtx, spokenCuePrefix: false });
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

  return {
    scripture,
    song: dedupe(songResults),
    lyric: dedupe(lyricResults),
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
