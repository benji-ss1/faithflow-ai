/**
 * src/engine/slide-actions — Phase 4 (P8): per-slide attached actions.
 *
 * A slide can carry a list of `ActionSpec`s that fire when it goes live. This
 * module owns the PURE rules (no React, no server): what's a valid slide-action
 * list, the cap, guarded-exclusion, and the dispatch sequencing through the
 * shared `dispatchEngineAction` seam + a macro resolver.
 *
 * SAFETY (CLAUDE.md rule 7, plan §5): slide actions are NON-DESTRUCTIVE by
 * construction — `validateForSlide` rejects any guarded spec (blank/kill/
 * clear_all_layers), enforced at SAVE (server action) AND at DISPATCH (here).
 * They are dispatched with `confirmed:false` so even if a guarded spec somehow
 * slipped through the save gate, `dispatchAction` would REFUSE it (defence in
 * depth). A slide action of type `macro` expands its Automation, but a macro's
 * OWN actions can never include another macro (validated at macro save).
 */
import type { EngineAction } from "../actions";
import { specToEngineAction, validateForSlide, type ActionSpec } from "../actions/spec";
import type { MacroDefinition } from "../macros";
import { macroToEngineActions } from "../macros";

/** Max actions attachable to one slide (keeps the badge row + save payload sane). */
export const MAX_SLIDE_ACTIONS = 8;

export interface DispatchResultLike { handled: boolean; reason?: string }
export type DispatchEngineAction = (action: EngineAction, opts?: { confirmed?: boolean }) => DispatchResultLike;

export interface SlideActionsValidation { ok: boolean; reason?: string; index?: number }

/** Validate a whole slide-actions list: array shape, cap, and per-item
 *  `validateForSlide` (structural + non-destructive). Pure. */
export function validateSlideActions(actions: unknown): SlideActionsValidation {
  if (!Array.isArray(actions)) return { ok: false, reason: "not-an-array" };
  if (actions.length > MAX_SLIDE_ACTIONS) return { ok: false, reason: "too-many" };
  for (let i = 0; i < actions.length; i++) {
    const r = validateForSlide(actions[i]);
    if (!r.ok) return { ok: false, reason: r.reason, index: i };
  }
  return { ok: true };
}

/** Keep only the valid, slide-permitted specs (fail-open filter for READ). */
export function sanitizeSlideActions(actions: unknown): ActionSpec[] {
  if (!Array.isArray(actions)) return [];
  const out: ActionSpec[] = [];
  for (const a of actions) {
    if (out.length >= MAX_SLIDE_ACTIONS) break;
    if (validateForSlide(a).ok) out.push(a as ActionSpec);
  }
  return out;
}

export interface SlideActionOutcome { spec: ActionSpec; result: DispatchResultLike }

/**
 * Fire a slide's actions in order through the dispatcher. A `macro` spec is
 * expanded via `resolveMacro` and each of its actions is dispatched with
 * `confirmed:false` — a slide going live must NEVER blank/kill/clear-all the
 * projector, and that invariant cannot be laundered through a macro. If a church
 * built an Automation containing a guarded action and attached it to a slide,
 * those guarded actions are REFUSED at dispatch (reason "refused-guard"); its
 * non-destructive actions still fire. This matches the slide invariant in
 * spec.ts, the ACTION_BINDINGS "operator-facing guard required before
 * confirmed:true" contract (a plain slide send offers no such guard), and the
 * user-facing 0.1.395 changelog ("slide actions ... can never blank or clear the
 * whole screen"). Guarded macros remain runnable from the Automations panel,
 * which supplies its own in-panel confirm. NON-macro slide actions are likewise
 * always `confirmed:false`.
 *
 * Returns one outcome per dispatched action (macro expansions included) so the
 * caller / tests can inspect `{handled,reason}`.
 */
export function dispatchSlideActions(
  dispatch: DispatchEngineAction,
  specs: ActionSpec[],
  resolveMacro: (macroId: string) => MacroDefinition | null,
): SlideActionOutcome[] {
  const outcomes: SlideActionOutcome[] = [];
  for (const spec of specs) {
    if (spec.type === "macro") {
      const def = resolveMacro(spec.macroId);
      if (!def) { outcomes.push({ spec, result: { handled: false, reason: "macro-not-found" } }); continue; }
      // confirmed:false — guarded macro contents are refused by dispatchAction
      // (a slide send is NOT an operator-facing confirm). See doc above.
      for (const ea of macroToEngineActions(def)) {
        outcomes.push({ spec, result: dispatch(ea, { confirmed: false }) });
      }
      continue;
    }
    const ea = specToEngineAction(spec);
    if (!ea) { outcomes.push({ spec, result: { handled: false, reason: "unmappable" } }); continue; }
    // Non-destructive slide actions: confirmed:false. If a guarded spec ever
    // slipped past the save gate, dispatchAction REFUSES it here.
    outcomes.push({ spec, result: dispatch(ea, { confirmed: false }) });
  }
  return outcomes;
}
