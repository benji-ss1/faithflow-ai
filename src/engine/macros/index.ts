/**
 * src/engine/macros — Phase 4 (P3): Automations (PresentFlow naming for macros).
 *
 * An Automation is a church-persisted, named list of `ActionSpec`s fired
 * atomically-in-sequence. Pure model + runner here (no React, no server import);
 * Supabase CRUD lives in `src/lib/actions.ts` (church-scoped, RLS-enabled table).
 *
 * CAPS (validated at save AND here): ≤ MAX_MACROS_PER_CHURCH definitions, ≤
 * MAX_ACTIONS_PER_MACRO actions each. RECURSION: a macro's actions can NEVER
 * include a `macro` spec (validateForMacro) — no macro-in-macro. Guarded specs
 * (blank/kill/clear_all_layers) ARE allowed in a macro but the panel must fire
 * them behind an in-panel confirm that maps to `dispatchAction`'s `confirmed:true`
 * (the hard Phase-3 precondition — see docs/ENGINE_INTEGRATION.md §2 P2 note).
 */
import type { EngineAction } from "../actions";
import { specToEngineAction, validateForMacro, isGuardedSpec, sanitizeActionList, rebuiltListBytes, MAX_ACTION_LIST_BYTES, type ActionSpec } from "../actions/spec";

export const MAX_MACROS_PER_CHURCH = 50;
export const MAX_ACTIONS_PER_MACRO = 20;

export interface MacroDefinition {
  id: string;
  churchId: string;
  name: string;
  actions: ActionSpec[];
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface MacroValidation { ok: boolean; reason?: string; index?: number }

/** Validate a macro's action list: array, cap, per-item `validateForMacro`
 *  (structural + no macro-in-macro). Pure. */
export function validateMacroActions(actions: unknown): MacroValidation {
  if (!Array.isArray(actions)) return { ok: false, reason: "not-an-array" };
  if (actions.length > MAX_ACTIONS_PER_MACRO) return { ok: false, reason: "too-many" };
  for (let i = 0; i < actions.length; i++) {
    const r = validateForMacro(actions[i]);
    if (!r.ok) return { ok: false, reason: r.reason, index: i };
  }
  if (rebuiltListBytes(actions) > MAX_ACTION_LIST_BYTES) return { ok: false, reason: "too-large" };
  return { ok: true };
}

/** Keep only valid macro-permitted specs, each REBUILT from its whitelisted
 *  fields, count- and byte-capped. Applied on SAVE and on READ. */
export function sanitizeMacroActions(actions: unknown): ActionSpec[] {
  return sanitizeActionList(actions, validateForMacro, MAX_ACTIONS_PER_MACRO);
}

/** True iff any action in the macro is destructive (needs the panel confirm). */
export function macroHasGuardedAction(def: MacroDefinition): boolean {
  return sanitizeMacroActions(def.actions).some(isGuardedSpec);
}

/** Expand a macro to the ordered EngineActions it dispatches. DEFENSIVE: the
 *  definition may come from a client cache / corrupted row, so the action list is
 *  re-sanitized here (count + byte caps, shape validation, whitelist rebuild,
 *  no macro-in-macro) before anything is mapped. Pure. */
export function macroToEngineActions(def: MacroDefinition): EngineAction[] {
  const out: EngineAction[] = [];
  for (const spec of sanitizeMacroActions(def?.actions)) {
    if (spec.type === "macro") continue; // recursion guard (belt + suspenders)
    const ea = specToEngineAction(spec);
    if (ea) out.push(ea);
  }
  return out;
}

export interface MacroOutcome { action: EngineAction; result: { handled: boolean; reason?: string } }
export type DispatchEngineAction = (
  action: EngineAction,
  opts?: { confirmed?: boolean },
) => { handled: boolean; reason?: string };

/**
 * Run a macro by dispatching its actions sequentially. `confirmed` gates the
 * guarded actions — the caller (Automations panel test-run / attach) passes
 * `confirmed:true` ONLY after its in-panel confirm; a plain run passes false and
 * any guarded action is refused by `dispatchAction`. Returns per-action outcomes.
 */
export function executeMacro(
  def: MacroDefinition,
  dispatch: DispatchEngineAction,
  opts: { confirmed?: boolean } = {},
): MacroOutcome[] {
  if (!def || !def.enabled) return [];
  const confirmed = opts.confirmed === true;
  const outcomes: MacroOutcome[] = [];
  for (const action of macroToEngineActions(def)) {
    // Fault isolation: a handler that throws becomes an explicit
    // {handled:false, reason:"threw"} outcome and never aborts the sequence.
    let result: { handled: boolean; reason?: string };
    try { result = dispatch(action, { confirmed }); }
    catch { result = { handled: false, reason: "threw" }; }
    outcomes.push({ action, result });
  }
  return outcomes;
}
