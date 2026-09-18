// Editor "view options" — rulers, grid, snap guides.
//
// ProPresenter treats these as view toggles rather than always-on chrome, and so
// do we: every one is OFF by default except the snap guides, which already
// existed and shipped ON (turning them off by default would be a regression).
//
// There is deliberately NO transparency-grid toggle here. The editor already
// paints a checkerboard BEHIND the canvas (the modal's CHECKER backdrop), which
// is what operators already know; a second one inside the canvas was built and
// then removed on the owner's call (2026-09-18) because two checkerboards are
// confusing. The existing backdrop is untouched.
// The choices are remembered PER OPERATOR in localStorage — never in the DB,
// never published, never part of a theme or a slide.
//
// Pure + unit-testable: no React, no DOM beyond the guarded storage helpers.

export type EditorViewPrefs = {
  /** Ruler gutters along the top and left of the canvas. */
  rulers: boolean;
  /** Faint grid over the canvas. */
  grid: boolean;
  /** The existing drag-time alignment guides. Shipped ON — stays ON. */
  snapGuides: boolean;
};

export const DEFAULT_VIEW_PREFS: EditorViewPrefs = {
  rulers: false,
  grid: false,
  snapGuides: true,
};

export const VIEW_PREFS_KEY = "presentflow.editor.view.v1";

/**
 * Coerce anything (a stale/corrupt/hand-edited localStorage blob, a future
 * version's extra keys) into a valid prefs object. Unknown keys are dropped and
 * a missing or non-boolean key falls back to its default — so a bad value can
 * never leave the editor in a state the operator can't get out of.
 */
export function normalizeViewPrefs(raw: unknown): EditorViewPrefs {
  const out = { ...DEFAULT_VIEW_PREFS };
  if (!raw || typeof raw !== "object") return out;
  const p = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_VIEW_PREFS) as (keyof EditorViewPrefs)[]) {
    if (typeof p[k] === "boolean") out[k] = p[k] as boolean;
  }
  return out;
}

export function loadViewPrefs(storage?: Pick<Storage, "getItem">): EditorViewPrefs {
  const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return { ...DEFAULT_VIEW_PREFS };
  try {
    const raw = s.getItem(VIEW_PREFS_KEY);
    return raw ? normalizeViewPrefs(JSON.parse(raw)) : { ...DEFAULT_VIEW_PREFS };
  } catch {
    return { ...DEFAULT_VIEW_PREFS };
  }
}

export function saveViewPrefs(prefs: EditorViewPrefs, storage?: Pick<Storage, "setItem">): void {
  const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return;
  try { s.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode / blocked */ }
}

// ---------- Ruler geometry --------------------------------------------------

/**
 * Ruler gutter thickness, in CSS px. Deliberately thin, and it sits INSIDE the
 * padding the canvas column already had — see RULER_PAD below — so turning
 * rulers on costs the canvas almost nothing.
 */
export const RULER_SIZE = 18;
/** Outer padding needed to fit a gutter without clipping it (was 16 = p-4). */
export const RULER_PAD = 22;

/**
 * Below this viewport height (CSS px) the rulers auto-hide, however the
 * operator set the toggle.
 *
 * 1366x768 at 150% Windows scaling is 911x512 CSS px — the worst realistic case
 * in docs/WINDOWS_DESIGN.md §3. There, canvas height is already down ~68px to
 * the object toolbar and the status row, and the honest choice (the owner's
 * instruction) is to drop the rulers rather than shrink the canvas again.
 */
export const RULER_MIN_VIEWPORT_H = 620;

export function rulersVisible(prefs: EditorViewPrefs, viewportH: number): boolean {
  return prefs.rulers && viewportH >= RULER_MIN_VIEWPORT_H;
}

/**
 * Tick positions along one ruler, as PERCENTAGES of the canvas edge.
 *
 * Percentages (not pixels) mean the ruler is correct at every zoom level and at
 * every window size without recomputation — the same trick every overlay inside
 * the canvas already uses.
 *
 * `total` is the canvas extent in canvas units (1920 or 1080). Minor ticks every
 * 1/16, labelled major ticks every 1/4.
 */
export function rulerTicks(total: number): { pct: number; major: boolean; label: string | null }[] {
  const DIVISIONS = 16;
  const ticks: { pct: number; major: boolean; label: string | null }[] = [];
  for (let i = 0; i <= DIVISIONS; i++) {
    const pct = (i / DIVISIONS) * 100;
    const major = i % 4 === 0;
    ticks.push({
      pct,
      major,
      // The 0 label is noise in an 18px gutter, and the last one would be
      // clipped by the edge, so neither is drawn.
      label: major && i !== 0 && i !== DIVISIONS ? String(Math.round((i / DIVISIONS) * total)) : null,
    });
  }
  return ticks;
}

/** Clamp a pointer position (canvas units) to the canvas for the ruler marker. */
export function markerPct(valueInCanvasUnits: number, total: number): number {
  if (!Number.isFinite(valueInCanvasUnits) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (valueInCanvasUnits / total) * 100));
}
