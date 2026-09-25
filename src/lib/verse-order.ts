/**
 * Keep the Bible tab's verse cards in SCRIPTURE order.
 *
 * Field report (Victor, 2026-09-22): after looking up Exodus 4:28, saying
 * "go back four" (-> 4:24) and then "go forward two" (-> 4:26), the cards read
 * 24, 28, 26. The NAVIGATION was right; the LIST order was not.
 *
 * Cause: `applyAdvancedVerse` appended on forward nav and prepended on reverse,
 * regardless of where the verse actually belongs. That keeps a straight
 * read-through contiguous (16, 17, 18) but scrambles any non-adjacent jump.
 *
 * This module is the pure, testable half. Two deliberate constraints:
 *
 *  1. It inserts IN ORDER only when the existing list is ALREADY sorted. The
 *     Bible tab has up/down buttons (`moveCard`) so an operator can arrange
 *     cards on purpose — silently re-sorting that would be its own regression.
 *     A hand-arranged list keeps the old append/prepend behaviour.
 *  2. It returns the insert INDEX, because every caller has to move the
 *     selection with the card. The old code hardcoded `length - 1` / `0`, which
 *     is wrong the moment the card lands in the middle — the next "next verse"
 *     would then walk from the wrong anchor.
 *
 * Sorting is by canonical book -> chapter -> verse as NUMBERS. Never by label
 * string: "4:10" would sort before "4:9", and book names do not sort
 * alphabetically into scripture order.
 */
import { parseReference, bookOrderIndex } from "./bible-parser";

/** Minimal shape this module needs — the real VerseCard has more fields. */
export type OrderableCard = { label: string; verses?: Array<{ verse: number }> };

/** [book, chapter, verse] — or null when the label cannot be parsed. */
export type VerseKey = [number, number, number];

/**
 * Sort key for a card. `parseReference` already tolerates a trailing
 * translation suffix ("Exodus 4:26 (KJV)"). The card's own `verses[0].verse` is
 * preferred over the parsed verse: every nav/lookup path builds one-verse cards
 * and that field is structured, where the label is display text.
 */
export function verseKeyOf(card: OrderableCard | null | undefined): VerseKey | null {
  if (!card?.label) return null;
  const ref = parseReference(card.label);
  if (!ref) return null;
  const book = bookOrderIndex(ref.book);
  if (!Number.isFinite(book) || book === Number.MAX_SAFE_INTEGER) return null;
  const verse = card.verses?.[0]?.verse;
  return [book, ref.chapter, typeof verse === "number" && Number.isFinite(verse) ? verse : ref.verseStart];
}

/** a < b ? -1 : a > b ? 1 : 0 over the [book, chapter, verse] triple. */
export function compareVerseKeys(a: VerseKey, b: VerseKey): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * True when every card that HAS a key is in non-decreasing order. Unparseable
 * cards (placeholders, reference-display-off) are skipped rather than treated as
 * "out of order" — they must not disable ordered insertion for everything else.
 */
export function isSortedByVerse(cards: readonly OrderableCard[]): boolean {
  let prev: VerseKey | null = null;
  for (const c of cards) {
    const k = verseKeyOf(c);
    if (!k) continue;
    if (prev && compareVerseKeys(prev, k) > 0) return false;
    prev = k;
  }
  return true;
}

export type InsertResult = { cards: OrderableCard[]; index: number };

/**
 * Insert `card` into `existing`.
 *
 * Ordered insertion when the list is already sorted AND the new card has a
 * usable key; otherwise the previous behaviour (append forward, prepend
 * reverse), so a deliberately hand-arranged list is never re-sorted.
 *
 * `dir` is the navigation direction: > 0 forward, < 0 backward. It is only
 * consulted for the fallback.
 */
export function insertVerseCard<T extends OrderableCard>(
  existing: readonly T[],
  card: T,
  dir: number,
): { cards: T[]; index: number } {
  const key = verseKeyOf(card);
  if (!key || !isSortedByVerse(existing)) {
    const cards = dir > 0 ? [...existing, card] : [card, ...existing];
    return { cards, index: dir > 0 ? cards.length - 1 : 0 };
  }
  // First position whose key is GREATER than the new card's.
  let at = existing.length;
  for (let i = 0; i < existing.length; i++) {
    const k = verseKeyOf(existing[i]);
    if (!k) continue;
    if (compareVerseKeys(k, key) > 0) { at = i; break; }
  }
  const cards = [...existing.slice(0, at), card, ...existing.slice(at)];
  return { cards, index: at };
}
