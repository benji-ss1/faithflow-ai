# OpenFlow — Implementation Plan (PresentFlow desktop)

Status: PLAN FOR REVIEW. No component code written yet. Build only after approval.

**Locked decisions (2026-08-26):**
- No hard Sunday deadline — build Phase 1 properly through the loop, no compression. Increment order still follows the §10 slice (shell+welcome+Chat -> Service Builder+Apply-to-Service -> Scripture/Songs) so there is a demoable path early.
- Song usage: degrade now (real "most used" counts, no last-used), add per-song usage tracking in Phase 3 (D2).
- Entry point: left-rail "OpenFlow" gradient wordmark only (no TopBar tab).
- D3 (image-gen provider) remains open, Phase 2 — options brought for approval at Capability 2.

This plan is grounded in the actual PresentFlow codebase (verified file:line references throughout), not the spec in the abstract. Where the spec and reality diverge, the divergence is called out explicitly with a recommendation.

---

## 0. Ground rules (carried into every file)

- **No emoji. Anywhere.** Not in code, JSX, comments, notification/toast text, placeholders, or docs. Visual indicators are `@tabler/icons-react` components only. This is enforced by a lint check added in Phase 1 (see §9).
- **Desktop-first.** OpenFlow targets `ProOperatorShell` (the Electron desktop shell), not the legacy web `OperatorShell`. Ref: `OperatorConsole.tsx:1961`.
- **Dedicated Groq key.** OpenFlow calls Groq through `OPENFLOW_GROQ_API_KEY`, a NEW env var, via its own server module — never the shared `GROQ_API_KEY` client used by verse/song detection.
- **Church data is authoritative, never invented.** Songs come from the library; verse text comes from `lookupReference()`; church stats come from the DB. The LLM composes and reasons, it does not fabricate content.
- **Ships through the loop.** Every increment: Plan -> Build -> six-agent gate -> Fix -> dummy-app verify -> file-scoped commit + changelog entry -> push. Live-output and church-scoped paths get the full gate.

---

## 1. Reuse inventory (what already exists)

### 1a. The mocked prototype on `feat/ai-chat-sidebar` (NOT merged)
A complete but fully-mocked chat UI lives on that branch under `src/components/operator/aichat/*` (`AIChatPanel.tsx`, `cards.tsx`, `messageblocks.tsx`, `types.ts`) plus a `--pf-*` token block in `globals.css:83-163`. Nothing is on `main`.

**Reuse (port the interaction logic, reskin the surface):**
- Greeting hero (time-of-day greeting, centered composer, quick-action pills)
- Composer (autosize textarea, Enter-to-send, attach/dictate buttons, model pill)
- Mode selector (active-pill row + "soon" chips)
- Message thread + asymmetric bubbles
- `messageblocks` primitives: `ReasoningTrace`, `ToolUseCard`, `StreamingText`, `ThinkingDots`
- `ServicePlanCard` — already has working `@dnd-kit` drag-reorder. This is the single most valuable piece to port.

**Rebuild / replace for OpenFlow:**
- Fonts -> **Inter** (prototype uses Playfair + system stack)
- Accent -> **orange/coral gradient `#E8742A -> #D4537E -> #9B8FE8`** (prototype is amber->orange)
- Icons -> **Tabler** (prototype is lucide-react)
- Backend -> the entire Groq/streaming/tool layer is faked (`demoReply`, `setTimeout`, client typewriter). Build for real.
- Voice -> prototype is visual-only; real capture is unbuilt.
- **Do NOT carry** the dev-login bypass (`api/dev-login`, middleware autologin, `dev-desktop.sh`) that also sits on that branch.

Decision: build fresh under `src/components/operator/openflow/*` (the spec's structure) and port the prototype's proven pieces file-by-file. Keeps a clean history and avoids inheriting the mock scaffolding.

### 1b. Shell integration points (verified)
| Concern | Location | Change |
|---|---|---|
| Center-mode union | `ProOperatorShell.tsx:96` | add `"openflow"` to `CenterMode` |
| Center-mode state | `ProOperatorShell.tsx:1480` | reuse `centerMode`/`setCenterMode` (no new state) |
| Center render switch | `ProOperatorShell.tsx:4082-4092` | add `centerMode === "openflow" ? <OpenFlowPanel ctx={ctx}/> : ...`, wrapped for crossfade |
| Left-rail entry point | `ProOperatorShell.tsx:4056` (between `PlaylistSection` and `MediaSection`) | mount `<OpenFlowSidebar onOpen={() => setCenterMode("openflow")} active={centerMode === "openflow"} />` |
| Optional TopBar tab | `TopBar.tsx:240-244` | optionally add `{ id:"openflow", label, icon }` to `FluidTabs.tabs` (auto-wires) |

### 1c. Apply-to-Service (real playlist mutation)
- Songs / media: `ctx.onAddLibraryItem(kind, {id, title})` (`OperatorConsole.tsx:1785`) and `ctx.onAddMediaGroup(title, ids)` (`:1865`) — these already give optimistic append + toast + Undo + `router.refresh()`.
- Scripture: `addServiceItem(ctx.planId, "scripture", ref, { reference, verses })` (`actions.ts:151`) or bulk `addServiceItems(...)` (`:194`), then call `router.refresh()` from the panel (mirror `BibleMode.tsx:247`).
- **Gotcha:** the item type is `"scripture"`, not `"bible"`. Payload shapes are validated in `actions.ts:85-149`.
- Active plan id: `ctx.planId` (`shell/types.ts:91`).

### 1d. AI + data plumbing
- Groq today: hand-rolled `fetch` (no SDK), single-shot only, no streaming. Template to copy for a dedicated client: `src/lib/server/sermon-rag.ts:184-228`. Streaming-route template: `src/app/api/imports/parse/route.ts:132-156`. Model ladder + 429 fallback: `src/lib/groq-fallback.ts` (reuse `getGroqActiveModel`/`markGroqPrimaryLimited`).
- Auth in routes: `apiUser()` (`session.ts:67`) -> 401 if null; churchId comes from the session, never the request body.
- Scripture text: `lookupReference()` (`bible.ts:186`) + `parseReference()` (`bible-parser.ts:1213`) + `listTranslations()` code->id (`bible.ts:116`). Never let the LLM emit verse text.
- Songs: `listSongs(churchId)` (`services.ts:211`). Frequency: `getChurchPatterns(churchId).topSongs` (`service-patterns.ts:156`).

### 1e. Live-detection layer (for the Hebrew/Greek bubble)
- Client transcript tap: `useAudioStream.ts:381 runDetectAll` (runs on interim-candidate + final); final path at `:1690`.
- Chip/bubble pattern to mirror: song chip `ProOperatorShell.tsx:390-445` (Project + Add-to-Playlist + Dismiss, with a 10s cooldown Map at `:235-239`).
- Project a custom slide: `ctx.onSendSlideToLive({ kind:"text", text, reference }, null, { instant:true })` (`OperatorConsole.tsx:822`; `reference` renders as a fixed footer, `broadcast.ts:35-38`).
- Cooldown/anti-replay to reuse: `songClickFiredAtRef` Map pattern bumped to 30s + a pure `decideHebrewGreekFire` helper modeled on `bible-antireplay.ts`.
- Keyterms: `deepgram-keyterms.ts` loader + `config/deepgram-keyterms/*.json`; Fly bridge sends them (`audio-server.ts:259-275`) with a **hard 100-term Deepgram cap**.

---

## 2. Spec-vs-reality gaps (decisions needed)

| # | Spec says | Reality | Recommendation |
|---|---|---|---|
| D1 | Model `llama-3.3-70b-versatile` | Live primary is `openai/gpt-oss-120b` (env `GROQ_MODEL`); the ladder falls back to `llama-3.1-8b-instant` | Give OpenFlow its own `OPENFLOW_GROQ_MODEL` env (default `llama-3.3-70b-versatile` per spec) so it is independent of the detection model. Non-blocking. |
| D2 | churchContext includes per-song "sung 23 times, last used 2 weeks ago" and rich per-preacher stats | Per-song usage frequency and last-used are **NOT tracked**; only aggregate `topSongs {title,count}` exists. No first-class "preacher" entity (only `sermonMetadata.speakerName` per deck). | Phase 1 **degrades gracefully**: use `topSongs` counts for "most used", omit last-used and preacher stats until a usage-tracking increment is built (Phase 3, §7). OpenFlow's prompt must not claim stats it doesn't have. |
| D3 | Image generation via "Stability / DALL-E / Replicate (TBC)" | No image provider wired; global policy is Groq-only + "ask before adding any provider" | **Open decision, Phase 2.** Does not affect the Sunday deadline. Bring provider + cost for approval when we reach Capability 2. |
| D4 | Send ~150-200 Hebrew/Greek terms as Deepgram keyterms | Deepgram caps at 100 keyterms/connection; merge already hard-caps at 100 | Ship the full 150-200 list as a **client-side post-transcription matcher** (in `runDetectAll`); send only the top ~30-40 highest-value terms as keyterms for recognition accuracy. |
| D5 | Voice input "use Deepgram (already integrated)" | The live Deepgram stream is service-audio via the Fly bridge, not a push-to-talk mic capture for the composer | Phase 2 voice uses the browser Web Speech API (`SpeechRecognition`) for push-to-talk in the composer; the prototype's visual overlay is reused. Deepgram stays the live-service path. |

None of D1-D5 block Phase 1 (chat + service builder + scripture + songs). D3 is the only true "needs your input" item and it is Phase 2.

---

## 3. Component tree

```
src/components/operator/openflow/
  OpenFlowSidebar.tsx        Left-rail entry (Feature 1): "OpenFlow" gradient wordmark, opens center panel
  OpenFlowPanel.tsx          Center-panel host: swaps welcome <-> chat, owns the OpenFlow session state
  OpenFlowWelcome.tsx        Greeting screen (particles bg, time-aware greeting, centered composer, pills)
  OpenFlowChat.tsx           Message thread (scrolls), autoscroll, streaming render
  OpenFlowInput.tsx          Composer: textarea + [+] file + [mic] + mode dropdown + [send]
  OpenFlowModeDropdown.tsx   Chat / Service Builder / Image / Scripture / Songs selector
  OpenFlowVoiceInput.tsx     Voice overlay (Phase 2)
  OpenFlowFilePreview.tsx    File thumbnail chips in composer (Phase 2)
  OpenFlowParticles.tsx      Canvas particle field (requestAnimationFrame; CSS-gradient fallback)
  messages/
    UserMessage.tsx
    AIMessage.tsx            Avatar + reasoning + streamed text + optional structured card
    ServicePlanCard.tsx      Ported dnd-kit card; "Apply to Service" / Edit / Regenerate
    ImagePreviewCard.tsx     Phase 2
    ScriptureCard.tsx        Verse text (from lookupReference) + Project / Add to Service
    SongSuggestionCard.tsx   Library songs + Add to Service / Preview lyrics
    InsightBanner.tsx
    ActionButtons.tsx

src/components/operator/biblical-detection/     (Phase 3, SEPARATE from OpenFlow)
  BiblicalTermBubble.tsx     Floating bubble over the center panel during live services
  BiblicalTermSlide.tsx      Styled projection slide builder (returns a SlidePayload)
  useTermDetection.ts        Scans transcript, applies 30s cooldown, surfaces a term

src/data/
  biblical-terms.json        150-200 curated Strong's-sourced entries (Phase 3)

src/hooks/
  useOpenFlow.ts             Session state machine (messages, mode, streaming, tool results)
  useGroqChat.ts             SSE client for POST /api/openflow/chat (reader + token assembly)
  useVoiceInput.ts           Web Speech push-to-talk (Phase 2)

src/lib/server/
  openflow.ts                Dedicated Groq client (OPENFLOW_GROQ_API_KEY, stream:true)
  openflow-context.ts        Builds the church-context system prompt from DB helpers
  openflow-tools.ts          Tool schemas + server-side executors (scripture/songs/service plan)

src/app/api/openflow/
  chat/route.ts              POST, auth + rate-limit, streams Groq SSE -> client (nodejs runtime)

src/lib/
  openflow-parse.ts          Pure parsers for <service_plan>/<scripture>/<song_suggestions> tags (unit-tested)

src/styles/
  openflow.css               OpenFlow token layer (gradient, radii, orange/coral) — or extend globals.css
```

---

## 4. State management

- **Session state** lives in `useOpenFlow()` (React state inside `OpenFlowPanel`), not global. Shape:
  ```
  { mode, messages: Msg[], streaming: boolean, draft, files: File[], voice: VoiceState }
  ```
  `Msg` = user | assistant; assistant messages carry `{ text, reasoning?, toolCalls?, card? }` where `card` is a discriminated union (`servicePlan | scripture | songs | image`).
- **No new global store.** OpenFlow reads church/plan data through the existing `ctx: OperatorShellCtx` prop that `ProOperatorShell` already threads everywhere, and mutates the playlist through `ctx.onAddLibraryItem` / `addServiceItem`. This keeps it inside the shell's established data flow (optimistic append + `router.refresh()`).
- **Conversation persistence:** Phase 1 is in-memory (cleared on panel close), matching the prototype. A `openflow_conversations` table is a Phase 3 nicety, not required for Sunday.
- **Center-panel toggle:** reuse `centerMode` (`ProOperatorShell.tsx:1480`); OpenFlow is just another `CenterMode` value, so switching away/back is free and preserves mic/BroadcastChannel state (the shell never remounts on mode change).
- **The Hebrew/Greek bubble** (Phase 3) holds its own tiny state next to the chips bar in `ProOperatorShell`, driven by `runDetectAll`; it is independent of the OpenFlow chat session.

---

## 5. API integration + data flow

### 5a. Chat request/stream
```
OpenFlowInput (send)
  -> useGroqChat.post({ mode, messages })
    -> POST /api/openflow/chat            (nodejs; apiUser() -> churchId; rate-limited)
        1. buildOpenFlowSystemPrompt(churchContext, mode)   [openflow-context.ts]
             churchContext assembled from:
               getChurch(churchId)                 (new thin getter)
               getChurchPatterns(churchId)         service-patterns.ts:156  (counts, topSongs, topScriptures)
               listSongs(churchId)                 services.ts:211
               listTranslations()/availableLicensedCodes  bible.ts
               churchPreferences.defaultTranslationId
               listMedia(churchId).length, settings.logoS3Key, settings.ccliNumber
        2. openflowChatStream(systemPrompt, messages, tools)  [server/openflow.ts]
             fetch Groq chat/completions with stream:true, OPENFLOW_GROQ_API_KEY,
             model = OPENFLOW_GROQ_MODEL, tools = openflow-tools schemas
        3. ReadableStream: re-enqueue token deltas as SSE frames; on a tool_call,
             execute server-side (scripture/songs/service plan grounding) and
             continue the completion with the tool result
    <- SSE stream of {delta} / {tool} / {card} / {done}
  <- useGroqChat assembles tokens -> AIMessage renders streaming text; a trailing
     structured tag (<service_plan> etc.) is parsed by openflow-parse.ts into a card
```

### 5b. Grounding tools (server-side, never trust the model for facts)
- `lookup_scripture(reference, translation?)` -> `parseReference` + `lookupReference` -> real verse text.
- `list_church_songs(query?)` -> `listSongs` filtered; merged with `getChurchPatterns().topSongs` for "most used" counts.
- `propose_service_plan(serviceType)` -> the model drafts blocks; song names are validated against `listSongs` (unknown songs are flagged "not in library", never applied).
These run inside the route so the LLM's output is corrected against the DB before it reaches the UI.

### 5c. Apply-to-Service data flow
```
ServicePlanCard "Apply to Service"
  for each block:
    songs      -> resolve title -> songId via listSongs match -> ctx.onAddLibraryItem("song",{id,title})
    scripture  -> parseReference -> lookupReference (verses) -> addServiceItem(planId,"scripture",ref,{reference,verses})
    media      -> match media asset -> ctx.onAddLibraryItem("media",{id,title})
  -> router.refresh()   (scripture path; song/media path already refreshes)
  -> toast "Service applied to playlist"   (no emoji)
Unresolved songs (not in library) are listed in the toast/card as skipped, not silently dropped.
```

---

## 6. Screen mockups (ASCII)

### 6a. Left-rail entry point (Feature 1)
```
+-- LEFT SIDEBAR ------------------+
|  Library                         |
|  Playlist                        |
|    1. Amazing Grace              |
|    2. Great Is Thy Faithfulness  |
|  ------------------------------  |   <- fixed, non-scrolling
|  | [*] OpenFlow                 ||   "Open" white / "Flow" orange->coral->purple gradient
|  |     AI                       ||   tiny 8px orange trademark tick
|  ------------------------------  |   2-3px orange left border, bg rgba(232,116,42,.04)
|  Media                           |
|  Hardware                        |
+----------------------------------+
[*] = IconSparkles (Tabler). Click -> setCenterMode("openflow"), 200-300ms crossfade.
```

### 6b. Welcome screen (center panel)
```
+-- CENTER (OpenFlow) ---------------------------------------------+
|  . . . particle field (canvas, z0) . . . . . . . . . . . . . . . |
|                                                                  |
|                         [*]  (IconSparkles 48px, gradient)       |
|                                                                  |
|              Good morning, Grace Chapel.                         |
|              ~~~~~~~~~~~~~~~~~~  (orange squiggle SVG)            |
|              Welcome to OpenFlow                                 |
|                                                                  |
|     +------------------------------------------------------+     |
|     |  How can I help you today?                           |     |
|     |                                                      |     |
|     |  [+] [mic]                        [ Chat v ] ( ^ )   |     |
|     +------------------------------------------------------+     |
|                                                                  |
|   ( [] Build a Sunday service ) ( [] Generate convention image ) |
|   ( [] Look up a Hebrew word )  ( [] Find songs about grace )    |
+------------------------------------------------------------------+
[+]=IconPlus  [mic]=IconMicrophone  Chat v=IconChevronDown  (^)=IconArrowUp (circle, #E8742A)
Pills: Tabler icon (14px orange) + Inter 500 13px label, border #2A2A2A, radius 20px.
```

### 6c. Mode dropdown
```
[ Chat  v ] clicked ->
+------------------------------+
| (v) [msg]  Chat              |   (v)=IconCheck on active
|     [list] Service Builder   |
|     [img]  Image Generator   |
|     [book] Scripture         |
|     [note] Songs             |
+------------------------------+
bg #1A1A1A, border #2A2A2A, radius 10px, scale-from-top 200ms.
Icons: IconMessageCircle / IconLayoutList / IconPhoto / IconBook2 / IconMusic.
```

### 6d. Chat thread with a Service Plan card
```
+-- CENTER (OpenFlow chat) ----------------------------------------+
|                          Build a convention service   [user, R]  |
|                                                                  |
| [*] OpenFlow                                                     |
|     Thought for 2s  v                                            |
|     Here is a convention plan based on your last 47 services.    |
|     +----------------------------------------------------+       |
|     | Convention Service                                 |       |
|     | Pre-Service Loop            10m   Welcome / count  |       |
|     | Praise & Worship            35m   [note] 4 songs   |       |
|     | Scripture Reading            5m   Romans 8:28 KJV  |  gold |
|     | The Word                    40m   Pastor Samuel    |       |
|     | ...                                                |       |
|     | Total  ~2h 28m                                     |  orange|
|     | +----------------------------------------------+   |       |
|     | | Convention services run 20-30m longer here.  |   | insight|
|     | +----------------------------------------------+   |       |
|     | ( Apply to Service )  ( Edit )  ( [refresh] Regenerate ) |  |
|     +----------------------------------------------------+       |
+------------------------------------------------------------------+
Rows drag-reorder (dnd-kit). "Apply to Service" = primary orange.
```

### 6e. Voice input state (Phase 2)
```
Ready:        [ (mic) Click to speak ]
Recording:    [ (mic pulsing)  00:07   | ||| || ||| |  Listening... ]
Transcribing: [ (mic + spinner)         Transcribing...           ]
Done:         text fills the composer.
```

### 6f. Hebrew/Greek bubble (Phase 3, over normal live view)
```
                         +-- center panel (slide grid) --+
                         |  [slide] [slide] [slide]       |
                         |                                |
                         |            +------------------+|
                         |            | [*] OPENFLOW DET.||  slides up 400ms
                         |            | Agape            ||  Inter 700
                         |            | AGAPE (gold)     ||  #EF9F27
                         |            | Self-giving love ||
                         |            | Greek / NT       ||
                         |            | (Project)(+PL)(x)||
                         |            +------------------+|
                         +--------------------------------+
Project = ctx.onSendSlideToLive({kind:"text", text, reference}, null, {instant:true})
```

---

## 7. Build phases + effort

Effort is rough engineering-days for one focused builder, each phase ending at a green six-agent gate + dummy-app verification + commit.

### Phase 1 — Sunday deadline (chat + service builder)
1. `OPENFLOW_GROQ_API_KEY` + `OPENFLOW_GROQ_MODEL` env wiring (`.env.local`, `.env.local.example`, Vercel). ~0.25d
2. `src/lib/server/openflow.ts` (streaming Groq client) + `openflow-context.ts` (system prompt from real church data) + `openflow-tools.ts` (scripture/songs/plan grounding). ~1.5d
3. `POST /api/openflow/chat` streaming route (auth, rate-limit, SSE, tool loop). ~1d
4. Shell wiring: `CenterMode "openflow"`, center switch branch, `OpenFlowSidebar` left-rail entry, crossfade. ~0.5d
5. UI: `OpenFlowPanel` + `OpenFlowWelcome` (particles, greeting, composer, pills) + `OpenFlowChat` + `OpenFlowInput` + `OpenFlowModeDropdown`, reskinned to Inter + orange/coral + Tabler, ported from the prototype. ~2d
6. `ServicePlanCard` (ported dnd-kit) + `openflow-parse.ts` + **Apply-to-Service** real playlist mutation + Chat and Service Builder modes. ~1.5d
7. Scripture mode + Songs mode cards (both grounded), since the tools already exist. ~1d
8. Gate + fixes + changelog + dummy-app verify. ~1d

Phase 1 subtotal: ~8.5-9.5 days of build. **This is tight for a single Sunday**; see §10 for the recommended MVP cut if the deadline is immovable.

### Phase 2 — next week
9. Image generation (needs D3 provider decision) — service + `ImagePreviewCard` + save-to-Media. ~2d
10. File upload/browse in the composer (reuse the just-shipped PPTX/PDF media pipeline for decks). ~1.5d
11. Voice input (Web Speech push-to-talk) — real capture behind the ported overlay. ~1d

### Phase 3 — week after
12-13. Hebrew/Greek detection: `biblical-terms.json` (150-200 Strong's entries), `useTermDetection` hook tapping `runDetectAll`, `decideHebrewGreekFire` cooldown helper + tests. ~2d
14. `BiblicalTermBubble` + `BiblicalTermSlide` (styled projection) mirroring the song-chip pattern. ~1.5d
15. Keyterm extension (top ~30-40 terms into `default.json`, rest as client matcher) — one Fly deploy. ~0.5d
16. Usage-tracking increment (fills D2): a `song_usage`/`preacher` rollup so OpenFlow can honestly say "last used 2 weeks ago". ~1.5d
17. Deeper Church Memory RAG (pgvector over service transcripts already exists via `sermon-rag`; wire it into the OpenFlow context). ~1.5d

---

## 8. Dependencies

New:
- `@tabler/icons-react` (icon system; not currently in the repo — lucide-react is)

Already present (reuse):
- `@dnd-kit/*` (ServicePlanCard reorder)
- Groq via `fetch` (no SDK needed), `groq-fallback` ladder
- `next/font` (swap to Inter), Drizzle/pg, existing bible/song/service helpers

No new AI provider in Phase 1. Image provider (Phase 2, D3) and any new table (Phase 3 usage tracking) are deferred and flagged.

---

## 9. Guardrails / quality gates specific to OpenFlow

- **No-emoji lint:** a repo check (script or eslint rule) that fails CI if any emoji code point appears under `src/components/operator/openflow/**` and `src/lib/server/openflow*`. Added in Phase 1 step 1.
- **Grounding tests:** unit tests that assert (a) scripture cards use `lookupReference` output verbatim, (b) song suggestions only reference `listSongs` ids, (c) `openflow-parse.ts` is pure and total on malformed tags.
- **Church-scoping:** the chat route derives `churchId` from `apiUser()` only; a cross-church adversarial test in `test/adversarial/` confirms one church cannot load another's context.
- **Rate limit + key isolation:** `OPENFLOW_GROQ_API_KEY` billed/limited independently; graceful degradation (clear message, no crash) when the key is missing.
- **Six-agent gate** on every increment touching the route, Apply-to-Service, or the live projection path.

---

## 10. Recommended MVP cut if Sunday is immovable

If the deadline is hard, ship this thin slice first (each a real, gated increment), and let the rest follow:
1. Shell entry + center panel + welcome + Chat mode streaming from Groq with real church context (no tools yet). Proves the surface end-to-end.
2. Service Builder mode + `ServicePlanCard` + **Apply-to-Service** (songs + scripture). This is the headline capability and the demo moment.
3. Scripture + Songs modes (cheap once tools exist).

That is Phase 1 steps 1-7 minus polish. Image gen, voice, file upload, and the Hebrew/Greek bubble are explicitly out of the Sunday scope.

---

## 11. Open decisions for you (before/while building)

- **D3 (Phase 2, not blocking Sunday):** image-generation provider — Stability, Replicate, or Gemini? Each has cost + a "new provider" sign-off per your Groq-only policy. I will bring options + pricing when we reach Capability 2.
- **D2 confirmation:** OK to **degrade** song "last used / times used" to just "most used (count)" for Phase 1, and add real per-song usage tracking in Phase 3? (Recommended — the alternative is a schema+backfill increment up front.)
- **Sidebar entry vs TopBar tab:** ship the left-rail "OpenFlow" wordmark entry as specified (recommended); optionally also add a TopBar tab. Confirm you want the wordmark entry, not a tab.
- **Deadline scope:** full Phase 1 (~8.5-9.5 build-days) vs the §10 MVP cut for Sunday. Which are we committing to?

No component code will be written until this plan is approved.
