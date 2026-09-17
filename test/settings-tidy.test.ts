// Run: npx tsx test/settings-tidy.test.ts
//
// settings-tidy (2026-09-17) — the operator's bottom-right gear popover was
// retired. Its ONLY two sub-tabs were "Automations" (MacrosTab) and "Bible"
// (BibleLicensingTab = CCLI number + API.Bible key + licensed translations).
// Both now live in the main Settings window opened from the TOP-RIGHT gear.
//
// Rule 0 (never regress): these are source-level guards so nobody can delete
// the gear WITHOUT the destination existing, or quietly re-add a second,
// competing settings entry point in the icon row.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const bar = read("../src/components/operator/pro/right/RightIconBar.tsx");
const win = read("../src/components/operator/settings/SettingsWindow.tsx");
const shell = read("../src/components/operator/pro/ProOperatorShell.tsx");

/* ── 1. the bottom-right gear is gone ────────────────────────────────────── */

assert.ok(!/Icon=\{SettingsIcon\}/.test(bar), "RightIconBar must not render a Settings gear trigger");
assert.ok(!/SettingsIcon/.test(bar), "the Settings lucide icon import must be gone from the icon row");
assert.ok(!/openKey === "settings"/.test(bar), "the Settings popover body must be gone");
assert.ok(!/function SettingsPopoverBody/.test(bar), "SettingsPopoverBody must be deleted, not orphaned");
assert.ok(!/"settings"\s*\|/.test(bar.split("type PopoverKey")[1]?.split(";")[0] ?? ""),
  '"settings" must be removed from the PopoverKey union');

// The panel bodies must no longer be imported here — they moved.
assert.ok(!/BibleLicensingTab/.test(bar), "BibleLicensingTab must no longer be imported by the icon row");
assert.ok(!/MacrosTab/.test(bar), "MacrosTab must no longer be imported by the icon row");

/* ── 2. nothing else in the icon row broke ───────────────────────────────── */

for (const k of ["bible", "songs", "xrefs", "layers", "timers", "messages"]) {
  assert.ok(new RegExp(`k="${k}"`).test(bar), `icon-row trigger "${k}" must still exist`);
  assert.ok(new RegExp(`openKey === "${k}"`).test(bar), `icon-row popover "${k}" must still render`);
}
// Badges + the multi-channel strip are untouched.
assert.ok(/<ChannelStrip/.test(bar), "ChannelStrip must still render above the icon row");
assert.ok(/badge=\{bibleCount\}/.test(bar) && /badge=\{songCount\}/.test(bar) && /badge=\{xrefCount\}/.test(bar),
  "detection badges must still be wired");
assert.ok(/<ThemesModal/.test(bar), "the Themes modal must still be mounted here");

// A legacy ?panel=settings / presentflow:open-panel deep-link must not dead-end:
// it now opens the real Settings window.
assert.ok(/name === "settings".*OPEN_SETTINGS_EVENT/s.test(bar),
  "a legacy panel=settings deep-link must forward to the main Settings window");
// A stale persisted sidebarTab of "settings" must not try to restore.
const restore = bar.split("loadSessionState()?.sidebarTab")[1]?.slice(0, 400) ?? "";
assert.ok(!/saved === "settings"/.test(restore), 'a stale saved "settings" tab must not restore');

/* ── 3. everything that moved is reachable from Settings ─────────────────── */

// Automations — IS wired and working (macros table + list/create/update/delete
// server actions + SlideGrid "Run automation"), so it moved AS-IS. If it were
// ever stubbed out this guard fails loudly rather than shipping a dead tab.
assert.ok(/id: "automations"/.test(win), "Settings must have an Automations section");
assert.ok(/case "automations": return <AutomationsSection/.test(win), "Automations section must render");
assert.ok(/<MacrosTab ctx=\{ctx\} \/>/.test(win), "Automations must render the real MacrosTab, not a placeholder");
const autoBody = win.split("function AutomationsSection")[1]?.split("\nfunction ")[0] ?? "";
assert.ok(autoBody.length > 0, "AutomationsSection must exist");
assert.ok(!/coming soon|disabled/i.test(autoBody),
  "Automations is wired — it must NOT be labelled coming soon or disabled");

// Test-run needs the live operator ctx; the shell must pass it through.
assert.ok(/<SettingsWindow ctx=\{ctx\} \/>/.test(shell),
  "ProOperatorShell must pass ctx to SettingsWindow so automation test-run still fires live");

// Bible / CCLI.
assert.ok(/<BibleLicensingTab \/>/.test(win), "Settings › Bible must render the CCLI + API.Bible panel");
assert.ok(/section: "automations"/.test(win), "Automations must be searchable in the settings search box");
assert.ok(/section: "bible", label: "CCLI number"/.test(win), "CCLI must be searchable in the settings search box");
assert.ok(/section: "bible", label: "API.Bible key"/.test(win), "API.Bible key must be searchable");

/* ── 4. Windows: no Mac-only glyphs in the moved UI ──────────────────────── */

// ⌘ may only reach the UI via useShortcutLabel/modKeyLabel, never typed into
// visible text (WINDOWS_DESIGN.md §5). Comments are exempt — they aren't UI.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const [name, src] of [["SettingsWindow", win], ["RightIconBar", bar]] as const) {
  assert.ok(!/[⌘⇧⌥]/.test(stripComments(src)), `${name} must not hardcode a Mac-only shortcut glyph`);
}

console.log("settings-tidy: all guards pass");
