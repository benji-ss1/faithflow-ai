/**
 * JPD Fix 6 — spoken translation-switch detection.
 *
 * The preacher says "read that in NLT" / "let's go to the King James
 * Version" and PresentFlow switches the active Bible translation. This
 * module is the pure, testable detector; useAudioStream runs it on every
 * final transcript (right next to matchCustomCommand) and the shell owns
 * the side-effect (switch immediately in AUTO, offer a tap-to-confirm
 * suggestion otherwise).
 *
 * Matching rules (mirrors src/lib/voice-commands.ts conventions):
 *   - Only translations that actually exist in the DB can fire. Callers
 *     pass the available codes (from GET /api/bible/translations); the
 *     module also keeps a shared store the shell hydrates at mount so
 *     useAudioStream doesn't need its own fetch.
 *   - UNAMBIGUOUS names/abbreviations (NIV, KJV, King James, Amplified, ...)
 *     fire on ANY mention — no switch-intent verb required. Rationale (2026-
 *     07-30): the preacher's goal is that any translation MENTION becomes a
 *     switch. Only unambiguous vocabulary is safe for zero-context firing.
 *   - AMBIGUOUS names/abbreviations (WEB, AMP, MSG, ASV, "the message")
 *     STILL require strong switch-intent verbs. This is the false-positive
 *     protection ("caught in a web of sin", "the message of hope",
 *     "back in King James' day" for KJV-adjacent — actually KJV isn't in
 *     this list because it's unambiguous, King James was a monarch phrasing
 *     is caught by the "was a" adversarial test — see below).
 *   - "the message" additionally must not be followed by "of" ("the
 *     message of hope" is everyday sermon language, not the MSG Bible).
 *   - 10s module-level cooldown (same pattern as voice-commands DEBOUNCE)
 *     so a re-heard phrase can't flip translations repeatedly.
 *   - Availability gating: switching to a code the DB doesn't have does not
 *     fire the detector at all — the shell UI shows a "not available" toast
 *     when a licensed-only code is spoken (that flow is caller-owned; the
 *     detector's job is just to return the requested code).
 *
 * See docs/BIBLE_TRANSLATIONS.md for the full 24-code list, public-domain
 * vs licensed split, and the ESV.org API scaffold.
 */

export type TranslationSwitchMatch = { code: string; matchedPhrase: string };

/** Public-domain set seeded by scripts/seed-bible.ts — the fallback when
 * the shell hasn't hydrated the live list yet. */
export const SEEDED_TRANSLATION_CODES = [
  "KJV", "WEB", "ASV", "DRC", "YLT", "DARBY", "GEN1599",
];

/** Full 24 English translation codes recognised by the detector. Whether a
 * given code actually FIRES depends on availableCodes (the DB's list) —
 * this is just the vocabulary. Add here when a new translation ships in
 * the seeded DB or via a licensed provider path. */
export const RECOGNISED_TRANSLATION_CODES = [
  "KJV", "NKJV", "NIV", "ESV", "NLT", "NASB", "ASV", "WEB", "AMP", "MSG",
  "CSB", "HCSB", "RSV", "NRSV", "CEV", "GNT", "ISV", "NET", "NCV", "YLT",
  "DRA", "WBS", "BBE", "DARBY", "GEN1599",
  // Legacy code kept for backwards compatibility with the seeded DB — the
  // Douay-Rheims Challoner revision is stored under DRC in scripts/seed-bible.ts
  // while the user's expanded list uses DRA (a distinct edition of the same
  // translation family). Both spoken names route via FULL_NAMES→DRC below;
  // DRA is a separate bare-abbreviation path.
  "DRC",
] as const;

// ── Shared available-codes store ──────────────────────────────────────────
let availableStore: string[] = [...SEEDED_TRANSLATION_CODES];

/** Shell calls this once /api/bible/translations resolves. */
export function setAvailableTranslationCodes(codes: string[]): void {
  const cleaned = codes.map((c) => String(c || "").toUpperCase().trim()).filter(Boolean);
  if (cleaned.length > 0) availableStore = cleaned;
}

export function getAvailableTranslationCodes(): string[] {
  return availableStore;
}

// ── Cooldown (same pattern as voice-commands DEBOUNCE) ────────────────────
const COOLDOWN_MS = 10_000;
let lastFiredAt = 0;

export function resetTranslationSwitchCooldown(): void {
  lastFiredAt = 0;
}

// ── Vocabulary ────────────────────────────────────────────────────────────

// Unambiguous abbreviations — never ordinary English words, safe case-insensitive.
// 2026-07-30 expansion: added CSB, HCSB, NRSV, GNT, ISV, NET, DRA, WBS, BBE, NCV.
//   - HCSB, NRSV, ISV, NET, DRA, WBS, BBE — never ordinary words in sermon
//     transcripts (Deepgram either capitalises them or writes them as
//     initialisms; none collide with English vocabulary).
//   - NET is common in secular speech ("the net result") but Deepgram would
//     lowercase it there; we match case-insensitively via /i because Deepgram
//     capitalises when it hears an acronym. To keep NET safe we ALSO require
//     switch intent for it — moved to AMBIGUOUS_ABBR_RE below.
//   - GNT is unambiguous (never an English word).
// 2026-07-31: global flag added so we can scan ALL occurrences and return
// the first that is actually available — prevents "NKJV, NIV" from failing
// because NKJV (not in seeded DB) is found first but NIV (in DB) is ignored.
const UNAMBIGUOUS_ABBR_RE = /\b(NKJV|KJV|NIV|NLT|ESV|NASB|CSB|HCSB|NRSV|NCV|CEV|GNT|RSV|YLT|DRC|DRA|WBS|BBE|ISV|DARBY)\b/ig;

// Ambiguous abbreviations — CASE-SENSITIVE (no /i), uppercase only, AND require
// strong switch-intent context. The false-positive protection the "caught in a
// web of sin" / "back in King James' day" tests exercise MUST survive.
//   - WEB, AMP, MSG, ASV: ordinary English words (web/amplifier/message/as)
//   - NET: "the net result", "safety net" — common secular speech
const AMBIGUOUS_ABBR_RE = /\b(WEB|AMP|MSG|ASV|NET)\b/;

// ── ASR mishearings (rule-9-style homophone repair for translation names) ──
// Deepgram frequently drops the leading letter or spells codes out ("NIV" →
// "IV" / "N I V" / "N.I.V.", "ESV" → "E S V"). These collide with ordinary
// speech ("give her an IV", roman numeral IV), so EVERY misheard pattern is
// STRICTLY intent-gated (a switch-intent verb must precede it) AND availability-
// gated (only fires when the target translation is actually in the DB). Result:
// "do you have IV?", "can we read in N I V" resolve to NIV — but only once NIV
// is licensed/seeded. Extend as real transcripts reveal new mishearings.
const MISHEARD_NAMES: Array<{ phrase: RegExp; code: string }> = [
  { phrase: /\b(?:iv|n\.?\s?i\.?\s?v)\b/i, code: "NIV" },     // NIV → "IV" / "N I V" / "N.I.V"
  { phrase: /\b(?:e\.?\s?s\.?\s?v|esb)\b/i, code: "ESV" },    // ESV → "E S V" / "ESB"
  { phrase: /\bn\.?\s?k\.?\s?j\.?\s?v\b/i, code: "NKJV" },    // NKJV → "N K J V"
  { phrase: /\bk\.?\s?j\.?\s?v\b/i, code: "KJV" },            // KJV → "K J V"
  { phrase: /\bn\.?\s?l\.?\s?t\b/i, code: "NLT" },            // NLT → "N L T"
  { phrase: /\bn\.?\s?a\.?\s?s\.?\s?b\b/i, code: "NASB" },    // NASB → "N A S B"
  { phrase: /\bc\.?\s?s\.?\s?b\b/i, code: "CSB" },            // CSB → "C S B"
];

// Longest-first so "new king james" wins over "king james", and
// "new american standard" (NASB) wins over "american standard" (ASV).
// 2026-07-30 expansion: added full-name patterns for the remaining 24 codes
// listed by the user (Holman, Contemporary English, International Standard,
// New English Translation, Douay-Rheims, Webster's, Bible in Basic English,
// New Revised Standard, Christian Standard, Good News, Revised Standard).
//
// UNAMBIGUOUS full names are marked ambiguous: false → no intent verb required.
// AMBIGUOUS full names (short generic phrases that collide with English) stay
// intent-gated ("the message", "amplified", etc.).
const FULL_NAMES: Array<{ phrase: RegExp; code: string; ambiguous: boolean }> = [
  // Most specific / longest first.
  { phrase: /\bnew revised standard\b/, code: "NRSV", ambiguous: false },
  { phrase: /\bnew english translation\b/, code: "NET", ambiguous: false },
  { phrase: /\bnew king james\b/, code: "NKJV", ambiguous: false },
  { phrase: /\bnew american standard\b/, code: "NASB", ambiguous: false },
  { phrase: /\bnew international\b/, code: "NIV", ambiguous: false },
  { phrase: /\bnew living\b/, code: "NLT", ambiguous: false },
  { phrase: /\bbible in basic english\b/, code: "BBE", ambiguous: false },
  { phrase: /\bcontemporary english\b/, code: "CEV", ambiguous: false },
  { phrase: /\binternational standard\b/, code: "ISV", ambiguous: false },
  { phrase: /\bchristian standard\b/, code: "CSB", ambiguous: false },
  { phrase: /\benglish standard\b/, code: "ESV", ambiguous: false },
  { phrase: /\brevised standard\b/, code: "RSV", ambiguous: false },
  { phrase: /\bamerican standard\b/, code: "ASV", ambiguous: false },
  { phrase: /\bworld english\b/, code: "WEB", ambiguous: false },
  { phrase: /\byoung'?s literal\b/, code: "YLT", ambiguous: false },
  { phrase: /\bdouay(?:[ -]rheims)?\b/, code: "DRC", ambiguous: false },
  { phrase: /\bgood news\b/, code: "GNT", ambiguous: false },
  { phrase: /\bgeneva bible\b/, code: "GEN1599", ambiguous: false },
  { phrase: /\bholman\b/, code: "HCSB", ambiguous: false },
  // "KJB" = King James Bible — common ASR rendering of the same name.
  // Must appear before "king james" so the abbreviation is caught first.
  { phrase: /\bkjb\b/, code: "KJV", ambiguous: false },
  { phrase: /\bking james\b/, code: "KJV", ambiguous: false },
  { phrase: /\bwebster'?s\b/, code: "WBS", ambiguous: false },
  { phrase: /\bdarby\b/, code: "DARBY", ambiguous: false },
  // AMBIGUOUS — require switch intent:
  //   "amplified" is a common English word ("amplified the sound").
  { phrase: /\bamplified\b/, code: "AMP", ambiguous: true },
  //   "the message" is common sermon language ("the message of hope") — never
  //   match when followed by "of", and require intent context.
  { phrase: /\bthe message\b(?!\s+of\b)/, code: "MSG", ambiguous: true },

  // ── ASR mishears of translation NAMES (v2, 2026-08-12) ────────────────────
  // Deepgram garbles spoken abbreviations. All are marked ambiguous:true so
  // they ONLY fire with explicit switch intent (read/use/give me/can we…) —
  // most contain real English words ("cage", "naive", "easy", "nasa") that
  // would false-positive otherwise. Longest/most-specific spellings first.
  { phrase: /\bnew inter national\b/, code: "NIV", ambiguous: true }, // "new international" split
  { phrase: /\bcage v(?:ee?)?\b/, code: "KJV", ambiguous: true },     // "K J V" (v / ve / vee)
  { phrase: /\bkay jay vee?\b/, code: "KJV", ambiguous: true },
  { phrase: /\bknive\b/, code: "NIV", ambiguous: true },              // "NIV" (not a real word — safe)
  { phrase: /\ben eye vee?\b/, code: "NIV", ambiguous: true },
  // NB: "naive" deliberately NOT mapped — it is common English and co-occurs
  // with intent words ("the bible tells us not to be naive") constantly in
  // preaching, so even intent-gating false-fires. Adversarial review 🔴.
  { phrase: /\beasy v(?:ee?)?\b/, code: "ESV", ambiguous: true },     // "ESV"
  { phrase: /\byes vee\b/, code: "ESV", ambiguous: true },
  { phrase: /\be as v(?:ee?)?\b/, code: "ESV", ambiguous: true },
  // "nasa bee" only (require the full "bee"); bare "nasa be" collides with
  // "nasa be praised" and similar. Adversarial review 🔴.
  { phrase: /\bnasa bee\b/, code: "NASB", ambiguous: true },          // "NASB"
  { phrase: /\bnas bee\b/, code: "NASB", ambiguous: true },
];

// STRONG switch-intent phrases for ambiguous full names and ambiguous abbrs.
// Deliberately excludes near-universal words (in, for, from, the, go, turn,
// put, show) that made "caught in a web of sin" / "back in King James' day"
// fire. Includes Nigerian pidgin ("make we read", "read am").
// 2026-07-31: added "have", "want", "need", "can we", "can I", "let us"
// so "can we have ASV" / "I want NLT" / "let us use the WEB" are recognised.
// "have" alone in "caught in a web of sin" is never adjacent to an ambiguous
// abbreviation in that phrasing so the false-positive risk is minimal.
// 2026-08-15: added "get", "got", "put on", "bring up", "pull up", "technical"
// and question forms so the booth's natural phrasing switches versions —
// "can we get NIV", "technical, do you have IV", "pull up the NLT".
const INTENT_RE = /\b(read|switch|use|open|version|translation|bible|give me|let'?s have|make we read|read am|have|want|need|can we|can i|let us|try|go with|go to|get|got|put on|bring up|pull up|technical|do you have|do we have)\b/i;

// Trailing intent — words that AFTER a (possibly-misheard) code still clearly
// mean "the <X> translation": "IV please", "IV version", "NIV bible".
const TRAILING_INTENT_RE = /^\s*(please|version|translation|bible|scripture)\b/i;

function hasIntentBefore(text: string, matchIndex: number): boolean {
  const before = text.slice(0, matchIndex);
  // Last ~10 words before the match.
  const words = before.trim().split(/\s+/).filter(Boolean);
  const window = words.slice(-10).join(" ");
  return INTENT_RE.test(window);
}

// Intent either before OR immediately after the match — used for the misheard
// path so "IV please" / "IV version" count even with no leading intent verb.
function hasIntentAround(text: string, matchIndex: number, matchLen: number): boolean {
  if (hasIntentBefore(text, matchIndex)) return true;
  const after = text.slice(matchIndex + matchLen);
  return TRAILING_INTENT_RE.test(after);
}

// A KJV false-positive we cannot fix by intent alone: "back in King James'
// day" has no intent verb before it, so intent-gating already suppresses
// it. The user's directive is that unambiguous names fire on ANY mention,
// but "king james" collides with the monarch. Belt-and-braces guard: skip
// KJV matches when followed by descriptors that unambiguously mean the
// person (was/is/became/reigned/ruled/etc.).
const KJV_MONARCH_TAIL_RE = /\b(king james)(['’]?s?)\s+(day|days|reign|reigned|time|era|was|is|became|court|throne|england)\b/i;

// GNT "good news" false-positive guard — "good news" is one of the most
// common sermon phrases ("good news of the gospel", "the good news is",
// "good news that Jesus saves", "good news for all", "good news we preach").
// Mirrors KJV_MONARCH_TAIL_RE: when a preposition/verb/pronoun clearly
// frames "good news" as ordinary speech, do NOT fire GNT via the full-name
// path. The bare "GNT" abbreviation still fires unambiguously. Sermon phrases
// like "the good news of the gospel" should never switch translations.
// 2026-07-31: extended to catch "good news we/they/I/he/she preach/bring/
// brought/came/proclaimed" and "good news for all/everyone/us/the world".
const GNT_GOSPEL_TAIL_RE = /\bgood news\b\s+(of|about|is|for|that|to|from|we|they|i|he|she|all|everyone|us|the world|brought|brings|we preach|proclaimed)\b/i;

/**
 * Detect a spoken translation-switch request in a final transcript.
 * Returns the target code + matched phrase, or null. Applies the 10s
 * module-level cooldown unless `opts.now` shows it has elapsed.
 */
export function detectTranslationSwitch(
  transcript: string,
  availableCodes: string[] = getAvailableTranslationCodes(),
  opts: { now?: number } = {},
): TranslationSwitchMatch | null {
  if (!transcript) return null;
  const available = new Set(availableCodes.map((c) => c.toUpperCase()));
  if (available.size === 0) return null;
  const text = transcript.toLowerCase();
  const now = opts.now ?? Date.now();

  let hit: TranslationSwitchMatch | null = null;

  // 1) Full names first (more specific than abbreviations; also avoids
  //    e.g. transcript "King James Version KJV" double-reads).
  //    Unambiguous names fire on any mention; ambiguous ones need intent.
  for (const { phrase, code, ambiguous } of FULL_NAMES) {
    if (!available.has(code)) continue;
    const m = phrase.exec(text);
    if (!m) continue;
    // KJV monarch guard — "King James was a monarch" / "back in King James' day"
    // etc. shouldn't switch. Only applied to the KJV / king-james entry.
    if (code === "KJV" && KJV_MONARCH_TAIL_RE.test(text)) continue;
    // GNT gospel-phrase guard — "good news of the gospel", "good news that
    // Jesus saves", "the good news is" are all common sermon speech, not
    // translation switches. Bare "GNT" abbreviation still fires via the
    // UNAMBIGUOUS_ABBR_RE path below.
    if (code === "GNT" && GNT_GOSPEL_TAIL_RE.test(text)) continue;
    if (ambiguous && !hasIntentBefore(text, m.index)) continue;
    hit = { code, matchedPhrase: m[0] };
    break;
  }

  // 2) Bare abbreviations. Unambiguous ones (NIV, KJV, ...) fire without
  //    intent context, any casing. Ambiguous ones (WEB, AMP, MSG, ASV, NET)
  //    are matched CASE-SENSITIVELY against the raw transcript (Deepgram
  //    capitalizes true acronyms) AND still require strong intent before.
  //
  //    2026-07-31: scan ALL unambiguous matches (UNAMBIGUOUS_ABBR_RE now has
  //    /g flag) so "NKJV, NIV" finds NIV even though NKJV is encountered
  //    first but is not in the seeded/available DB. Return the first hit that
  //    is actually available.
  if (!hit) {
    UNAMBIGUOUS_ABBR_RE.lastIndex = 0; // reset /g state before scanning
    let m: RegExpExecArray | null;
    while ((m = UNAMBIGUOUS_ABBR_RE.exec(transcript)) !== null) {
      const code = m[1].toUpperCase();
      if (available.has(code)) { hit = { code, matchedPhrase: m[0] }; break; }
    }
  }
  if (!hit) {
    const m = AMBIGUOUS_ABBR_RE.exec(transcript);
    if (m) {
      const code = m[1];
      if (available.has(code) && hasIntentBefore(text, m.index)) {
        hit = { code, matchedPhrase: m[0] };
      }
    }
  }

  // 4) ASR mishearings — STRICTLY intent-gated + availability-gated. Handles
  //    "do you have IV" (NIV), spelled-out "N I V", "E S V", etc. Only fires
  //    when a switch-intent verb precedes the mangled code AND the translation
  //    is actually available, so it can't false-fire on ordinary speech.
  if (!hit) {
    for (const { phrase, code } of MISHEARD_NAMES) {
      if (!available.has(code)) continue;
      const m = phrase.exec(text);
      if (m && hasIntentAround(text, m.index, m[0].length)) { hit = { code, matchedPhrase: m[0] }; break; }
    }
  }

  if (!hit) return null;
  if (now - lastFiredAt < COOLDOWN_MS) return null;
  lastFiredAt = now;
  return hit;
}
