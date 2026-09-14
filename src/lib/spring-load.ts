// Cross-OS spring-loaded drag-and-drop primitives (Wave 3, item 4).
//
// "Spring loading" = hovering a drag over a collapsed/foreign target for a
// short dwell ARMS it (accent ring + slight expand) so a drop lands there. We
// build it on in-app pointer/HTML5 drag events ONLY (dragover/dragleave/drop),
// never OS-native folder-spring behaviour, so it is byte-identical on Windows,
// macOS and Linux. This module is the PURE core (timer state machine + drop-
// target classification); the React wiring is a thin wrapper over it.

/** Dwell before a hovered target arms, in ms. Field value from the brief. */
export const SPRING_ARM_MS = 600;

// ── Drop classification ──────────────────────────────────────────────────────
// The MIME types our in-app library/media browsers stamp on a drag (see
// SongsBrowser / MediaBrowser onDragStart), plus the OS-file signal.
export const PF_LIBRARY_ITEM_MIME = "application/x-pf-library-item";
export const PF_LIBRARY_ITEMS_MIME = "application/x-pf-library-items";

export type DropKind = "library-item" | "os-files" | "none";

/**
 * Classify a drag from its dataTransfer `types` list. In-app library drags win
 * over the generic "Files" signal (a card drag never carries real OS files);
 * an OS Finder/Explorer drag carries only "Files". Pure + test-locked.
 */
export function classifyDrop(types: readonly string[] | undefined | null): DropKind {
  if (!types) return "none";
  if (types.includes(PF_LIBRARY_ITEM_MIME) || types.includes(PF_LIBRARY_ITEMS_MIME)) {
    return "library-item";
  }
  if (types.includes("Files")) return "os-files";
  return "none";
}

/**
 * True iff a `dragleave` genuinely left the target (not just crossed onto a
 * CHILD of it). HTML5 fires dragleave when the pointer moves from a row onto a
 * descendant; that pointer wiggle must NOT reset the dwell. We treat the leave
 * as real only when `relatedTarget` (where the pointer went) is not contained
 * within `currentTarget` (the row). Pure so it's unit-testable with fake nodes.
 */
export function isRealDragLeave(
  currentTarget: { contains(node: unknown): boolean } | null,
  relatedTarget: unknown,
): boolean {
  if (!currentTarget) return true;
  if (relatedTarget && currentTarget.contains(relatedTarget)) return false;
  return true;
}

// ── Spring-arm state machine ─────────────────────────────────────────────────
// A tiny pure reducer so the dwell/arm logic is testable without timers or the
// DOM. The React hook feeds it real timestamps and a scheduled tick.

export type SpringState = {
  /** The id of the target currently being hovered (null = none). */
  hoverId: string | null;
  /** Timestamp (ms) the current hover began. */
  hoverStartedAt: number;
  /** True once the hover has dwelt past SPRING_ARM_MS. */
  armed: boolean;
};

export const SPRING_IDLE: SpringState = { hoverId: null, hoverStartedAt: 0, armed: false };

/** Enter (or stay on) a target. Re-entering a DIFFERENT target restarts the
 *  dwell; re-entering the SAME target preserves its (possibly armed) state. */
export function springEnter(state: SpringState, id: string, now: number): SpringState {
  if (state.hoverId === id) return state;
  return { hoverId: id, hoverStartedAt: now, armed: false };
}

/** Leave the current target (or a specific one). Disarms. */
export function springLeave(state: SpringState, id?: string): SpringState {
  if (id !== undefined && state.hoverId !== id) return state; // stale leave for an old target
  return SPRING_IDLE;
}

/** Tick: arm the current hover if it has dwelt long enough. */
export function springTick(state: SpringState, now: number, armMs = SPRING_ARM_MS): SpringState {
  if (state.hoverId === null || state.armed) return state;
  if (now - state.hoverStartedAt >= armMs) return { ...state, armed: true };
  return state;
}

/** True iff this specific target is the armed one. */
export function isArmed(state: SpringState, id: string): boolean {
  return state.armed && state.hoverId === id;
}

// ── Playlist header drop-position resolution ─────────────────────────────────
// Dropping an item onto a section header should insert it as the FIRST member
// of that section, i.e. immediately AFTER the header in the flat playlist order.
// Given the flat id list and the header's id, resolve the target insertion
// index. Pure + test-locked.

/**
 * Insertion index (into `orderedIds`) for a drop onto the header `headerId`.
 * Returns the position right after the header. -1 if the header isn't found.
 */
export function insertIndexAfterHeader(orderedIds: readonly string[], headerId: string): number {
  const i = orderedIds.indexOf(headerId);
  return i === -1 ? -1 : i + 1;
}

/**
 * THE single ordering primitive: place `movingId` at `index` in `orderedIds`.
 * `movingId` is first removed if already present (relocate); a fresh id is a
 * plain insert. `index` is clamped into range so an out-of-bounds/`NaN`/negative
 * index fail-softs to a clamped position instead of dropping the id. Pure +
 * test-locked; every DnD insertion path (header-drop, section-drop reposition)
 * routes through this so there's one clamp/insert behaviour.
 */
export function insertIdAtIndex(
  orderedIds: readonly string[],
  movingId: string,
  index: number,
): string[] {
  const without = orderedIds.filter((x) => x !== movingId);
  const clamped = Number.isFinite(index) ? Math.max(0, Math.min(Math.trunc(index), without.length)) : without.length;
  return [...without.slice(0, clamped), movingId, ...without.slice(clamped)];
}

/**
 * Produce the new id order after moving `movingId` to sit immediately after
 * `headerId`. If `movingId` isn't already present it is inserted (a fresh add);
 * if it is present it is relocated. Pure so the reorder is test-locked.
 */
export function orderAfterHeaderDrop(
  orderedIds: readonly string[],
  headerId: string,
  movingId: string,
): string[] {
  const without = orderedIds.filter((x) => x !== movingId);
  const at = insertIndexAfterHeader(without, headerId);
  if (at === -1) return [...orderedIds]; // header gone — no-op copy
  return insertIdAtIndex(without, movingId, at);
}
