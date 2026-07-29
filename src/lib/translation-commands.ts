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
 *   - Bare abbreviations ("NLT", "KJV") match directly — they're
 *     unambiguous speech. EXCEPT ambiguous English words (WEB, AMP, MSG)
 *     which need switch-intent context like full names do.
 *   - Full names ("king james", "new living translation") require a
 *     switch-intent verb within the ~10 words before the name — "King
 *     James was a monarch" must NOT switch, "let's read King James" must.
 *     Nigerian pidgin intents included ("make we read am for King James").
 *   - "the message" additionally must not be followed by "of" ("the
 *     message of hope" is everyday sermon language, not the MSG Bible).
 *   - 10s module-level cooldown (same pattern as voice-commands DEBOUNCE)
 *     so a re-heard phrase can't flip translations repeatedly.
 */

export type TranslationSwitchMatch = { code: string; matchedPhrase: string };

/** Public-domain set seeded by scripts/seed-bible.ts — the fallback when
 * the shell hasn't hydrated the live list yet. */
export const SEEDED_TRANSLATION_CODES = [
  "KJV", "WEB", "ASV", "DRC", "YLT", "DARBY", "GEN1599",
];

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

// Abbreviations that are ordinary English words / too collision-prone to
// fire without switch-intent context nearby. These ALSO match
// case-sensitively only ("WEB" not "web") — Deepgram capitalizes true
// acronyms, and lowercase "web"/"amp"/"msg" in a transcript is almost
// always the ordinary English word ("caught in a web of sin").
// Unambiguous abbreviations — never ordinary words, safe case-insensitive.
const UNAMBIGUOUS_ABBR_RE = /\b(NKJV|KJV|NIV|NLT|ESV|NASB|CSB|NCV|CEV|GNT|RSV|YLT|DRC|DARBY)\b/i;
// Ambiguous abbreviations — CASE-SENSITIVE (no /i), uppercase only.
const AMBIGUOUS_ABBR_RE = /\b(WEB|AMP|MSG|ASV)\b/;

// Longest-first so "new king james" wins over "king james", and
// "new american standard" (NASB) wins over "american standard" (ASV).
const FULL_NAMES: Array<{ phrase: RegExp; code: string }> = [
  { phrase: /\bnew king james\b/, code: "NKJV" },
  { phrase: /\bnew american standard\b/, code: "NASB" },
  { phrase: /\bnew international\b/, code: "NIV" },
  { phrase: /\bnew living\b/, code: "NLT" },
  { phrase: /\benglish standard\b/, code: "ESV" },
  { phrase: /\bking james\b/, code: "KJV" },
  { phrase: /\bamerican standard\b/, code: "ASV" },
  { phrase: /\bworld english\b/, code: "WEB" },
  { phrase: /\byoung'?s literal\b/, code: "YLT" },
  { phrase: /\bdouay(?:[ -]rheims)?\b/, code: "DRC" },
  { phrase: /\bdarby\b/, code: "DARBY" },
  { phrase: /\bgeneva bible\b/, code: "GEN1599" },
  { phrase: /\bamplified\b/, code: "AMP" },
  // "the message" is common sermon language ("the message of hope") —
  // never match when followed by "of", and still require intent context.
  { phrase: /\bthe message\b(?!\s+of\b)/, code: "MSG" },
];

// STRONG switch-intent phrases for full names and ambiguous abbreviations.
// Deliberately excludes near-universal words (in, for, from, the, go, turn,
// put, show) that made "caught in a web of sin" / "back in King James' day"
// fire. Includes Nigerian pidgin ("make we read", "read am").
const INTENT_RE = /\b(read|switch|use|open|version|translation|bible|give me|let'?s have|make we read|read am)\b/i;

function hasIntentBefore(text: string, matchIndex: number): boolean {
  const before = text.slice(0, matchIndex);
  // Last ~10 words before the match.
  const words = before.trim().split(/\s+/).filter(Boolean);
  const window = words.slice(-10).join(" ");
  return INTENT_RE.test(window);
}

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
  for (const { phrase, code } of FULL_NAMES) {
    if (!available.has(code)) continue;
    const m = phrase.exec(text);
    if (!m) continue;
    if (!hasIntentBefore(text, m.index)) continue;
    hit = { code, matchedPhrase: m[0] };
    break;
  }

  // 2) Bare abbreviations. Unambiguous ones (NIV, KJV, ...) fire without
  //    intent context, any casing. Ambiguous ones (WEB, AMP, MSG, ASV) are
  //    matched CASE-SENSITIVELY against the raw transcript (Deepgram
  //    capitalizes true acronyms) AND still require strong intent before.
  if (!hit) {
    const m = UNAMBIGUOUS_ABBR_RE.exec(transcript);
    if (m) {
      const code = m[1].toUpperCase();
      if (available.has(code)) hit = { code, matchedPhrase: m[0] };
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

  if (!hit) return null;
  if (now - lastFiredAt < COOLDOWN_MS) return null;
  lastFiredAt = now;
  return hit;
}
