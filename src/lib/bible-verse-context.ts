/**
 * Which chapter a bare "verse 2" means (2026-09-19 field report: said "Galatians 1",
 * then "verse 2", and the screen jumped to Galatians 2:2).
 *
 * Two gaps in the old rule (a single voice-only memory, set only at >=75%):
 *  1. "Galatians 1" (a whole-chapter mention, parser confidence 72) never became the
 *     context, so "verse 2" resolved against an EARLIER passage instead.
 *  2. The verse actually on the projector was ignored, so an operator who put
 *     Galatians 1:1 up by hand still got the preacher's stale chapter.
 * The newest of (last passage the preacher named, verse on the projector) now wins.
 */
import { knownBook } from "./bible-parser";
import { parseLiveScriptureRef } from "./bible-antireplay";

/** A detection this confident, with a real book, may become the bare-verse context. It
 * never fires anything by itself (auto-fire stays at 75); the fuzzy book patterns
 * (55, ~65 after blending) stay below it so "room 1:2" can't seed a chapter. */
export const BIBLE_CONTEXT_SEED_CONFIDENCE = 70;

export type VerseContext = { book: string; chapter: number };
export type StampedVerseContext = VerseContext & { ts: number };

/** Blended (parser x Deepgram) floor: a genuinely shaky transcript must not seed. */
export const BIBLE_CONTEXT_SEED_BLENDED_FLOOR = 60;

/** `parserConfidence` is the raw pattern confidence (identity of the match: an exact book
 * name is 72+, fuzzy books 55-60); `blended` is after the Deepgram utterance multiplier. */
export function seedsVerseContext(
  parserConfidence: number,
  blended: number,
  isPhrase: boolean,
  worshipHeld = false,
): boolean {
  // Worship mode deliberately holds detected scripture at chip-tier so a sung lyric that
  // happens to parse as a verse can't reach the projector. Such a detection must not
  // become the chapter a later bare "verse N" resolves against either — that bare verse
  // is nav-exempt from the cap and WOULD project.
  if (worshipHeld) return false;
  return !isPhrase && parserConfidence >= BIBLE_CONTEXT_SEED_CONFIDENCE && blended >= BIBLE_CONTEXT_SEED_BLENDED_FLOOR;
}

/** Book (canonical name) + chapter of the scripture verse currently live, or null. */
export function liveVerseContext(liveText: string | null | undefined): VerseContext | null {
  const live = parseLiveScriptureRef(liveText);
  if (!live) return null;
  const book = knownBook(live.book);
  return book ? { book, chapter: live.chapter } : null;
}

/** The newer of the preacher's last-named passage and the live verse; a tie goes to
 * the preacher (a mention and its own live projection are the same passage anyway). */
export function pickVerseContext(
  voice: StampedVerseContext | null,
  live: StampedVerseContext | null,
): VerseContext | null {
  const pick = !voice ? live : !live ? voice : voice.ts >= live.ts ? voice : live;
  return pick ? { book: pick.book, chapter: pick.chapter } : null;
}
