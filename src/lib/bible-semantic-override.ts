// Semantic-override decision for the live audio bridge (scripts/audio-server.ts).
//
// 2026-08-30 field bug (Revelation → Romans): the parser correctly resolved
// "Revelation 21:4" but at low confidence (55) because the ASR spelling was
// slightly off and the fuzzy pattern fired with needsSemanticFallback=true. The
// bridge then embedded the whole segment, ran a pgvector search, and — because
// the parser confidence was < 75 — OVERWROTE the book with the top vector hit,
// which was a Romans verse that merely contains the word "revelation" (e.g.
// Romans 16:25 "the revelation of the mystery"). Result: Revelation relabelled
// Romans on the projector.
//
// Root fix: the parser's BOOK identity is high-precision even at low confidence —
// low confidence reflects the NUMBER shape (chapter/verse), not the book. So the
// semantic hit may only:
//   • fully override when the parser resolved NO valid book, or
//   • refine chapter/verse when it AGREES with the parser's book.
// A cross-book vector hit must NEVER relabel the book. This is a pure function so
// it is unit-testable without standing up the WS bridge (mirrors bible-antireplay.ts).

import { knownBook } from "./bible-parser";

export type SemanticHit = { book: string; chapter: number; verse: number; distance: number };

export type ParserPosition = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  confidence: number;
};

export type OverrideResult = {
  book: string;
  chapter: number;
  vs: number;
  ve: number;
  confidence: number;
  /** what the decision did — for tracing/tests */
  action: "none" | "full-override" | "refine-position" | "keep-parser-book";
};

// Thresholds preserved from the original inline logic (audio-server.ts:1010-1020).
const SEMANTIC_SIM_MIN = 55; // vector hit must be at least this similar
const PARSER_CONF_MAX = 75; // only reconsider when the parser was unsure

export function decideSemanticOverride(
  parser: ParserPosition,
  top: SemanticHit | undefined,
): OverrideResult {
  let { book, chapter, confidence } = parser;
  let vs = parser.verseStart;
  let ve = parser.verseEnd;

  if (!top) return { book, chapter, vs, ve, confidence, action: "none" };

  // cosine distance: 0 = identical, 2 = opposite → similarity in [0..100].
  const semanticSim = Math.max(0, Math.round((1 - top.distance) * 100));
  let action: OverrideResult["action"] = "none";

  if (semanticSim >= SEMANTIC_SIM_MIN && confidence < PARSER_CONF_MAX) {
    const canonicalTop = knownBook(top.book) || top.book;
    const parserBookValid = !!knownBook(parser.book);

    if (!parserBookValid) {
      // Parser couldn't resolve a real book — trust the vector hit fully.
      book = canonicalTop;
      chapter = top.chapter;
      vs = top.verse;
      ve = top.verse;
      action = "full-override";
    } else if (canonicalTop === book) {
      // Same book — let the vector hit refine only the chapter/verse position.
      chapter = top.chapter;
      vs = top.verse;
      ve = top.verse;
      action = "refine-position";
    } else {
      // Parser resolved a DIFFERENT valid book than the vector hit → keep the
      // parser's book AND position. A cross-book hit (a Romans verse that merely
      // mentions "revelation") must never relabel Revelation → Romans.
      action = "keep-parser-book";
    }
  }

  // Blended confidence: weighted, never higher than the stronger signal, capped
  // at 95. Unchanged from the original — confidence blending never relabels.
  confidence = Math.min(95, Math.max(confidence, Math.round(0.6 * semanticSim + 0.4 * confidence)));

  return { book, chapter, vs, ve, confidence, action };
}
