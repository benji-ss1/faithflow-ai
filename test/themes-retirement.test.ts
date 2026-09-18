// Run: npx tsx test/themes-retirement.test.ts
//
// themes-retirement (2026-09-18) — the legacy Themes screen (ThemesManager,
// hosted in the operator's ThemesModal) was RETIRED, not deleted. These are
// source-level guards for rule 0 (never regress):
//
//  1. every capability on the parity checklist is reachable in a new surface,
//  2. the escape hatch really restores the old screen,
//  3. no entry point dead-ends (a legacy deep-link still lands somewhere),
//  4. the retired file itself is still in the tree.
//
// Parity table: docs/THEMES_MANAGER_RETIREMENT.md
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const pop = read("../src/components/operator/pro/ThemePopover.tsx");
const tab = read("../src/components/operator/pro/ThemeEditorTab.tsx");
const editor = read("../src/components/operator/pro/DesktopSlideEditorModal.tsx");
const topbar = read("../src/components/operator/pro/TopBar.tsx");
const bar = read("../src/components/operator/pro/right/RightIconBar.tsx");
const flag = read("../src/lib/legacy-themes-flag.ts");
const layers = read("../src/components/operator/pro/right/LayersPanel.tsx");
const importDlg = read("../src/components/library/ThemeImportDialog.tsx");
const doc = read("../docs/THEMES_MANAGER_RETIREMENT.md");

/* ── 0. retired, NOT deleted ─────────────────────────────────────────────── */

assert.ok(
  existsSync(new URL("../src/components/library/ThemesManager.tsx", import.meta.url)),
  "ThemesManager.tsx must stay in the tree — it is retired, not deleted (rule 0)",
);
assert.ok(
  existsSync(new URL("../src/components/operator/pro/ThemesModal.tsx", import.meta.url)),
  "ThemesModal.tsx must stay in the tree so the escape hatch is real",
);
assert.ok(
  existsSync(new URL("../src/app/(app)/library/themes/page.tsx", import.meta.url)),
  "the web /library/themes page stays (out of scope — see the doc §4); removing it deletes export/import-file/reorder",
);

/* ── 1. list-level capabilities are reachable in the popover ─────────────── */

const listCapabilities: [string, RegExp][] = [
  // #5 new theme, #8 apply/go-live, #10 set default (apply IS set-default),
  // #11 duplicate, #12 delete, #13 rename, #16 detail, #17 recents, #18 built-ins
  ["New theme", /aria-label="New theme"/],
  ["Apply / go live", /applyThemeLive/],
  ["Duplicate", /label: "Duplicate"/],
  ["Delete", /Delete…/],
  ["Rename", /label: "Rename"/],
  ["Open (detail view)", /label: "Open"/],
  ["Edit… (opens the theme editor)", /label: "Edit…"/],
  ["Recents", /Recents/],
  ["Built-in themes", /data-builtin-themes/],
  // gap #2 closed here
  ["Import from ProPresenter", /aria-label="Import from ProPresenter"/],
  ["Import dialog mounted", /<ThemeImportDialog/],
  // gap #6 closed here
  ["Default look per content type", /data-content-type-defaults/],
  ["…backed by the real content-type store", /saveContentTypeStyles/],
  ["…and disabled without edit_library", /isContentTypeEditDenied/],
];
for (const [what, re] of listCapabilities) {
  assert.ok(re.test(pop), `ThemePopover must cover the legacy capability: ${what}`);
}

// The ProPresenter import must NOT hard-navigate out of the operator console.
assert.ok(/onDone\?: \(\) => void/.test(importDlg), "ThemeImportDialog needs an onDone escape from the /library/themes navigation");
assert.ok(/if \(onDone\) onDone\(\); else window\.location\.href/.test(importDlg), "onDone must replace the hard navigation");
assert.ok(/onDone=\{/.test(pop), "the operator host must pass onDone so import never navigates away mid-service");

// #1 backgrounds — the BackgroundSelector block that sat on top of the legacy
// screen still has a home (the Layers panel).
assert.ok(/<BackgroundSelector/.test(layers), "BackgroundSelector must still be reachable from the Layers panel");

/* ── 2. editor capabilities are reachable in the theme-mode slide editor ─── */

const editorCapabilities: [string, RegExp][] = [
  ["font family", /fontFamily: e\.target\.value/],
  ["font weight", /fontWeight: Number\(e\.target\.value\)/],
  ["text colour", /color: e\.target\.value/],
  ["text size", /<SizeInput/],
  ["alignment", /align: a/],
  ["text shadow", /shadow: true/],
  ["background type", /bgType: t/],
  ["background colour 1", /bgColor: e\.target\.value/],
  ["background colour 2", /bgColor2: e\.target\.value/],
  ["background image", /bgImageUrl: url/],
  ["background video", /bgVideoUrl: url/],
  ["readability dim (legacy bgOpacity)", /dim: Number\(e\.target\.value\) \/ 100/],
  ["background animation", /bgAnimation: m/],
  ["logo image", /logoUrl: url/],
  ["logo position", /logoPosition: p/],
  ["logo size", /logoSizePx: Number/],
  ["auto-colourway from logo", /autoColorway/],
  ["scripture: show reference", /scriptureShowReference/],
  ["scripture: reference position", /scriptureReferencePosition/],
  ["scripture: show translation", /scriptureTranslationVisible/],
  ["transition effect + duration", /setTransition\(/],
  ["set as default on save", /setMakeDefault/],
];
for (const [what, re] of editorCapabilities) {
  assert.ok(re.test(tab), `the theme editor must cover the legacy control: ${what}`);
}
// The editor is genuinely wired to theme mode + can save a theme.
assert.ok(/const themeMode = !!themeTarget/.test(editor), "the slide editor must have a theme mode");
assert.ok(/onSaveTheme/.test(editor), "theme mode must be able to save the theme");
// The pencil/Edit path actually opens it.
assert.ok(/presentflow:open-slide-editor/.test(pop), "the popover must open the theme editor, not the retired screen");

// Legacy bgOpacity themes must keep their look — the mapper reconciles it.
const appearance = read("../src/lib/theme-appearance.ts");
assert.ok(/c\.bgOpacity/.test(appearance), "themeConfigToAppearance must still honour legacy bgOpacity so old themes don't change");

/* ── 3. entry points: retired, and nothing dead-ends ─────────────────────── */

// The Themes button opens the popover regardless of the PP7 layers flag now.
assert.ok(/const useThemePopover = pp7Themes \|\| !legacyThemes/.test(topbar),
  "the top-bar Themes button must open the popover unless the escape hatch is on");
assert.ok(/useThemePopover \? \(\s*<ThemePopover/.test(topbar), "the popover must be mounted on that same condition");

// A legacy `presentflow:open-themes-settings` deep-link (Settings → Open
// themes, and anything else) must forward to the popover, never dead-end.
assert.ok(/readLegacyThemesFlag\(\)\) \{ setThemesModalOpen\(true\); return; \}/.test(bar),
  "the legacy event must open the old modal ONLY behind the escape hatch");
assert.ok(/dispatchEvent\(new CustomEvent\(OPEN_THEME_POPOVER_EVENT\)\)/.test(bar),
  "with the hatch off, the legacy event must forward to the popover");
assert.ok(/OPEN_THEME_POPOVER_EVENT, onOpen/.test(topbar),
  "the top bar must listen for the forwarded event so Settings → Open themes still works");
const settings = read("../src/components/operator/settings/SettingsWindow.tsx");
assert.ok(/presentflow:open-themes-settings/.test(settings),
  "Settings → Themes & Look must still have a working way in (it rides the forwarded event)");

// The popover's "classic screen" sliders icon is hidden unless the hatch is on.
assert.ok(/canEdit && legacyThemes \? <button[\s\S]{0,400}?classic screen/.test(pop),
  "the classic-screen sliders icon must be gated on the escape hatch");

/* ── 4. the escape hatch is real ─────────────────────────────────────────── */

assert.ok(/NEXT_PUBLIC_LEGACY_THEMES === "1"/.test(flag), "env escape hatch must be NEXT_PUBLIC_LEGACY_THEMES=1");
assert.ok(/presentflow\.legacyThemes\.v1/.test(flag), "per-machine escape hatch key must exist");
// Default OFF: no truthy branch without the env var or the localStorage "1".
assert.ok(!/return true;\s*\n\s*\}\s*\n\s*return process\.env/.test(flag.replace(/local === "1"/, "x")),
  "the flag must default OFF");
// With the hatch on, the REAL legacy screen comes back (not a stub).
const modal = read("../src/components/operator/pro/ThemesModal.tsx");
assert.ok(/import \{ ThemesManager \}/.test(modal) && /<ThemesManager/.test(modal),
  "the escape hatch must restore the real ThemesManager, not a placeholder");
assert.ok(/themesModalOpen \? <ThemesModal open/.test(bar),
  "the retired modal must only mount when it has actually been opened via the hatch");

/* ── 5. the checklist itself stays with the code ─────────────────────────── */

for (const section of ["## 1. Parity checklist", "## 2. Parity checklist", "## 3. Entry points", "## 4. Refused"]) {
  assert.ok(doc.includes(section), `the retirement doc must keep section: ${section}`);
}
// The two controls deliberately dropped were no-ops — assert they are still
// no-ops, so nobody "fixes" the doc instead of building the feature.
const themeConfig = read("../src/lib/theme-config.ts");
assert.ok(/churchNameVisible/.test(themeConfig) && /lowerThirdEnabled/.test(themeConfig),
  "the dropped keys must stay in the sanitiser so stored theme configs are preserved");
assert.ok(!/churchNameVisible/.test(tab) && !/lowerThirdEnabled/.test(tab),
  "the no-op church-name / lower-third controls must not be re-added as fake controls");

console.log("themes-retirement: all guards pass");
