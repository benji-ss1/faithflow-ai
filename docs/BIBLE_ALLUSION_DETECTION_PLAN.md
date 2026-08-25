# Bible Reference & Allusion Detection — Improvement Plan

**Status:** planned (3 subagents: map + design + risk, 2026-08-25). Not built.
**Goal:** on the live preacher transcript, detect scripture even when NOT cited — famous phrases/paraphrases ("the author and finisher of our faith" → Heb 12:2, "I am that I am" → Ex 3:14) — and be contextually aware of quoting ("it is written…", "the Lord said…", "in Romans…").

---

## Why it's weak today (verified — mostly mis-wiring, not missing capability)

1. **The live path uses the weaker of two searches the app already has.** A better `hybridSearch` (keyword-FTS ⊕ semantic-vector, RRF-fused, public-domain KJV+WEB) exists but is wired ONLY to the typed operator search box (`/api/bible/search`). The **live bridge calls vector-only `semanticSearch`** (`audio-server.ts` → `/api/internal/semantic-search`) — no keyword arm — so a verbatim quote ranks on embedding "vibe" alone and a topically-similar-but-wrong verse out-ranks the exact one.
2. **The curated phrase corpus is tiny (~234–500 entries) and missing the marquee examples** — "author and finisher" and "I am that I am" = 0 hits (`src/data/biblePhrases.ts`). `topPhraseForSpeech` (`src/services/bible/phraseSearch.ts`) is substring/keyword + 1-word fuzzy only.
3. **No "is this scripture-speech?" awareness** — nothing recognizes citation cues ("it is written", "the Lord said", "in Hebrews").
4. Conservative thresholds + vector-only means real quotes miss the ≥60% cliff; server semantic path degrades silently if secrets/embeddings/FTS-migration are missing.

---

## Design — two-tier, hot path stays pure-JS

Hard constraint: the **Fly audio bridge cannot embed** (broken native binary), latency (CLAUDE.md rule 10) forbids network on the hot path, and offline-first is a live epic. So:

- **Tier A — curated allusion index (hot, pure-JS, on-device):** the primary detector. Runs on every window, on Fly + offline, <10ms, no network. This is where most of the win is.
- **Tier B — full public-domain hybrid search (server, Vercel):** recall net for paraphrases Tier A misses. Off the hot path, cooldown-gated, never blocks Tier A emission.

### Corpus
- **Tier A** stays in `src/data/biblePhrases.ts` (bundled TS, Fly/offline-safe). Grow ~500 → ~1,200, biased to phrases spoken WITHOUT a reference (titles/creeds/idioms). `fullText` stays **KJV verbatim (public domain)**. Add fields: `allusionForms` (as spoken), `distinctiveTokens` (rare anchor words — "finisher", "sticketh"), `noSignalSafe` (distinctive enough to fire with no cue). Build-time n-gram + double-metaphone sidecar index.
- **Tier B** reuses the existing `bible_verses` table (KJV/WEB already have FTS + pgvector). **No new storage.** NIV/NKJV/NLT are NEVER indexed — match against public-domain wording, display the church's licensed translation fetched live at projection time.

### Matching
- **Multi-width sliding windows** {4,5,6,8,10}-grams over the last ~40 words (replaces single 40-word blob).
- **`normalizeForAllusion()`** shared helper: lowercase, strip punct, TH-fronting repair (rule 9), KJV↔modern lemma fold (thee/thou→you, saith→says, hath→have, -eth/-est) + contraction expand. This is what makes "I am who I am" match "I am that I am".
- **Three arms fused via the existing RRF:** (a) curated string/fuzzy (Tier A, pure-JS, always) upgraded to token-set Levenshtein + double-metaphone on distinctive tokens; (b) lexical FTS (Tier B); (c) semantic pgvector (Tier B). Curated hit gets an RRF rank boost.

### Context awareness — weight for curated, gate for semantic
`scripturalRegisterScore(window)` (pure-JS): explicit cues ("it is written", "the Lord said", "in <Book>", "Jesus said", "thus saith") = strong +20; KJV-register n-grams (thou/thee/verily/behold/saith) = weak +10; name proximity (Moses/Paul/David) = +5.
- **Weight (not gate) Tier A** — so bare famous phrases with NO cue still fire (`noSignalSafe`).
- **Gate Tier B** — a semantic-only match with generic wording and no cue must NOT surface (this is the false-positive source).

### Safety (non-negotiable guardrails, from the risk agent)
- **Allusions are manual-chip-only, hard-capped at confidence 74, NEVER auto-fire** — preserve BOTH clamp sites (`ai-detection/index.ts:126` + `useAudioStream.ts:545`) and the `!isPhraseMatch` exclusions from `forceLive`/`trustworthyForContext`. Auto-projection needs fresh rule-7 sign-off + field data (mirrors the 2026-07-28 sign-off).
- **Public-domain corpus ONLY (KJV/WEB).** No licensed text in the corpus/embeddings. Legal-class — confirm, never claim final.
- **Heavy matching off the client interim hot path.** `endpointing=100` unchanged.
- **Worship-stopword/distinctiveness guard binds the semantic layer too** — a themeless match during singing is suppressed (don't fire scripture over worship lyrics — the 2026-08-21 "who is seated at the right hand" incident).
- **Preserve anti-replay** (15s phrase cooldown), and test against REAL accented transcripts (rule 9).

---

## Increment plan (smallest high-value first)

**Increment 1 — Strengthen the curated hot path. SHIP FIRST.** Highest value, lowest risk, zero infra, works on Fly + offline.
- Add the missing famous allusions (Heb 12:2, Ex 3:14, …); reconcile the corpus-count drift; add `allusionForms`/`distinctiveTokens`/`noSignalSafe`.
- `normalizeForAllusion()` + multi-width windows + token-set/metaphone fuzzy in `phraseSearch`.
- Wire into `detectAll()`. Still ≤74, still chip-only.
- Tests incl. the user's two examples + sung-worship-paraphrase (must NOT fire).

**Increment 2 — Context weighting.** Pure-JS `scripturalRegisterScore()` as additive boost + Tier-B gate. No infra.

**Increment 3 — Proper hybrid fallback.** Route the live phrase path through `hybridSearch` (RRF FTS+pgvector) instead of raw `semanticSearch`. Requires: apply the FTS migration (`docs/migrations/2026-08-25-add-bible-verses-fts.sql`) + confirm the Vercel embed endpoint is healthy.

**Increment 4 — Later/optional.** Offline embeddings for Tier B; precision-data-driven tuning; the auto-projection graduation conversation.

Each increment ships through the six-agent gate + adversarial tests, preserving `test/bible-antireplay.test.ts` (21) and `test/service-mode.test.ts` (8) green.

---

## Decisions needed from the user
1. **Match-on-KJV, display-in-licensed-translation** — a match is found against public-domain (KJV) wording, but the slide projects in the church's chosen translation (NIV/etc.) fetched live. So the preacher may quote KJV words while the slide shows NIV. Acceptable? (This is already how the app works; the plan preserves it.)
2. **Auto-fire policy** — recommendation: allusions stay **manual-chip-only, never auto-project** until field precision data + fresh sign-off. Confirm.
3. **Corpus growth** — OK to bootstrap ~1,200 entries with an offline Groq pass over public "most-quoted verses/biblical idioms" lists, then human-review for accuracy + KJV/public-domain licensing?
4. **Apply the FTS migration to prod** (needed before Increment 3's keyword arm works) — I'll handle it; just confirming.
5. **Confirm the Vercel-side embedding endpoint is healthy** — Increment 3's semantic recall depends on it (Increments 1–2 do not).
