# PresentFlow Engine Integration Plan

> **Purpose**: Step-by-step blueprint for Claude Code to build the `src/engine/` module on top of the existing PresentFlow codebase. Every file path, type name, and constant referenced here is real and verified against the live repo.
>
> **Rule #1**: Zero disruption. The current operator console, broadcast pipeline, and output surfaces keep working at every commit. The engine is additive — it reads from existing state and writes to the existing `BroadcastChannel` wire.

---

## 1. Architecture Reality Check

### What Exists (DO NOT replace)

| Layer | File(s) | Role |
|-------|---------|------|
| **Wire contract** | `src/lib/broadcast.ts` | `OutputState`, `SlidePayload`, `ThemeAppearance`, `TransitionSpec`, `AnnouncementPayload`, `VideoInputState`, `MessageOverlay`, `TimerOverlay`. BroadcastChannel + Supabase Realtime fan-out. |
| **State owner** | `src/components/operator/OperatorConsole.tsx` (92KB) | All state via `useState`. Passes `OperatorShellCtx` prop bag down. No Redux/Zustand. |
| **Shell ctx type** | `src/components/operator/shell/types.ts` | `OperatorShellCtx` — 145-field prop bag (slides, audio, zone, appearance, all handlers). |
| **Shell composer** | `src/components/operator/pro/ProOperatorShell.tsx` (212KB) | Pure layout: TopBar, Left, Center, Right, BottomBar, MediaStrip. All auto-fire/detection logic lives here. |
| **Render pipeline** | `src/components/live/PresentationCanvas.tsx` → `SlideRenderer.tsx` → `AutoFitText` | Fixed 1920×1080 canvas, CSS transform scaling, ProjectionZone sub-rect, 6 slide kinds. |
| **Projection zones** | `src/lib/projection-zone.ts` | Normalized 0..1 rect + margins + fontScale. `resolveZoneRects()` for pixel layout. |
| **Event bus** | `src/lib/internal-events.ts` | Symbol-nonce gated `CustomEvent` bus. XSS-proof. |
| **Audio pipeline** | `src/components/operator/useAudioStream.ts` (169KB) | Deepgram → bible-parser → ai-detection → suggestions. 3 capture tiers. |
| **Policy constants** | `src/components/operator/pro/operatorConstants.ts` | All signed-off thresholds (SONG_AUTOLIVE_CONFIDENCE=90, SONG_STAGE_CONFIDENCE=80, etc). CLAUDE.md rule 7 locked. |
| **Session hooks** | `src/components/operator/pro/hooks.ts` | `useTimerSession`, `useMessagesSession`, `useBibleSession` — survive tab switches. |

### What the Engine Adds

A `src/engine/` module that sits **between** OperatorConsole's state and the broadcast wire. It does NOT replace OperatorConsole — it provides structured domain types, a cue-sheet model, an action dispatcher, and macro/automation primitives that OperatorConsole can adopt incrementally.

```
┌─────────────────────────────────────────────────────┐
│  OperatorConsole (state owner, unchanged)            │
│  ├─ useState() for plan, cursor, audio, etc.        │
│  └─ builds OperatorShellCtx                         │
│       │                                              │
│       ▼                                              │
│  src/engine/ (NEW — additive layer)                  │
│  ├─ types/         Branded IDs, domain enums         │
│  ├─ cue-sheet/     CueSheet model over ExpandedPlan  │
│  ├─ actions/       Typed action creators + dispatcher │
│  ├─ macros/        Macro definitions + runner         │
│  ├─ timers/        Timer engine (replaces hooks.ts)   │
│  ├─ messages/      Message overlay engine             │
│  ├─ stage/         Stage display layout engine        │
│  ├─ looks/         Looks (per-screen layer routing)   │
│  └─ props/         Props overlay system               │
│       │                                              │
│       ▼                                              │
│  src/lib/broadcast.ts (wire, unchanged)              │
│  └─ BroadcastChannel → /live, /stage, /livestream    │
└─────────────────────────────────────────────────────┘
```

---

## 2. ProPresenter Feature Parity Map

Every ProPresenter feature mapped to what PresentFlow has today and what the engine adds.

### Already Implemented (Keep)

| ProPresenter Feature | PresentFlow Equivalent | Status |
|---------------------|----------------------|--------|
| Slide Grid view | `SlideGrid.tsx` in center pane | Done |
| Multi-screen output | `/live`, `/stage`, `/livestream` routes + OutputWindow.ts | Done |
| Bible display | `BibleMode.tsx` + `useBibleSession` + bible-parser + auto-fire | Done |
| Song lyrics display | Song items in plan + `AutoFitText` crowd-readable sizing | Done |
| Announcements layer | `AnnouncementPayload` on OutputState + separate rendering | Done |
| Stage display | `/stage` route with dedicated layout | Done |
| Themes (bg + text) | `ThemeAppearance` on OutputState, `themeBackgroundStyle()` | Done |
| Video inputs | `VideoInputState` on OutputState, camera/UVC compositing | Done |
| Transitions | `TransitionSpec` + `ALLOWED_TRANSITION_NAMES` (Cut, Fade, Dissolve, Slide, Wipe, Amoeba) | Done |
| Timer overlay | `TimerOverlay` type + `useTimerSession` hook | Done |
| Message overlay | `MessageOverlay` type + `useMessagesSession` hook | Done |
| Projection zones | `ProjectionZone` + `ProjectionZoneProfile` + zone editor UI | Done |
| AI auto-fire (Bible) | Auto-approve pipeline in ProOperatorShell + confidence thresholds | Done |
| AI auto-fire (Songs) | Song detection + SONG_AUTOLIVE_CONFIDENCE=90 + disambig margin | Done |
| Search | `SearchPalette.tsx` command palette | Done |
| Keyboard shortcuts | `useOperatorHotkeys` + `ShortcutsHelpOverlay` | Done |
| Media browser | `MediaBrowser.tsx` in center pane | Done |
| Playlists | `ExpandedPlan` with ordered items | Done |
| Import (SongSelect) | Import flows + `MediaImportWizard.tsx` | Done |
| Output routing | `OutputRoutingRow.tsx` in right panel | Done |
| Font scaling | `fontScale` on OutputState + A-/AUTO/A+ controls | Done |
| Slide editor | `DesktopSlideEditorModal.tsx` + `SlideObjectsLayer` | Done |
| EasyView (operator text) | Operator preview uses same `PresentationCanvas` at different scale | Done |
| Live preview | `LivePreviewPanel.tsx` in right sidebar | Done |
| Audio monitoring | `useAudioStream` + Audio Guardian watchdog + multi-channel capture | Done |

### Phase 0: Engine Types (P0) — Week 1

**Goal**: Branded ID types + domain enums that map cleanly onto existing types.

**Create**: `src/engine/types/index.ts`

```typescript
// Branded IDs — type-safe, zero-runtime wrappers over string
export type ChurchId = string & { readonly __brand: "ChurchId" };
export type PlanId = string & { readonly __brand: "PlanId" };
export type ItemId = string & { readonly __brand: "ItemId" };
export type SlideId = string & { readonly __brand: "SlideId" };
export type SongId = string & { readonly __brand: "SongId" };
export type ThemeId = string & { readonly __brand: "ThemeId" };
export type MacroId = string & { readonly __brand: "MacroId" };
export type TimerId = string & { readonly __brand: "TimerId" };
export type PropId = string & { readonly __brand: "PropId" };
export type LookId = string & { readonly __brand: "LookId" };

// Re-export existing types so engine consumers import from one place
export type { SlidePayload, OutputState, ThemeAppearance, TransitionSpec,
  AnnouncementPayload, VideoInputState, MessageOverlay, TimerOverlay,
  SlideObjectWire } from "@/lib/broadcast";
export type { ProjectionZone, ProjectionZoneProfile } from "@/lib/projection-zone";
export type { OperatorShellCtx } from "@/components/operator/shell/types";
export type { AutopilotMode } from "@/components/operator/OperatorConsole";
export type { Detection, SongSuggestion, CommandSuggestion,
  UnifiedSuggestion } from "@/components/operator/useAudioStream";

// Domain enums matching existing string unions
export const SlideKind = {
  Text: "text",
  Image: "image",
  Video: "video",
  Blank: "blank",
  Logo: "logo",
  Empty: "empty",
} as const;
export type SlideKind = (typeof SlideKind)[keyof typeof SlideKind];

export const CenterMode = {
  Slides: "slides",
  Bible: "bible",
  Songs: "songs",
  Media: "media",
} as const;
export type CenterMode = (typeof CenterMode)[keyof typeof CenterMode];

export const AutopilotModeEnum = {
  Manual: "manual",
  Suggestion: "suggestion",
  Armed: "armed",
  Active: "active",
} as const;
```

**Integration**: Import from `@/engine/types` anywhere new code needs these. Existing code untouched.

### Phase 1: Cue Sheet Model (P1) — Week 2

**Goal**: A read-only projection over `ExpandedPlan` that gives the engine a structured view of the service.

**Create**: `src/engine/cue-sheet/index.ts`

```typescript
import type { ExpandedPlan, ExpandedItem } from "@/lib/server/services";
import type { SlidePayload, TransitionSpec } from "@/lib/broadcast";
import type { ItemId, SlideId } from "../types";

export type CueEntry = {
  itemIdx: number;
  slideIdx: number;
  itemId: ItemId;
  slideId: SlideId;
  slide: SlidePayload;
  itemTitle: string;
  itemKind: string; // "scripture" | "song" | "media" | "sermon" | etc.
  transition?: TransitionSpec | null;
  /** Actions to fire when this cue goes live (Phase 3: macros) */
  actions?: CueAction[];
};

export type CueAction = {
  type: "macro" | "clear_layer" | "start_timer" | "send_message" | "trigger_look";
  payload: Record<string, unknown>;
};

/** Build a flat cue list from the existing ExpandedPlan. */
export function buildCueSheet(plan: ExpandedPlan): CueEntry[] {
  const entries: CueEntry[] = [];
  plan.items.forEach((item: ExpandedItem, itemIdx: number) => {
    const slides = item.slides ?? [];
    slides.forEach((slide: SlidePayload, slideIdx: number) => {
      entries.push({
        itemIdx,
        slideIdx,
        itemId: (item.id ?? `item-${itemIdx}`) as ItemId,
        slideId: `${item.id ?? itemIdx}-${slideIdx}` as SlideId,
        slide,
        itemTitle: item.title ?? "",
        itemKind: item.kind ?? "unknown",
        transition: null,
        actions: [],
      });
    });
  });
  return entries;
}

/** Navigate the cue sheet relative to a current position. */
export function nextCue(sheet: CueEntry[], current: { itemIdx: number; slideIdx: number }): CueEntry | null {
  const idx = sheet.findIndex(e => e.itemIdx === current.itemIdx && e.slideIdx === current.slideIdx);
  return idx >= 0 && idx < sheet.length - 1 ? sheet[idx + 1] : null;
}

export function prevCue(sheet: CueEntry[], current: { itemIdx: number; slideIdx: number }): CueEntry | null {
  const idx = sheet.findIndex(e => e.itemIdx === current.itemIdx && e.slideIdx === current.slideIdx);
  return idx > 0 ? sheet[idx - 1] : null;
}
```

**Integration**: OperatorConsole can optionally `useMemo(() => buildCueSheet(plan), [plan])` and pass it via ctx. Does not replace any existing navigation — additive only.

### Phase 2: Action Dispatcher (P2) — Week 3

**Goal**: Typed actions that map to existing handler calls on OperatorShellCtx. Centralizes the "what happened" logic so macros can replay actions.

**Create**: `src/engine/actions/index.ts`

```typescript
import type { SlidePayload, TransitionSpec, AnnouncementPayload } from "@/lib/broadcast";
import type { OperatorShellCtx } from "@/components/operator/shell/types";

// Every operator action as a discriminated union
export type EngineAction =
  | { type: "GO_SLIDE"; itemIdx: number; slideIdx: number }
  | { type: "SEND_TO_LIVE" }
  | { type: "NEXT_SLIDE" }
  | { type: "PREV_SLIDE" }
  | { type: "CLEAR_SLIDE" }
  | { type: "CLEAR_MEDIA" }
  | { type: "CLEAR_LOWER_THIRD" }
  | { type: "BLANK" }
  | { type: "LOGO" }
  | { type: "KILL" }
  | { type: "SEND_MESSAGE"; text: string; dismissAfterMs?: number | null }
  | { type: "CLEAR_MESSAGE" }
  | { type: "SEND_LOWER_THIRD"; line1: string; line2: string }
  | { type: "SET_ANNOUNCEMENT"; announcement: AnnouncementPayload | null }
  | { type: "SET_TRANSITION"; transition: TransitionSpec | null }
  | { type: "SEND_SLIDE_TO_LIVE"; slide: SlidePayload; transition?: TransitionSpec | null }
  | { type: "STAGE_SLIDE"; slide: SlidePayload }
  | { type: "START_COUNTDOWN"; seconds: number }
  | { type: "OPEN_PROJECTOR" }
  | { type: "OPEN_STAGE" }
  | { type: "OPEN_STREAM" }
  | { type: "TRIGGER_MACRO"; macroId: string }
  | { type: "SET_LOOK"; lookId: string }
  | { type: "TOGGLE_PROP"; propId: string; visible: boolean };

/**
 * Dispatch an action by calling the corresponding handler on OperatorShellCtx.
 * This is the single point where engine actions translate to existing UI actions.
 */
export function dispatchAction(ctx: OperatorShellCtx, action: EngineAction): void {
  switch (action.type) {
    case "GO_SLIDE": ctx.onJumpSlide(action.itemIdx, action.slideIdx); break;
    case "SEND_TO_LIVE": ctx.onSendToLive(); break;
    case "CLEAR_SLIDE": ctx.onClearSlide(); break;
    case "CLEAR_MEDIA": ctx.onClearMedia(); break;
    case "CLEAR_LOWER_THIRD": ctx.onClearLowerThird(); break;
    case "BLANK": ctx.onBlank(); break;
    case "LOGO": ctx.onLogo(); break;
    case "KILL": ctx.onKill(); break;
    case "SEND_MESSAGE": ctx.onSendMessage(action.text, action.dismissAfterMs); break;
    case "CLEAR_MESSAGE": ctx.onClearMessage(); break;
    case "SEND_LOWER_THIRD": ctx.onSendLowerThird(action.line1, action.line2); break;
    case "SET_ANNOUNCEMENT": ctx.onSetAnnouncement(action.announcement); break;
    case "SET_TRANSITION": ctx.onSetTransitionSpec(action.transition); break;
    case "SEND_SLIDE_TO_LIVE":
      ctx.onSendSlideToLive(action.slide, action.transition); break;
    case "STAGE_SLIDE": ctx.onStageSlide(action.slide); break;
    case "START_COUNTDOWN": ctx.onStartCountdown(action.seconds); break;
    case "OPEN_PROJECTOR": ctx.onOpenProjector(); break;
    case "OPEN_STAGE": ctx.onOpenStage(); break;
    case "OPEN_STREAM": ctx.onOpenStream(); break;
    // Macro + Look + Prop are engine-only (P3+P7+P8)
    case "TRIGGER_MACRO": break; // Phase 3
    case "SET_LOOK": break; // Phase 7
    case "TOGGLE_PROP": break; // Phase 8
  }
}
```

**Integration**: ProOperatorShell auto-fire logic can optionally dispatch through `dispatchAction(ctx, { type: "SEND_SLIDE_TO_LIVE", slide, transition })` instead of calling `ctx.onSendSlideToLive` directly. Both paths work.

> **As-built (Wave 5) — the live `dispatchAction` diverges from the sketch above and these are load-bearing contracts:**
> - It returns `{ handled: boolean, reason? }`, NOT `void`. `handled:false` is always explicit (never a silent no-op): `reason` is `"todo-wired"` (`SET_BACKGROUND_MEDIA`), `"engine-only"` (`TRIGGER_MACRO`/`SET_LOOK`/`TOGGLE_PROP`), `"refused-guard"` (a destructive action fired without confirmation), or `"unknown"`.
> - It takes a third arg `options: { confirmed?: boolean }`.
> - `ACTION_BINDINGS` carries a `requiresConfirm: true` flag on the **destructive** actions — `KILL`, `CLEAR_ALL_LAYERS`, `BLANK`. `dispatchAction` REFUSES a guarded action (returns `{ handled:false, reason:"refused-guard" }`, calls nothing) unless `options.confirmed === true`.
>
> **HARD PHASE-3 PRECONDITION (macros / timeline / remote / Stream Deck / MIDI):** any surface that replays actions through `dispatchAction` MUST pass `confirmed:true` ONLY after an operator-facing guard equivalent to the UI press-and-HOLD (the LayersPanel Clear-All / Kill hold, or a discrete confirm step). A macro/timeline that fires `KILL`/`CLEAR_ALL_LAYERS`/`BLANK` with a blanket `confirmed:true` and no operator-facing guard is a rule violation — the whole point of the flag is that a stored/remote sequence cannot blank the projector mid-service without a human-equivalent confirm at replay time.

### Phase 3: Macros (P3) — Week 4-5

**Goal**: ProPresenter-style macros. A macro is a named sequence of `EngineAction[]` that fires on demand, from a cue, or via Stream Deck / MIDI.

**Create**: `src/engine/macros/index.ts`

```typescript
import type { EngineAction } from "../actions";
import type { MacroId } from "../types";

export type MacroTrigger =
  | { kind: "manual" }              // button press / Stream Deck
  | { kind: "cue"; cueId: string }  // when a specific cue goes live
  | { kind: "timer"; timerId: string; event: "start" | "end" | "warning" }
  | { kind: "midi"; channel: number; note: number }
  | { kind: "schedule"; cron: string };

export type MacroDefinition = {
  id: MacroId;
  name: string;
  actions: EngineAction[];
  triggers: MacroTrigger[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Run a macro by dispatching its actions sequentially. */
export async function executeMacro(
  macro: MacroDefinition,
  dispatch: (action: EngineAction) => void,
  options?: { delayBetweenMs?: number }
): Promise<void> {
  if (!macro.enabled) return;
  for (const action of macro.actions) {
    dispatch(action);
    if (options?.delayBetweenMs) {
      await new Promise(r => setTimeout(r, options.delayBetweenMs));
    }
  }
}
```

**Storage**: Macros are persisted per-church in Supabase (new `macros` table, `church_id` scoped per CLAUDE.md rule 3). The operator UI (MacrosTab.tsx — already exists at `pro/right/tabs/MacrosTab.tsx`) gets a macro editor and trigger list.

### Phase 4: Timer Engine (P4) — Week 5

**Goal**: Replace the `useTimerSession` hook with a proper timer engine that supports multiple named timers (ProPresenter has unlimited timers).

**Create**: `src/engine/timers/index.ts`

The existing `useTimerSession()` in `hooks.ts` handles one timer. The engine version supports N timers, each with its own overlay position. It emits `EngineAction` events at start/end/warning thresholds so macros can react.

**Integration**: The existing `TimerOverlay` type on OutputState already supports timer data. The engine publishes timer state to OutputState via the existing `safePost()` + BroadcastChannel path. `hooks.ts` `useTimerSession` stays as a compatibility wrapper that delegates to the engine's first timer slot.

### Phase 5: Props System (P5) — Week 6

**Goal**: ProPresenter-style props — saved media/text overlays that toggle on/off on any layer.

**Create**: `src/engine/props/index.ts`

Props are overlay objects (image, text, shape) that persist in the library and can be toggled visible on any output screen. They layer ON TOP of the current slide (like ProPresenter's props layer). The existing `SlideObjectWire` type in `broadcast.ts` already defines the object shape (text/shape/image/video with position, size, rotation, opacity, animations). Props are collections of `SlideObjectWire[]` with a name and visibility state.

**Wire change**: Add optional `props?: SlideObjectWire[]` to `OutputState`. PresentationCanvas renders them as an additional absolute-positioned layer above the slide zone. This is the ONLY wire change in the entire plan.

### Phase 6: Stage Display Engine (P6) — Week 7

**Goal**: ProPresenter-style flexible stage layouts with current/next text, timers, clocks, and messages.

**Create**: `src/engine/stage/index.ts`

The existing `/stage` route renders a single-layout stage display. The engine adds a layout editor that defines which "boxes" appear (current slide, next slide, timer, clock, message, notes) and their positions. Layouts are persisted per-church.

**Integration**: The `/stage` route's page component reads the active layout from the engine and renders boxes accordingly. The existing `PresentationCanvas` + `SlideRenderer` are reused for the current/next slide boxes.

### Phase 7: Looks System (P7) — Week 8

**Goal**: ProPresenter-style "Looks" — per-screen layer routing configurations.

**Create**: `src/engine/looks/index.ts`

A Look defines which layers (slide, media, props, announcements) are visible on which output screen. The existing multi-screen system (`/live`, `/stage`, `/livestream`) already routes different content. Looks formalize this: "Worship Look" might show slides+media on audience, current+next on stage; "Sermon Look" might show slides on audience, notes+timer on stage.

**Integration**: Looks are applied by setting the appropriate OutputState fields for each screen's BroadcastChannel. The existing `openLiveChannel()` + `safePost()` pattern is reused. Each Look is a preset that the dispatcher applies as a batch of OutputState updates.

### Phase 8: Slide Actions (P8) — Week 9

**Goal**: ProPresenter-style slide actions — attach behaviors to individual slides.

Slide actions fire when a slide goes live. They're stored on the cue sheet entry (`CueAction[]` from P1). Examples: "when this slide goes live, start timer X", "clear props layer", "trigger macro Y", "change Look to Z".

**Integration**: The existing auto-fire path in ProOperatorShell already fires actions when slides transition. The engine hooks into the same point: when `onSendSlideToLive` fires, check the cue entry for actions and dispatch them.

### Phase 9: Timeline (P9) — Week 10

**Goal**: ProPresenter-style timeline — play back slides + media + actions with recorded timings.

A timeline is a sequence of `{ cueId, timestampMs, action }` entries that play back at recorded speed. The operator records a run-through (slides advance at the times they were clicked), then replays it. Uses `requestAnimationFrame` + the existing `dispatchAction` system.

---

## 3. File Tree (What Gets Created)

```
src/engine/
├── index.ts                    # barrel export
├── types/
│   └── index.ts                # branded IDs, re-exports, enums
├── cue-sheet/
│   └── index.ts                # CueEntry, buildCueSheet, navigation
├── actions/
│   └── index.ts                # EngineAction union, dispatchAction
├── macros/
│   ├── index.ts                # MacroDefinition, executeMacro
│   ├── store.ts                # Supabase CRUD (church_id scoped)
│   └── triggers.ts             # Trigger matching + registration
├── timers/
│   ├── index.ts                # Multi-timer engine
│   └── overlay.ts              # Timer → OutputState.timer publishing
├── props/
│   ├── index.ts                # PropDefinition, toggle logic
│   └── store.ts                # Supabase CRUD
├── stage/
│   ├── index.ts                # StageLayout, StageBox types
│   ├── layouts.ts              # Layout presets + editor model
│   └── store.ts                # Supabase CRUD
├── looks/
│   ├── index.ts                # LookDefinition, applyLook
│   └── store.ts                # Supabase CRUD
├── slide-actions/
│   └── index.ts                # CueAction executor
└── timeline/
    ├── index.ts                # Timeline model
    ├── recorder.ts             # Record operator actions with timestamps
    └── player.ts               # Playback engine
```

---

## 4. Database Migrations

All new tables are `church_id` scoped (CLAUDE.md rule 3). Migration files go in `drizzle/` alongside existing migrations.

```sql
-- macros
CREATE TABLE macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id),
  name TEXT NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]',
  triggers JSONB NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_macros_church ON macros(church_id);

-- props
CREATE TABLE props (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id),
  name TEXT NOT NULL,
  objects JSONB NOT NULL DEFAULT '[]',
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_props_church ON props(church_id);

-- stage_layouts
CREATE TABLE stage_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id),
  name TEXT NOT NULL,
  boxes JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_stage_layouts_church ON stage_layouts(church_id);

-- looks
CREATE TABLE looks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id),
  name TEXT NOT NULL,
  screen_config JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_looks_church ON looks(church_id);

-- slide_actions (per-plan, attached to cue entries)
CREATE TABLE slide_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id),
  plan_id UUID NOT NULL,
  item_idx INTEGER NOT NULL,
  slide_idx INTEGER NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_slide_actions_plan ON slide_actions(plan_id);

-- timelines
CREATE TABLE timelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id),
  plan_id UUID NOT NULL,
  name TEXT NOT NULL,
  entries JSONB NOT NULL DEFAULT '[]',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_timelines_plan ON timelines(plan_id);
```

---

## 5. Critical Rules for Claude Code

1. **The Loop** (CLAUDE.md rule 1): Write → `pnpm build` → fix errors → `pnpm build` clean → then move on. Never skip the build check.

2. **Three Review Agents** (CLAUDE.md rule 2): After each phase, run type-check, lint, and a build. The engine module must pass `tsc --noEmit` independently.

3. **church_id Scoping** (CLAUDE.md rule 3): Every new table and every new query MUST filter by `church_id`. No exceptions.

4. **BroadcastChannel Primary** (CLAUDE.md rule 6): The engine dispatches to `safePost()` on the existing `LiveChannelLike`. Never bypass BroadcastChannel for same-machine sync. Supabase Realtime is additive cross-device fan-out only.

5. **Signed-Off Thresholds** (CLAUDE.md rule 7): Do NOT change `SONG_AUTOLIVE_CONFIDENCE`, `SONG_STAGE_CONFIDENCE`, `BIBLE_AUTOFIRE_CONFIDENCE`, or `SONG_AUTO_LIVE_MIN_GAP_MS`. These are field-tested and locked.

6. **No Full Reloads** (CLAUDE.md rule 8): Engine actions never call `window.location.reload()`. Use `router.refresh()` or local state updates.

7. **Groq AI Provider** (CLAUDE.md rule 4): Any new AI features in the engine use Groq, not OpenAI. The existing audio pipeline already uses Groq via Deepgram.

8. **Wire Discipline**: The ONLY wire change allowed is adding optional `props?: SlideObjectWire[]` to `OutputState`. Everything else works through existing OutputState fields.

9. **Import Paths**: Engine files import from `@/engine/...`. They may import types from `@/lib/broadcast`, `@/lib/projection-zone`, `@/components/operator/shell/types`. They MUST NOT import React components or hooks — the engine is pure TypeScript logic.

10. **Testing**: Each engine module gets a `__tests__/` folder with unit tests. Use the existing test setup (vitest if present, otherwise jest).

---

## 6. Build Order

| Phase | Module | Depends On | Output |
|-------|--------|-----------|--------|
| P0 | `engine/types/` | Nothing | Branded IDs + re-exports |
| P1 | `engine/cue-sheet/` | P0 | CueSheet over ExpandedPlan |
| P2 | `engine/actions/` | P0 | EngineAction + dispatchAction |
| P3 | `engine/macros/` | P0, P2 | Macro model + executor + DB |
| P4 | `engine/timers/` | P0, P2 | Multi-timer + overlay publishing |
| P5 | `engine/props/` | P0, P2 | Props overlay + wire change + DB |
| P6 | `engine/stage/` | P0 | Stage layout engine + DB |
| P7 | `engine/looks/` | P0, P2 | Looks routing + DB |
| P8 | `engine/slide-actions/` | P1, P2, P3 | Cue action executor + DB |
| P9 | `engine/timeline/` | P1, P2 | Timeline recorder + player + DB |

---

## 7. Integration Touchpoints (Minimal Changes to Existing Files)

### `src/lib/broadcast.ts`
- Add `props?: SlideObjectWire[]` to `OutputState` type (P5 only)
- Add `props` to `isValidOutputState` validator

### `src/components/live/PresentationCanvas.tsx`
- Add props overlay layer after the zone div (P5 only)
- Read `props` from OutputState and render as absolute-positioned SlideObjectWire elements

### `src/components/operator/OperatorConsole.tsx`
- Optionally build cue sheet: `const cueSheet = useMemo(() => buildCueSheet(plan), [plan])`
- Pass `cueSheet` on ctx (add to OperatorShellCtx)
- No other changes required until operator UI for macros/looks/props is built

### `src/components/operator/pro/ProOperatorShell.tsx`
- Import `dispatchAction` and use it alongside existing handler calls (optional, incremental)
- Add MacrosTab, PropsTab, LooksTab to right sidebar (existing tab infrastructure)

### `src/components/operator/shell/types.ts`
- Add optional `cueSheet?: CueEntry[]` to OperatorShellCtx
- Add optional `macros?: MacroDefinition[]`
- Add optional `looks?: LookDefinition[]`
- Add optional `props?: PropDefinition[]`

### Database schema (`drizzle/schema.ts`)
- Add tables from Section 4

---

## 8. What This Does NOT Change

- **OperatorConsole state management**: Still useState, still 92KB. No Redux migration.
- **useAudioStream pipeline**: Untouched. Engine doesn't process audio.
- **Auto-fire logic in ProOperatorShell**: Stays in ProOperatorShell. Engine provides an alternative dispatch path but doesn't replace the existing auto-fire.
- **Theme system**: Untouched. ThemeAppearance stays on OutputState.
- **Projection zones**: Untouched. ProjectionZone stays on OutputState.
- **Transition system**: Untouched. TransitionSpec stays on OutputState.
- **Internal event bus**: Untouched. Symbol-nonce security stays.
- **Deploy stack**: Same. Next.js → Vercel, Audio → Fly.io, DB → Supabase.

---

## 9. Blueprint Corrections (appended after P0–P2 build, 2026-09-08)

The build agent verified every referenced type/handler against the live repo on
branch `feat/decoupling-layers-panel`. Where the blueprint diverged from reality,
the code follows REALITY. Divergences found:

### Repo-fact corrections (P0 types)
- **`ExpandedItem` shape** (`src/lib/server/services.ts`): fields are `id: string`
  (required, never undefined), `order`, `type: ServiceItemType`, `title: string`
  (required), `slides: SlidePayload[]`. There is **no `kind` field** (it's `type`)
  and **no per-item/per-slide `transition`**. The blueprint's `item.id ?? …`,
  `item.kind`, and `item.title ?? ""` fallbacks are dead code against the real type.
- **`ServiceItemType`** (`src/lib/db/schema.ts`, `serviceItemTypeEnum`): `song |
  scripture | media | sermon | blank | logo | header`. Re-exported from
  `@/engine/types`; mirrored by the new `ItemType` enum. **`header` items are
  non-content dividers with `slides: []`.**
- **`AutopilotMode`** IS exported from `OperatorConsole` as `"manual" |
  "suggestion" | "armed" | "active"` (matches the blueprint's enum). **`ServiceMode`**
  (`"auto" | "worship" | "preacher"`) also lives there — blueprint omitted it; now
  re-exported.
- **`CenterMode`** has no single source-of-truth type in the repo. Provided as an
  engine-local enum only (not re-exported from elsewhere).
- All re-exported wire types (`SlidePayload`, `OutputState`, `ThemeAppearance`,
  `TransitionSpec`, `AnnouncementPayload`, `VideoInputState`, `MessageOverlay`,
  `TimerOverlay`, `SlideObjectWire`) plus `ProjectionZone`/`ProjectionZoneProfile`
  and the audio types (`Detection`, `SongSuggestion`, `CommandSuggestion`,
  `UnifiedSuggestion`, `AudioStreamState`) were confirmed present and exported.
  Also re-exported the layers-engine wire types (`BackgroundSpec`, `LayerWire`,
  `LayerKind`, `LayerZone`) that postdate the blueprint.

### Cue-sheet corrections (P1)
- Renamed `CueEntry.itemKind` → **`itemType`** (matches `ExpandedItem.type`).
  Added **`isHeader`** (always false in a built sheet — headers contribute zero
  cues by construction) for explicitness.
- **Navigation delegates to the existing `nextPreviewPosition`** helper in
  `src/lib/operator-nav.ts` instead of the blueprint's duplicated `findIndex`
  walk — so there is exactly ONE header/empty-item skip predicate. `nextCue` /
  `prevCue` now take `(plan, sheet, current)` and return the entry at the shared
  helper's computed position (or null at the ends). Added `cueAt(sheet, pos)`.

### Actions corrections (P2)
- Every ctx handler the blueprint mapped **exists with the exact name** and is
  wired: `onJumpSlide`, `onSendToLive`, `onClearSlide`, `onClearMedia`,
  `onClearLowerThird`, `onBlank`, `onLogo`, `onKill`, `onSendMessage`,
  `onClearMessage`, `onSendLowerThird`, `onSetAnnouncement`, `onSetTransitionSpec`,
  `onSendSlideToLive`, `onStageSlide`, `onStartCountdown`, `onOpenProjector`,
  `onOpenStage`, `onOpenStream`. Added `SET_PREVIEW_ITEM → onSetPreviewItem`.
- **`NEXT_SLIDE` / `PREV_SLIDE` dropped** from the dispatchable union: the
  blueprint listed them but wrote no dispatch arm, and no ctx handler advances by
  one without a target position. Next/prev is a cue-sheet concern — use
  `nextCue`/`prevCue` + `GO_SLIDE`.
- **Layers-engine actions added** (the `ctx.liveLayers: UseLiveLayers` prop
  postdates the blueprint). `UseLiveLayers` exposes `clearLayer(id)`,
  `toggleLayer(id)`, `clearAll()`, `swapBackground(spec)` — but **no
  `setLayerVisibility` and no assetRef background setter**. Therefore:
  - `CLEAR_LAYER {id}` → `liveLayers.clearLayer` (real)
  - `CLEAR_ALL_LAYERS` → `liveLayers.clearAll` (real)
  - `SET_LAYER_VISIBILITY {id, enabled}` → real via `rows` lookup + `toggleLayer`,
    toggling only when the current enabled state differs (idempotent).
  - `SET_BACKGROUND {spec}` → `liveLayers.swapBackground` (real).
  - `SET_BACKGROUND_MEDIA {assetRef}` → **TODO-WIRED** (no ctx handler takes an
    assetRef; the asset→`BackgroundSpec` resolution + `setMediaAsBackground` store
    side-effect live in the console/MediaBrowser today, not on ctx).
  - `TRIGGER_MACRO` / `SET_LOOK` / `TOGGLE_PROP` remain engine-only future phases.
- **`ACTION_BINDINGS`** (new): a `Record<EngineActionType, ActionBinding>` that is
  the single source of truth for how each action resolves (`ctx` / `layers` /
  `todo-wired` / `engine-only`). The completeness test asserts against it.

### Process / convention corrections
- **Migrations** live in `docs/migrations`, NOT `drizzle/` (Section 4's file
  location note is wrong — no migrations were written in P0–P2 anyway).
- **Tests** use `node:test` + `node:assert/strict` run via `npx tsx --test` — NOT
  vitest/jest (Section 5 rule 10 is wrong). New tests:
  `test/engine-cue-sheet.test.ts` (9), `test/engine-actions.test.ts` (5) — 14 pass.
- `MacrosTab.tsx` (referenced in Phase 3) does **not** exist yet at
  `pro/right/tabs/`; out of scope for P0–P2, flagged for the P3 pass.

### Timer-engine corrections (P4, appended after the Wave-7 fix pass, 2026-09-09)
- **No compatibility wrapper (blueprint said otherwise).** The blueprint (and the
  original `engine/timers/index.ts` header) claimed the legacy single-timer
  `useTimerSession` would become "a thin compatibility wrapper over timer slot 1".
  As built it is **not** — the legacy hook is left UNTOUCHED beside the new pure
  engine + `useTimersSession`. The two coexist on the wire by id: the legacy quick
  timer publishes the unkeyed `"default"` timer slot; each engine-backed named
  timer publishes its own KEYED `TimerOverlay` (`id = def.id`). Header corrected.
- **countdown_to targets resolve ONCE, not per tick.** `resolveTargetMs` rolls a
  passed clock to the next day. If it were called every 500ms tick, the instant
  `now` crossed the target the timer would jump back to ~23:59 instead of running
  NEGATIVE into overrun. The hook (`useTimersSession`) now resolves each
  countdown_to's target once (at load) and re-resolves ONLY on reset / re-show;
  the pure engine gets the already-resolved `targetMs`. Locked by
  `test/engine-timers.test.ts` (resolve-once + roll-forward).
- **Pure helpers moved into the engine for testability.** `resolveTargetMs`
  (→ `engine/timers`) and `expandMessageTokens` / `timerTokenValue`
  (→ `engine/timers/messages`) were inlined in `pro/hooks.ts`, which pulls in
  `"server-only"` actions and so could never be imported into a `node:test` unit
  (the stress suite kept byte-copies). They now live in the engine and are imported
  by both `hooks.ts` (re-exported for existing callers) and the tests directly.
- **Row caps + dismiss whitelist (defence-in-depth).** `createTimerDefinition` /
  `createMessageTemplate` cap at 50 rows/church with an honest error; the message
  `dismiss` field is server-side whitelisted to the known enum. RLS is enabled on
  both new tables in the migration (owner-bypass model, matches every tenant table).
- **2Hz tick gate.** `useTimersSession` only spins its 500ms display tick when
  something needs it (any running timer, any countdown_to, or any shown timer) —
  not merely because timers exist.
- **`presentflow:timer-command` is nonce-gated (Y1).** The macro/engine entry point
  now dispatches via `dispatchInternal` and the ProOperatorShell listener drops any
  event failing `isInternalEvent` — an XSS/extension can't drive a timer.

### §9 correction note — Phase-4 slide-actions/macros as-built (FINAL FIX PASS, 2026-09-09)
Several earlier claims in this doc are now STALE and are corrected here (the code
is the source of truth):

- **`SET_BACKGROUND_MEDIA` is no longer "todo-wired".** Phase 4 gave it a real ctx
  handler (`ACTION_BINDINGS.SET_BACKGROUND_MEDIA = { mode: "ctx", method:
  "onSetBackgroundMedia" }`, wired to `OperatorConsole.setBackgroundMedia` →
  `setMediaAsBackground`). The Wave-5 "As-built" bullet and the P0–P2 binding note
  that list it as `todo-wired` predate Phase 4. `todo-wired` is now an EMPTY set —
  no shipping action returns that reason.
- **`MacrosTab.tsx` EXISTS.** The P0–P2 process note ("`MacrosTab.tsx` … does not
  exist yet … flagged for the P3 pass") is stale — it lives at
  `pro/right/tabs/MacrosTab.tsx`, is dynamically imported by both `RightTabs` and
  `RightIconBar`, and drives Automations CRUD + test-run through the ONE dispatcher.
- **Persisted-spec hardening (new).** `validateSpec` (engine/actions/spec.ts) now
  bounds `set_background_media` (`assetRef.url` via the shared `isValidRenderUrl`
  https/loopback gate, `assetRef.id` via `SAFE_TOKEN`, fileName ≤260 / kind ≤40 /
  mediaKey ≤512) and validates `set_background` / `set_announcement` /
  `set_transition` shapes through the shared broadcast validators
  (`isValidBackgroundSpec` / `isValidAnnouncement` / `isValidTransitionSpec`) plus
  an 8 KB byte cap. Guarded blank/kill/clear-all specs remain slide-forbidden.
- **Fault isolation.** `dispatchSlideActions` and `executeMacro` wrap each dispatch
  (`safeDispatch`): a throwing handler → `{handled:false, reason:"threw"}`, the
  batch continues. `DispatchResultLike.reason` is an open string at the
  slide/macro layer, so `"threw"` is additive (the core `DispatchResult.reason`
  union is unchanged).
- **As-built test counts.** Phase-4 engine suites: `engine-slide-actions` (9),
  `engine-macros` (7), `engine-actions` (6), `engine-phase4-stress` (11),
  `engine-spec-validation` (11, NEW). Timers (13) bring the Phase-4 engine total to
  **57 green**. (Earlier prose citing 10/7/6 predates this pass.)
