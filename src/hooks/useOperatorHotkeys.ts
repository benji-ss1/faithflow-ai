"use client";
/**
 * Priority 4 — Global operator hotkeys.
 *
 * Single hook mounted in ProOperatorShell. Centralizes every global keybind
 * so we don't have half a dozen `onKey` listeners fighting each other.
 *
 * The key-decode is extracted as a PURE function (`decodeShortcut`) so it can
 * be unit-tested without a browser (see test/keyboard-shortcuts.test.ts).
 *
 * ProOperatorShell canonical center-mode values are:
 *   "slides" | "bible" | "songs" | "media"
 * The decoder emits `"playlist-mode"` for the Cmd/Ctrl+P shortcut, which the
 * shell aliases to `"slides"` (see ProOperatorShell.onSetCenterMode). Kept
 * the name `playlist-mode` for continuity with the shortcut card + Cmd+P
 * mnemonic ("Playlist").
 */
import { useEffect, useRef } from "react";

export type ShortcutAction =
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "send-live" }
  | { kind: "send-live-force" } // Shift+Enter — bypasses Safe Mode
  | { kind: "kill-live" }
  | { kind: "blank" }
  | { kind: "logo" }
  | { kind: "open-search" }
  | { kind: "bible-mode" }
  | { kind: "media-mode" }
  | { kind: "songs-mode" }
  | { kind: "playlist-mode" } // aliased to "slides" by ProOperatorShell
  | { kind: "jump-slide"; index: number } // 0-based slide index
  | { kind: "open-help" };

/**
 * Pure predicate: should this event be ignored because the user is typing?
 * Matches Radix / native form controls and any contentEditable region,
 * including ARIA text-role widgets (Radix Combobox, cmdk input, etc.) and
 * nested contenteditable containers where the actual target is a child span.
 */
export function shouldIgnore(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as HTMLElement & { isContentEditable?: boolean };
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  // ARIA text roles — Radix combobox trigger, cmdk input, custom searchboxes.
  const getAttr = (el as Element).getAttribute;
  if (typeof getAttr === "function") {
    const role = (el as Element).getAttribute("role");
    if (role === "textbox" || role === "combobox" || role === "searchbox") return true;
  }
  // Nested contenteditable: target may be a child element inside a
  // contenteditable="true" container. `closest` handles this cleanly.
  const closest = (el as Element).closest;
  if (typeof closest === "function") {
    try {
      if ((el as Element).closest('[contenteditable="true"]')) return true;
    } catch {
      /* jsdom-less test targets may not implement closest — ignore */
    }
  }
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

  // Shift+Enter → force send-live (bypasses Safe Mode). Advanced operator
  // escape hatch — see Y2.
  if ((code === "Enter" || key === "Enter") && shift) {
    return { kind: "send-live-force" };
  }

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
   * Fired when Enter is pressed in Safe Mode — lets the shell surface a
   * toast/breadcrumb so operators aren't confused by the silent no-op.
   * Debouncing lives at the callsite so the hook stays pure/idempotent.
   */
  onSafeModeSwallowed?: () => void;
  /**
   * Whether the 1-9 slide-jump shortcuts should fire — usually only when the
   * center mode is "slides"/"playlist" AND an item is selected.
   */
  isSlideJumpEnabled?: () => boolean;
};

/**
 * DOM-based modal detection. Radix primitives (Dialog, Popover, DropdownMenu,
 * Select, ContextMenu) and cmdk render with `data-state="open"` on nodes
 * carrying role="dialog" | "menu" | "listbox". If any such node exists in
 * the DOM, we defer to the modal's own Escape/keydown handling and skip
 * ALL global hotkeys — otherwise pressing Escape inside a picker would kill
 * live output.
 */
function anyOverlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.querySelectorAll(
      '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ).length > 0;
  } catch {
    return false;
  }
}

export function useOperatorHotkeys(handlers: HotkeyHandlers) {
  // Y5: keep the handler bag behind a ref so we don't re-attach the window
  // keydown listener on every parent render. Fresh reads at fire time still
  // see the latest closure values.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // R1: If any Radix/cmdk overlay is open, do nothing — the overlay's
      // own listeners will handle Escape and other keys. Prevents the
      // notorious "Escape kills live while I'm just closing a picker".
      if (anyOverlayOpen()) return;

      const action = decodeShortcut(e);
      if (!action) return;

      const h = handlersRef.current;

      switch (action.kind) {
        case "next":
          e.preventDefault();
          h.onNext();
          return;
        case "prev":
          e.preventDefault();
          h.onPrev();
          return;
        case "send-live": {
          e.preventDefault();
          const safe = h.isSafeMode ? h.isSafeMode() : false;
          if (safe) {
            // Safe Mode ON: don't push to live. Notify shell so it can
            // surface a toast instead of a silent swallow.
            h.onSafeModeSwallowed?.();
            return;
          }
          h.onSendLive();
          return;
        }
        case "send-live-force":
          // Shift+Enter — advanced operator override, bypass Safe Mode.
          e.preventDefault();
          h.onSendLive();
          return;
        case "kill-live":
          e.preventDefault();
          h.onKillLive();
          return;
        case "blank":
          e.preventDefault();
          h.onBlank();
          return;
        case "logo":
          e.preventDefault();
          h.onLogo();
          return;
        case "open-search":
          e.preventDefault();
          h.onOpenSearch();
          return;
        case "bible-mode":
          e.preventDefault();
          h.onSetCenterMode("bible");
          return;
        case "media-mode":
          e.preventDefault();
          h.onSetCenterMode("media");
          return;
        case "songs-mode":
          e.preventDefault();
          h.onSetCenterMode("songs");
          return;
        case "playlist-mode":
          e.preventDefault();
          h.onSetCenterMode("playlist");
          return;
        case "jump-slide": {
          const enabled = h.isSlideJumpEnabled ? h.isSlideJumpEnabled() : true;
          if (!enabled) return;
          e.preventDefault();
          h.onJumpSlide(action.index);
          return;
        }
        case "open-help":
          e.preventDefault();
          h.onOpenShortcutsHelp();
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Y5: empty deps — listener attaches once, reads latest via ref.
  }, []);
}
