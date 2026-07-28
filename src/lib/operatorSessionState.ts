"use client";
/**
 * operatorSessionState — JPD Fix 5 (2026-07-27)
 *
 * Persists the operator's *position* in the console across app relaunches
 * (quit PresentFlow → reopen → same plan item/slide selected in PREVIEW,
 * same right-sidebar tab open). Web-side only (localStorage) — the desktop
 * shell is a thin client, so this survives Electron restarts with no DMG cut.
 *
 * What this file deliberately does NOT own (already persisted elsewhere):
 *   - Playlist items/order .......... DB (service_plans / getExpandedServicePlan)
 *   - AI listening intent ........... AI_LISTEN_INTENT_KEY + auto-resume (Bug-3,
 *                                     OperatorConsole) — `aiWasOn` here is a
 *                                     mirror for observability only, never acted on
 *   - Audio device/channel/capture .. nativeDeviceStore / deviceChannelPrefs (v0.1.78-84)
 *   - Transition type/speed ......... presentflow.pro.transition (BottomBar)
 *   - Screen assignments ............ presentflow.screenAssignments.v1 (ScreensPanel)
 *   - Timers / Messages ............. pro/hooks.ts TIMER_KEY / MSG_KEY
 *
 * Restore policy: PREVIEW ONLY. Restoring must never fire anything to live.
 * Staleness: saved state older than 36h is ignored and cleared. 36h (not 12h)
 * so the Saturday-night-prep → Sunday-morning-service pattern (12.5-15h gap)
 * survives; the activePlanId match already guards against cross-service
 * confusion when a different plan is opened.
 */

const KEY = "presentflow.pro.sessionState.v1";
const MAX_AGE_MS = 36 * 60 * 60 * 1000; // 36h
const DEBOUNCE_MS = 2000;

export type OperatorSessionState = {
  lastActiveItemIdx: number;
  lastActiveSlideIdx: number;
  /** Right icon-bar popover key ("bible" | "songs" | ... ) or null = closed. */
  sidebarTab: string | null;
  /** Mirror of AI listening at save time. NOT used to auto-start the mic —
   *  that stays with AI_LISTEN_INTENT_KEY's existing auto-resume path. */
  aiWasOn: boolean;
  activePlanId: string;
  savedAt: number;
};

type Patch = Partial<Omit<OperatorSessionState, "savedAt">>;

// ---------------------------------------------------------------------------

function readRaw(): OperatorSessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<OperatorSessionState>;
    if (!p || typeof p !== "object") return null;
    if (typeof p.savedAt !== "number" || typeof p.activePlanId !== "string") return null;
    return {
      lastActiveItemIdx: Number.isInteger(p.lastActiveItemIdx) ? (p.lastActiveItemIdx as number) : 0,
      lastActiveSlideIdx: Number.isInteger(p.lastActiveSlideIdx) ? (p.lastActiveSlideIdx as number) : 0,
      sidebarTab: typeof p.sidebarTab === "string" ? p.sidebarTab : null,
      aiWasOn: p.aiWasOn === true,
      activePlanId: p.activePlanId,
      savedAt: p.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Load persisted session state. Returns null (and clears storage) when the
 * blob is missing, malformed, or older than 36h.
 */
export function loadSessionState(): OperatorSessionState | null {
  const s = readRaw();
  if (!s) return null;
  if (Date.now() - s.savedAt > MAX_AGE_MS) {
    try { window.localStorage.removeItem(KEY); } catch { /* noop */ }
    return null;
  }
  return s;
}

// --- debounced writer -------------------------------------------------------

let pending: Patch | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushHooked = false;

function writeNow() {
  if (!pending || typeof window === "undefined") return;
  const prev = readRaw();
  const merged: OperatorSessionState = {
    lastActiveItemIdx: pending.lastActiveItemIdx ?? prev?.lastActiveItemIdx ?? 0,
    lastActiveSlideIdx: pending.lastActiveSlideIdx ?? prev?.lastActiveSlideIdx ?? 0,
    sidebarTab: pending.sidebarTab !== undefined ? pending.sidebarTab : (prev?.sidebarTab ?? null),
    aiWasOn: pending.aiWasOn ?? prev?.aiWasOn ?? false,
    activePlanId: pending.activePlanId ?? prev?.activePlanId ?? "",
    savedAt: Date.now(),
  };
  pending = null;
  if (timer) { clearTimeout(timer); timer = null; }
  if (!merged.activePlanId) return; // never persist without a plan anchor
  try { window.localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* quota/private — noop */ }
}

/** Flush any pending debounced write immediately (quit / tab-hide path). */
export function flushSessionState() { writeNow(); }

/**
 * Queue a session-state update. Writes are debounced 2s; a flush listener on
 * visibilitychange(hidden)/pagehide guarantees the last state lands before
 * the app quits (Electron window close fires pagehide).
 */
export function updateSessionState(patch: Patch) {
  if (typeof window === "undefined") return;
  pending = { ...pending, ...patch };
  if (timer) clearTimeout(timer);
  timer = setTimeout(writeNow, DEBOUNCE_MS);
  if (!flushHooked) {
    flushHooked = true;
    window.addEventListener("pagehide", writeNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") writeNow();
    });
  }
}
