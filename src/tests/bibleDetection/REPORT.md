# Bible Detection Test Suite — Report

**Date:** 2026-07-26
**Total tests:** 787
**Passed:** 787 (100.00%)
**Failed:** 0
**Psalm 46:10 gate:** PASS (all 6 phrasings)

## By format

| Format | Result |
| --- | --- |
| abbreviated | 172/172 (100%) |
| conversational | 195/195 (100%) |
| deepgram | 74/74 (100%) |
| partial | 61/61 (100%) |
| spoken_full | 134/134 (100%) |
| spoken_short | 127/127 (100%) |
| tricky | 24/24 (100%) |

## By book

All 66 books at 100%. 0 books below the 97% threshold.

## Baseline vs. post-fix

- Before fixes: 781/787 (99.24%) — 6 failures
- After fixes: 787/787 (100.00%)
- Existing `src/lib/bible-parser.test.ts`: 27/27 (no regressions)

## Fixes applied to `src/lib/bible-parser.ts`

1. **`1 Chr` / `2 Chr` abbreviations added** to `RAW_BOOKS`. Previously only `1 chron` / `1 ch` variants existed, so the standard SBL abbreviation `1 Chr 16:11` returned zero matches.
2. **Single-chapter book + explicit `1:verse` notation.** `Philemon 1:6` was resolving to Philemon 1:1 because `single_chapter_book_verse` greedy-matched the `1` as the verse and discarded `:6`. Added negative-lookahead `(?!\s*:)` so colon forms fall through to `book_ch_colon_verse`, which now treats chapter=1 for single-chapter books as the verse marker. Covers Obadiah, Philemon, 2 John, 3 John, Jude.
3. **New `fuzzy_book_ch_space_verse` pattern.** Extends fuzzy Deepgram tolerance to spoken form (`filippians four thirteen` → Philippians 4:13). Previously only the colon shape fuzzy-matched. Guarded by: candidate ≥6 chars, must not be exact-known, must fuzzy-match a real book via `fuzzyBookMatch()`, chapter must validate.

## Phase 7 — push-to-live pipeline (verified by inspection)

- `parseReferences → parseReference → lookupReference()` (`src/lib/server/bible.ts`) uses `LOWER(book) = LOWER(?)` — book casing is safe.
- Whole-chapter (`Psalm 46`) → `parseReference()` sets `verseEnd = null`; downstream loads verse 1 first.
- Range (`Romans 8:28-30`) → `verseStart=28, verseEnd=30`, SQL `verse BETWEEN` loads all three slides.
- Unusual naming (Song of Solomon, 1 Chronicles) → `VARIANT_TO_BOOK` normalises variants to the canonical DB book name.
- Re-detection of a previously-shown verse → parser is stateless; anti-replay handled in `ProOperatorShell` with the different-ref-live bypass (CLAUDE.md rule 7).

## Known limitations (out of scope)

- **Two-word misspellings** (`first korinthians`) not covered — fuzzy layer is intentionally 1-word-only per the 2026-07-24 F1 fix. Two-word real names remain handled by the exact-variant table.
- **Extreme mishearings outside Levenshtein-2** (e.g. Deepgram rendering "Hosea" as "OA") need a phonetic layer trained on real transcript samples. Flagged in `bible-parser.ts:756`.
- The suite tests the parser in isolation; the Deepgram audio path and interim-final fast-path in `scripts/audio-server.ts` are covered by existing `test/deepgram-keyterms.test.ts` and manual field-testing.

## How to run

```bash
# Full suite (~1s)
npx tsx src/tests/bibleDetection/detectionTestRunner.ts

# Only failing books (<97%)
npx tsx src/tests/bibleDetection/detectionTestRunner.ts --failures-only
```

Exit code is non-zero if overall <97%, any book <97%, or the Psalm 46:10 gate fails — CI-ready.

## Changelog entry

`v0.1.65` added to `src/lib/changelog.ts` — What's New modal will surface to testers on next update push.
