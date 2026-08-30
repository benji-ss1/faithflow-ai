/**
 * Song slide chunking — the pure, deterministic core (Increment A1).
 *
 * SONGS ONLY. This module must never be applied to Bible verses or media —
 * an adversarial test asserts that. It takes a single lyric BODY and returns an
 * ordered array of slide texts, each a small, phrase-broken, readable chunk.
 *
 * Spec: docs/SONG_SLIDE_CHUNKING_SPEC.md (research §1-4, review fold §9).
 * Contract highlights (all tested in test/song-chunk.test.ts):
 *   - Pure & deterministic: no DB, no I/O, no Date/Math.random.
 *   - Empty / whitespace-only input → [] (never a blank slide).
 *   - Blank line = SECTION break; single "\n" = line break.
 *   - Break at phrase boundaries; never mid-word; clause-preservation is
 *     best-effort (English-biased). Long lines wrap; a single over-long token
 *     stays whole (char fallback so the loop always terminates).
 *   - Grammar pass: strip trailing . and , ; ALL-CAPS → sentence case, but
 *     locale-safe — skips any line containing non-ASCII letters (protects
 *     Yoruba/Igbo diacritics) and single-word shouts ("HALLELUJAH").
 *   - Idempotent: chunkLyrics(rejoin(chunkLyrics(x))) === chunkLyrics(x).
 *   - Reuses sanitizeLyrics (pro6-parser) as the input-clean step — one source
 *     of truth, not a second divergent cleaner.
 */

import { sanitizeLyrics } from "./pro6-parser";
import {
  SONG_LINES_PER_SLIDE_TARGET,
  SONG_LINES_PER_SLIDE_MAX,
  SONG_WORDS_PER_LINE_SOFT,
  SONG_WORDS_PER_LINE_MAX,
  SONG_CHUNK_INPUT_MAX_CHARS,
  SONG_STRIP_EOL_PUNCT,
  SONG_NORMALIZE_ALLCAPS,
} from "./song-chunk-constants";

export interface ChunkOptions {
  linesPerSlideTarget?: number;
  linesPerSlideMax?: number;
  wordsPerLineSoft?: number;
  wordsPerLineMax?: number;
  stripEolPunct?: boolean;
  normalizeAllCaps?: boolean;
}

/** English boundary words we prefer to break BEFORE. Best-effort, English-biased
 *  (the spec downgrades "never mid-clause" to best-effort for vernacular). */
const BREAK_BEFORE = new Set([
  "and", "but", "for", "nor", "or", "yet", "so",
  "to", "of", "in", "on", "at", "by", "with", "from",
  "that", "when", "as", "who", "which",
]);

/** Canonical way to turn a prior chunk output back into a body for re-chunking.
 *  Slides are separated by a blank line so each becomes its own section on
 *  re-chunk. Used by the A2 re-chunk action (reChunkSong) for the slides→body
 *  step, and by the idempotency test. */
export function rejoinSlides(slides: string[]): string {
  return slides.join("\n\n");
}

export function chunkLyrics(body: string, opts: ChunkOptions = {}): string[] {
  if (typeof body !== "string") return [];

  const linesTarget = opts.linesPerSlideTarget ?? SONG_LINES_PER_SLIDE_TARGET;
  const linesMax = opts.linesPerSlideMax ?? SONG_LINES_PER_SLIDE_MAX;
  const wordsSoft = opts.wordsPerLineSoft ?? SONG_WORDS_PER_LINE_SOFT;
  const wordsMax = opts.wordsPerLineMax ?? SONG_WORDS_PER_LINE_MAX;
  const stripEol = opts.stripEolPunct ?? SONG_STRIP_EOL_PUNCT;
  const normCaps = opts.normalizeAllCaps ?? SONG_NORMALIZE_ALLCAPS;

  // Input guard: clamp size, normalize newlines, then strip control chars.
  // TAB is converted to a SPACE (NOT stripped) so tab/TSV-separated words keep
  // their boundary — stripping \t merged "Holy\tGod" → "HolyGod" (word-drop).
  // The control class below deliberately EXCLUDES \t (\x09) and \n (\x0a).
  let raw = body.length > SONG_CHUNK_INPUT_MAX_CHARS
    ? body.slice(0, SONG_CHUNK_INPUT_MAX_CHARS)
    : body;
  raw = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

  // Reuse the existing lyric cleaner (chords, pipe/slash separators, blank-line
  // collapse, trim). One source of truth — do not reimplement its rules here.
  const cleaned = sanitizeLyrics(raw);
  if (!cleaned.trim()) return [];

  const slides: string[] = [];

  // Blank line = section boundary.
  const sections = cleaned.split(/\n[ \t]*\n/);
  for (const section of sections) {
    const rawLines = section
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (rawLines.length === 0) continue;

    // Wrap over-long lines, then apply the grammar pass to every display line.
    const displayLines: string[] = [];
    for (const line of rawLines) {
      const wrapped = wordCount(line) > wordsMax
        ? wrapLine(line, wordsSoft, wordsMax)
        : [line];
      for (const w of wrapped) {
        const g = grammarPass(w, stripEol, normCaps);
        if (g.length > 0) displayLines.push(g);
      }
    }
    if (displayLines.length === 0) continue;

    // Group into slides, distributed as evenly as possible, never exceeding max.
    for (const group of groupEvenly(displayLines, linesTarget, linesMax)) {
      slides.push(group.join("\n"));
    }
  }

  return slides;
}

function wordCount(line: string): number {
  const t = line.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

/**
 * Wrap a single over-long line into multiple lines at phrase boundaries.
 * Guarantees each output line has ≤ max words and never splits a word, so a
 * single over-long token (e.g. a 40-char word) simply lands on its own line.
 */
function wrapLine(line: string, soft: number, max: number): string[] {
  const words = line.trim().split(/\s+/);
  const out: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    if (cur.length >= max) {
      out.push(cur.join(" "));
      cur = [];
      continue;
    }
    if (cur.length >= soft) {
      const endsPunct = /[,;:—–-]$/.test(words[i]);
      const next = words[i + 1];
      const nextIsBreakBefore = next !== undefined && BREAK_BEFORE.has(stripWord(next));
      if (endsPunct || nextIsBreakBefore) {
        out.push(cur.join(" "));
        cur = [];
      }
    }
  }
  if (cur.length > 0) out.push(cur.join(" "));
  return out;
}

function stripWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z']/g, "");
}

/** Distribute N lines across ceil(N/target) slides as evenly as possible; every
 *  slide ends up with ≤ target (and therefore ≤ max) lines. */
function groupEvenly(lines: string[], target: number, max: number): string[][] {
  const n = lines.length;
  if (n === 0) return [];
  const t = Math.max(1, Math.min(target, max));
  const numSlides = Math.ceil(n / t);
  const base = Math.floor(n / numSlides);
  let remainder = n - base * numSlides;

  const groups: string[][] = [];
  let idx = 0;
  for (let s = 0; s < numSlides; s++) {
    const size = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    groups.push(lines.slice(idx, idx + size));
    idx += size;
  }
  return groups;
}

/** Strip trailing periods/commas and normalize ALL-CAPS → sentence case,
 *  locale-safely. Order matters: strip punctuation first so casing sees the
 *  bare word set. */
function grammarPass(line: string, stripEol: boolean, normCaps: boolean): string {
  let s = line.trim();
  // Tidy internal punctuation/spacing (user directive 2026-08-26 — "a bit more
  // grammar work, like commas"): collapse runs of spaces, remove a space BEFORE
  // , ; : ! ? and ensure a single space AFTER , ; : when a word follows. Safe,
  // deterministic; runs before the end-of-line strip + casing.
  s = s
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,;:.!?])/g, "$1")
    // Add a single space AFTER , ; : when a word follows — but NEVER inside a
    // number/reference (digit-adjacent), or "10,000 Reasons" → "10, 000" and
    // "John 3:16" → "3: 16". The [^\s\d] lookahead skips a following digit, and
    // (?<!\d) skips a preceding digit, so thousands separators, times and
    // verse refs pass through untouched.
    .replace(/(?<!\d)([,;:])(?=[^\s\d])/g, "$1 ")
    .trim();
  if (stripEol) s = s.replace(/[.,;:]+$/, "").trimEnd();
  if (normCaps && isNormalizableAllCaps(s)) s = toSentenceCase(s);
  // 2026-08-30: fix the standalone pronoun "i" → "I" (and "i'm"/"i'll"/… — \bi\b
  // matches the i before the apostrophe) when casing normalization is on. Guarded
  // ASCII-only so Yoruba/Igbo lines (diacritics) are never touched. (First-letter
  // capitalization of every line was tried but changes existing golden chunk
  // output for all songs — deferred to a dedicated opt-in tidy flag + test pass.)
  if (normCaps && !/[^\x00-\x7f]/.test(s)) s = s.replace(/\bi\b/g, "I"); // eslint-disable-line no-control-regex
  return s;
}

/** True only for multi-word, ASCII-only, genuinely ALL-CAPS lines. Non-ASCII
 *  (Yoruba/Igbo diacritics) and single-word shouts ("HALLELUJAH") are skipped. */
function isNormalizableAllCaps(s: string): boolean {
  if (!/[A-Za-z]/.test(s)) return false;          // no letters → nothing to case
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(s)) return false;       // any non-ASCII → leave as-is
  if (s.trim().split(/\s+/).length < 2) return false; // single-word shout
  return s === s.toUpperCase() && s !== s.toLowerCase();
}

function toSentenceCase(s: string): string {
  const lower = s.toLowerCase();
  return lower.replace(/[a-z]/, (c) => c.toUpperCase());
}
