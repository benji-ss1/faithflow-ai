# Windows design rules (PresentFlow operator app)

Status: written 2026-09-17 against `origin/main` @ 567b338. Line numbers are for that commit; re-grep before trusting them.
Why this exists: 3-4 of the 5 churches installing this weekend run Windows. The Windows polish work (What's New 0.1.426 `changes/windows-polish.md`, 0.1.427 `changes/windows-polish-2.md`, both 2026-09-16) made the app fit and feel right on Windows. This doc lists every rule so new UI work does not undo it (CLAUDE.md rule 0).

Core principle of the existing work: **every Windows fix is scoped to Windows, so macOS renders byte-identically.** Keep it that way.

---

## 1. How Windows is detected

| Where | What | File:line |
|---|---|---|
| Renderer, pure helper | `isWindowsUA(ua?)` — `/Windows/i` on the user agent. SSR-safe. | `src/lib/platform.ts:5-8` |
| Renderer, CSS hook | `PLATFORM_ATTR_SCRIPT` stamps `<html data-platform="win">` before hydration | `src/lib/platform.ts:20-21`, injected in `src/app/layout.tsx:69-70` |
| Renderer, React hook | `useIsWindows()` — false on first render (SSR parity), true after mount | `src/lib/usePlatformLabel.ts:14-19` |
| Electron main | `process.platform === "win32"` | `electron/main.ts:320` (window), `:569` (AGC), `:280` (tray .ico) |
| Legacy/audio ad-hoc checks | `/windows\|win32\|win64\|wow64/` regex on UA/platform | `src/lib/audio/captureMode.ts:111-114`, `src/lib/desktop-os.ts:29-30`, `src/components/operator/settings/tabs/NdiTab.tsx:65-66`, `src/components/operator/pro/right/tabs/AudioTab.tsx:1066,1094,1243`, `src/components/operator/pro/UpdateBanner.tsx:57`, `src/components/setup/SystemAudioCaptureGuide.tsx:35` |

Rules:
- New renderer code uses `isWindowsUA()` / `useIsWindows()` / `html[data-platform="win"]`. Do not add another regex.
- Never match a bare `win` — `darwin` contains it (see comment at `src/lib/desktop-os.ts:29`).
- Anything that changes what is RENDERED must not differ between SSR and first client render: use the CSS attribute (set pre-hydration) or a post-mount hook, never `isWindowsUA()` inside render.

## 2. CSS rules (all in `src/app/globals.css`, block at 670-697)

| Rule | Why | Line |
|---|---|---|
| `.pf-dotgrid { animation: none }` | endless background-position animation repainted the grid every frame; main source of sluggishness on Windows iGPUs at 125-150% | 685 |
| `[class*="backdrop-blur"]` → no backdrop-filter | blur is expensive on Windows compositors | 686 |
| `hover:-translate-y*` on button/a/[role=button] → `translate: none` | button moving under the pointer made edge clicks miss | 687 |
| `active:scale*` → `scale: none` | same | 688 |
| `aside[data-tour=left/right] { overflow-x: hidden }` | Windows scrollbars take layout width (Mac overlays) → phantom horizontal scrollbar, clipped rows. Scoped to the operator panels only: a bare `aside` clipped the admin Sidebar collapse button | 691-692 |
| right panel 300px below 1240 CSS px, 280px below 960 | 1366x768 @125% ≈ 1093 CSS px wide; slide grid needs room. Mirrors `rightPanelWidthFor()` | 696-697 |

Tailwind arbitrary variants used for Windows-only compaction (all no-ops on Mac):
- `src/components/operator/pro/TopBar.tsx:213,217,220` — search box 248 → 168px (≤1380) → 34px icon (≤1180); label + kbd hidden.
- `src/components/operator/pro/TopBar.tsx:273` (padding), `:508` (output labels hidden ≤1380).
- `src/components/operator/pro/FluidTabs.tsx:85,98` — tab labels hidden ≤1180 (icon-only).
- `src/components/operator/pro/center/CenterHeader.tsx:65` (`@container`), `:87,94,118,136` (Edit/Add/Tidy/Edit image labels hidden under 720px container), `:203` (150 → 90px under 640px container).

Pattern: `[html[data-platform=win]_&]:max-[1180px]:hidden`. Use it; don't change the Mac class.

### Scrollbars
- Global thin themed scrollbars (both platforms): `globals.css:169-173` (`scrollbar-width: thin`, 9px webkit). `.pf-transcript-scroll` 8px: `:473-485`.
- On Windows the scrollbar **takes width**. Anything with `overflow-y-auto` inside a fixed-width box loses ~9px of content width on Windows only. Size contents with `min-w-0`/`truncate`, never to the exact pixel of the container.

### Fonts
- UI stacks: `--font-sans` / `--font-display` at `globals.css:95,99` — webfonts (Plus Jakarta Sans, Sora) loaded via `openFlowFontVars` (`src/lib/openflow/fonts.ts`, applied at `layout.tsx:68`), with `"Segoe UI"` in the fallback chain. Do not introduce UI stacks that fall straight from a Mac font (`-apple-system`, `SF Pro`, `Helvetica Neue`) to generic `sans-serif` without a webfont or Segoe UI.
- Slide/theme fonts: `FONTS` in `DesktopSlideEditorModal.tsx:694` and `FONT_CHOICES` in `ThemeEditorTab.tsx:30` include **Helvetica**, which is not installed on Windows (Windows substitutes Arial; metrics differ slightly). Georgia/Arial/Times New Roman are present on both. The webfonts are bundled. For projected text prefer the bundled webfonts; a theme authored in Helvetica on a Mac will wrap differently on a Windows projector PC (see memory note "Lyrics never clip" — font-cache root cause).

## 3. Layout / DPI / scaling

- Windows laptops commonly run 125% or 150% scaling. CSS viewport = physical / scale: 1920x1080@125% = 1536x864; 1366x768@125% = 1093x614; 1366x768@150% = 911x512 (worst realistic case).
- `rightPanelWidthFor(viewportW, win)` — `src/lib/platform.ts:40-43`. Mac always 360.
- `leftPanelMaxWidth(viewportW, win)` — `src/lib/panelLayout.ts:15-20`: keeps center ≥ `CENTER_MIN_WIDTH_WIN = 480`, never below `LEFT_PANEL_MIN_WIDTH`.
- Resize re-clamp of the left panel on window resize/snap (never persists the clamp): `ProOperatorShell.tsx:1994-2020`, Windows-only.
- FluidTabs indicator re-measure via ResizeObserver when labels collapse: `FluidTabs.tsx:34-50`, Windows-only.

## 4. Window chrome, title bar, menus (Electron)

`electron/main.ts` `createMainWindow()`:
- 315-331: on win32 size against the work area of the display under the cursor (NOT the primary — the projector is often primary), clamp width/height/minWidth/minHeight, `backgroundColor #0C0B0A` (no white flash), `center: true`; maximize on `ready-to-show` if the work area is < 1400x900 (`:365-367`). macOS keeps literal 1400/900/1100/700.
- 363: `setMenuBarVisibility(false)` on Windows. **Not** `autoHideMenuBar` — a stray Alt would focus the menu and steal arrow/G hotkeys mid-service. Accelerators still work.
- No `titleBarOverlay` / frameless window is used: Windows keeps the native title bar and min/max/close. Don't put UI that assumes a traffic-light inset or draggable custom title bar.
- 341-355: universal right-click Cut/Copy/Paste/Select All on editable fields and selections (both platforms).
- 280: tray icon `.ico` on win32.
- 569-571: disable `WebRtcAllowInputVolumeAdjustment` on win32 (Chromium AGC was raising the OS mic slider). Only ONE `disable-features` switch is honoured — join values if another is added.

## 5. Keyboard hint labels (Ctrl vs ⌘)

- `modKeyLabel()` → `"⌘"` Mac / `"Ctrl "` else — `platform.ts:11-14`. Used by `TopBar.tsx:85` (resolved post-mount, `aria-label` at :212) and `SearchPalette.tsx:383`.
- `shortcutLabel({mod,shift,alt,key})` → Mac glyph string byte-identical to the old labels (`⌘⇧Z`), else `Ctrl+Shift+Z`, `↵` → `Enter` — `platform.ts:28-38`.
- `useShortcutLabel(keys)` — post-mount hook, `usePlatformLabel.ts:6-11`. Used by `DesktopSlideEditorModal.tsx:82-83` (undo/redo), `SlideGrid.tsx:177` (Ctrl+Enter save), `SettingsWindow.tsx:791` (Ctrl+,).
- `DesktopSlideEditorModal.tsx:795` — "Shift-click" vs "⇧-click" via `useIsWindows()`.
- Handlers must accept `e.metaKey || e.ctrlKey` (e.g. `DesktopSlideEditorModal.tsx:453`), and Windows redo also accepts Ctrl+Y (`:458`).
- Acceptable dual labels still hardcoded: `ShortcutsHelpOverlay.tsx:27-31` ("⌘/Ctrl + K"), `layout/Topbar.tsx:263`. Remaining Mac-only visible label: `layout/Sidebar.tsx:423` "⌘/ toggles sidebar" (admin, not operator) — see audit.
- Rule: never type a `⌘`, `⇧`, `⌥` glyph into visible UI text. Use `useShortcutLabel`.

## 6. Mouse, touchpad, touch

- Windows convention: **right-click = context menu; Ctrl-click = add to selection; Shift-click = range.** On Mac Ctrl-click is also a context menu (Radix handles `contextmenu`), so `metaKey || ctrlKey` for toggle-select is correct on both.
- Every context-menu-only action needs a visible alternative (button/`…` menu) — Windows precision touchpads often have right-click disabled or mapped to two-finger tap operators don't know.
- Hover-revealed controls must also show on `focus-within` and on `[@media(hover:none)]` (pattern at `ThemePopover.tsx:198`). Note touchscreen Windows laptops with a trackpad report `hover: hover`, so tap users there won't see hover-only controls — keep essentials visible.
- No hover lift / press scale on click targets (enforced by CSS §2 for `button`/`a`/`[role=button]`; a clickable `div` is NOT covered — use a `button`).
- F-keys (Pp7 clear rail F1-F7, `right/Pp7ClearRail.tsx:112-130`): many Windows laptops default F-row to media keys (Fn needed). Always keep the on-screen button; never make an F-key the only path. F5 is left for reload.

## 7. Dialogs

- Electron has no reliable `window.confirm`/`prompt`/`alert`; use in-app dialogs (`DesktopSlideEditorModal.tsx:400`, `:1118-1150`; `useConfirm` in ThemeEditorTab). Never call `window.confirm` in new code.
- Dialog widths: use `w-[Npx] max-w-full` / `max-w-[calc(100vw-24px)]` and `max-h-[75vh]` + inner scroll (patterns at `ThemePopover.tsx:268,361`). A fixed height dialog will not fit at 1366x768@150% (512 CSS px tall).

## 8. NDI / Windows build / audio

Not design, but ship-relevant: `docs/WINDOWS_NDI_UPDATES.md` (update routine), `.github/workflows/release-windows.yml` (CI build incl. NDI + Blackmagic), memory notes `windows-ndi-build.md`, `releases-repo-move.md`, `release-tokens-blackmagic.md`. Windows mic boost default 1 (Mac 1.5): `src/lib/audio/micBoostPolicy.ts:10-20`. Windows native capture gate: `src/lib/audio/captureMode.ts:198`, `electron/ipc/audio.ts:114-117,194`. LAN overlay firewall rule win32-only: `electron/lan/LanOverlayServer.ts:336-340`.

---

## 9. Checklist — every UI change must pass on Windows

1. [ ] No visible `⌘ ⇧ ⌥` glyphs; shortcut hints use `useShortcutLabel` / `modKeyLabel`. Handlers accept `ctrlKey` as well as `metaKey`.
2. [ ] Any Windows-only styling uses `html[data-platform="win"]` or the `[html[data-platform=win]_&]:` variant; the Mac class list is unchanged (diff it).
3. [ ] No platform check inside render that would mismatch SSR (use CSS attr or post-mount hook).
4. [ ] Fits at **1093x614** (1366x768@125%) and **911x512** (@150%) CSS px: nothing pushed off-screen, top-bar settings button reachable, center grid ≥ 480px, dialogs scroll instead of overflowing. (Emulate: DevTools device toolbar with those sizes, or Electron zoom 125/150%.)
5. [ ] Scrollable panels: content still fits when a 9px non-overlay scrollbar takes width; no horizontal scrollbar appears; long names `truncate`.
6. [ ] No new `hover:-translate-y`/`active:scale` on non-button click targets; no new `backdrop-blur` you depend on for legibility; no infinite CSS animations on large layers.
7. [ ] Every right-click menu action is also reachable by a visible button or `…` menu. Ctrl-click is never used to open a menu.
8. [ ] Hover-only controls also appear on focus-within / hover:none, and nothing essential is hover-only.
9. [ ] F-key or modifier-only features have an on-screen equivalent.
10. [ ] Fonts: UI uses the existing stacks; projected text defaults to bundled webfonts; if you add a system font choice, confirm it exists on Windows 10/11.
11. [ ] Long menus/submenus have `max-h-[…vh]`/`max-h-[300px]` + `overflow-y-auto` (Radix does collision-flip, not scroll).
12. [ ] No `window.confirm/prompt/alert`.
13. [ ] Electron main changes: win32 branch reviewed separately (window size, menu bar, `disable-features` single switch).
14. [ ] `npx tsx --test test/platform.test.ts` passes; if you touched panel sizing, add a case there.
15. [ ] Field check on a real Windows PC at the church's actual scaling before a service (hardware can't be claimed tested otherwise).

## 10. Regression tests that guard this

- `test/platform.test.ts` (8 tests, in `test/suites/ci.txt:92`): `isWindowsUA`; `modKeyLabel` ⌘ on Mac / Ctrl on Windows; `PLATFORM_ATTR_SCRIPT` stamps only on Windows; `shortcutLabel` Mac strings byte-identical + Windows words; `rightPanelWidthFor` Mac always 360 / Windows 360-300-280; `leftPanelMaxWidth` Mac = floor(w/2) exactly / Windows keeps center ≥ 480.
- Not covered by tests (manual only): the `globals.css` Windows block, Tailwind win variants in TopBar/FluidTabs/CenterHeader, `electron/main.ts` win32 window options, context-menu alternatives. Gap: a CSS snapshot test asserting every `data-platform` rule stays scoped would be cheap to add.

---

## 11. Audit 2026-09-17 (in-flight branches + rebuild on main)

### feat/theme-gaps-a (`/Users/benjisanusi/faithflow-gapsa`, 31 files, +2461/-234, incl. uncommitted SlideGrid/slide-selection edits)
- 🟢 `SlideGrid.tsx` (diff hunk ~1489): slide multi-select uses `e.metaKey || e.ctrlKey` toggle + `shiftKey` range — correct Windows semantics; right-click still opens the card context menu (stopPropagation kept). Card is a `<button>`, so the Windows no-hover-lift CSS still applies.
- 🟡 Multi-select is discoverable only via modifier-click; the "Selected slides (n)" item appears only after selecting. No hint text; if one is added it must say "Ctrl-click" on Windows (`useIsWindows`), not "cmd".
- 🟡 `SlideGrid.tsx` theme submenu now lists saved themes + 7 built-ins with no `max-h`/`overflow-y-auto` on the parent SubContent — a church with many themes at 150% (512px tall) gets a list that runs off-screen. Add `max-h-[340px] overflow-y-auto` like PlaylistSection does.
- 🟡 `src/lib/builtin-themes.ts` "Minimal" built-in uses `font: "Helvetica"` — not on Windows (Arial substitute, different wrap). Prefer a bundled webfont (Inter) for a built-in that ships to Windows churches.
- 🟢 `PlaylistSection.tsx`: new "Playlist options" `…` DropdownMenu duplicates the context-menu actions (good — right-click not required); submenus have `max-h` + scroll.
- 🟢 `ThemePopover.tsx`: built-in section reuses existing card grid (3 cols inside `w-[440px] max-w-[calc(100vw-24px)] max-h-[75vh]` scroll) — fits; Rename hidden for built-ins, no new hover-only controls.
- 🟢 `ThemeDecorLayer.tsx`/output files: no platform-specific CSS; no backdrop-filter. Decor video on Windows iGPUs is a perf item to field-check, not a layout regression.

### feat/church-styles-b (`/Users/benjisanusi/faithflow-gapsb`, 21 files, +1608/-176)
- 🟢 Almost entirely data/sync (church_preferences store, RealtimeSyncBridge). No layout, font, shortcut or menu changes.
- 🟢 `ThemesManager.tsx`: `title` tooltip on a `disabled` select won't show on hover in Chromium (either platform), but the same message is also rendered inline — fine.
- 🟢 `ThemeEditorTab.tsx`: copy-only changes.

### Already on main from the PP7 rebuild
- 🟡 `DesktopSlideEditorModal.tsx:635,728`: fixed `w-[184px]` left + `w-[320px]` right panels in a full-screen modal. At 911 CSS px (1366x768@150%) the canvas column gets ~407px; at 1093 it gets ~589. Usable but cramped; no Windows compaction. Candidate for a `[html[data-platform=win]_&]:max-[1180px]` narrower inspector — not blocking.
- 🟡 `DesktopSlideEditorModal.tsx:694` and `ThemeEditorTab.tsx:30`: Helvetica in the font list (see §2 Fonts). Mac-authored Helvetica themes re-wrap on Windows projectors.
- 🟡 `right/Pp7ClearRail.tsx:112-130`: F1-F7 clears. On Windows laptops with media-key F-row these need Fn; buttons remain (`:150-172`, titles "Clear All (F1)") so it's not broken — tell installers.
- 🟢 `right/Pp7ClearRail.tsx:170`: the Clear All `X` overhangs `-left-3` inside the right `aside`, which has `overflow-y-auto` (and `overflow-x: hidden` on Windows). It overhangs into the preview, not past the aside's left edge, so it is not clipped — verify visually on Windows with a 300/280px right panel.
- 🟢 `ThemePopover.tsx:198`: hover-reveal button also shows on focus-within and hover:none (touch-laptop caveat §6). `:225` context menu has a visible alternative (card click/double-click + detail view).
- 🟢 `DesktopSlideEditorModal.tsx:82-83,453-458,795`: undo/redo labels, Ctrl handlers, Ctrl+Y redo, Shift-click hint all platform-correct. `:400,1118`: in-app confirm, no `window.confirm`.
- 🟢 `ThemeEditorTab.tsx`: no platform-specific issues found.
- 🟡 `src/components/layout/Sidebar.tsx:423`: "⌘/ toggles sidebar" Mac-only label (admin pages, not operator).
