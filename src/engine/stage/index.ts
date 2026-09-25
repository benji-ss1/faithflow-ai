/**
 * src/engine/stage — PURE stage-layout model (ProPresenter "Stage Layouts", 1:1).
 *
 * User direction 2026-09-21: copy ProPresenter's SEPARATE Stage Layout editor
 * rather than folding stage config into Scenes. So a StageLayout is its own
 * first-class named preset — exactly like ProPresenter's Screens > Edit Layouts
 * (Ctrl+4) list, with its own thumbnailed live-switch flyout.
 *
 * Kept deliberately PURE (no React, no DB, no `server-only` import, every
 * function takes an explicit `nowMs`/context) so the whole model is directly
 * unit-testable under `node:test`, matching src/engine/timers/index.ts.
 *
 * Scenes vs Stage Layouts — two DIFFERENT questions, both preserved:
 *   Scene (= ProPresenter "Look") : which LAYERS reach which screen (+ theme).
 *   StageLayout                   : what the stage confidence monitor is BUILT
 *                                   from — which widgets, where, how big.
 */


/** Widget kinds, mirroring ProPresenter's stage element palette. */

export type StageWidgetKind =
  | "current_text"      // the live slide's text — the big one
  | "next_text"         // what's coming, so singers/preacher can see ahead
  | "timer"             // a specific named timer (bound by timerId)
  | "clock"             // System Clock — host wall-clock time
  | "slide_preview"     // thumbnail of an actual output screen
  | "message"           // operator message to the platform
  | "static_text";      // fixed label, e.g. "STAGE 1"

export const STAGE_WIDGET_KINDS: StageWidgetKind[] = [
  "current_text", "next_text", "timer", "clock", "slide_preview", "message", "static_text",
];

export const STAGE_WIDGET_LABELS: Record<StageWidgetKind, string> = {
  current_text: "Current text",
  next_text: "Next text",
  timer: "Timer",
  clock: "Clock",
  slide_preview: "Screen preview",
  message: "Message",
  static_text: "Text",
};

/** Canvas is a normalised 0..1 box so a layout renders identically at any
 *  stage-screen resolution (a 720p confidence monitor and a 4K LED wall show
 *  the same design). Percentages, never pixels. */
export interface StageRect { x: number; y: number; w: number; h: number }

export type StageAlign = "left" | "center" | "right";

// StageColorTrigger lived here. Colour triggers belong to the TIMER
// (src/engine/timers), which is the one place every surface reads them from.

export interface StageWidget {
  id: string;
  kind: StageWidgetKind;
  rect: StageRect;
  /** Bound timer definition id — `kind:"timer"` only. */
  timerId?: string | null;
  /** Which output the preview mirrors — `kind:"slide_preview"` only. */
  previewScreen?: "main" | "stage" | "livestream" | "ndi";
  /** Literal text — `kind:"static_text"` only. */
  text?: string;
  /** Relative text size; 1 = the layout's natural size for that box. */
  scale: number;
  align: StageAlign;
  color?: string;
  /** Render the text in capitals. */
  uppercase?: boolean;
  /** Show the timer/clock's NAME above the value. */
  showLabel?: boolean;
  /** Timer/clock format. */
  showHours?: boolean;
  leadingZeros?: boolean;
  zIndex: number;

  // DELETED 2026-09-25: `overrunColor` and `colorTriggers` used to live here
  // too. They were sanitised, persisted, and set by four of the five built-in
  // presets — and read by NOTHING: StageLayoutRenderer resolves a timer's
  // colour from the TIMER DEFINITION's own triggers, never the widget's. So
  // the shipped presets advertised an amber→yellow→red countdown that could
  // never happen.
  //
  // They are removed rather than wired, because ProPresenter has exactly one
  // source of truth for a timer's colour (the timer), and two places to set
  // the same thing is how the stage screen and the operator panel drift apart.
  // Set a timer's triggers on the TIMER, in the Timers panel, and every
  // surface — projector, stage, layout — agrees.
}

export interface StageLayout {
  id: string;
  name: string;
  /** Layout-wide background. Stage screens are almost always black. */
  background: string;
  widgets: StageWidget[];
}

// ── Bounds ────────────────────────────────────────────────────────────────
export const STAGE_SCALE_MIN = 0.2;
export const STAGE_SCALE_MAX = 6;
export const STAGE_MAX_WIDGETS = 24;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Colours are written straight into a `style` attribute by the renderer, so an
 *  unvalidated string is a CSS-injection vector. Accept ONLY #rrggbb — the same
 *  gate the rest of the codebase uses (isHex6Color) — and drop anything else
 *  rather than trusting it. Kept local so this module stays dependency-free. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const safeColor = (v: unknown): string | undefined =>
  typeof v === "string" && HEX6.test(v) ? v : undefined;

/** Clamp a rect into the canvas, keeping it at least 1% x 1% and never
 *  letting it start off-canvas — a widget must always be reachable/visible. */
export function clampRect(r: StageRect): StageRect {
  const w = clamp(Number.isFinite(r.w) ? r.w : 0.2, 0.01, 1);
  const h = clamp(Number.isFinite(r.h) ? r.h : 0.1, 0.01, 1);
  return {
    w, h,
    x: clamp(Number.isFinite(r.x) ? r.x : 0, 0, 1 - w),
    y: clamp(Number.isFinite(r.y) ? r.y : 0, 0, 1 - h),
  };
}

// DELETED 2026-09-22: resolveWidgetColor, formatStageClock, STAGE_UNBOUND,
// StageRenderContext and resolveWidgetText lived here and were called from
// NOWHERE in src/. StageLayoutRenderer did all four jobs itself, against the
// engine/timers versions — and the two had already drifted: formatStageClock
// and formatTimerClock disagreed on minute padding, which a test RECORDED as a
// 🟡 note instead of the loop closing it.
//
// They are deleted rather than kept "for later". An uncalled pure function is
// not spare capacity, it is a second implementation waiting to disagree with
// the real one — which is exactly how the stage screen and the projector drift
// apart. Timer formatting and colour live in src/engine/timers
// (formatTimerClock, resolveTimerColor, triggerValueFor) and are shared by
// every surface, so there is one answer to "what does this timer say and what
// colour is it".

/** Sanitize an untrusted layout (DB row, import, wire) into a safe one.
 *  Fail-open per-field like the rest of the codebase: a bad field falls back to
 *  a sane default rather than discarding the whole layout, because a blank
 *  stage screen mid-service is worse than a slightly-wrong one. */
export function sanitizeStageLayout(input: unknown, fallbackId = "layout"): StageLayout {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawWidgets = Array.isArray(o.widgets) ? o.widgets : [];
  const seen = new Set<string>();
  const widgets: StageWidget[] = [];
  for (const rw of rawWidgets.slice(0, STAGE_MAX_WIDGETS)) {
    const w = (rw && typeof rw === "object" ? rw : {}) as Record<string, unknown>;
    const kind = w.kind as StageWidgetKind;
    if (!STAGE_WIDGET_KINDS.includes(kind)) continue; // unknown kind → dropped
    let id = typeof w.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(w.id) ? w.id : `w${widgets.length}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const r = (w.rect && typeof w.rect === "object" ? w.rect : {}) as Record<string, number>;
    widgets.push({
      id, kind,
      rect: clampRect({ x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }),
      timerId: typeof w.timerId === "string" && w.timerId ? w.timerId : null,
      previewScreen: (["main", "stage", "livestream", "ndi"] as const).includes(w.previewScreen as "main")
        ? (w.previewScreen as StageWidget["previewScreen"]) : "main",
      text: typeof w.text === "string" ? w.text.slice(0, 200) : undefined,
      scale: clamp(Number.isFinite(Number(w.scale)) ? Number(w.scale) : 1, STAGE_SCALE_MIN, STAGE_SCALE_MAX),
      align: (["left", "center", "right"] as const).includes(w.align as StageAlign) ? (w.align as StageAlign) : "center",
      color: safeColor(w.color),
      uppercase: w.uppercase === true,
      showLabel: w.showLabel === true,
      showHours: typeof w.showHours === "boolean" ? w.showHours : undefined,
      leadingZeros: w.leadingZeros === true,
      zIndex: clamp(Number.isFinite(Number(w.zIndex)) ? Number(w.zIndex) : widgets.length, -9999, 9999),
    });
  }
  return {
    id: typeof o.id === "string" && o.id ? o.id.slice(0, 64) : fallbackId,
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 120) : "Layout",
    background: safeColor(o.background) ?? "#000000",
    widgets: widgets.sort((a, b) => a.zIndex - b.zIndex),
  };
}


/**
 * Text size for a widget, as a fraction of the CANVAS HEIGHT.
 *
 * WHY THIS IS SHARED (2026-09-25): there were three copies — the renderer used
 * `rect.h * 60 * scale`, the editing canvas `rect.h * 58` and the thumbnail
 * `rect.h * 46`, and neither of the last two applied `scale`. So the Size
 * slider moved and nothing an operator was looking at changed; they found out
 * what it did on the confidence monitor, mid-service.
 *
 * Returning a FRACTION rather than pixels is what lets all three share it: the
 * renderer multiplies by the real screen height, the canvas and thumbnail by
 * their own box height. One answer, three sizes of the same picture.
 */
export function stageTextFraction(w: { rect: { h: number }; scale: number }): number {
  return w.rect.h * 0.6 * w.scale;
}

/** The same number as a CSS length against a size-container. The three
 *  surfaces each put `container-type: size` on their canvas, so `cqh` means
 *  "1% of the canvas height" everywhere — identical picture at any size. */
export function stageTextCss(w: { rect: { h: number }; scale: number }): string {
  return `${Math.max(0.5, stageTextFraction(w) * 100)}cqh`;
}
