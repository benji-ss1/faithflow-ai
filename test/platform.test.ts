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

import { shortcutLabel, rightPanelWidthFor } from "../src/lib/platform";
import { leftPanelMaxWidth, CENTER_MIN_WIDTH_WIN } from "../src/lib/panelLayout";

test("shortcutLabel: Mac strings are byte-identical to the old hardcoded labels", () => {
  assert.equal(shortcutLabel({ mod: true, key: "Z" }, MAC), "⌘Z");
  assert.equal(shortcutLabel({ mod: true, shift: true, key: "Z" }, MAC), "⌘⇧Z");
  assert.equal(shortcutLabel({ mod: true, key: "↵" }, MAC), "⌘↵");
  assert.equal(shortcutLabel({ mod: true, key: "," }, MAC), "⌘,");
});

test("shortcutLabel: Windows uses Ctrl/Shift/Enter words", () => {
  assert.equal(shortcutLabel({ mod: true, key: "Z" }, WIN), "Ctrl+Z");
  assert.equal(shortcutLabel({ mod: true, shift: true, key: "Z" }, WIN), "Ctrl+Shift+Z");
  assert.equal(shortcutLabel({ mod: true, key: "↵" }, WIN), "Ctrl+Enter");
  assert.equal(shortcutLabel({ mod: true, key: "," }, WIN), "Ctrl+,");
});

test("rightPanelWidthFor: Mac always 360; Windows compacts only below 1240", () => {
  for (const w of [853, 1093, 1239, 1353, 1400, 1920]) assert.equal(rightPanelWidthFor(w, false), 360);
  assert.equal(rightPanelWidthFor(1400, true), 360);
  assert.equal(rightPanelWidthFor(1240, true), 360);
  assert.equal(rightPanelWidthFor(1239, true), 300);
  assert.equal(rightPanelWidthFor(959, true), 280);
});

test("leftPanelMaxWidth: Mac = floor(w*0.5) exactly (unchanged)", () => {
  for (const w of [1100, 1353, 1400, 1920, 2560]) assert.equal(leftPanelMaxWidth(w, false), Math.floor(w * 0.5));
});

test("leftPanelMaxWidth: Windows keeps the center >= 480 when possible, never below min 250", () => {
  // 1093 (1366x768 @125%): 1093 - 300 - 40 - 480 = 273
  assert.equal(leftPanelMaxWidth(1093, true), 273);
  assert.ok(1093 - leftPanelMaxWidth(1093, true) - 300 - 40 >= CENTER_MIN_WIDTH_WIN);
  assert.equal(leftPanelMaxWidth(853, true), 250); // tiny: floor wins
  assert.equal(leftPanelMaxWidth(1920, true), 960); // big: half wins, same as Mac
});
