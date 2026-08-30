# Post-Service Fixes & Contextual Awareness — Plan (2026-08-30)

> Source of truth for the fixes arising from the JPD service on/around 2026-08-30.
> Ships one increment at a time through the six-agent ship gate (CLAUDE.md rule 2),
> dummy-app-first, no straight-to-main for anything >100 LOC or touching AI/auto-fire.
> Grounded in real JPD accented speech (rule 9), not idealized transcripts.

## The thesis: contextual awareness

The headline is not seven patches — it is **one cross-cutting capability**: the system must
understand, like a human in the room, *what kind of speech is happening right now*
(prayer vs storytelling vs reading scripture vs genuine navigation vs singing) and
*what the operator is doing* (typing, driving the preview), and use that to decide whether
to act or hold. African Pentecostal services ramble, repeat scriptures many times, tell
stories, and pray in worship-adjacent language. Without context the engine is doomed to
misfire. A single **Context Engine** makes song-during-prayer, story-"go back", repeat-refire,
and fighting-the-operator all behave correctly. Being *faster* is itself part of the fix:
when the AI keeps up, the operator does not have to press next and then battle the AI.

Non-negotiable: **additive, no regressions.** Every new signal only *downgrades* a confidence
into the existing manual-chip tier or *suppresses a re-fire* — no auto-fire bar moves, no gate
is rewritten, and with the flag off the system is provably byte-identical to today.

---

## Root causes (all confirmed by research, read-only)

| # | Issue | Root cause | Key files |
|---|-------|-----------|-----------|
| 1 | Songs fire during prayer ("in the mighty name of Jesus", "bless the Lord", "he is King") | No prayer/spoken-vs-sung discrimination anywhere. Title-token overlap (Dice ~0.8 → 80) + plan boost (+20 → 100) auto-projects. Rule 7 flags this OPEN. | `src/lib/ai-detection/song-match.ts`, `index.ts` (cap block 288–333) |
| 2 | "Romans four four eighteen" → Romans **4:4** (dropped 18), and it **overwrote** the correct live verse | `book_ch_space_verse` (`bible-parser.ts:887–905`) binds first two number atoms as ch:verse; no dedup of stuttered adjacent numbers. Mis-parse (4:4≠4:18) reads as a legit swap → replaces live verse. | `src/lib/bible-parser.ts`, `bible-antireplay.ts` |
| 3 | "Revelation" detected as "Romans" | Parser is innocent. Fly bridge **semantic-override** (`scripts/audio-server.ts:1016`) overwrites the parser's correct book with a Romans vector hit (a Romans verse containing the word "revelation") when parser conf 55 < 75. Latent on prod (embeddings broken on Fly) — fires wherever embeddings load. | `scripts/audio-server.ts:999–1017` |
| 4 | Verse re-fires/flickers when preacher repeats it (John 3:16 ×3) | The 2026-08-19 already-live suppression is fed the wrong field: it parses `liveSlide.text` (verse body) looking for a "John 3:16 (NIV)" label that only lives in `liveSlide.reference`, so it never recognizes a repeat → always `fire:different-ref-live`. Test fixture faked the slide shape, hiding it. | `ProOperatorShell.tsx:2296,2816`, `bible-antireplay.ts:43–55` |
| 5 | Story "go back"/"next" triggers verse nav | Bare `go back` mis-tagged as anchored (conf 75 → instant); "go back to Egypt/your seats" all fire; `hasVerseContext` satisfied by a stale verse live 20 min ago (no recency). | `src/lib/context-parser.ts:153`, `ProOperatorShell.tsx:3093–3212` |
| 6 | Preacher mode verses feel less automatic than auto mode | Scripture flow is **byte-identical** in preacher vs auto in code. Gap is the misleading mode toast ("Preacher = scripture prioritised") while auto-projection is gated on the separate **AUTO toggle**. Perception/UX, not a scripture bug. | `OperatorConsole.tsx:239–243`, `TopBar.tsx` |
| 7 | AI overrides the operator taking over (types James 4:9 / drives preview → AI yanks screen) | Two auto-fire chokepoints (`2298`, `2843`) never read the **already-existing** 4s sliding interaction stamp (`bibleCooldownUntilRef`, stamped on every click/keydown at `2949`). Typing guard (`2708–2717`) is point-in-time, only on chokepoint B, misses preview/click. | `ProOperatorShell.tsx` |
| 8 | Media library slow | `listMedia` fetches whole table, **no pagination, no `church_id` index** (seq scan); `MediaBrowser` re-fetches everything on every open, no session cache. Thumbnails already exist — it's the refetch, not image weight. | `services.ts:236`, `api/media/list/route.ts`, `MediaBrowser.tsx:105`, `schema.ts:190` |

---

## The Context Engine (centerpiece)

New pure modules (no React, no I/O — unit-testable like `bible-antireplay.ts`):
- `src/lib/ai-detection/context-engine.ts` — `ContextEngine` class + `ContextSnapshot`.
- `src/lib/ai-detection/context-lexicons.ts` — six class lexicons/regex banks.
- `src/lib/ai-detection/context-groq.ts` — Phase 3 only; async, graceful-degrading Groq classifier.

**Six speech classes**, each scored per utterance by a fast lexicon+cadence scan:
`PRAYER · SCRIPTURE_READING · PREACHING/STORYTELLING · WORSHIP_SINGING · EXPLICIT_NAV · ANNOUNCEMENT`.

**Rolling state:** ring buffer (last ~8 utterances / ~30s), EWMA per class, dominant class with
hysteresis + dwell time, `prayerStreak`, `recentRefs` (repeat awareness), current live kind.
Held as `contextRef` in `useAudioStream`, reset where `dedupeRef` resets. `observe(text)` runs at
`runDetectAll` cadence (finals + accepted interims) — O(tokens), no network → satisfies rule 10.

**Three downgrade-only signals → existing consumers:**
- (a) `isPrayerContext`/`isStoryContext` → extend the cap block at `index.ts:288–333` to cap
  song/lyric to `SUGGEST_CAP=84` during prayer (still a chip, never hidden; cue-announced songs bypass).
- (b) `isStoryContext` + `liveKind` → post-filter weak nav verbs ("go back"/"go on") at the
  `parseContextCommand` callsites; high-conf anchored nav ("go to the next verse") never suppressed.
- (c) `refJustRepeated()` → gate the `forceLive` in `useAudioStream:574` so an incidental repeat
  of an on-screen verse does not re-fire (belt-and-braces with the #4 fix).

**Groq assist (Phase 3, optional):** only on ambiguity-band utterances, async, downgrade/retract only;
natural ~1–2s pre-projection window lets a retract pre-empt a mistake. Build only if Phase-1/2 field
data leaves a meaningful tail. Graceful no-op when key missing (rule 6).

**Rollout flag:** `NEXT_PUBLIC_CONTEXT_ENGINE` + session override, default OFF. Off ⇒ `ctx.context`
undefined ⇒ every new branch is a no-op ⇒ parity with today (drift-guard test enforces).

---

## Never-override (operator-in-flow)

The app already stamps a 4s sliding timestamp on every click/keydown (`bibleCooldownUntilRef`,
`ProOperatorShell.tsx:2949`) — the chokepoints just never read it. Fix:
- Add `lastOperatorInteractionRef` + `operatorInFlow()` (4s sliding, matches existing cooldowns).
- Stamp inside the existing `cancel()` closures (`1142`, `2948`) + preview mutations; AI's own fires
  call `ctx.onSendSlideToLive` programmatically (no synthetic DOM events) so they never self-stamp.
- Check `operatorInFlow() && !voiceCommand && !forceLive` at both chokepoints (`2298`, after `2745`)
  and in `autoLiveSong`. When held, fall through to chip population (detection still becomes a tappable chip).
- Passive UX: a "Holding — you're driving · tap James 4:9 to apply" pill in `AITranscriptTicker`;
  no toast, no projector change. Voice nav still bypasses (explicit spoken intent).
- Auto-decays after 4s idle → AI resumes; never latches off.

---

## Number-stutter + no-overwrite (parser)

- Add `collapseStutteredNumbers(s)` in `normalize()` (`bible-parser.ts`, after line 547):
  collapse **three adjacent** number tokens where the first two are numerically equal
  (`four four eighteen` → `four eighteen` → 4:18). Guards: requires a **third** number
  (so "Genesis one one" stays 1:1); adjacency-only (so "Romans four verse four" stays 4:4);
  pre-fused compounds ("one one nine" → Psalm 119) are untouched.
- Secondary hardening (optional): `strandedTrailingNumber` flag → `decideBibleAutoFire`
  suppresses a same-book/same-chapter, stranded, equal-or-lower-confidence re-parse from
  replacing a live verse. Primary parser fix alone resolves the field report.

---

## Increment sequence

Each increment: feature branch → build → six-agent gate (parallel, background) → typecheck + tests →
verify (dummy app / real transcript corpus) → ship. Quick isolated wins first to de-risk and land
value before the next service; the Context Engine is the big elevated work.

| Inc | What | Risk | Rule-7 sign-off | Deploy |
|-----|------|------|-----------------|--------|
| **0** | Real-speech corpus: transcribe JPD audio via Deepgram → label 5 classes → fixtures + lexicon tuning | — | No | none (data) |
| **1** | Number-stutter collapse + no-overwrite-live-verse | Low | No | **Fly** (bundle w/ Inc 2) |
| **2** | Revelation→Romans: book-preservation guard in semantic override | Low | No | **Fly** |

> ⚠️ **Deploy note (coherence-gate catch):** `bible-parser.ts` is the authoritative LIVE parser inside the **Fly bridge** (`scripts/audio-server.ts`) — the renderer consumes an already-parsed reference. So Inc 1 is NOT fixed in a live service by a Vercel push alone; it requires `./scripts/deploy.sh audio`. Inc 1 + Inc 2 (both parser/bridge changes) ship in ONE Fly deploy, done manually with explicit go + v41 rollback ready (per the audio-bridge outage history). `deploy.sh audio` rebuilds from `Dockerfile.audio` (code-green ≠ container-green) and does NOT manage `INTERNAL_API_SECRET`/`INTERNAL_API_BASE` — the semantic path (and thus Inc 2's guard) is only live when those already exist on the Fly app.

> 🔭 **Inc 2b (deferred, stress-gate follow-up):** the current guard keeps the parser book on ANY cross-book vector hit. That's safe but rarely loses a legit correction of a *fuzzy-misspelled* book (e.g. "colatians" → keeps Galatians instead of Colossians). Cleaner design: expose a `bookMatchExact` flag from `parseReferences` and let `decideSemanticOverride` allow a high-similarity cross-book override ONLY when `bookMatchExact === false` (exact-variant books like Revelation never swap; fuzzy ones can be corrected). **Blocked on verification** that EVERY Revelation/Revelations spelling resolves via the exact-alias path (not fuzzy) before enabling — otherwise it reopens Revelation→Romans. Also note the `!parserBookValid` full-override branch is effectively dead code (parser books are always canonical); the real signal is exact-vs-fuzzy, not validity.
| **3** | Verse-repeat glitch: feed `.reference` to already-live guard + real-shape test | Low | No | Vercel |
| **4** | Context Engine Phase 1 (deterministic) + prayer→song cap | Med | No (additive, flag-off no-op) | Vercel |
| **5** | Context Engine Phase 2: story nav-suppression + repeat-vs-restatement | Med | No | Vercel |
| **6** | Never-override / operator-in-flow + passive chip | Med | **Yes** (touches auto-fire) | Vercel |
| **7** | Preacher-verse parity: fix toast copy + "AUTO is off" hint | Very low | No | Vercel |
| **8** | Media speed: session cache + pagination + `church_id` index | Low-Med | No | Vercel + migration |
| **9** | Context Engine Phase 3: Groq async assist (optional, data-driven) | Med | No | Vercel |

Proposed order: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8** (→ 9 if warranted). 1–3 are independent quick wins
that can start immediately (no corpus dependency); 4–6 are the contextual centerpiece; 7–8 are lighter and
can slot in parallel-ish. Media (8) is fully independent and could be pulled earlier if the operator pain is acute.

## Open decisions
- Preacher-mode songs: **DECIDED (2026-08-30) — guarded 95%+ exception.** A song may auto-project in
  preacher mode only at ≥95% AND with a strong disambiguation margin (well above the current 90 bar,
  and ≥PREACHER cap raised carefully); otherwise manual chip. "Even then it has to be super strong and
  really careful." Implemented in the context/preacher increment, NOT the quick wins. The prayer→song
  cap (Inc 4) is still what stops the actual misfires.
- Real-speech corpus: confirm `~/Downloads/AUDIO-2026-08-20-20-05-07.mp3` is JPD service audio;
  provide any YouTube URLs; approve Deepgram transcription (uses `DEEPGRAM_API_KEY`).

## Acceptance criteria (per increment, filled before building)
- 1: "Romans four four eighteen"→4:18; regression set (Gen 1:1, Matt 5:5, Psalm 119, "Romans four verse four") green; live Romans 4:18 not overwritten by a 4:4 re-read.
- 2: parser Revelation matrix stable; semantic override cannot change book when parser resolved a valid book; Fly deploy verified.
- 3: John 3:16 said 3× holds steady (no remount/animate); next/prev still project; real-slide-shape test added.
- 4: "in the mighty name of Jesus" during a prayer streak caps song ≤84 (chip, not fired); flag-off parity matrix identical to today.
- 5: story "go back"/"go back to Egypt" does not navigate while story context + no fresh live verse; anchored "go to the next verse" still instant.
- 6: James 4:7 live + operator typing 4:9 → screen stays 4:7, 4:9 appears as chip; after 4s idle it fires; voice "James 4:9" bypasses.
- 7: preacher-mode toast no longer implies scripture auto without AUTO; hint shown when Preacher on + AUTO off.
- 8: media list paginated + cached across mode-switches; `church_id` index added; first-open backfill off the hot path.
