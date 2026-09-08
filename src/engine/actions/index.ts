/**
 * src/engine/actions — Phase 2 (P2) of the Engine Integration blueprint.
 *
 * A typed, discriminated-union action model + a single `dispatchAction` that
 * translates each engine action into the REAL handler on `OperatorShellCtx`.
 * This is the one place engine intent maps to existing operator plumbing, so
 * macros/timelines can replay actions through it. Pure TS: no React imports, no
 * side effects at module scope.
 *
 * BLUEPRINT CORRECTIONS (verified against the live repo, 2026-09-08):
 *   - Every ctx handler the blueprint mapped to EXISTS with the exact name:
 *     onJumpSlide, onSendToLive, onClearSlide, onClearMedia, onClearLowerThird,
 *     onBlank, onLogo, onKill, onSendMessage, onClearMessage, onSendLowerThird,
 *     onSetAnnouncement, onSetTransitionSpec, onSendSlideToLive, onStageSlide,
 *     onStartCountdown, onOpenProjector, onOpenStage, onOpenStream. (verified)
 *   - The blueprint listed `NEXT_SLIDE` / `PREV_SLIDE` in the union but had NO
 *     dispatch arm for them — and there is NO ctx handler that advances by one
 *     without a target position. They are DROPPED from the dispatchable union:
 *     next/prev is a CUE-SHEET concern (use `nextCue`/`prevCue` + `GO_SLIDE`).
 *     Documented divergence.
 *   - The layers engine (`ctx.liveLayers`, type `UseLiveLayers`) postdates the
 *     blueprint. It exposes `clearLayer(id)`, `toggleLayer(id)`, `clearAll()`,
 *     `swapBackground(spec)` — but NO `setLayerVisibility` and NO assetRef-based
 *     background setter. So:
 *       • CLEAR_LAYER / CLEAR_ALL_LAYERS / SET_BACKGROUND → REAL-wired.
 *       • SET_LAYER_VISIBILITY → REAL-wired via a row lookup + `toggleLayer`
 *         (toggles only when the current enabled state differs from the target).
 *       • SET_BACKGROUND_MEDIA {assetRef} → TODO-WIRED: no ctx handler takes an
 *         assetRef; the media-asset→BackgroundSpec resolution + `setMediaAsBackground`
 *         store side-effect live in the console/MediaBrowser today, not on ctx.
 *   - TRIGGER_MACRO / SET_LOOK / TOGGLE_PROP remain engine-only (future phases).
 */
import type {
  SlidePayload,
  TransitionSpec,
  AnnouncementPayload,
  BackgroundSpec,
} from "@/lib/broadcast";
import type { OperatorShellCtx } from "@/components/operator/shell/types";

// ── The action union ──────────────────────────────────────────────────────
export type EngineAction =
  // Navigation / live
  | { type: "GO_SLIDE"; itemIdx: number; slideIdx: number }
  | { type: "SET_PREVIEW_ITEM"; itemIdx: number }
  | { type: "SEND_TO_LIVE" }
  | { type: "SEND_SLIDE_TO_LIVE"; slide: SlidePayload; transition?: TransitionSpec | null }
  | { type: "STAGE_SLIDE"; slide: SlidePayload }
  // Clears / blanks
  | { type: "CLEAR_SLIDE" }
  | { type: "CLEAR_MEDIA" }
  | { type: "CLEAR_LOWER_THIRD" }
  | { type: "BLANK" }
  | { type: "LOGO" }
  | { type: "KILL" }
  // Overlays
  | { type: "SEND_MESSAGE"; text: string; dismissAfterMs?: number | null }
  | { type: "CLEAR_MESSAGE" }
  | { type: "SEND_LOWER_THIRD"; line1: string; line2: string }
  | { type: "SET_ANNOUNCEMENT"; announcement: AnnouncementPayload | null }
  | { type: "SET_TRANSITION"; transition: TransitionSpec | null }
  | { type: "START_COUNTDOWN"; seconds: number }
  // Output windows
  | { type: "OPEN_PROJECTOR" }
  | { type: "OPEN_STAGE" }
  | { type: "OPEN_STREAM" }
  // Layers engine (postdates blueprint)
  | { type: "CLEAR_LAYER"; id: string }
  | { type: "CLEAR_ALL_LAYERS" }
  | { type: "SET_LAYER_VISIBILITY"; id: string; enabled: boolean }
  | { type: "SET_BACKGROUND"; spec: BackgroundSpec | null }
  | { type: "SET_BACKGROUND_MEDIA"; assetRef: { id: string; url: string; fileName: string; kind: string; mediaKey?: string } }
  // Engine-only (future phases — no ctx dispatch)
  | { type: "TRIGGER_MACRO"; macroId: string }
  | { type: "SET_LOOK"; lookId: string }
  | { type: "TOGGLE_PROP"; propId: string; visible: boolean };

export type EngineActionType = EngineAction["type"];

/**
 * How each action resolves — the single source of truth the completeness test
 * asserts against.
 *   - "ctx":         calls a named OperatorShellCtx handler.
 *   - "layers":      calls a ctx.liveLayers (UseLiveLayers) method.
 *   - "todo-wired":  no ctx handler exists yet; dispatch is a documented no-op.
 *   - "engine-only": handled by a later engine phase, never touches ctx.
 */
export type ActionBinding =
  | { mode: "ctx"; method: keyof OperatorShellCtx }
  | { mode: "layers"; method: string }
  | { mode: "todo-wired" }
  | { mode: "engine-only" };

export const ACTION_BINDINGS: Record<EngineActionType, ActionBinding> = {
  GO_SLIDE: { mode: "ctx", method: "onJumpSlide" },
  SET_PREVIEW_ITEM: { mode: "ctx", method: "onSetPreviewItem" },
  SEND_TO_LIVE: { mode: "ctx", method: "onSendToLive" },
  SEND_SLIDE_TO_LIVE: { mode: "ctx", method: "onSendSlideToLive" },
  STAGE_SLIDE: { mode: "ctx", method: "onStageSlide" },
  CLEAR_SLIDE: { mode: "ctx", method: "onClearSlide" },
  CLEAR_MEDIA: { mode: "ctx", method: "onClearMedia" },
  CLEAR_LOWER_THIRD: { mode: "ctx", method: "onClearLowerThird" },
  BLANK: { mode: "ctx", method: "onBlank" },
  LOGO: { mode: "ctx", method: "onLogo" },
  KILL: { mode: "ctx", method: "onKill" },
  SEND_MESSAGE: { mode: "ctx", method: "onSendMessage" },
  CLEAR_MESSAGE: { mode: "ctx", method: "onClearMessage" },
  SEND_LOWER_THIRD: { mode: "ctx", method: "onSendLowerThird" },
  SET_ANNOUNCEMENT: { mode: "ctx", method: "onSetAnnouncement" },
  SET_TRANSITION: { mode: "ctx", method: "onSetTransitionSpec" },
  START_COUNTDOWN: { mode: "ctx", method: "onStartCountdown" },
  OPEN_PROJECTOR: { mode: "ctx", method: "onOpenProjector" },
  OPEN_STAGE: { mode: "ctx", method: "onOpenStage" },
  OPEN_STREAM: { mode: "ctx", method: "onOpenStream" },
  CLEAR_LAYER: { mode: "layers", method: "clearLayer" },
  CLEAR_ALL_LAYERS: { mode: "layers", method: "clearAll" },
  SET_LAYER_VISIBILITY: { mode: "layers", method: "toggleLayer" },
  SET_BACKGROUND: { mode: "layers", method: "swapBackground" },
  SET_BACKGROUND_MEDIA: { mode: "todo-wired" },
  TRIGGER_MACRO: { mode: "engine-only" },
  SET_LOOK: { mode: "engine-only" },
  TOGGLE_PROP: { mode: "engine-only" },
};

/**
 * Dispatch an engine action by calling the corresponding real handler on
 * OperatorShellCtx (or its liveLayers). Engine-only + todo-wired actions are
 * intentional no-ops here (handled elsewhere / not yet wired).
 */
export function dispatchAction(ctx: OperatorShellCtx, action: EngineAction): void {
  switch (action.type) {
    case "GO_SLIDE": ctx.onJumpSlide(action.itemIdx, action.slideIdx); break;
    case "SET_PREVIEW_ITEM": ctx.onSetPreviewItem(action.itemIdx); break;
    case "SEND_TO_LIVE": ctx.onSendToLive(); break;
    case "SEND_SLIDE_TO_LIVE": ctx.onSendSlideToLive(action.slide, action.transition); break;
    case "STAGE_SLIDE": ctx.onStageSlide(action.slide); break;
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
    case "START_COUNTDOWN": ctx.onStartCountdown(action.seconds); break;
    case "OPEN_PROJECTOR": ctx.onOpenProjector(); break;
    case "OPEN_STAGE": ctx.onOpenStage(); break;
    case "OPEN_STREAM": ctx.onOpenStream(); break;

    // ── Layers engine ──
    case "CLEAR_LAYER": ctx.liveLayers.clearLayer(action.id); break;
    case "CLEAR_ALL_LAYERS": ctx.liveLayers.clearAll(); break;
    case "SET_LAYER_VISIBILITY": {
      // No dedicated visibility setter exists — toggle only when the current
      // enabled state differs from the requested one (idempotent).
      const row = ctx.liveLayers.rows.find((r) => r.id === action.id);
      if (row && row.enabled !== action.enabled) ctx.liveLayers.toggleLayer(action.id);
      break;
    }
    case "SET_BACKGROUND": ctx.liveLayers.swapBackground(action.spec); break;

    // ── Not yet wired to ctx (documented) ──
    case "SET_BACKGROUND_MEDIA": break; // TODO-wired: needs assetRef→BackgroundSpec + store side-effect

    // ── Engine-only future phases ──
    case "TRIGGER_MACRO": break; // Phase 3
    case "SET_LOOK": break;      // Phase 7
    case "TOGGLE_PROP": break;   // Phase 8

    default: {
      // Exhaustiveness guard — a new action type must be handled above.
      const _never: never = action;
      void _never;
    }
  }
}
