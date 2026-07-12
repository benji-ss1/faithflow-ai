"use client";
/**
 * Priority 4 — Global operator hotkeys.
 *
 * Single hook mounted in ProOperatorShell. Centralizes every global keybind
 * so we don't have half a dozen `onKey` listeners fighting each other.
 *
 * The key-decode is extracted as a PURE function (`decodeShortcut`) so it can
 * be unit-tested without a browser (see test/keyboard-shortcuts.test.ts).
 */
import { useEffect } from "react";

export type ShortcutAction =
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "send-live" }
  | { kind: "kill-live" }
  | { kind: "blank" }
  | { kind: "logo" }
  | { kind: "open-search" }
  | { kind: "bible-mode" }
  | { kind: "media-mode" }
  | { kind: "songs-mode" }
  | { kind: "playlist-mode" }
  | { kind: "jump-slide"; index: number } // 0-based slide index
  | { kind: "open-help" };

/**
 * Pure predicate: should this event be ignored because the user is typing?
 * Matches Radix / native form controls and any contentEditable region.
 */
export function shouldIgnore(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as HTMLElement & { isContentEditable?: boolean };
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Minimal keyboard-event shape so we can construct fakes in tests without
 * needing a DOM. Matches the fields KeyboardEvent exposes.
 */
export type ShortcutKeyEvent = {
  code?: string;
  key?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
};

/**
 * Pure decoder. Returns null when the event should not trigger any global
 * action (typing in an input, unknown key, etc.).
 */
export function decodeShortcut(e: ShortcutKeyEvent): ShortcutAction | null {
  if (shouldIgnore(e.target ?? null)) return null;
  const cmd = !!(e.metaKey || e.ctrlKey);
  const shift = !!e.shiftKey;
  const alt = !!e.altKey;
  const code = e.code || "";
  const key = e.key || "";

  // Cmd/Ctrl combos first — center-mode switches + search palette.
  if (cmd && !alt) {
    // Prefer `code` (physical) so it's layout-agnostic. Fall back to key.
    const c = code || `Key${key.toUpperCase()}`;
    if (c === "KeyK") return { kind: "open-search" };
    if (c === "KeyB") return { kind: "bible-mode" };
    if (c === "KeyM") return { kind: "media-mode" };
    if (c === "KeyS") return { kind: "songs-mode" };
    if (c === "KeyP") return { kind: "playlist-mode" };
    return null;
  }

  // Any other modifier combo we don't understand → bail.
  if (alt) return null;

  // Shift+/ → "?" (open help).
  if (code === "Slash" && shift) return { kind: "open-help" };
  if (key === "?") return { kind: "open-help" };

  // Bare navigation.
  if (code === "Space" || key === " " || code === "ArrowRight" || key === "ArrowRight") {
    return { kind: "next" };
  }
  if (code === "ArrowLeft" || key === "ArrowLeft") return { kind: "prev" };
  if (code === "Enter" || key === "Enter") return { kind: "send-live" };
  if (code === "Escape" || key === "Escape") return { kind: "kill-live" };

  // Bare letter actions (no modifier).
  if (!shift && !cmd) {
    if (code === "KeyB" || key === "b" || key === "B") return { kind: "blank" };
    if (code === "KeyL" || key === "l" || key === "L") return { kind: "logo" };
  }

  // Digit1..Digit9 → jump-slide 0..8. Ignore shifted (those are symbols).
  if (!shift) {
    if (code && /^Digit[1-9]$/.test(code)) {
      const n = parseInt(code.slice(5), 10);
      return { kind: "jump-slide", index: n - 1 };
    }
    if (/^[1-9]$/.test(key)) {
      return { kind: "jump-slide", index: parseInt(key, 10) - 1 };
    }
  }

  return null;
}

/**
 * Callback bag consumed by the hook.
 */
export type HotkeyHandlers = {
  onNext: () => void;
  onPrev: () => void;
  onSendLive: () => void;
  onKillLive: () => void;
  onBlank: () => void;
  onLogo: () => void;
  onOpenSearch: () => void;
  onSetCenterMode: (mode: "bible" | "media" | "songs" | "playlist") => void;
  onJumpSlide: (index: number) => void;
  onOpenShortcutsHelp: () => void;
  /**
   * Called to decide whether Enter should send-to-live (safe-mode OFF) or
   * only select preview (safe-mode ON). The hook lets the caller pass a
   * live-read function so we don't re-compute stale localStorage.
   */
  isSafeMode?: () => boolean;
  /**
   * Whether the 1-9 slide-jump shortcuts should fire — usually only when the
   * center mode is "slides"/"playlist" AND an item is selected.
   */
  isSlideJumpEnabled?: () => boolean;
  /**
   * Any modal open? When true, we swallow Escape at the browser level and
   * let the modal handle it, and we also skip most shortcuts to avoid
   * hijacking focus inside dialogs (Radix already handles this via
   * shouldIgnore, but modals w/o focused inputs still need care).
   */
  isModalOpen?: () => boolean;
};

export function useOperatorHotkeys(handlers: HotkeyHandlers) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = decodeShortcut(e);
      if (!action) return;

      const modalOpen = handlers.isModalOpen ? handlers.isModalOpen() : false;
      // When a modal is open, only allow Escape (to close) and let the modal
      // handle it — do NOT invoke kill-live. Everything else is suppressed.
      if (modalOpen) {
        // Let the modal receive the event naturally.
        return;
      }

      switch (action.kind) {
        case "next":
          e.preventDefault();
          handlers.onNext();
          return;
        case "prev":
          e.preventDefault();
          handlers.onPrev();
          return;
        case "send-live": {
          e.preventDefault();
          const safe = handlers.isSafeMode ? handlers.isSafeMode() : false;
          if (safe) {
            // Safe Mode ON: don't push to live. Selecting the current
            // preview slide is a no-op — Enter falls through silently so
            // the operator learns nothing scary happened.
            return;
          }
          handlers.onSendLive();
          return;
        }
        case "kill-live":
          e.preventDefault();
          handlers.onKillLive();
          return;
        case "blank":
          e.preventDefault();
          handlers.onBlank();
          return;
        case "logo":
          e.preventDefault();
          handlers.onLogo();
          return;
        case "open-search":
          e.preventDefault();
          handlers.onOpenSearch();
          return;
        case "bible-mode":
          e.preventDefault();
          handlers.onSetCenterMode("bible");
          return;
        case "media-mode":
          e.preventDefault();
          handlers.onSetCenterMode("media");
          return;
        case "songs-mode":
          e.preventDefault();
          handlers.onSetCenterMode("songs");
          return;
        case "playlist-mode":
          e.preventDefault();
          handlers.onSetCenterMode("playlist");
          return;
        case "jump-slide": {
          const enabled = handlers.isSlideJumpEnabled
            ? handlers.isSlideJumpEnabled()
            : true;
          if (!enabled) return;
          e.preventDefault();
          handlers.onJumpSlide(action.index);
          return;
        }
        case "open-help":
          e.preventDefault();
          handlers.onOpenShortcutsHelp();
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
