/**
 * src/engine/actions/spec.ts — Phase 4: the SERIALIZABLE action spec.
 *
 * `EngineAction` (./index.ts) is the runtime dispatch union — some arms carry
 * live objects (a `SlidePayload`, a `TransitionSpec`) that only make sense while
 * an operator is driving. `ActionSpec` is the PERSISTED, JSON-safe subset that a
 * slide action or an Automation (macro) stores in the DB and replays later. It
 * is deliberately smaller and flatter than `EngineAction`:
 *
 *   - No `SEND_SLIDE_TO_LIVE` / `STAGE_SLIDE` / `GO_SLIDE` — those reference the
 *     live cursor / a specific slide payload and are not meaningful as a stored,
 *     content-independent action attached to some OTHER slide.
 *   - Guarded (destructive) specs (`blank` / `kill` / `clear_all_layers`) ARE in
 *     the union but are EXCLUDED from slide actions (a slide going live must
 *     never be able to blank/kill the projector) and only ALLOWED in an
 *     Automation, where the panel fires them behind an in-panel confirm that maps
 *     to `dispatchAction`'s `confirmed:true`.
 *   - `macro` references another Automation by id. Allowed AS a slide action
 *     (attach an Automation to a slide) but FORBIDDEN inside a macro's own action
 *     list — macros cannot contain macros (no recursion). Enforced at validate.
 *
 * Pure TS: no React, no server import, no side effects. Directly node-testable.
 */
import type { EngineAction, EngineActionType } from "./index";
import { ACTION_BINDINGS } from "./index";
import type { BackgroundSpec, TransitionSpec, AnnouncementPayload } from "@/lib/broadcast";
// Runtime validators reused from the hardened cross-device wire layer (relative
// import, not the `@/` alias, so node --test/tsx resolve it without a path plugin).
import { isValidBackgroundSpec, isValidTransitionSpec, isValidAnnouncement, isValidRenderUrl } from "../../lib/broadcast";

/** JSON-safe media asset reference (mirrors SET_BACKGROUND_MEDIA's assetRef). */
export interface MediaAssetRef {
  id: string;
  url: string;
  fileName: string;
  kind: string;
  mediaKey?: string;
}

export type ActionSpec =
  // Non-destructive — allowed on slides AND in macros
  | { type: "set_background_media"; assetRef: MediaAssetRef }
  | { type: "set_background"; spec: BackgroundSpec | null }
  | { type: "timer"; timerId: string; command: "start" | "stop" | "reset" }
  | { type: "show_message"; text: string; dismissAfterMs?: number | null }
  | { type: "clear_message" }
  | { type: "clear_layer"; layerId: string }
  | { type: "send_lower_third"; line1: string; line2: string }
  | { type: "clear_lower_third" }
  | { type: "set_announcement"; announcement: AnnouncementPayload | null }
  | { type: "set_transition"; transition: TransitionSpec | null }
  | { type: "logo" }
  // Destructive (guarded) — NEVER a slide action; macro-only, behind confirm
  | { type: "blank" }
  | { type: "kill" }
  | { type: "clear_all_layers" }
  // Reference to another Automation — slide-only (no macro-in-macro recursion)
  | { type: "macro"; macroId: string };

export type ActionSpecType = ActionSpec["type"];

/** Which EngineAction each non-macro spec maps to (its `type`), for guard
 *  lookup + dispatch. `macro` has no direct EngineAction (it expands). */
const SPEC_TO_ENGINE: Record<Exclude<ActionSpecType, "macro">, EngineActionType> = {
  set_background_media: "SET_BACKGROUND_MEDIA",
  set_background: "SET_BACKGROUND",
  timer: "TIMER_COMMAND",
  show_message: "SEND_MESSAGE",
  clear_message: "CLEAR_MESSAGE",
  clear_layer: "CLEAR_LAYER",
  send_lower_third: "SEND_LOWER_THIRD",
  clear_lower_third: "CLEAR_LOWER_THIRD",
  set_announcement: "SET_ANNOUNCEMENT",
  set_transition: "SET_TRANSITION",
  logo: "LOGO",
  blank: "BLANK",
  kill: "KILL",
  clear_all_layers: "CLEAR_ALL_LAYERS",
};

/** True iff the spec resolves to a destructive (requiresConfirm) EngineAction. */
export function isGuardedSpec(spec: ActionSpec): boolean {
  if (spec.type === "macro") return false; // a macro reference itself isn't guarded; its contents are guarded at fire time
  const et = SPEC_TO_ENGINE[spec.type];
  return ACTION_BINDINGS[et]?.requiresConfirm === true;
}

/**
 * Map a persisted ActionSpec to the runtime EngineAction to dispatch. Returns
 * `null` for `macro` (the caller expands it via the macro runner) and for any
 * malformed spec. Pure.
 */
export function specToEngineAction(spec: ActionSpec): EngineAction | null {
  switch (spec.type) {
    case "set_background_media": return { type: "SET_BACKGROUND_MEDIA", assetRef: spec.assetRef };
    case "set_background": return { type: "SET_BACKGROUND", spec: spec.spec };
    case "timer": return { type: "TIMER_COMMAND", timerId: spec.timerId, command: spec.command };
    case "show_message": return { type: "SEND_MESSAGE", text: spec.text, dismissAfterMs: spec.dismissAfterMs ?? null };
    case "clear_message": return { type: "CLEAR_MESSAGE" };
    case "clear_layer": return { type: "CLEAR_LAYER", id: spec.layerId };
    case "send_lower_third": return { type: "SEND_LOWER_THIRD", line1: spec.line1, line2: spec.line2 };
    case "clear_lower_third": return { type: "CLEAR_LOWER_THIRD" };
    case "set_announcement": return { type: "SET_ANNOUNCEMENT", announcement: spec.announcement };
    case "set_transition": return { type: "SET_TRANSITION", transition: spec.transition };
    case "logo": return { type: "LOGO" };
    case "blank": return { type: "BLANK" };
    case "kill": return { type: "KILL" };
    case "clear_all_layers": return { type: "CLEAR_ALL_LAYERS" };
    case "macro": return null;
    default: { const _n: never = spec; void _n; return null; }
  }
}

const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

/** Byte cap for an embedded BackgroundSpec / AnnouncementPayload / TransitionSpec
 *  (a stored/replayed spec must not be able to bloat the DB row or the wire). */
const MAX_EMBEDDED_SPEC_BYTES = 8192;
function withinByteCap(v: unknown): boolean {
  try { return JSON.stringify(v).length <= MAX_EMBEDDED_SPEC_BYTES; } catch { return false; }
}

export interface ValidateResult { ok: boolean; reason?: string }

/**
 * Structural validation of a single spec (shape + field bounds). Does NOT check
 * placement rules (slide-vs-macro) — that's `validateForSlide` / `validateForMacro`.
 */
export function validateSpec(spec: unknown): ValidateResult {
  if (!spec || typeof spec !== "object") return { ok: false, reason: "not-an-object" };
  const s = spec as Record<string, unknown>;
  const t = s.type;
  switch (t) {
    case "set_background_media": {
      const a = s.assetRef as Record<string, unknown> | undefined;
      if (!a || typeof a.id !== "string" || typeof a.url !== "string" || typeof a.fileName !== "string" || typeof a.kind !== "string")
        return { ok: false, reason: "bad-assetRef" };
      // id: a safe token (used as a React/Map key + persisted). url: MUST pass the
      // same https/loopback render-url gate as every projector media URL — no
      // arbitrary/cross-device http host. fileName/kind: bounded length.
      if (!SAFE_TOKEN.test(a.id)) return { ok: false, reason: "bad-assetRef-id" };
      if (!isValidRenderUrl(a.url)) return { ok: false, reason: "bad-assetRef-url" };
      if (a.fileName.length === 0 || a.fileName.length > 260) return { ok: false, reason: "bad-fileName" };
      if (a.kind.length === 0 || a.kind.length > 40) return { ok: false, reason: "bad-kind" };
      if (a.mediaKey !== undefined && (typeof a.mediaKey !== "string" || a.mediaKey.length > 512)) return { ok: false, reason: "bad-mediaKey" };
      return { ok: true };
    }
    case "set_background":
      // A stored background spec is replayed onto the projector — validate its
      // shape through the SAME hardened validator the wire uses, + a byte cap.
      if (s.spec === null || s.spec === undefined) return { ok: true };
      if (!isValidBackgroundSpec(s.spec)) return { ok: false, reason: "bad-background" };
      if (!withinByteCap(s.spec)) return { ok: false, reason: "background-too-large" };
      return { ok: true };
    case "timer":
      if (typeof s.timerId !== "string" || !SAFE_TOKEN.test(s.timerId)) return { ok: false, reason: "bad-timerId" };
      if (s.command !== "start" && s.command !== "stop" && s.command !== "reset") return { ok: false, reason: "bad-command" };
      return { ok: true };
    case "show_message":
      if (typeof s.text !== "string" || s.text.length === 0 || s.text.length > 2000) return { ok: false, reason: "bad-text" };
      if (s.dismissAfterMs != null && (typeof s.dismissAfterMs !== "number" || s.dismissAfterMs < 0 || s.dismissAfterMs > 3_600_000))
        return { ok: false, reason: "bad-dismiss" };
      return { ok: true };
    case "clear_message":
    case "clear_lower_third":
    case "logo":
    case "blank":
    case "kill":
    case "clear_all_layers":
      return { ok: true };
    case "clear_layer":
      if (typeof s.layerId !== "string" || !SAFE_TOKEN.test(s.layerId)) return { ok: false, reason: "bad-layerId" };
      return { ok: true };
    case "send_lower_third":
      if (typeof s.line1 !== "string" || typeof s.line2 !== "string") return { ok: false, reason: "bad-lines" };
      if (s.line1.length > 500 || s.line2.length > 500) return { ok: false, reason: "line-too-long" };
      return { ok: true };
    case "set_announcement":
      if (s.announcement === null || s.announcement === undefined) return { ok: true };
      if (!isValidAnnouncement(s.announcement)) return { ok: false, reason: "bad-announcement" };
      if (!withinByteCap(s.announcement)) return { ok: false, reason: "announcement-too-large" };
      return { ok: true };
    case "set_transition":
      if (s.transition === null || s.transition === undefined) return { ok: true };
      if (!isValidTransitionSpec(s.transition)) return { ok: false, reason: "bad-transition" };
      if (!withinByteCap(s.transition)) return { ok: false, reason: "transition-too-large" };
      return { ok: true };
    case "macro":
      if (typeof s.macroId !== "string" || !SAFE_TOKEN.test(s.macroId)) return { ok: false, reason: "bad-macroId" };
      return { ok: true };
    default:
      return { ok: false, reason: "unknown-type" };
  }
}

/** A spec is valid AND permitted as a SLIDE action (no guarded/destructive). */
export function validateForSlide(spec: unknown): ValidateResult {
  const base = validateSpec(spec);
  if (!base.ok) return base;
  if (isGuardedSpec(spec as ActionSpec)) return { ok: false, reason: "guarded-not-allowed-on-slide" };
  return { ok: true };
}

/** A spec is valid AND permitted inside a MACRO (no macro-in-macro recursion).
 *  Guarded specs ARE allowed here (fired behind the panel confirm). */
export function validateForMacro(spec: unknown): ValidateResult {
  const base = validateSpec(spec);
  if (!base.ok) return base;
  if ((spec as ActionSpec).type === "macro") return { ok: false, reason: "no-macro-in-macro" };
  return { ok: true };
}
