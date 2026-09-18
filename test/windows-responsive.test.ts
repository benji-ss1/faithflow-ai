/**
 * Windows responsiveness guards for the UI that shipped 2026-09-17/18
 * (PP7 layers panel, theme-editor chrome, slide-grid menus, centre header).
 * Run: npx tsx --test test/windows-responsive.test.ts
 *
 * Why source assertions: docs/WINDOWS_DESIGN.md §10 names exactly this gap —
 * "the globals.css Windows block [and] Tailwind win variants ... manual only.
 * A CSS snapshot test asserting every data-platform rule stays scoped would be
 * cheap to add." These lock the fixes measured on 2026-09-18 at 911x512
 * (1366x768 @150%), 1093x614 (@125%) and 1280x720, so a later edit cannot
 * silently undo them.
 *
 * Invariant throughout: every Windows-only rule stays behind
 * html[data-platform="win"], so the macOS class list is unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const RIGHT_ICON_BAR = "src/components/operator/pro/right/RightIconBar.tsx";
const EDITOR_MODAL = "src/components/operator/pro/DesktopSlideEditorModal.tsx";
const SLIDE_GRID = "src/components/operator/pro/center/SlideGrid.tsx";
const ZONE_CONTROLS = "src/components/operator/zone/ProjectionZoneControls.tsx";
const CENTER_HEADER = "src/components/operator/pro/center/CenterHeader.tsx";

test("Layers popover is pulled into view and capped on short viewports", () => {
  const src = read(RIGHT_ICON_BAR);
  // The shell renders INLINE at the bottom of the scrolling right aside, so a
  // freshly opened panel landed ~315px below the fold at EVERY viewport
  // (measured: 422..827 in a 512-tall viewport). Without this the operator
  // clicks Layers and sees nothing happen.
  assert.match(src, /shellRef\.current\?\.scrollIntoView\(\{ block: "nearest" \}\)/);
  // 400px cannot fit a 512/614px CSS viewport; step down on short screens.
  assert.match(src, /max-h-\[400px\] \[@media\(max-height:700px\)\]:max-h-\[220px\]/);
});

test("editor status bar: readouts yield, the zoom/Fit cluster never does", () => {
  const src = read(EDITOR_MODAL);
  const bar = src.slice(src.indexOf('className="shrink-0 border-t flex items-center gap-3 px-3 h-8'));
  const statusBar = bar.slice(0, bar.indexOf("</div>\n    </div>") + 20);
  // At 911x512 the canvas column is ~407px. If the readouts are shrink-0 the
  // ml-auto cluster is pushed out and "Fit" is sliced in half.
  assert.ok(
    !/className="shrink-0 text-\[var\(--color-muted-foreground\)\]">\{label\}/.test(statusBar),
    "selection label must not be shrink-0 — it has to truncate so zoom stays on screen",
  );
  assert.match(statusBar, /min-w-0 truncate text-\[var\(--color-muted-foreground\)\]">\{label\}/);
  assert.match(statusBar, /min-w-0 overflow-hidden flex items-center gap-2\.5 font-mono/);
  // The View / zoom / Fit cluster must stay rigid.
  assert.match(statusBar, /className="ml-auto shrink-0 flex items-center gap-1"/);
});

test("slide-grid menus are bounded by the available height, not by luck", () => {
  const src = read(SLIDE_GRID);
  const AVAIL = "var(--radix-context-menu-content-available-height)";
  // Radix collision-FLIPS, it does not scroll: an uncapped menu runs off a
  // 512px-tall screen. Measured pre-fix: the root menu rendered 124..512,
  // flush to the bottom edge with zero margin and no scroll.
  const rootMenu = src.slice(src.indexOf("<ContextMenu.Content"), src.indexOf("<ContextMenu.Content") + 400);
  assert.match(rootMenu, /collisionPadding=\{8\}/);
  assert.ok(rootMenu.includes(AVAIL), "root card menu must cap against the available height");
  assert.match(rootMenu, /overflow-y-auto/);
  // Every ContextMenu.Content / SubContent in the file must be capped.
  const uncapped = src
    .split(/<ContextMenu\.(?:Sub)?Content/)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf(">")))
    .filter((open) => !open.includes(AVAIL) && !open.includes("max-h-"));
  assert.deepEqual(uncapped, [], `uncapped context-menu content: ${JSON.stringify(uncapped)}`);
  // The root cap must sit ABOVE the menu's natural height (~390px) so no
  // scrollbar appears where there is room — keeps macOS rendering unchanged.
  assert.match(rootMenu, /max-h-\[min\(420px,/);
});

test("projection-zone controls size off their container, not the viewport", () => {
  const src = read(ZONE_CONTROLS);
  // This bar lives inside the editor's ~407px canvas column at 911px, so a
  // `md:` (768px VIEWPORT) breakpoint forced two columns into 407px: measured
  // 462px of content in a 407px box, with the R-margin input sitting UNDER
  // the Center button.
  assert.ok(!/\bmd:grid-cols-2\b/.test(src), "viewport breakpoint must not drive a panel-nested grid");
  assert.match(src, /@container/);
  assert.match(src, /grid-cols-1 @\[520px\]:grid-cols-2/);
  // Nothing in these rows may overlap, at any width.
  assert.match(src, /flex items-center gap-2 flex-wrap">\s*<span className="w-14 shrink-0 text-white\/50">Margins/);
  assert.match(src, /flex items-center gap-2 justify-end flex-wrap/);
});

test("centre-header card-size slider hides only on Windows, only when starved", () => {
  const src = read(CENTER_HEADER);
  // At 911px the centre panel is 381px and the header ran 402px, clipping the
  // Grid/List/Text toggle by 21px. The slider is cosmetic; the toggle is not.
  assert.match(src, /\[html\[data-platform=win\]_&\]:@max-\[420px\]:hidden/);
  // …and the existing 150 -> 90px step must survive.
  assert.match(src, /w-\[150px\] \[html\[data-platform=win\]_&\]:@max-\[640px\]:w-\[90px\]/);
});

test("every Windows-only rule stays scoped to html[data-platform=win]", () => {
  // A bare `win:` style variant, or a Tailwind class keyed off the platform
  // without the attribute selector, would change the macOS class list.
  for (const file of [RIGHT_ICON_BAR, EDITOR_MODAL, SLIDE_GRID, ZONE_CONTROLS, CENTER_HEADER]) {
    const src = read(file);
    for (const m of src.matchAll(/data-platform/g)) {
      const around = src.slice(Math.max(0, m.index - 20), m.index + 30);
      assert.ok(
        around.includes('[html[data-platform=win]_&]') || around.includes('html[data-platform="win"]'),
        `${file}: data-platform reference is not the scoped selector: ${around}`,
      );
    }
  }
});
