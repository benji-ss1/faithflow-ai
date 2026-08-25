# Song Slide Chunking Spec (songs only)

**Status:** research-backed spec, not yet built. Source: deep-research run 2026-08-25 (25 claims, all verified 3-0, 0 refuted).
**Scope:** SONG lyrics only. This spec MUST NOT touch Bible-verse slides or media — the field complaint ("too clunky, too many words per slide") is about songs. Verses and media keep their current behaviour.
**Where it plugs in:** thresholds live alongside the existing song constants in `operatorConstants.ts`; chunking runs at song import/edit time (not on the hot detection path). Nothing here changes the auto-fire gates in `CLAUDE.md` rule 7.

---

## 1. Why this exists

One-to-two real users reported songs are clunky — too much text per slide. The research confirms this is the single biggest readability mistake in lyric projection: dense slides force small fonts, and (per multiple practitioner sources) *psychologically diminish congregational singing* because people lose their place when they glance up. The fix is smaller, phrase-based slides that break where the song is actually sung.

We are the only one of the compared tools (EasyWorship = fully manual; ProPresenter = manual-assist "Reflow") that would auto-chunk with a sung-boundary-aware algorithm. That's the differentiator — but auto-chunking must never override a deliberate operator break.

---

## 2. Hard rules (verified, high confidence)

| Rule | Value | Source basis |
|------|-------|--------------|
| **Max lines per slide** | `4` (absolute), `5` only as an escape hatch | CMG, MediaShout, ChurchJuice, WorshipTools — unanimous |
| **Target lines per slide** | `2–3` (default `2` for slow/worship, `3` for up-tempo) | CMG "balanced default" |
| **Words per line** | minimize; soft target `~6`, hard cap `~9` before forcing a wrap | Church Graphic Design "as few words per line as the lyrics allow" |
| **Break points** | PREFER phrase/breath/melodic boundaries; never break mid-word; clause-preservation is **best-effort** (English-biased heuristic — see §9 fold) | ChurchJuice, Renewing Worship |
| **Sizing order** | size font FIRST (large), then chunk to fit — never shrink font to fit more text | Church Graphic Design "bigger font is a forcing function" |

### Grammar / style rules (verified)
- **Strip end-of-line periods and commas.** The line break signals separation. (The Creative Pastor, MediaShout)
- **Keep internal commas ONLY where a genuine sung pause occurs** mid-line.
- **Sentence case / title style, NOT ALL CAPS.** All-caps reads as shouting and hurts readability. (Renewing Worship)
- Preserve intentional capitalization (line-start caps, "God"/"Lord"/"You" reverent caps).
- Typography defaults (already largely handled by the theme system, listed for the reviewer): sans-serif, 32–48pt sized to the farthest seat, line-height 1.2–1.5.

---

## 3. The chunking algorithm (songs only)

Input: a song's raw lyric text, already split into sections (verse/chorus/bridge/etc.) with section labels where available.

```
for each SECTION:
  1. Split the section into LINES on existing newlines (author's line breaks are
     the primary phrase signal — respect them first).
  2. For any LINE longer than WORDS_PER_LINE_MAX (~9 words):
     - find the best phrase boundary at/under the cap, in priority order:
         a. existing punctuation (— , ; :)  → break AFTER it
         b. a conjunction / preposition boundary (and / but / for / to / of / in)
            → break BEFORE the conjunction
         c. last resort: nearest word boundary under the cap
     - NEVER break so that a grammatical clause is split across the wrap.
  3. Group the resulting lines into SLIDES of LINES_PER_SLIDE_TARGET
     (2 slow / 3 up-tempo), never exceeding LINES_PER_SLIDE_MAX (4).
     - Prefer even splits: a 6-line section → 3+3, not 4+2.
     - Keep a couplet/rhyme pair together on the same slide when it fits.
  4. Apply grammar pass: strip trailing . and , ; normalize ALL-CAPS lines to
     sentence case (guarded — don't touch acronyms or single-word shouts like
     "Hallelujah").
```

### Hymns (metrical) — special case
- Detect metrical hymns (uniform ~8/6-syllable lines, 4-line stanzas). Common Meter `8.6.8.6`, Long Meter `8.8.8.8`.
- Chunk **by stanza**: default **2 lines/slide (couplet)**, full **4-line quatrain acceptable**. The metrical line-ends ARE the sung boundaries — do not re-break them.

### Contemporary P&W — repeated sections
- **Store each section once. On repeat, re-show the SAME chunked slides** (don't re-author). Keep a section→slides map + a repeat/sequence order.
- Concrete representation: when a chorus recurs, emit duplicate slide references pointing at the one authored chunk set (MediaShout: duplicate per repeat rather than loop-back — cleaner for the operator).

---

## 3a. Where the chunker runs — integration architecture (resolved 2026-08-25)

**Discovery:** chunking is NOT a render-time operation. Songs are stored pre-split as `song_slides` rows (one row = one slide, ordered, with a `lyrics` text and an optional `objects_json` rich-object model). The clunky slides were produced at **import time** by the parsers (`pro7-parser`, `pro6-parser`, `parsers/csv`, `parsers/propresenter`, `ai-helpers` AI-generation, `song-bulk-insert`). So the chunker has two call sites, and three safety rules.

### The pure module + two call sites
- **`src/lib/song-chunk.ts`** — pure function: `rawLyrics/lines → SlideText[]`. No DB, no I/O. Both call sites use it.
- **Call site 1 — import time.** New imports of *unstructured* lyric text get chunked by this module.
- **Call site 2 — re-chunk action.** An operator-triggered "re-chunk this song" that regenerates `song_slides` for an *existing* clunky song. This is how the current library gets fixed.

### Rule 1 — NEVER clobber deliberate author breaks (source classification)
Classify each import source by whether it already carries meaningful slide boundaries:
- **Structured (has author breaks): ProPresenter / Pro6 / Pro7 imports.** DEFAULT = preserve the author's slide boundaries. The chunker only intervenes on a single line that exceeds the hard word cap (wrap it at a phrase boundary) — it does NOT re-draw slide boundaries. Songs whose slides exceed `SONG_LINES_PER_SLIDE_MAX` are flagged as **re-chunk candidates** the operator can opt into — surfaced, never auto-applied.
- **Unstructured (no reliable breaks): AI-generated lyrics, plain-text paste, CSV lyric blobs without slide markers.** The chunker OWNS boundary creation here — this is the default path and the primary win.

### Rule 2 — NEVER clobber rich slides (`objects_json` + media overrides)
- The chunker operates on the `lyrics` text only.
- If ANY slide in a song has a non-empty `objects_json` (Phase 5D rich object model) or a per-slide media/background override, **re-chunk is blocked-by-default** for that song and requires explicit opt-in with a data-loss warning — because changing slide boundaries invalidates the per-slide object/media mapping. New unstructured imports (no objects yet) are unaffected.

### Rule 3 — both new imports AND the existing library (re-chunk is CONFIRM-GATED, not "undoable")
- Import-time chunking fixes *future* songs; the re-chunk action fixes the *existing* clunky library. Ship both, sharing the one pure module.
- **Correction (Security/Build-Standards fold):** delete+insert in one transaction is *atomic, not reversible* — there is no post-commit undo and `song_slides` has no version/soft-delete column. So re-chunk is a **preview-then-commit** action: the operator sees the proposed new chunking and confirms BEFORE the old rows are replaced. No silent destructive rewrite. (A true snapshot/version column is out of scope for Increment A2; preview-then-commit is the safety model.)

### Rule 4 — NEVER orphan a plan-item slide-order override (Coherence NO-GO blocker)
- `serviceItems.payload.slideOrder` is a `string[]` of `song_slide` UUIDs — a per-service-plan reorder/selection override. Re-chunk deletes old slides and inserts new rows with **new UUIDs**, so any plan referencing that song's slides would point at deleted IDs → **blank slides on the projector** (this is exactly incident `project_faithflow_song_refs.md`).
- **Rule:** before re-chunk, **block-by-default** any song referenced by a `serviceItems.payload.slideOrder` override (same treatment as Rule 2's rich-object songs), OR clear/remap those overrides inside the same transaction. Import-time chunking of *new unstructured* songs (call-site 1) is unaffected — no plan references them yet — so this applies to the re-chunk action only.

### Rule 5 — add the missing `song_slides(song_id)` index first (Speed blocker)
- `song_slides` has only a PK; the FK to `songs` does NOT auto-index `song_id` in Postgres, yet re-chunk's `delete … where song_id = ?` and every slide read filter on it. Add `index("idx_song_slides_song").on(t.songId)` as a small forward+rollback migration BEFORE shipping the re-chunk action. Additive, safe, trivially reversible.
- Re-chunk writes must reuse the existing **batched multi-row insert in a transaction** (`bulkInsertSongs` pattern, chunked at 5000 to dodge the param cap) — never INSERT-per-slide. Keep re-chunk **per-song / on-demand**; any future library-wide sweep must be a bounded, idempotent background job (like the sermon-backfill cron), not a synchronous request.

### Behind a flag
- All of the above ships behind a feature flag (songs-only). Bible-verse slides and media are on entirely separate code paths and are untouched — an adversarial test asserts no verse/media slide is ever routed through `song-chunk.ts`.

---

## 4. African / Black gospel — the vibe rules (verified structure, reasoned representation)

These follow from verified structural facts (call-and-response, improvisational vamps) but the slide-representation choices are OUR reasoned defaults — the research found no gospel-specific projection guidance. Flag as design decisions for sign-off, and validate on a real service.

1. **Call-and-response line type.** Support a per-line `role` = `lead | response | unison`. Lead and response can be styled/labelled distinctly (e.g. response indented or dimmed). The short response phrase is kept available for instant re-display. Chunking keeps a call and its response together on the same slide when they fit ≤4 lines.
2. **Loopable refrain / vamp ("selah").** A section can be flagged `loopable`. It renders as a single held slide the operator can repeat/hold indefinitely, plus a clean hold state for spontaneous ad-lib — NOT forced into a linear one-pass sequence. This is how gospel songs actually end (extended vamp/shout).
3. **Spontaneous / unscripted sections** must degrade gracefully: if the AI or operator has no pre-authored slide, hold the current refrain rather than going blank.

---

## 5. Resolved decisions (were open questions)

1. **Bilingual/vernacular lines — RESOLVED (user directive 2026-08-25): English first, one language at a time, switchable.**
   - **Default projected language = English.** Never stack two languages on a slide (that doubles density — the exact clunkiness we're fixing).
   - A song whose original is Yoruba/Igbo/Pidgin/Twi/etc. still **leads with English** *when an English version is stored*; the operator can **switch** that song to its original language on demand. Switching **replaces** the displayed text (still one language on screen), it does not stack.
   - The switch is a **live per-song toggle** the operator can hit during the service (worship shifts language mid-flow), plus a **per-church default preference** (default = English).
   - **Fallback:** if a song exists ONLY in the vernacular (no English version stored), show the vernacular — "English first" applies only when there's an English version to lead with.
   - **Inline code-switch** within a single sung line ("You are worthy / Iwo l'oba") stays on ONE line — never split by language (would break mid-phrase).
   - Call-and-response across languages is handled by the lead/response line ROLE (§4.1), not by the language toggle.
   - *Data-model implication:* a song needs an optional language variant (English + original) and a per-song current-language state; the projector reads the active variant. Confirm the songs schema can carry a variant/translation field at build time.
2. **Repeated-chorus representation — RESOLVED: store each section ONCE; the sequence references it on repeat.** For unknown-count gospel vamps/"selah", the refrain slide HOLDS (stays live until detection/operator moves on) — matches PresentFlow's existing hold-until-replaced live model + the `already-live` skip invariant. No duplicate-per-repeat, no guessing the count.
3. **Medleys — RESOLVED: model as a setlist of separate song entries, not a combined blob.** Uses the existing `servicePlans`/`serviceItems` ordered-setlist model + worship-mode setlist biasing. Songs stay separate (per-song AI detection + Spirit-led non-linear order); no dead slides because the current slide holds until the next song fires. Verify the setlist supports fast song-to-song at build time.

### Still genuinely unsourced / low priority
- **ProPresenter numeric maxima**: never published; our 4-line max rests on the broader church-media consensus, which is strong. No action.

---

## 6. Config surface (proposed constants, songs only)

Add alongside the existing song constants in `operatorConstants.ts` so they're one source of truth and tunable without code spelunking:

```ts
// Song slide chunking (songs only — never applied to Bible verses or media)
export const SONG_LINES_PER_SLIDE_TARGET = 2;   // 2 slow / bump to 3 for up-tempo
export const SONG_LINES_PER_SLIDE_MAX    = 4;    // hard ceiling
export const SONG_WORDS_PER_LINE_SOFT    = 6;    // prefer wrapping beyond this
export const SONG_WORDS_PER_LINE_MAX     = 9;    // force a phrase-boundary wrap
export const SONG_STRIP_EOL_PUNCT        = true; // remove trailing . and ,
export const SONG_NORMALIZE_ALLCAPS      = true; // ALL CAPS → sentence case (guarded)
```

Operator override is mandatory: an explicit author/operator break point always wins over auto-chunking (matches EasyWorship's manual model, which operators expect).

---

## 6a. Scope split — chunker vs. language switch

These are **two separable increments**; don't conflate them:
- **Increment A — the chunker (this spec's core).** Language-agnostic: it chunks whatever text is active into clean, phrase-broken slides. Ship this first; it fixes the "too clunky" complaint on its own.
- **Increment B — English-first language switch (§5.1).** A per-song English/original variant + live operator toggle + per-church default. Depends on a songs-schema language-variant field. Ship after A. The chunker doesn't need to change — it just re-chunks whichever variant is active.

## 7. Build plan (goes through the six-agent gate → dummy app)

1. Implement the chunker as a **pure, unit-testable module** (`src/lib/song-chunk.ts`) — no DB, no I/O, deterministic (Build-Standards agent will want this). Signature: `chunkLyrics(rawText, opts) → SlideText[]`.
2. Golden-file tests: a hymn (Common/Long Meter), a contemporary P&W song with a repeated chorus, an African gospel song with call-and-response + a vamp, a deliberately clunky over-long line, AND regression tests for the three §3a rules (structured import preserved; song with `objects_json` not re-chunked; unstructured blob chunked).
3. Wire into the **two call sites** (§3a): (a) import-time for unstructured sources, (b) an opt-in "re-chunk song" action for the existing library. Structured (ProPresenter/Pro6/7) imports preserve author breaks by default. Behind a feature flag; verses/media code paths untouched — adversarial test asserts no verse/media slide is ever routed through `song-chunk.ts`.
4. Run the **six-agent ship gate** (`docs/AGENT_WORKFLOW.md`). Coherence must return GO.
5. Push to the **dummy app** (`localhost:3000`, feature branch) — load a real clunky song, run re-chunk, eyeball that slides show fewer words and break on sung boundaries, confirm a ProPresenter import's author breaks are untouched and a rich-object song is not silently re-chunked. Only then consider `main`.
6. Changelog entry in `src/lib/changelog.ts` (operator-facing: "Songs now break into cleaner, easier-to-read slides").

---

## 8. Sources (all verified 3-0)

- Church Motion Graphics — lines per slide (2–3 default, 4 max) · line spacing
- The Creative Pastor — 1–4 lines, strip end-of-line punctuation
- MediaShout — density harm, duplicate-per-repeat for repeated lines
- ChurchJuice — ≤5 lines ceiling, break on lyrical pauses
- Church Graphic Design (UK) — minimize words/line, font-first forcing function
- Musicademy — dense slides force unreadable fonts, diminish singing
- Renewing Worship NC — break on melodic phrasing, no ALL CAPS, 32–48pt sans-serif
- WorshipTools (primary) — "Max lines per slide" auto-generation; 2 or 4 most common
- EasyWorship (primary) — manual Ctrl+Enter split + per-slide labels; no auto-paginate
- HymnalLibrary + Wikipedia (Long/Common Meter) — strophic quatrain structure
- Cohen/LibreTexts ethnomusicology — call-and-response, improvisational vamp/shout endings

---

## 9. Pre-build review fold (six-agent design pass, 2026-08-25)

The six-agent design review ran on this spec + the real code. Verdict: **NO-GO until the items below are folded** (now folded). Import-time chunking (A1) was already GO; the re-chunk action (A2) was the blocked path. This section is authoritative where it corrects earlier prose.

### 9.1 Corrected input/output contract (Reviewer 🔴)
The schema does **not** store sections/labels — `song_slides` is a flat, ordered list of `lyrics` strings (`objects_json` nullable). So:
- **Pure module signature:** `chunkLyrics(body: string, opts) → string[]` — takes a single lyric BODY (`\n`-separated lines), returns an ordered array of slide texts. Section/label awareness is **best-effort**, inferred from blank-line gaps and label lines *if present*, else the module is **section-agnostic** and just chunks lines.
- **Re-chunk (A2) needs a slides→body step FIRST:** existing slides are already chunks, so re-chunk = `join existing song_slides.lyrics with \n\n → body → chunkLyrics(body) → new slides`. This rejoin step is part of A2, not the pure module.
- **§3/§4 features that need structure that doesn't exist yet** (hymn-stanza detection, `loopable`, call-and-response `role`, language variant) require **new columns** → they belong to **Increment B / later**, NOT A1/A2. A1/A2 ship the density + grammar + phrase-wrap win only.

### 9.2 Degenerate-input contract (Stress 🔴) — explicit, tested
- `chunkLyrics("")`, whitespace-only, `"\n\n"` → **`[]`** (never a blank slide — `song_slides.lyrics` is `.notNull()`; a blank slide blanks the projector).
- Leading/trailing/inter-stanza blank lines → stripped, never emitted as slides.
- **Blank line = SECTION break; single `\n` = line break.** (Resolves the biggest ambiguity.)
- An over-cap **unbreakable single token** (40-char word/URL) → emit it on its own line/slide; char-level fallback so the break loop always terminates.
- **Idempotency is a hard guarantee:** `chunkLyrics(join(chunkLyrics(x))) === chunkLyrics(x)` — fixed-point test required.

### 9.3 Locale-safe casing (Stress 🔴 / Build-Standards 🟡) — protects the African-song core
- ALL-CAPS→sentence-case normalization must be **Unicode/locale-invariant** and must **skip any line containing non-ASCII letters** (Yoruba "Ọlọ́run tóbi", Igbo) — naive `.toLowerCase()` mangles diacritics and hits the Turkish dotless-i trap. Guard already excludes single-word shouts ("HALLELUJAH" stays as-is).
- English-only conjunction boundaries mean the "never mid-clause" rule is **best-effort**, not absolute (see §2). For vernacular lines with no English boundary words, prefer the author's existing line break and never break mid-word.

### 9.4 Security + concurrency criteria (Security 🔴/🟡, Speed 🟡)
- **Church-scope:** re-chunk reuses the `updateSongSlides` shape — `requireCap("edit_library")` + verify `songs.churchId === user.churchId` (two-hop; `song_slides` has no own `churchId`) before any write. **Adversarial test:** calling re-chunk with another church's `songId` must reject (rule 5 test in `test/adversarial/`).
- **Input cap:** bound chunker input length + strip control chars before chunking (ReDoS guard on a crafted megabyte line).
- **Never re-chunk a currently-LIVE song:** block/defer; wrap in a transaction (mirrors the `actions.ts:472` live-gap guard).
- **Concurrency:** guard concurrent re-chunk of the same song (optimistic version check or row lock) — no lost-update / orphan rows.
- **Grammar pass = one source of truth** with the existing `sanitizeLyrics` helper — do not add a second divergent cleaner.

### 9.5 Detection-safety (Coherence 🟢 verified, one test)
- The grammar pass is **invisible to song detection** — `song-match.ts` already `toLowerCase().normalize("NFKD")` + strips punctuation, so stripping trailing `.`/`,` and casing changes don't affect matching, PROVIDED the chunker only regroups/wraps words and **never drops or reorders** them.
- **Test:** a re-chunked song must still detect at **≥ its pre-chunk confidence tier** (long-line→two-line wrap slightly shifts per-line fragment trigrams; assert no tier regression).

### 9.6 Scope split — de-risk by shipping A1 before A2
The review shows almost all risk lives in the re-chunk-existing-library path. So split Increment A:
- **A1 — import-time chunking for NEW unstructured songs.** Pure module + wire into the unstructured import/paste path. **No migration, no plan-order risk, no live-collision** (nothing references a brand-new song). Already GO. Ships "new songs aren't clunky."
- **A2 — re-chunk the EXISTING library** (the operator action). Carries Rules 4+5, preview-then-commit, church-scope, live-block, concurrency, and the index migration. This is where your *current* clunky library gets fixed, so it's the higher-value but higher-risk half — ship it second, with all guards, through the full gate.

### 9.7 Decisions pinned (were "builder would have to guess")
1. **Feature flag:** one env/config key, songs-only, per-church scope. Name at build (e.g. `SONG_CHUNK_ENABLED`).
2. **"Confirmed" = operator preview-then-commit** (§3a Rule 3), not write-then-undo.
3. **Tempo:** no tempo signal exists → **default `SONG_LINES_PER_SLIDE_TARGET = 2`** for all songs in A1/A2; the "3 for up-tempo" branch is deferred until there's an operator/per-song setting to drive it.
4. **Hymn-meter detection: DEFERRED.** No reliable syllable input and it risks non-determinism. v1 respects the author's existing line breaks + word-cap wrap + grammar pass only. Meter-aware stanza chunking is a later refinement.
5. **Constants live in `src/lib/`** (a new `src/lib/song-chunk-constants.ts` or inside `song-chunk.ts`), NOT the client-coupled `components/operator/pro/operatorConstants.ts`, so the pure module stays I/O-free. (Supersedes §6's path.)

### 9.8 Net
Design is fundamentally coherent: songs-only holds, auto-fire gates and detection are genuinely untouched, the `objects_json` guard is correct. The pass caught one real data-loss blocker (plan-order orphan = a repeat of a known incident), a missing index, a false "reversible" promise, a wrong input contract, and the diacritic-casing trap — all now folded. **A1 is GO. A2 is GO once Rules 4+5 + preview-then-commit are implemented as specified here.**
