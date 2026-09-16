/**
 * Windows-polish platform helpers. Run: npx tsx --test test/platform.test.ts
 * Invariant: macOS output is unchanged (no data-platform attr, ⌘ label).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWindowsUA, modKeyLabel, PLATFORM_ATTR_SCRIPT } from "../src/lib/platform";

const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PresentFlow/0.1 Chrome/138 Electron/43 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) PresentFlow/0.1 Chrome/138 Electron/43 Safari/537.36";

test("isWindowsUA: Windows yes, Mac no", () => {
  assert.equal(isWindowsUA(WIN), true);
  assert.equal(isWindowsUA(MAC), false);
});

test("modKeyLabel: ⌘ on Mac (unchanged), Ctrl on Windows", () => {
  assert.equal(modKeyLabel(MAC), "⌘");
  assert.equal(modKeyLabel(WIN), "Ctrl ");
});

test("PLATFORM_ATTR_SCRIPT stamps data-platform only on Windows", () => {
  for (const [ua, want] of [[WIN, "win"], [MAC, null]] as const) {
    const attrs: Record<string, string> = {};
    const doc = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } };
    new Function("navigator", "document", PLATFORM_ATTR_SCRIPT)({ userAgent: ua }, doc);
    assert.equal(attrs["data-platform"] ?? null, want);
  }
});
