/**
 * Song slide chunking constants (songs only — never applied to Bible verses or
 * media). Lives in src/lib/ (NOT the client-coupled operatorConstants) so the
 * pure `song-chunk.ts` module stays I/O-free and unit-testable.
 *
 * Values are the research-backed defaults from docs/SONG_SLIDE_CHUNKING_SPEC.md
 * (deep-research run 2026-08-25, all claims verified 3-0). See §2 + §9.7.
 */

// Target lines per slide. Default 2 (conservative — the fold pinned this because
// there is no tempo signal on `songs`; the "3 for up-tempo" branch is deferred).
export const SONG_LINES_PER_SLIDE_TARGET = 2;

// Hard ceiling on lines per slide. Verified unanimous across church-media sources.
export const SONG_LINES_PER_SLIDE_MAX = 4;

// Prefer wrapping a line once it exceeds this many words…
export const SONG_WORDS_PER_LINE_SOFT = 6;

// …and force a phrase-boundary wrap once it reaches this many words.
export const SONG_WORDS_PER_LINE_MAX = 9;

// Input guard: reject/clamp absurd inputs before the phrase-boundary search
// (ReDoS / CPU guard on a crafted megabyte single line — Security fold §9.4).
export const SONG_CHUNK_INPUT_MAX_CHARS = 20_000;

// Strip trailing end-of-line periods/commas (the line break signals separation).
export const SONG_STRIP_EOL_PUNCT = true;

// Normalize ALL-CAPS lines → sentence case (locale-safe; skips non-ASCII lines
// so Yoruba/Igbo diacritics are never mangled, and skips single-word shouts).
export const SONG_NORMALIZE_ALLCAPS = true;

/**
 * Feature flag for Increment A1 (import-time chunking of NEW unstructured songs).
 * Default ON (verified by tests + the six-agent gate, and by A2 which shares the
 * same engine). Set SONG_CHUNK_ENABLED=0 to disable and fall back to the legacy
 * blank-line split. Server-side only (non-NEXT_PUBLIC).
 */
export function isSongChunkEnabled(): boolean {
  const v = process.env.SONG_CHUNK_ENABLED;
  return v !== "0" && v !== "false";
}
