/**
 * Detects spoken song cues in a transcript segment.
 *
 * Strategy:
 *   1. Scan for CUE PHRASES ("let's sing", "let us worship with", "please
 *      stand and sing"...). Only text AFTER a cue is treated as a possible
 *      title, so a sermon simply saying the phrase "amazing grace" doesn't
 *      trigger a suggestion — a pastor has to say it as a call to worship.
 *   2. Fuzzy-match the candidate against the church's song titles using
 *      normalized token overlap + a length penalty (Jaccard-like).
 *   3. If no fuzzy hit crosses the confidence floor, the caller is expected
 *      to run a semantic search across the same corpus (this file returns
 *      { needsSemanticFallback: true } so the audio server can route it).
 *
 * Pure function, testable, no I/O.
 */

const CUE_PATTERNS: { re: RegExp; weight: number }[] = [
  { re: /\blet(?:'|)s\s+(?:all\s+)?sing\s+(?:the\s+song\s+)?(.+?)(?:$|\.|,|\band\b|\bnow\b)/i, weight: 0.9 },
  { re: /\blet\s+us\s+(?:all\s+)?sing\s+(?:the\s+song\s+)?(.+?)(?:$|\.|,)/i, weight: 0.9 },
  { re: /\blet(?:'|)s\s+(?:all\s+)?worship\s+(?:with\s+)?(?:the\s+song\s+)?(.+?)(?:$|\.|,)/i, weight: 0.85 },
  { re: /\bplease\s+stand(?:\s+and\s+sing)?\s+(?:with\s+us\s+)?(?:the\s+song\s+)?(.+?)(?:$|\.|,)/i, weight: 0.75 },
  { re: /\bnext\s+(?:song|hymn)\s+(?:is\s+)?(.+?)(?:$|\.|,)/i, weight: 0.85 },
  { re: /\bsing\s+(?:the\s+song\s+)?(.+?)(?:$|\.|,|\bwith\b|\band\b)/i, weight: 0.55 },
  { re: /\bhymn\s+(?:number\s+)?(?:\d+\s+)?(.+?)(?:$|\.|,)/i, weight: 0.7 },
];

const STOPWORDS = new Set(["the", "a", "an", "of", "in", "and", "to", "for", "with", "song", "hymn"]);

function normalizeTitle(s: string): string[] {
  return s.toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[!?.,:;"'()]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}

export type SongCandidate = { text: string; cueConfidence: number };

/** Returns candidate song titles extracted from cue phrases. Empty if none. */
export function extractSongCandidates(text: string): SongCandidate[] {
  const raw: SongCandidate[] = [];
  for (const p of CUE_PATTERNS) {
    const m = p.re.exec(text);
    if (m && m[1]) {
      const candidate = m[1].trim().replace(/^["'`]|["'`]$/g, "");
      if (candidate.length >= 2) raw.push({ text: candidate, cueConfidence: p.weight * 100 });
    }
  }
  // Dedupe: keep the highest-cue-confidence entry per normalized title so
  // overlapping regexes ("let's sing X" vs "sing X") don't emit twice.
  const bestByKey = new Map<string, SongCandidate>();
  for (const c of raw) {
    const key = c.text.toLowerCase().replace(/\s+/g, " ");
    const prev = bestByKey.get(key);
    if (!prev || c.cueConfidence > prev.cueConfidence) bestByKey.set(key, c);
  }
  return Array.from(bestByKey.values());
}

export type SongMatchResult = {
  songId: string | null;
  title: string;
  confidence: number; // 0-100
  matchedText: string;
  needsSemanticFallback: boolean;
};

/** Match a candidate against a library. Returns null-songId if no fuzzy hit. */
export function fuzzyMatchSong(candidate: SongCandidate, library: { id: string; title: string }[]): SongMatchResult {
  const candTokens = normalizeTitle(candidate.text);
  if (candTokens.length === 0) {
    return { songId: null, title: candidate.text, confidence: 0, matchedText: candidate.text, needsSemanticFallback: false };
  }

  let best: { id: string; title: string; score: number } | null = null;
  for (const song of library) {
    const songTokens = normalizeTitle(song.title);
    const sim = jaccard(candTokens, songTokens);
    // Bonus for containment: if candidate is a substring of song title (or v.v.)
    const candStr = candTokens.join(" ");
    const songStr = songTokens.join(" ");
    const containsBonus = candStr && (songStr.includes(candStr) || candStr.includes(songStr)) ? 0.15 : 0;
    const score = Math.min(1, sim + containsBonus);
    if (!best || score > best.score) best = { id: song.id, title: song.title, score };
  }

  if (!best) return { songId: null, title: candidate.text, confidence: 0, matchedText: candidate.text, needsSemanticFallback: false };

  const rawScore = Math.round(best.score * 100);
  // Weight cue signal heavily: strong cue but weak match still worth a
  // semantic fallback, weak cue and weak match is not.
  const combined = Math.round(0.65 * rawScore + 0.35 * candidate.cueConfidence);

  return {
    songId: rawScore >= 60 ? best.id : null,
    title: best.title,
    confidence: rawScore >= 60 ? combined : Math.round(0.4 * combined),
    matchedText: candidate.text,
    needsSemanticFallback: rawScore < 60 && candidate.cueConfidence >= 70,
  };
}
