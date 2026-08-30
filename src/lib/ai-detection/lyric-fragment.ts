// Lyric fragment n-gram matcher.
//
// No web lyric scraping. Local + licensed only. This module indexes ONLY
// lyrics that are already stored locally (church-owned imports and
// verified public-domain hymns) plus lyrics we've received from licensed
// providers. It never fetches from the open web.
//
// Algorithm: trigram overlap (Dice coefficient). Fast, tolerant of speech
// recognition wobble, and doesn't need a heavy NLP stack.

export type IndexedSong = {
  songId: string;
  title: string;
  artist?: string | null;
  source: "public_domain" | "church" | "imported";
  slides: { order: number; lyrics: string }[];
};

export type LyricMatch = {
  songId: string;
  title: string;
  artist?: string | null;
  source: "public_domain" | "church" | "imported";
  matchedLine: string;          // best-matching line from the song
  matchedSlideOrder: number;    // slide the matched line came from
  score: number;                // 0-100 raw trigram Dice score
};

const WORD_RE = /[a-z0-9']+/g;
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
function tokens(s: string): string[] {
  return (normalize(s).match(WORD_RE) || []);
}
function trigrams(words: string[]): string[] {
  if (words.length < 3) return [];
  const out: string[] = [];
  for (let i = 0; i <= words.length - 3; i++) out.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

export type SongIndex = {
  byTrigram: Map<string, Set<string>>;             // trigram -> songIds
  songs: Map<string, IndexedSong>;                 // songId -> song
  lineTrigrams: Map<string, { line: string; slideOrder: number; grams: string[] }[]>; // songId -> lines
};

export function buildIndex(songs: IndexedSong[]): SongIndex {
  const byTrigram = new Map<string, Set<string>>();
  const songMap = new Map<string, IndexedSong>();
  const lineTrigrams = new Map<string, { line: string; slideOrder: number; grams: string[] }[]>();
  for (const song of songs) {
    songMap.set(song.songId, song);
    const lines: { line: string; slideOrder: number; grams: string[] }[] = [];
    for (const slide of song.slides) {
      for (const rawLine of slide.lyrics.split(/\n+/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const t = trigrams(tokens(line));
        if (t.length === 0) continue;
        lines.push({ line, slideOrder: slide.order, grams: t });
        for (const g of t) {
          let set = byTrigram.get(g);
          if (!set) { set = new Set(); byTrigram.set(g, set); }
          set.add(song.songId);
        }
      }
    }
    lineTrigrams.set(song.songId, lines);
  }
  return { byTrigram, songs: songMap, lineTrigrams };
}

/**
 * Score a spoken chunk against the indexed songs. Returns top candidates
 * with the best-matching line per song.
 *
 * chunk must be normalized text; we tokenize + trigram internally.
 * minWords: reject chunks shorter than 4 words (too ambiguous).
 */
export function matchLyricFragment(chunk: string, index: SongIndex, opts: { limit?: number; minWords?: number } = {}): LyricMatch[] {
  const minWords = opts.minWords ?? 4;
  const limit = opts.limit ?? 5;
  const words = tokens(chunk);
  if (words.length < minWords) return [];
  const chunkGrams = trigrams(words);
  if (chunkGrams.length === 0) return [];

  // Candidate songs = songs that share at least one trigram
  const candidateSongIds = new Set<string>();
  for (const g of chunkGrams) {
    const set = index.byTrigram.get(g);
    if (set) for (const id of set) candidateSongIds.add(id);
  }
  if (candidateSongIds.size === 0) return [];

  const chunkSet = new Set(chunkGrams);
  const chunkDistinct = chunkSet.size;
  // A "repetitive" sung phrase = many raw trigrams but very few DISTINCT ones
  // ("glory to glory to glory to glory", "holy holy holy"). Only these get the
  // containment rescue below; everything else scores EXACTLY as before (parity).
  const chunkIsRepetitive = chunkGrams.length >= chunkDistinct * 2 && chunkDistinct <= 8;
  const results: LyricMatch[] = [];
  for (const songId of candidateSongIds) {
    const song = index.songs.get(songId)!;
    const lines = index.lineTrigrams.get(songId) || [];
    let best: { line: string; slideOrder: number; score: number } | null = null;
    for (const l of lines) {
      let inter = 0;
      for (const g of l.grams) if (chunkSet.has(g)) inter++;
      if (inter === 0) continue;
      // Dice coefficient: 2·|A∩B| / (|A|+|B|) — UNCHANGED.
      const dice = (2 * inter) / (l.grams.length + chunkGrams.length);
      let score = Math.round(dice * 100);
      // 2026-08-30 repetitive-phrase rescue (field bug: singing "glory to glory"
      // did NOT match the "GLORY TO GLORY" song because the long rolling window /
      // repeated grams inflate Dice's denominator). ONLY for a sustained
      // repetitive chunk, lift the score by how fully its distinct grams cover
      // this line. Ordinary speech/singing (not repetitive) is untouched.
      if (chunkIsRepetitive) {
        const lineDistinct = new Set(l.grams);
        let interD = 0;
        for (const g of lineDistinct) if (chunkSet.has(g)) interD++;
        const containment = interD / Math.max(1, Math.min(lineDistinct.size, chunkDistinct));
        score = Math.max(score, Math.round(containment * 100));
      }
      if (!best || score > best.score) best = { line: l.line, slideOrder: l.slideOrder, score };
    }
    if (best && best.score > 0) {
      results.push({
        songId,
        title: song.title,
        artist: song.artist,
        source: song.source,
        matchedLine: best.line,
        matchedSlideOrder: best.slideOrder,
        score: best.score,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
