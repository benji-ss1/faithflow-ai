/**
 * Priority 4 — keyboard shortcut decoder unit tests.
 *
 * Run: npx tsx --env-file=.env.local test/keyboard-shortcuts.test.ts
 *
 * We can't drive a real browser here, so we import the PURE decoder +
 * input-guard predicate from src/hooks/useOperatorHotkeys.ts and verify
 * every mapping in the spec.
 */
import assert from "node:assert";
import {
  decodeShortcut,
  shouldIgnore,
  type ShortcutKeyEvent,
} from "../src/hooks/useOperatorHotkeys";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error("        " + (err instanceof Error ? err.message : String(err)));
    fail++;
  }
}

function ev(partial: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { target: null, ...partial };
}

console.log("keyboard-shortcuts.test.ts\n");

// --- decoder mapping ------------------------------------------------------

check("Space → next", () => {
  assert.deepStrictEqual(decodeShortcut(ev({ code: "Space", key: " " })), { kind: "next" });
});
check("ArrowRight → next", () => {
  assert.deepStrictEqual(decodeShortcut(ev({ code: "ArrowRight", key: "ArrowRight" })), { kind: "next" });
});
check("ArrowLeft → prev", () => {
  assert.deepStrictEqual(decodeShortcut(ev({ code: "ArrowLeft", key: "ArrowLeft" })), { kind: "prev" });
});
check("Enter → send-live", () => {
  assert.deepStrictEqual(decodeShortcut(ev({ code: "Enter", key: "Enter" })), { kind: "send-live" });
});
check("Escape → kill-live", () => {
  assert.deepStrictEqual(decodeShortcut(ev({ code: "Escape", key: "Escape" })), { kind: "kill-live" });
});
check("KeyB (no modifier) → blank", () => {
  assert.deepStrictEqual(decodeShortcut(ev({ code: "KeyB", key: "b" })), { kind: "blank" });
});
check("KeyL (no modifier) → logo", () => {
  assert.deepStrictEqual(decodeShortcut(ev({ code: "KeyL", key: "l" })), { kind: "logo" });
});

check("Cmd+KeyK → open-search", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "KeyK", key: "k", metaKey: true })),
    { kind: "open-search" },
  );
});
check("Ctrl+KeyK → open-search", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "KeyK", key: "k", ctrlKey: true })),
    { kind: "open-search" },
  );
});
check("Cmd+KeyB → bible-mode", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "KeyB", key: "b", metaKey: true })),
    { kind: "bible-mode" },
  );
});
check("Cmd+KeyM → media-mode", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "KeyM", key: "m", metaKey: true })),
    { kind: "media-mode" },
  );
});
check("Cmd+KeyS → songs-mode", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "KeyS", key: "s", metaKey: true })),
    { kind: "songs-mode" },
  );
});
check("Cmd+KeyP → playlist-mode", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "KeyP", key: "p", metaKey: true })),
    { kind: "playlist-mode" },
  );
});

check("Digit1 → jump-slide index 0", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "Digit1", key: "1" })),
    { kind: "jump-slide", index: 0 },
  );
});
check("Digit9 → jump-slide index 8", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "Digit9", key: "9" })),
    { kind: "jump-slide", index: 8 },
  );
});
check("Digit5 → jump-slide index 4", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "Digit5", key: "5" })),
    { kind: "jump-slide", index: 4 },
  );
});

check("Shift + Slash (=?) → open-help", () => {
  assert.deepStrictEqual(
    decodeShortcut(ev({ code: "Slash", key: "?", shiftKey: true })),
    { kind: "open-help" },
  );
});

// --- input guard ---------------------------------------------------------

check("Key while INPUT focused → null (ignored)", () => {
  const target = { tagName: "INPUT", isContentEditable: false } as unknown as EventTarget;
  assert.strictEqual(decodeShortcut(ev({ code: "Space", key: " ", target })), null);
});
check("Key while TEXTAREA focused → null", () => {
  const target = { tagName: "TEXTAREA", isContentEditable: false } as unknown as EventTarget;
  assert.strictEqual(decodeShortcut(ev({ code: "KeyB", key: "b", target })), null);
});
check("Key while SELECT focused → null", () => {
  const target = { tagName: "SELECT", isContentEditable: false } as unknown as EventTarget;
  assert.strictEqual(decodeShortcut(ev({ code: "Enter", key: "Enter", target })), null);
});
check("Key while contentEditable focused → null", () => {
  const target = { tagName: "DIV", isContentEditable: true } as unknown as EventTarget;
  assert.strictEqual(decodeShortcut(ev({ code: "KeyL", key: "l", target })), null);
});

// --- shouldIgnore predicate ---------------------------------------------

check("shouldIgnore: INPUT → true", () => {
  assert.strictEqual(shouldIgnore({ tagName: "INPUT" } as unknown as EventTarget), true);
});
check("shouldIgnore: TEXTAREA → true", () => {
  assert.strictEqual(shouldIgnore({ tagName: "TEXTAREA" } as unknown as EventTarget), true);
});
check("shouldIgnore: SELECT → true", () => {
  assert.strictEqual(shouldIgnore({ tagName: "SELECT" } as unknown as EventTarget), true);
});
check("shouldIgnore: contentEditable → true", () => {
  assert.strictEqual(
    shouldIgnore({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget),
    true,
  );
});
check("shouldIgnore: BUTTON → false", () => {
  assert.strictEqual(shouldIgnore({ tagName: "BUTTON" } as unknown as EventTarget), false);
});
check("shouldIgnore: null → false", () => {
  assert.strictEqual(shouldIgnore(null), false);
});

// --- misc negative cases -------------------------------------------------

check("Unknown key → null", () => {
  assert.strictEqual(decodeShortcut(ev({ code: "F13", key: "F13" })), null);
});
check("Digit0 → null (only 1-9 are shortcuts)", () => {
  assert.strictEqual(decodeShortcut(ev({ code: "Digit0", key: "0" })), null);
});
check("Cmd + Digit1 → null (numeric shortcuts are bare only)", () => {
  assert.strictEqual(
    decodeShortcut(ev({ code: "Digit1", key: "1", metaKey: true })),
    null,
  );
});
check("Shift+B → null (uppercase 'B' not a bare-letter action)", () => {
  // Bare-letter blank/logo require no modifier at all.
  assert.strictEqual(
    decodeShortcut(ev({ code: "KeyB", key: "B", shiftKey: true })),
    null,
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
