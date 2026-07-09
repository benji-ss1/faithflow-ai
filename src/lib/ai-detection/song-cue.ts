// Worship-cue detector.
//
// No web lyric scraping. Local + licensed only. This module ONLY detects
// whether the speaker is announcing / cueing a song by pattern matching
// on natural speech phrases. It does NOT fetch anything from the internet
// and does NOT attempt to reproduce lyrics.
//
// The extracted candidateTitle is a raw noun phrase; the caller is
// responsible for resolving it against the local song library / licensed
// providers via song-match.ts.

export type SongCue = {
  matchedText: string;      // full spoken phrase we matched on
  candidateTitle: string;   // extracted title guess (may be empty)
  section?: "chorus" | "verse" | "bridge" | "outro" | "tag";
  confidence: number;       // 0-100 confidence in the CUE itself
};

// Ordered most-specific → most-lenient. First match per pattern wins.
const CUE_PATTERNS: { re: RegExp; confidence: number; section?: SongCue["section"] }[] = [
  // "the chorus says", "sing the bridge", "let's go to the outro"
  { re: /\b(?:the\s+)?chorus\s+(?:says|goes|reads)\b/i, confidence: 80, section: "chorus" },
  { re: /\bsing\s+(?:the\s+)?(chorus|bridge|outro|tag)\b/i, confidence: 88 },
  { re: /\b(?:go\s+to|jump\s+to|play|show)\s+(?:the\s+)?(chorus|bridge|outro|tag)\b/i, confidence: 85 },

  // Explicit sing/worship cues with title-bearing tail
  { re: /\blet'?s\s+(?:all\s+)?sing\b/i, confidence: 88 },
  { re: /\bwe(?:'re|\s+are)\s+going\s+to\s+sing\b/i, confidence: 90 },
  { re: /\b(?:let\s+us|please)\s+worship\b/i, confidence: 75 },
  { re: /\bjoin\s+us\s+in(?:\s+singing)?\b/i, confidence: 80 },
  { re: /\bthis\s+song\s+is\s+(?:about|called|titled)\b/i, confidence: 82 },
  { re: /\b(?:the\s+)?song\s+is\s+called\b/i, confidence: 85 },
  { re: /\bstand\s+(?:up\s+)?(?:and\s+)?sing\b/i, confidence: 75 },
  { re: /\bsing(?:\s+it)?\s+with\s+(?:me|us)\b/i, confidence: 78 },
];

// Extract the noun phrase after a cue prefix. Very simple: take up to the
// next punctuation, the words "with", "and", "to", or up to 8 tokens.
function extractTitle(text: string, prefixMatch: RegExpMatchArray): string {
  const end = prefixMatch.index! + prefixMatch[0].length;
  const tail = text.slice(end).replace(/^[,.:;!?\s"'“”]+/, "");
  // Stop at punctuation OR at connective conjunctions that usually end a
  // title in speech ("Amazing Grace, and then we'll...").
  const stop = tail.search(/[,.;!?\n]|\s+(?:and then|because|so that|as we)\b/i);
  const chunk = (stop >= 0 ? tail.slice(0, stop) : tail).trim();
  // Cap at 8 words to avoid runaway
  const words = chunk.split(/\s+/).slice(0, 8);
  // Trim leading filler words ("the", "song", "called", "titled", "about")
  while (words.length && /^(?:the|a|an|song|called|titled|about|to|by)$/i.test(words[0])) words.shift();
  return words.join(" ").replace(/["'“”]/g, "").trim();
}

/**
 * Scan a transcript chunk for song-cue phrases. Returns 0 or more cues.
 * Multiple cues in one chunk are allowed (e.g. compound sentence).
 */
export function detectSongCues(text: string): SongCue[] {
  const cues: SongCue[] = [];
  for (const p of CUE_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const section = p.section
      ?? (m[1] && /^(chorus|bridge|outro|tag)$/i.test(m[1]) ? (m[1].toLowerCase() as SongCue["section"]) : undefined);
    const candidateTitle = extractTitle(text, m);
    cues.push({
      matchedText: m[0],
      candidateTitle,
      section,
      confidence: p.confidence,
    });
  }
  return cues;
}
