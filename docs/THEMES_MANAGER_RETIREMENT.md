# Retiring the legacy Themes screen (`ThemesManager.tsx`) — parity checklist

_2026-09-18. Branch `feat/retire-themes-manager`. Planned in `faithflow-themes/docs/PP7_REBUILD_PLAN.md` §3 phase 5: "…then retire ThemesManager **after a parity checklist**." This is that checklist._

Rule 0 (NEVER REGRESS) governs this work: **nothing is deleted**. `src/components/library/ThemesManager.tsx` stays in the tree and comes back whole behind an escape hatch. Every capability below is either proven to exist in a new surface, closed in this PR, or explicitly reported as not carried over with the reason.

## 0. Scope — what is being retired

`ThemesManager` has **two** hosts:

| Host | File | In scope? |
|---|---|---|
| Operator console "Themes" modal (`operatorMode`) | `src/components/operator/pro/ThemesModal.tsx:97` | **YES — retired here** |
| Web admin page `/library/themes` | `src/app/(app)/library/themes/page.tsx:35` | **NO — out of scope, see §4** |

The new surfaces are all operator-console surfaces (a Radix popover anchored to a toolbar button, and the desktop slide editor in theme mode). There is no web-page equivalent of them, so the web admin screen keeps the legacy component. Retiring *that* is its own project (§4).

## 1. Parity checklist — list / shell capabilities

Legend: ✅ covered · 🆕 gap closed in this PR · ⬜ web-only, never present in the operator host (so not lost by this retirement) · ❌ not carried over (reason given)

| # | Capability | ThemesManager | Where it lives now |
|---|---|---|---|
| 1 | Backgrounds picker (`BackgroundSelector`) at the top of the Themes area | `ThemesManager.tsx:251-253` | ✅ `right/LayersPanel.tsx:105` and `right/Pp7LayersPanel.tsx:209` (the Layers panel, which is the PP7 home for backgrounds) |
| 2 | Import a ProPresenter theme (`ThemeImportDialog`) | `ThemesManager.tsx:277-287, 301` | 🆕 `ThemePopover.tsx` header → "Import from ProPresenter". (The only other mount, `right/tabs/ThemesTab.tsx:67`, is an **unreferenced** component — nothing renders it.) |
| 3 | Import a `.pftheme.json` file (`importTheme`) | `ThemesManager.tsx:222-243, 262-276` | ⬜ web-only — the button is inside `{!operatorMode && …}`, so the operator modal never had it. Still on `/library/themes`. |
| 4 | Export a theme as `.pftheme.json` (`exportTheme`) | `ThemesManager.tsx:113-132, 1030-1038` | ⬜ web-only — only `SortableThemeCard` (web grid) renders the Download button; `OperatorThemeCard` never did. Still on `/library/themes`. |
| 5 | New theme | `ThemesManager.tsx:92-95, 288-298` | ✅ `ThemePopover.tsx:345` (+ icon) → `NewThemeDialog` `ThemePopover.tsx:389-460`, with a "start from" picker the legacy screen did not have |
| 6 | **Default theme per content type** (Songs / Bible verses) | `ThemesManager.tsx:303, 1057-1102` (`ContentTypeStyleBar`, **operator-only**) | 🆕 `ThemePopover.tsx` — "Default look per content type" row under the grid. This was the one genuinely operator-only capability of the legacy screen. |
| 7 | Empty state + "Create your first theme" | `ThemesManager.tsx:305-321` | ✅ `ThemePopover.tsx:354-355` ("No themes yet" + New Theme button) |
| 8 | Click a theme card → make it live | `ThemesManager.tsx:1130-1143` (`onGoLive` → `setDefaultTheme`) | ✅ `ThemePopover.tsx:236-246` → `apply()` `ThemePopover.tsx:158-171` → `applyThemeLive` (`src/lib/theme-apply-client.ts:33`), which also restyles the current song and records Recents |
| 9 | "Live"/"Default" badge on the active theme | `ThemesManager.tsx:1125-1129` | ✅ blue in-use dot `ThemePopover.tsx:272` |
| 10 | Set as default (star) | `ThemesManager.tsx:165-176, 1010-1020` | ✅ same as #8 — apply *is* set-default (`POST /api/themes/[id]/apply`) |
| 11 | Duplicate | `ThemesManager.tsx:97-108, 1154-1162` | ✅ `ThemePopover.tsx:194-215` (right-click → Duplicate); also handles built-ins |
| 12 | Delete (with in-app confirm) | `ThemesManager.tsx:134-142, 1163-1171` | ✅ `ThemePopover.tsx:217-226` (right-click → Delete…, `useConfirm`) |
| 13 | Rename | `ThemesManager.tsx:662-669` (inside the editor) | ✅ `ThemePopover.tsx:173-185, 257-269` (right-click → Rename, inline edit) — better than the legacy screen |
| 14 | Live theme thumbnail | `SlidePreview` `ThemesManager.tsx:381-590` (a hand-written approximation) | ✅ `ThemeThumb` `ThemePopover.tsx:102-110` — renders with the **real** `SlideRenderer`, so the thumbnail matches the projector |
| 15 | Drag-to-reorder themes (`reorderThemes`) | `ThemesManager.tsx:148-163, 340-358` | ⬜ web-only — `operatorMode` renders the non-sortable grid (`ThemesManager.tsx:322-338`), explicitly "No drag-reorder (click is reserved for go-live)". Still on `/library/themes`. |
| 16 | Open a theme's detail view | — (not in the legacy screen) | ✅ new in `ThemePopover.tsx:326-338` |
| 17 | Recents row | — (not in the legacy screen) | ✅ new in `ThemePopover.tsx:358-363` |
| 18 | Built-in themes | — (not in the legacy screen) | ✅ new in `ThemePopover.tsx:367-368` |

## 2. Parity checklist — the theme editor

Legacy editor = `ThemeEditor` (`ThemesManager.tsx:598-945`). New editor = the desktop slide editor in **theme mode** (`DesktopSlideEditorModal.tsx:86-87`, opened by `presentflow:open-slide-editor {themeId}` from `ThemePopover.tsx:55-57`), whose drawer tab is `ThemeEditorTab.tsx`.

| Control | Legacy | New |
|---|---|---|
| Theme name / rename | `:662-669` | ✅ `ThemePopover.tsx:257-269` (inline rename) |
| Esc closes the editor only | `:615-626` | ✅ `DesktopSlideEditorModal.tsx:399-407` (in-app unsaved-changes prompt; Electron-safe) |
| Save (create or update) | `:178-218` | ✅ `DesktopSlideEditorModal.tsx:489-492` (`onSaveTheme`) |
| Save also applies live (operator) | `:205-213` | ✅ "Set as default on save" `ThemeEditorTab.tsx:315-325` + `restyleSongs` `DesktopSlideEditorModal.tsx:192-210` |
| Font family | `:683-687` | ✅ `ThemeEditorTab.tsx:178-182` |
| Text colour | `:688-690` | ✅ `ThemeEditorTab.tsx:189-191` |
| Lyrics size (px) | `:692-694` | ✅ `ThemeEditorTab.tsx:205-207` (per text box; flat field derived on save — `src/lib/theme-editor-model.ts`) |
| Scripture size (px) | `:695-697` | ✅ same control on a slide whose role is Scripture (`ThemeEditorTab.tsx:164-166, 205-207`) |
| Font weight | `:700-704` | ✅ `ThemeEditorTab.tsx:184-188` |
| Alignment | `:705-714` | ✅ `ThemeEditorTab.tsx:193-197` |
| Text shadow | `:716-718` | ✅ `ThemeEditorTab.tsx:198-201` |
| Background type (solid/gradient/image/video) | `:722-731` | ✅ `ThemeEditorTab.tsx:211-215` |
| Background colour 1 / 2 | `:732-741` | ✅ `ThemeEditorTab.tsx:216-226` |
| Gradient angle | — (legacy only *read* `bgAngle`, no control) | ✅ new in `ThemeEditorTab.tsx:227-231` |
| Background image picker | `:742-750` | ✅ `ThemeEditorTab.tsx:232-235` |
| Background video picker | `:751-757` | ✅ `ThemeEditorTab.tsx:236-239` |
| Background opacity / readability dim | `:758-760` (`bgOpacity`) | ✅ `ThemeEditorTab.tsx:240-242` (`dim`). Same knob: `theme-appearance.ts:103-110` maps legacy `bgOpacity` → `dim = 1 − bgOpacity`, so old themes keep their look |
| Background motion (none/drift/aurora/pulse) | `:761-773` | ✅ `ThemeEditorTab.tsx:243-249` |
| Church logo image | `:778-785`, `:806-813` | ✅ `ThemeEditorTab.tsx:252-255` |
| Logo 3×3 placement + None | `:789-802` | ✅ `ThemeEditorTab.tsx:256-269` |
| Logo size | `:803-805` | ✅ `ThemeEditorTab.tsx:270-272` |
| Logo opacity | — | ✅ new in `ThemeEditorTab.tsx:273-275` |
| Auto-colourway from logo | `:814-823` | ✅ `ThemeEditorTab.tsx:276-279` (+ writes the readable text colour onto every slide's main box) |
| Scripture: show reference | `:865-867` | ✅ `ThemeEditorTab.tsx:291-294` |
| Scripture: reference position | `:868-877` | ✅ `ThemeEditorTab.tsx:295-299` |
| Scripture: show translation | `:878-880` | ✅ `ThemeEditorTab.tsx:300-303` |
| Transition effect | `:884-890` (3 options) | ✅ `ThemeEditorTab.tsx:307-311` (full `TRANSITIONS` list) |
| Transition duration | `:891-893` | ✅ `ThemeEditorTab.tsx:312-314` |
| Preview: lyrics / scripture / sermon / blank | `:914-932` | ✅ superseded — the new editor edits **real slides** with a per-slide role (`ThemeEditorTab.tsx:160-167`), so each content type is a slide you see on the real canvas, not a mock |
| **Church name on slide** (toggle + top/bottom) | `:824-838` (`churchNameVisible`, `churchNamePosition`) | ❌ **not carried over — the controls were no-ops.** The keys are accepted by the sanitiser (`src/lib/theme-config.ts:71`) but **no renderer reads them** — grep for `churchNameVisible` outside `ThemesManager.tsx` returns only the allow-list. Only the legacy screen's own mock preview drew it (`:507-523`). Carrying it over would re-add a fake control (PP7_REBUILD_PLAN §4 no-fake-controls). Existing theme configs keep the stored keys untouched, so building the real feature later loses nothing. |
| **Lower third** (enabled / style / colour) | `:842-859` (`lowerThirdEnabled`, `lowerThirdStyle`, `lowerThirdColor`) | ❌ **not carried over — same reason.** Sanitised (`theme-config.ts:72`) but read by no renderer; only the mock preview drew it (`:571-587`). The live lower-third that churches actually use is the **Messages** layer / livestream overlay, which is unaffected. Stored keys are preserved. |

## 3. Entry points and what happens to them

| Entry point | Before | After |
|---|---|---|
| Top-bar "Themes" button (`TopBar.tsx:266`) | PP7 flag ON → `ThemePopover`; OFF → legacy modal | Always `ThemePopover` (legacy modal only if the escape hatch is on **and** PP7 layers are off) |
| `presentflow:open-themes-settings` event (`RightIconBar.tsx:150`) | opens `ThemesModal` (legacy) | forwards to `presentflow:open-theme-popover` → the popover. Legacy modal only with the escape hatch on. |
| ThemePopover sliders icon "All themes (classic screen)" (`ThemePopover.tsx:344`) | opens the legacy modal | hidden unless the escape hatch is on |
| Settings → Themes & Look → "Open themes" (`SettingsWindow.tsx:385`) | legacy modal | the popover (it dispatches the same event, which now forwards) — no dead link |
| `/library/themes` (web + desktop sidebar nav) | legacy screen | unchanged — see §4 |

**Escape hatch:** `NEXT_PUBLIC_LEGACY_THEMES=1`, or `localStorage["presentflow.legacyThemes.v1"] = "1"` on one machine. With it on, the top-bar button, the `open-themes-settings` event and the popover's sliders icon all reach the full legacy `ThemesManager` modal exactly as before, including its web-only-looking controls in operator mode. Off by default.

## 4. Refused — the web admin screen is its own project

`/library/themes` still renders `ThemesManager`. Replacing it is **not** a small change and is deliberately not attempted here:

- The new surfaces are operator-shell components. `ThemePopover` is a Radix popover bound to a toolbar anchor (`anchorSelector`), and the new editor is `DesktopSlideEditorModal` — a full operator modal with a slide rail, canvas, drawer and live/preview wiring. Neither drops into a server-rendered admin page.
- Three capabilities live **only** on that page: export `.pftheme.json` (#4), import a `.pftheme.json` file (#3), and drag-to-reorder (#15). Deleting the page deletes them.
- A replacement is a new web Themes screen built on the v3 style model — a phase-5-sized piece of work, not a retirement.

So the web page stays as-is, at zero risk, and gets tracked as follow-up work. This checklist is the input for it.
