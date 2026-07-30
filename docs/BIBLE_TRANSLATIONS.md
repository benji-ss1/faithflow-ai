# Bible Translations — recognition, availability, licensing

_Last updated: 2026-07-30._

## The 25 recognised translation codes

The spoken translation-switch detector (`src/lib/translation-commands.ts`)
recognises the following codes. Whether a code actually PROJECTS depends on
which translations are loaded in the DB (`bibleTranslations` +
`bibleVerses`) — the recogniser is vocabulary, availability is data.

| Code | Full name | Status | Recognised as |
|------|-----------|--------|--------------|
| KJV | King James Version | Public domain — seeded | "KJV", "King James" |
| NKJV | New King James | Licensed | "NKJV", "New King James" |
| NIV | New International | Licensed | "NIV", "New International" |
| ESV | English Standard | Licensed (free-tier API available — see below) | "ESV", "English Standard" |
| NLT | New Living | Licensed | "NLT", "New Living" |
| NASB | New American Standard | Licensed | "NASB", "New American Standard" |
| ASV | American Standard | Public domain — seeded | "ASV" (case-sensitive, intent-gated), "American Standard" |
| WEB | World English Bible | Public domain — seeded | "WEB" (case-sensitive, intent-gated), "World English" |
| AMP | Amplified | Licensed | "AMP" (case-sensitive, intent-gated), "Amplified" (intent-gated) |
| MSG | The Message | Licensed | "MSG" (case-sensitive, intent-gated), "The Message" (intent-gated, not followed by "of") |
| CSB | Christian Standard | Licensed | "CSB", "Christian Standard" |
| HCSB | Holman Christian Standard | Licensed | "HCSB", "Holman" |
| RSV | Revised Standard | Licensed | "RSV", "Revised Standard" |
| NRSV | New Revised Standard | Licensed | "NRSV", "New Revised Standard" |
| CEV | Contemporary English | Licensed | "CEV", "Contemporary English" |
| GNT | Good News | Licensed | "GNT", "Good News" |
| ISV | International Standard | Licensed | "ISV", "International Standard" |
| NCV | New Century Version | Licensed — not seeded | "NCV" |
| NET | New English Translation | Free (with terms) | "NET" (case-sensitive, intent-gated), "New English Translation" |
| YLT | Young's Literal | Public domain — seeded | "YLT", "Young's Literal" |
| DRA | Douay-Rheims American | Public domain | "DRA" |
| WBS | Webster's Bible | Public domain | "WBS", "Webster's" |
| BBE | Bible in Basic English | Public domain | "BBE", "Bible in Basic English" |
| DARBY | Darby | Public domain — seeded | "DARBY", "Darby" |
| GEN1599 | Geneva Bible (1599) | Public domain — seeded | "Geneva Bible" |
| DRC | Douay-Rheims Challoner | Public domain — seeded | "Douay-Rheims", "Douay Rheims" |

## Ambiguity gating (false-positive protection)

Some codes / full names collide with ordinary English:

- Ambiguous abbreviations (**WEB, AMP, MSG, ASV, NET**) require a
  switch-intent verb within ~10 words before the mention, AND are matched
  case-sensitively against the raw transcript. Deepgram capitalises true
  acronyms, so "caught in a web of sin" (lowercase web) never fires.
- Ambiguous full names (**"amplified", "the message"**) also require intent.
  "The message of hope" (followed by "of") never fires.
- **King James monarch guard**: "King James was a monarch", "back in King
  James' day" — a tail-regex catches monarch-adjacent phrasing so the KJV
  detector doesn't false-fire on historical narrative.
- **GNT gospel-phrase guard**: "good news of the gospel", "the good news
  is coming", "good news that Jesus saves" — a tail-regex mirrors the KJV
  guard (`good news` followed by `of|about|is|for|that|to|from`) so the
  bare "good news" full-name path doesn't false-fire on ordinary sermon
  speech. Bare `GNT` abbreviation still fires unambiguously, and
  "the Good News Translation" still fires (the guard does not match
  "translation" as the follower).

## "Not available" UX

When the preacher requests a code that isn't loaded (e.g. NIV, ESV, NLT
on a fresh install with only public-domain seeded content), the operator
sees a warning toast:

> NLT not available — showing KJV instead
> Heard "read that in NLT". Ask an admin to enable NLT — see docs/BIBLE_TRANSLATIONS.md for the ESV.org path.

The session translation is NOT switched — the currently-live verse stays
on-screen in the current translation. This is deliberate: silently
falling back to something the user didn't ask for would be worse than
leaving the current output as-is.

## ESV.org free-tier API (env-gated)

esv.org offers a free-tier API (5,000 queries/day) for developers building
non-commercial applications. To enable ESV fetching in PresentFlow:

1. Register at https://api.esv.org — get an API key.
2. Add to environment variables (Vercel dashboard or `.env.local`):
   ```
   ESV_API_KEY=your-token-here
   ```
3. Redeploy (or restart `next dev`).

The scaffold lives in `src/lib/server/esv-fallback.ts`:

- `fetchEsvVerses(book, chapter, verseStart, verseEnd)` returns
  `EsvVerse[] | null`.
- Null on env-not-set (silent no-op — expected default), network error,
  or empty result. Callers degrade gracefully.
- 24h in-memory cache, bounded to 500 entries with LRU-ish trim.
- 3s per-request timeout so a stalled API can never hang the service.

**Wiring point (not yet connected):** `src/lib/server/bible.ts` →
`lookupReference()`. When `translationCode === "ESV"` and the licensed-
translation guard would otherwise return `[]`, call `fetchEsvVerses`
first and, if non-null, return those verses instead. Wire this when the
Bible mode WIP branch lands so the two changes don't collide.

## Licensed translations that ARE NOT implemented

NIV, NLT, NASB, MSG, CSB, HCSB, AMP require paid licences from their
publishers (Zondervan, Tyndale, Lockman Foundation, NavPress, Holman,
Zondervan). PresentFlow does not currently license these. To add one:

1. Contact the publisher's rights team.
2. Negotiate a redistribution licence (typical: per-user or per-install
   fee, plus copyright display requirements).
3. Store the text in `bibleVerses` for the new translation ID, and set
   `bibleTranslations.licenseRequired = false` when the licence permits
   full-verse projection.

Until then, spoken requests for these codes surface the "not available"
toast and leave the current translation live.

## Cross-references

- Detector: `src/lib/translation-commands.ts` (74 unit tests in
  `test/translation-commands.test.ts`).
- Handler: `applyTranslationSwitch` in
  `src/components/operator/pro/ProOperatorShell.tsx`.
- ESV fallback scaffold: `src/lib/server/esv-fallback.ts`.
- Anti-replay policy (Bible auto-fire): `src/lib/bible-antireplay.ts` +
  CLAUDE.md rule 7 (2026-07-30 note).
