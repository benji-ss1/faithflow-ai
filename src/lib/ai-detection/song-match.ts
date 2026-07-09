// Song matching engine.
//
// ⚠️ NO WEB LYRIC SCRAPING. LOCAL + LICENSED ONLY. This module resolves a
// spoken cue or lyric fragment to a song, but the ONLY sources it will
// consider are:
//   1. Songs already in the current service plan playlist
//   2. Songs in the church's local library (source = church | imported)
//   3. Verified public-domain hymns (source = public_domain)
//   4. Licensed provider placeholder (not implemented — never web-fetch)
//
// If none of these carry lyrics, we return NO candidate. The UI is then
// required to show "Import Song / Search Library" and hide Send Live.

import { buildIndex, matchLyricFragment, type IndexedSong, type LyricMatch } from "./lyric-fragment";
import type { SlidePayload } from "@/lib/broadcast";

export type SongMatchResult = {
  songId: string;
  title: string;
  artist: string | null;
  source: "playlist" | "local_library" | "public_domain";
  confidence: number;               // 0-100
  matchedSection: "chorus" | "verse" | "bridge" | "outro" | "tag" | null;
  matchedLine?: string;
  matchedSlideOrder?: number;
  previewPayload: SlidePayload;
};

export type MatchContext = {
  churchId: string;
  planId?: string;
  planSongIds?: string[];           // ordered playlist song IDs
  recentSongIds?: string[];         // song IDs seen recently in transcript
  spokenCuePrefix?: boolean;        // true if we came from a song-cue detector
  library?: IndexedSong[];          // preloaded library (client cache)
};

/** Rough title-similarity: token overlap with normalization. */
function titleScore(spoken: string, title: string): number {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s']/g, " ").trim();
  const a = new Set(norm(spoken).split(/\s+/).filter((w) => w && w.length > 1));
  const b = new Set(norm(title).split(/\s+/).filter((w) => w && w.length > 1));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const dice = (2 * inter) / (a.size + b.size);
  if (norm(spoken) === norm(title)) return 100;
  return Math.round(dice * 100);
}

function detectSection(line: string): SongMatchResult["matchedSection"] {
  const s = line.toLowerCase();
  if (/^\s*(chorus|refrain)\b/.test(s)) return "chorus";
  if (/^\s*verse\b/.test(s)) return "verse";
  if (/^\s*bridge\b/.test(s)) return "bridge";
  if (/^\s*(outro|ending)\b/.test(s)) return "outro";
  if (/^\s*tag\b/.test(s)) return "tag";
  return null;
}

function slideToPayload(song: IndexedSong, slideOrder?: number): SlidePayload {
  const slides = song.slides.slice().sort((a, b) => a.order - b.order);
  const chosen = slideOrder !== undefined
    ? (slides.find((s) => s.order === slideOrder) || slides[0])
    : slides[0];
  if (!chosen) return { kind: "empty" };
  return { kind: "text", text: chosen.lyrics };
}

/**
 * Resolve a spoken transcript chunk (either a cue title or a lyric line)
 * to up to 3 songs. Confidence is clamped 0-100.
 */
export async function matchSongCue(
  chunk: string,
  ctx: MatchContext,
): Promise<SongMatchResult[]> {
  const library = ctx.library || [];
  if (library.length === 0) return [];

  const planIdSet = new Set(ctx.planSongIds || []);
  const recentIdSet = new Set(ctx.recentSongIds || []);

  // Build (or accept prebuilt) index. Callers typically pass a prebuilt
  // library, so buildIndex is called client-side once per library refresh.
  const index = buildIndex(library);

  // Lyric-fragment matches
  const lyricMatches = matchLyricFragment(chunk, index, { limit: 8, minWords: 4 });

  // Title-similarity matches over ALL library songs
  const titleMatches: LyricMatch[] = [];
  for (const song of library) {
    const t = titleScore(chunk, song.title);
    if (t >= 40) {
      titleMatches.push({
        songId: song.songId,
        title: song.title,
        artist: song.artist,
        source: song.source,
        matchedLine: song.slides[0]?.lyrics.split(/\n/)[0] ?? "",
        matchedSlideOrder: song.slides[0]?.order ?? 0,
        score: t,
      });
    }
  }

  // Merge by songId, keeping the higher raw score. Track exact-title separately.
  type Merged = LyricMatch & { titleBoost: number; exactTitle: boolean };
  const merged = new Map<string, Merged>();
  for (const m of lyricMatches) {
    merged.set(m.songId, { ...m, titleBoost: 0, exactTitle: false });
  }
  for (const m of titleMatches) {
    const prev = merged.get(m.songId);
    const exactTitle = m.score === 100;
    if (prev) {
      prev.titleBoost = Math.max(prev.titleBoost, m.score);
      prev.exactTitle = prev.exactTitle || exactTitle;
      if (m.score > prev.score) {
        prev.score = m.score;
        prev.matchedLine = m.matchedLine;
        prev.matchedSlideOrder = m.matchedSlideOrder;
      }
    } else {
      merged.set(m.songId, { ...m, titleBoost: m.score, exactTitle });
    }
  }

  const results: SongMatchResult[] = [];
  for (const m of merged.values()) {
    // SAFETY GATE: no lyrics means no candidate. Prevents empty-cards from
    // ever exposing a Send Live button.
    const song = index.songs.get(m.songId)!;
    const hasLyrics = song.slides.some((s) => s.lyrics && s.lyrics.trim().length > 0);
    if (!hasLyrics) continue;

    let confidence = m.score;
    if (planIdSet.has(m.songId)) confidence += 20;
    if (recentIdSet.has(m.songId)) confidence += 10;
    if (m.exactTitle) confidence += 30;
    if (ctx.spokenCuePrefix) confidence += 15;
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));

    const source: SongMatchResult["source"] = planIdSet.has(m.songId)
      ? "playlist"
      : (song.source === "public_domain" ? "public_domain" : "local_library");

    results.push({
      songId: m.songId,
      title: m.title,
      artist: m.artist ?? null,
      source,
      confidence,
      matchedSection: m.matchedLine ? detectSection(m.matchedLine) : null,
      matchedLine: m.matchedLine,
      matchedSlideOrder: m.matchedSlideOrder,
      previewPayload: slideToPayload(song, m.matchedSlideOrder),
    });
  }

  // Sort by confidence desc, then playlist-first as a tiebreaker
  results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const rank = (s: SongMatchResult["source"]) => s === "playlist" ? 0 : s === "local_library" ? 1 : 2;
    return rank(a.source) - rank(b.source);
  });

  return results.slice(0, 3);
}
