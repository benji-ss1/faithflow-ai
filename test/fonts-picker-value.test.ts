/**
 * Fonts P1 — every font picker binds its <select value> through
 * selectedFontValue() (2026-09-17, e2e gate finding).
 *
 * Regression: pickerOptionsFor() stopped prepending a stored value the registry
 * can resolve (so a stored stack selects its plain option instead of a
 * redundant "Keep current" row). But the pickers still bound the RAW stored
 * string. A stored CSS stack — "Georgia, serif", which is exactly what
 * themeConfigToAppearance produces and what the ThemesTab swatch dialog stores
 * via fontStack — matches no <option> value, so the browser falls back to
 * showing the FIRST option. The operator saw "Inter" on a Georgia theme, and
 * saving would have overwritten the real stored value.
 *
 * Contract: value={selectedFontValue(stored)} everywhere, and selectedFontValue
 * maps a resolvable stored value onto the option that represents it while
 * leaving anything unknown exactly as stored (never rewrite stored data).
 *
 * Run: npx tsx test/fonts-picker-value.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_PICKER_OPTIONS, pickerOptionsFor, selectedFontValue } from "../src/lib/fonts/registry";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PICKERS = [
  "src/components/library/ThemesManager.tsx",
  "src/components/operator/pro/ThemeEditorTab.tsx",
  "src/components/operator/pro/DesktopSlideEditorModal.tsx",
  "src/components/operator/shell/RightInspector.tsx",
  "src/components/operator/scripture/ScriptureSlideEditor.tsx",
];

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

/** The option a <select> would actually show for a stored value ("" = none). */
const shown = (stored: string) => {
  const v = selectedFontValue(stored);
  const opts = pickerOptionsFor(stored);
  return opts.find((o) => o.value === v)?.value ?? "";
};

check("a stored CSS STACK selects its real font, not the first option", () => {
  // These are real stored shapes: themeConfigToAppearance output and the
  // ThemesTab swatches both store a full stack.
  assert.equal(shown("Georgia, serif"), "Georgia");
  assert.equal(shown("Inter, system-ui, sans-serif"), "Inter");
  assert.equal(shown("Sora, Inter, sans-serif"), "Sora");
  assert.equal(shown('"Times New Roman", serif'), "Times New Roman");
  // The bug: the raw stored stack is NOT an option value, so binding it raw
  // would have shown the first option (Inter) for a Georgia theme.
  assert.ok(!FONT_PICKER_OPTIONS.some((o) => o.value === "Georgia, serif"));
  assert.notEqual(shown("Georgia, serif"), FONT_PICKER_OPTIONS[0].value);
});

check("what themeConfigToAppearance actually stores round-trips to its font", () => {
  for (const family of ["Georgia", "Sora", "Playfair Display", "Helvetica"]) {
    const stored = themeConfigToAppearance({ fontFamily: family })?.fontFamily;
    assert.ok(typeof stored === "string" && stored.length > 0, family);
    assert.equal(shown(stored!), family, `${family} → ${stored}`);
  }
});

check("plain stored values are unchanged", () => {
  for (const o of FONT_PICKER_OPTIONS) assert.equal(selectedFontValue(o.value), o.value);
});

check("an UNKNOWN stored value is preserved verbatim and is selectable", () => {
  // Never rewrite stored data: it stays exactly as saved and gets its own option.
  assert.equal(selectedFontValue("Comic Sans MS"), "Comic Sans MS");
  assert.equal(shown("Comic Sans MS"), "Comic Sans MS");
  assert.equal(pickerOptionsFor("Comic Sans MS")[0].group, "current");
  assert.equal(selectedFontValue(""), "");
  assert.equal(selectedFontValue(null), "");
  assert.equal(selectedFontValue(undefined), "");
});

check("every picker routes its <select value> through selectedFontValue", () => {
  for (const rel of PICKERS) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(/selectedFontValue/.test(src), `${rel} does not import/use selectedFontValue`);
    // Each <select> that renders <FontOptions> must bind a routed value. Catch
    // the raw-binding shapes this bug was made of.
    for (const m of src.match(/<select[^>]*value=\{[^}]*\}/g) ?? []) {
      if (!/fontFamily/.test(m)) continue;
      assert.ok(/selectedFontValue\(/.test(m), `${rel}: font <select> binds a RAW stored value → ${m.slice(0, 110)}`);
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
