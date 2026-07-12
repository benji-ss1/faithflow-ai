// Trigger-phrase song detector.
//
// A thin, deterministic wrapper over the church's local song library. Given
// a raw transcript chunk (e.g. "let's sing Amazing Grace tonight"), it:
//
//   1. Detects a trigger prefix ("let's sing", "let us sing", "we sing",
//      "let's worship with", "let's worship", "singing", "sing the song",
//      "next song", "next we're going to sing", ...).
//   2. Extracts up to 8 candidate title words after the trigger.
//   3. Resolves the candidate against the local library via:
//        a) exact title match (case-insensitive)
//        b) substring / starts-with title match
//        c) bigram-similarity fuzzy match (>= 0.65)
//        d) first-line lyric fragment match
//   4. Returns a single best `SongSuggestion` (or null).
//
// Deduplication: identical songId within 30s → returns null with
// matchType "duplicate". State is process-local; call `resetSongDedupe()`
// in tests.
//
// This module is intentionally web-fetch free — it consumes an
// already-indexed local library.

import type { IndexedSong } from "./lyric-fragment";

export type SongMatchType = "exact" | "substring" | "fuzzy" | "lyric" | "duplicate";

export type SongSuggestion = {
  songId: string;
  songTitle: string;
  confidence: number;      // 0-100
  matchType: SongMatchType;
  triggerPhrase: string;
  candidateTitle: string;
};

// --- Trigger phrases ---------------------------------------------------

// Ordered: longest / most-specific first so "let us sing" wins over "sing".
const TRIGGER_PATTERNS: RegExp[] = [
  /\bnext\s+(?:we(?:'re| are)\s+going\s+to\s+sing|we\s+sing)\b/i,
  /\bwe(?:'re| are)\s+going\s+to\s+sing\b/i,
  /\blet(?:'s|\s+us)\s+worship\s+with\b/i,
  /\blet(?:'s|\s+us)\s+all\s+sing\b/i,
  /\blet(?:'s|\s+us)\s+sing\b/i,
  /\blet(?:'s|\s+us)\s+worship\b/i,
  /\bsing\s+the\s+song\b/i,
  /\bnext\s+song\b/i,
  /\bwe\s+sing\b/i,
  /\bsinging\b/i,
];

function findTrigger(text: string): { match: RegExpExecArray; pattern: RegExp } | null {
  let best: { match: RegExpExecArray; pattern: RegExp } | null = null;
  for (const p of TRIGGER_PATTERNS) {
    const m = p.exec(text);
    if (!m) continue;
    // Prefer the earliest trigger; on tie prefer the longer match
    if (!best || m.index < best.match.index ||
        (m.index === best.match.index && m[0].length > best.match[0].length)) {
      best = { match: m, pattern: p };
    }
  }
  return best;
}

// --- Candidate extraction ---------------------------------------------

const STOP_WORD = /^(?:the|a|an|song|called|titled|about|to|by|with)$/i;

function extractCandidate(text: string, trig: RegExpExecArray): string {
  const end = trig.index + trig[0].length;
  const tail = text.slice(end).replace(/^[,.:;!?\s"'“”]+/, "");
  const stop = tail.search(/[,.;!?\n]|\s+(?:and then|because|so that|as we|tonight|today)\b/i);
  const chunk = (stop >= 0 ? tail.slice(0, stop) : tail).trim();
  const words = chunk.split(/\s+/).filter(Boolean).slice(0, 8);
  while (words.length && STOP_WORD.test(words[0])) words.shift();
  return words.join(" ").replace(/["'“”]/g, "").trim();
}

// --- Similarity -------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Set<string> {
  const n = normalize(s).replace(/\s+/g, " ");
  const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character-bigrams. Returns 0-1. */
function bigramSim(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// --- Dedupe -----------------------------------------------------------

const dedupeMap = new Map<string, number>();
const DEDUPE_MS = 30_000;

export function resetSongDedupe(): void { dedupeMap.clear(); }

function isDuplicate(songId: string, now: number): boolean {
  const prev = dedupeMap.get(songId);
  if (prev && now - prev < DEDUPE_MS) return true;
  dedupeMap.set(songId, now);
  return false;
}

// --- Public API -------------------------------------------------------

export type DetectSongOpts = {
  now?: number;              // for tests
  fuzzyThreshold?: number;   // default 0.65
  useDedupe?: boolean;       // default true
};

/**
 * Detect a spoken song reference in the transcript chunk, matching against
 * the church's indexed song library. Returns the highest-confidence match
 * or null.
 */
export function detectSongInTranscript(
  transcript: string,
  library: Array<Pick<IndexedSong, "songId" | "title"> & Partial<IndexedSong>>,
  opts: DetectSongOpts = {},
): SongSuggestion | null {
  if (!transcript || typeof transcript !== "string") return null;
  if (!Array.isArray(library) || library.length === 0) return null;

  const now = opts.now ?? Date.now();
  const fuzzyThreshold = opts.fuzzyThreshold ?? 0.65;

  const trig = findTrigger(transcript);
  if (!trig) return null;

  const candidate = extractCandidate(transcript, trig.match);
  if (!candidate || candidate.length < 2) return null;

  const nCandidate = normalize(candidate);

  // 1) exact title match
  let best: { song: typeof library[number]; conf: number; type: SongMatchType } | null = null;

  for (const song of library) {
    if (!song?.title) continue;
    const nTitle = normalize(song.title);
    if (!nTitle) continue;

    if (nCandidate === nTitle) {
      best = { song, conf: 98, type: "exact" };
      break;
    }
  }

  // 2) substring / starts-with: candidate contains title OR title contains candidate
  if (!best) {
    for (const song of library) {
      if (!song?.title) continue;
      const nTitle = normalize(song.title);
      if (!nTitle) continue;
      if (nCandidate.startsWith(nTitle) || nCandidate.includes(nTitle)) {
        // Prefer longest title match — a longer overlap = more evidence.
        const conf = Math.min(95, 80 + Math.min(15, nTitle.length / 4));
        if (!best || conf > best.conf) best = { song, conf: Math.round(conf), type: "substring" };
      } else if (nTitle.startsWith(nCandidate) && nCandidate.length >= 4) {
        const conf = 78;
        if (!best || conf > best.conf) best = { song, conf, type: "substring" };
      }
    }
  }

  // 3) fuzzy bigram similarity
  if (!best) {
    let topSim = 0;
    for (const song of library) {
      if (!song?.title) continue;
      const sim = bigramSim(candidate, song.title);
      if (sim >= fuzzyThreshold && sim > topSim) {
        topSim = sim;
        best = { song, conf: Math.round(50 + sim * 40), type: "fuzzy" };
      }
    }
  }

  // 4) lyric first-line fragment
  if (!best) {
    for (const song of library) {
      const slides = (song as IndexedSong).slides;
      if (!slides || slides.length === 0) continue;
      const firstLine = (slides.find((s) => s.order === 0) ?? slides[0])?.lyrics?.split(/\n+/)[0] ?? "";
      if (!firstLine) continue;
      const sim = bigramSim(candidate, firstLine);
      if (sim >= fuzzyThreshold) {
        const conf = Math.round(45 + sim * 35);
        if (!best || conf > best.conf) best = { song, conf, type: "lyric" };
      }
    }
  }

  if (!best) return null;

  const useDedupe = opts.useDedupe !== false;
  if (useDedupe && isDuplicate(best.song.songId, now)) {
    return {
      songId: best.song.songId,
      songTitle: best.song.title!,
      confidence: best.conf,
      matchType: "duplicate",
      triggerPhrase: trig.match[0],
      candidateTitle: candidate,
    };
  }

  return {
    songId: best.song.songId,
    songTitle: best.song.title!,
    confidence: Math.max(0, Math.min(100, best.conf)),
    matchType: best.type,
    triggerPhrase: trig.match[0],
    candidateTitle: candidate,
  };
}
