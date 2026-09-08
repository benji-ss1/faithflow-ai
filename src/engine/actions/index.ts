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
  // Multi-timer engine (P4). `timerId` names the timer slot; the command is
  // start | stop | reset. Wired to the shell's timers session via ctx.
  | { type: "TIMER_COMMAND"; timerId: string; command: "start" | "stop" | "reset" }
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
export type ActionBinding = (
  | { mode: "ctx"; method: keyof OperatorShellCtx }
  | { mode: "layers"; method: string }
  | { mode: "todo-wired" }
  | { mode: "engine-only" }
) & {
  /** DESTRUCTIVE action — `dispatchAction` REFUSES it unless the caller passes
   *  `{ confirmed: true }`. The UI's press-and-HOLD Clear-All / Kill affordance
   *  is that confirmation; any macro/timeline/remote surface MUST supply an
   *  operator-facing guard equivalent before setting `confirmed:true`
   *  (docs/ENGINE_INTEGRATION.md Phase-3 precondition). */
  requiresConfirm?: true;
};

export const ACTION_BINDINGS: Record<EngineActionType, ActionBinding> = {
  GO_SLIDE: { mode: "ctx", method: "onJumpSlide" },
  SET_PREVIEW_ITEM: { mode: "ctx", method: "onSetPreviewItem" },
  SEND_TO_LIVE: { mode: "ctx", method: "onSendToLive" },
  SEND_SLIDE_TO_LIVE: { mode: "ctx", method: "onSendSlideToLive" },
  STAGE_SLIDE: { mode: "ctx", method: "onStageSlide" },
  CLEAR_SLIDE: { mode: "ctx", method: "onClearSlide" },
  CLEAR_MEDIA: { mode: "ctx", method: "onClearMedia" },
  CLEAR_LOWER_THIRD: { mode: "ctx", method: "onClearLowerThird" },
  BLANK: { mode: "ctx", method: "onBlank", requiresConfirm: true },
  LOGO: { mode: "ctx", method: "onLogo" },
  KILL: { mode: "ctx", method: "onKill", requiresConfirm: true },
  SEND_MESSAGE: { mode: "ctx", method: "onSendMessage" },
  CLEAR_MESSAGE: { mode: "ctx", method: "onClearMessage" },
  SEND_LOWER_THIRD: { mode: "ctx", method: "onSendLowerThird" },
  SET_ANNOUNCEMENT: { mode: "ctx", method: "onSetAnnouncement" },
  SET_TRANSITION: { mode: "ctx", method: "onSetTransitionSpec" },
  START_COUNTDOWN: { mode: "ctx", method: "onStartCountdown" },
  TIMER_COMMAND: { mode: "ctx", method: "onTimerCommand" },
  OPEN_PROJECTOR: { mode: "ctx", method: "onOpenProjector" },
  OPEN_STAGE: { mode: "ctx", method: "onOpenStage" },
  OPEN_STREAM: { mode: "ctx", method: "onOpenStream" },
  CLEAR_LAYER: { mode: "layers", method: "clearLayer" },
  CLEAR_ALL_LAYERS: { mode: "layers", method: "clearAll", requiresConfirm: true },
  SET_LAYER_VISIBILITY: { mode: "layers", method: "toggleLayer" },
  SET_BACKGROUND: { mode: "layers", method: "swapBackground" },
  SET_BACKGROUND_MEDIA: { mode: "todo-wired" },
  TRIGGER_MACRO: { mode: "engine-only" },
  SET_LOOK: { mode: "engine-only" },
  TOGGLE_PROP: { mode: "engine-only" },
};

/** Options for `dispatchAction`. */
export interface DispatchOptions {
  /** Set true only after an operator-facing guard (the UI press-and-HOLD, or a
   *  macro/remote equivalent) has confirmed a `requiresConfirm` action. */
  confirmed?: boolean;
}

/** The outcome of a dispatch. `handled:false` is NEVER a silent no-op — `reason`
 *  says why (todo-wired / engine-only / refused-guard / unknown). */
export interface DispatchResult {
  handled: boolean;
  reason?: "todo-wired" | "engine-only" | "refused-guard" | "unknown";
}

/**
 * Dispatch an engine action by calling the corresponding real handler on
 * OperatorShellCtx (or its liveLayers).
 *
 * Returns `{ handled: boolean, reason? }` — a `handled:false` result is explicit
 * (never a silent no-op): engine-only + todo-wired actions are handled elsewhere
 * / not yet wired, and a destructive action WITHOUT `confirmed:true` is REFUSED
 * (reason "refused-guard"). Destructive actions (see `requiresConfirm` in
 * ACTION_BINDINGS: KILL / CLEAR_ALL_LAYERS / BLANK) only fire when the caller
 * passes `{ confirmed: true }`.
 */
export function dispatchAction(
  ctx: OperatorShellCtx,
  action: EngineAction,
  options: DispatchOptions = {},
): DispatchResult {
  // Guard destructive actions BEFORE any handler runs — an unconfirmed guarded
  // action is refused (returns unhandled) so macro/timeline/remote surfaces can
  // never yank the projector without an operator-facing confirm.
  if (ACTION_BINDINGS[action.type]?.requiresConfirm && !options.confirmed) {
    return { handled: false, reason: "refused-guard" };
  }
  switch (action.type) {
    case "GO_SLIDE": ctx.onJumpSlide(action.itemIdx, action.slideIdx); return { handled: true };
    case "SET_PREVIEW_ITEM": ctx.onSetPreviewItem(action.itemIdx); return { handled: true };
    case "SEND_TO_LIVE": ctx.onSendToLive(); return { handled: true };
    case "SEND_SLIDE_TO_LIVE": ctx.onSendSlideToLive(action.slide, action.transition); return { handled: true };
    case "STAGE_SLIDE": ctx.onStageSlide(action.slide); return { handled: true };
    case "CLEAR_SLIDE": ctx.onClearSlide(); return { handled: true };
    case "CLEAR_MEDIA": ctx.onClearMedia(); return { handled: true };
    case "CLEAR_LOWER_THIRD": ctx.onClearLowerThird(); return { handled: true };
    case "BLANK": ctx.onBlank(); return { handled: true };
    case "LOGO": ctx.onLogo(); return { handled: true };
    case "KILL": ctx.onKill(); return { handled: true };
    case "SEND_MESSAGE": ctx.onSendMessage(action.text, action.dismissAfterMs); return { handled: true };
    case "CLEAR_MESSAGE": ctx.onClearMessage(); return { handled: true };
    case "SEND_LOWER_THIRD": ctx.onSendLowerThird(action.line1, action.line2); return { handled: true };
    case "SET_ANNOUNCEMENT": ctx.onSetAnnouncement(action.announcement); return { handled: true };
    case "SET_TRANSITION": ctx.onSetTransitionSpec(action.transition); return { handled: true };
    case "START_COUNTDOWN": ctx.onStartCountdown(action.seconds); return { handled: true };
    case "TIMER_COMMAND": ctx.onTimerCommand(action.timerId, action.command); return { handled: true };
    case "OPEN_PROJECTOR": ctx.onOpenProjector(); return { handled: true };
    case "OPEN_STAGE": ctx.onOpenStage(); return { handled: true };
    case "OPEN_STREAM": ctx.onOpenStream(); return { handled: true };

    // ── Layers engine ──
    case "CLEAR_LAYER": ctx.liveLayers.clearLayer(action.id); return { handled: true };
    case "CLEAR_ALL_LAYERS": ctx.liveLayers.clearAll(); return { handled: true };
    case "SET_LAYER_VISIBILITY": {
      // No dedicated visibility setter exists — toggle only when the current
      // enabled state differs from the requested one (idempotent).
      const row = ctx.liveLayers.rows.find((r) => r.id === action.id);
      if (row && row.enabled !== action.enabled) ctx.liveLayers.toggleLayer(action.id);
      return { handled: true };
    }
    case "SET_BACKGROUND": ctx.liveLayers.swapBackground(action.spec); return { handled: true };

    // ── Not yet wired to ctx (documented, explicit — NOT a silent no-op) ──
    case "SET_BACKGROUND_MEDIA":
      // TODO-wired: needs assetRef→BackgroundSpec + store side-effect.
      return { handled: false, reason: "todo-wired" };

    // ── Engine-only future phases ──
    case "TRIGGER_MACRO": // Phase 3
    case "SET_LOOK":      // Phase 7
    case "TOGGLE_PROP":   // Phase 8
      return { handled: false, reason: "engine-only" };

    default: {
      // Exhaustiveness guard — a new action type must be handled above.
      const _never: never = action;
      void _never;
      return { handled: false, reason: "unknown" };
    }
  }
}
