/**
 * A theme that carries its OWN background must switch OFF an active Background
 * Template — the mutual-exclusivity invariant (user-approved 2026-08-28).
 *
 * Field report 2026-09-22: "Theme applied to 9 slides" toasted, but the
 * projector background never changed. `applyThemeLive` (Themes tab / Theme
 * popover) gets this right because it dispatches `presentflow:theme-changed`,
 * whose OperatorConsole handler clears the template AND stamps the theme as the
 * newest explicit pick. The PER-SONG apply paths did not, so a template picked
 * earlier kept out-ranking the theme forever.
 *
 * Run: npx tsx test/theme-clears-template.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

console.log("the shared helper:");
check("syncBackgroundForAppliedTheme clears AND stamps, and snapshots for Undo", () => {
  const src = read("../src/lib/theme-apply-client.ts");
  const i = src.indexOf("export async function syncBackgroundForAppliedTheme");
  assert.ok(i >= 0, "helper is gone — the per-song apply paths have nothing to call");
  const body = src.slice(i, i + 1400);
  assert.match(body, /appearanceHasBackground/, "it must no-op for a TEXT-ONLY theme so a template can still be layered under it");
  assert.match(body, /markThemeBackgroundPicked\(\)/, "without the stamp the template wins again after a restart");
  assert.match(body, /setActiveBackgroundId\("none"\)/, "the template is never actually cleared");
  assert.match(body, /snapshotBackgroundState\(\)/, "no snapshot — Undo cannot restore the operator's template");
});
check("a TEXT-ONLY theme leaves the template alone", () => {
  const src = read("../src/lib/theme-apply-client.ts");
  const i = src.indexOf("export async function syncBackgroundForAppliedTheme");
  const body = src.slice(i, i + 1400);
  assert.match(body, /if \(!appearanceHasBackground\(themeConfigToAppearance\(config as never\)\)\) return null;/,
    "the early-return for a text-only theme is gone — applying a font-only theme would now wipe the operator's template");
});

console.log("\nevery per-song apply path calls it:");
check("the slide-grid Theme menu (apply to all slides)", () => {
  const src = read("../src/components/operator/pro/center/SlideGrid.tsx");
  const i = src.indexOf("const applyThemeAll");
  const body = src.slice(i, i + 900);
  assert.match(body, /syncBackgroundForAppliedTheme\(cfg\)/, "applyThemeAll still leaves the template out-ranking the theme");
  assert.match(src, /config\?: unknown/, "the themes list dropped `config`, so the path can't tell whether the theme has a background");
});
check("the Theme inspector's Apply-to-song", () => {
  const src = read("../src/components/operator/shell/RightInspector.tsx");
  assert.match(src, /syncBackgroundForAppliedTheme\(current\.config\)/, "the inspector's per-song apply still leaves the template winning");
});
check("the Themes-tab path still uses the theme-changed event (unchanged)", () => {
  const src = read("../src/lib/theme-apply-client.ts");
  const i = src.indexOf("export async function applyThemeLive");
  assert.match(src.slice(i, i + 1200), /presentflow:theme-changed/,
    "applyThemeLive stopped dispatching theme-changed — that event is what clears the template for the Themes tab");
});
check("the apply-theme-to-song LISTENER is not double-clearing", () => {
  // Historically dispatched BY applyThemeLive (visual-only since 2026-09-23),
  // whose theme-changed event already clears the template.
  // Clearing again there would be redundant and would fight the Undo snapshot.
  const src = read("../src/components/operator/pro/left/PlaylistSection.tsx");
  const i = src.indexOf("const onApplyThemeToSong");
  assert.ok(!/syncBackgroundForAppliedTheme/.test(src.slice(i, i + 1600)),
    "redundant clear added to the listener — it already runs after applyThemeLive cleared the template");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
