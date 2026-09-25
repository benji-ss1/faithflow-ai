/**
 * src/engine/stage/presets — built-in Stage Layouts.
 *
 * ProPresenter ships starter layouts and its Edit Layouts list is preset-first
 * ("+" offers a pre-loaded template or blank). We do the same, and the names
 * below deliberately mirror the real layouts seen in a working ProPresenter
 * install (user screenshot, 2026-09-21): "Current + Next Text",
 * "Current + Timer Text", "Current text only", "Timer only", "Current + Timers".
 *
 * Built-ins are CODE, not DB rows — the same pattern as BUILT_IN_SCENES in
 * src/lib/scenes.ts: identical for every church, nothing to seed, nothing to
 * migrate, and impossible to delete by accident. A church customises by
 * DUPLICATING a built-in into an editable row (never editing one in place), so
 * "restore defaults" is always available — something ProPresenter does not
 * give you once you've edited or deleted a starter layout.
 */
import type { StageLayout, StageWidget } from "./index";

const w = (p: Partial<StageWidget> & Pick<StageWidget, "id" | "kind" | "rect">): StageWidget => ({
  scale: 1, align: "center", zIndex: 0, ...p,
});

/** `timerId: null` = "not bound yet". The editor prompts the operator to pick
 *  one of their timers; until then the widget renders a dash rather than
 *  vanishing, so the binding is visibly incomplete instead of silently missing. */
export const BUILT_IN_STAGE_LAYOUTS: StageLayout[] = [
  {
    id: "builtin-current-next",
    name: "Current + Next Text",
    background: "#000000",
    widgets: [
      w({ id: "current", kind: "current_text", rect: { x: 0.03, y: 0.06, w: 0.94, h: 0.58 }, scale: 1.6 }),
      w({ id: "next", kind: "next_text", rect: { x: 0.03, y: 0.68, w: 0.94, h: 0.26 }, scale: 0.9, color: "#9ca3af", zIndex: 1 }),
    ],
  },
  {
    id: "builtin-current-timer",
    name: "Current + Timer Text",
    background: "#000000",
    widgets: [
      w({ id: "current", kind: "current_text", rect: { x: 0.03, y: 0.04, w: 0.94, h: 0.62 }, scale: 1.6 }),
      w({
        id: "timer", kind: "timer", timerId: null, rect: { x: 0.03, y: 0.70, w: 0.94, h: 0.26 },
        scale: 2.4, color: "#4ade80", showLabel: true, zIndex: 1,
      }),
    ],
  },
  {
    id: "builtin-current-only",
    name: "Current text only",
    background: "#000000",
    widgets: [
      w({ id: "current", kind: "current_text", rect: { x: 0.03, y: 0.06, w: 0.94, h: 0.88 }, scale: 1.9 }),
    ],
  },
  {
    id: "builtin-timer-only",
    name: "Timer only",
    background: "#000000",
    widgets: [
      w({
        id: "timer", kind: "timer", timerId: null, rect: { x: 0.05, y: 0.28, w: 0.90, h: 0.44 },
        scale: 5, color: "#4ade80",
      }),
    ],
  },
  {
    id: "builtin-current-timers",
    name: "Current + Timers",
    background: "#000000",
    widgets: [
      w({ id: "current", kind: "current_text", rect: { x: 0.03, y: 0.16, w: 0.94, h: 0.56 }, scale: 1.4 }),
      w({ id: "clock", kind: "clock", rect: { x: 0.03, y: 0.02, w: 0.30, h: 0.12 }, scale: 1, align: "left", color: "#9ca3af", zIndex: 1 }),
      w({
        id: "timer", kind: "timer", timerId: null, rect: { x: 0.55, y: 0.02, w: 0.42, h: 0.12 },
        scale: 1.2, align: "right", color: "#4ade80", zIndex: 2,
      }),
      w({ id: "next", kind: "next_text", rect: { x: 0.03, y: 0.76, w: 0.94, h: 0.20 }, scale: 0.85, color: "#9ca3af", zIndex: 3 }),
    ],
  },
];

export function isBuiltInStageLayout(id: string): boolean {
  return BUILT_IN_STAGE_LAYOUTS.some((l) => l.id === id);
}

/** Duplicate a layout into an editable copy. Never edit a built-in in place. */
export function duplicateStageLayout(src: StageLayout, id: string, name?: string): StageLayout {
  return {
    id, name: name ?? `${src.name} copy`, background: src.background,
    // DEEP copy every nested object. A shallow `{...x}` leaves `rect` (and the
    // triggers) shared with the source, so dragging a widget in the duplicate
    // would silently mutate the BUILT-IN preset for the rest of the session —
    // caught by test/stage-layout-engine.test.ts.
    widgets: src.widgets.map((x) => ({
      ...x,
      rect: { ...x.rect },
    })),
  };
}
