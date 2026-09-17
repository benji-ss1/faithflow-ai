# Theme Editor (ProPresenter-style) — PR 1 spec (approved 2026-09-17)

User/Victor: Themes popover pencil must open an exact Edit-Slide-style editor FOR THAT THEME (like ProPresenter's theme editor), never the old ThemesManager screen.

## Signed-off decisions
- Multiple theme slides now (slide rail + "+"); text boxes get a role: main (lyrics/text), verse, reference.
- New editor handles logo, backgrounds (solid/gradient/image/video/animated + angle + dim), auto-colourway from logo, transitions, scripture options.
- Save updates the theme AND re-applies it to every song using it (confirm "Update N songs?").
- Text-box position/size saved now; projector uses layout + scripture + transitions in PR 2.
- Old ThemesManager stays reachable (sliders icon) until parity verified; remove later.

## PR 1 scope
1. Server (src/lib/actions.ts):
   - ThemeConfig + THEME_ALLOWED_KEYS: add `layout`, `bgAngle`, `dim`, `logoOpacity`.
   - sanitizeThemeConfig: dedicated validators — layout = { version:3, slides:[{ id, name, role?: "lyrics"|"scripture", bgColor?, bgImageUrl?, objects }] } max 12 slides; objects filtered via isValidSlideObject (broadcast.ts), capped MAX_SLIDE_OBJECTS, cleanRenderUrl on every url, colour regex; drop only invalid parts; total JSON cap ~256KB; bgAngle 0-360 number; dim/logoOpacity 0-1.
   - Fix logoPosition "middle-center" → "center" mapping (theme-appearance allowed list).
   - Fix applyThemeToSong revert bug: preserve the FIRST themeBackup snapshot (add slides created after first apply); switch inline bake to bakeThemeIntoObjectsJson; store themeId in slideThemeBackups entries.
   - New `countSongsUsingTheme(themeId)` and `reapplyThemeToSongs(themeId, {cursor, limit=25})`: requireCap edit_library; theme re-selected by church; songs filtered by church_id AND (settings->>'appliedThemeId' = id OR slideThemeBackups entry themeId = id); per song in db.transaction with SELECT ... FOR UPDATE; re-bake = reset theme-owned fields (bgType,bgColor,bgColor2,bgImageUrl,transition, text fontFamily/fontSize/fontWeight/color/align) to original snapshot values then bake; slide UPDATEs filtered by song_id of church-checked songs; skip slides with per-slide override of another theme; returns {updated, nextCursor}.
2. Editor (reuse DesktopSlideEditorModal, no song regressions):
   - useSlideEditor: `editable?: boolean` arg (default itemType==="song").
   - Modal: `targetTheme` prop → mode "theme": itemId "theme_"+id, memoised initialSlides from config.layout (seed one "Lyrics" slide with a centred text object from existing flat config if absent), separate onSaveTheme (never song save functions), title "Edit theme — name", hide Save-to-all/song-only warning, Show → preview as {kind:"text"} origin, wording "in this theme".
   - Theme tab (only in theme mode; song tab list byte-identical): Typography defaults (font, weight, colour, align, shadow, lyrics size, scripture size), Background (type, colours, angle, image/video via extracted BgAssetPicker/MediaLibraryPicker, dim, animation), Logo (upload, 3x3 position incl. center, size, opacity, auto-colourway), Scripture (show reference, position above/below/inline, show translation, verse/reference box roles), Transition (effect + duration using TransitionChooser list), set as default.
   - Text object role selector in theme mode (main/verse/reference).
   - Save flow: updateTheme(config incl layout + flat fields derived from slide 1 main text) → countSongsUsingTheme → if N>0 confirm "Update N songs using this theme?" → loop reapplyThemeToSongs → toast → dispatch presentflow:themes-changed + presentflow:theme-changed (if default) → router.refresh.
3. Wiring: ThemePopover pencil + detail pencil + context "Edit…" dispatch `presentflow:open-slide-editor` with `{themeId}`; ProOperatorShell listener fetches /api/themes, sets targetTheme (mutually exclusive with targetSong, resets blank/add). Sliders icon keeps old ThemesManager.
4. Tests: sanitizeThemeConfig layout validation (hostile objects, urls, oversize, proto keys); rebake-from-original helper (removed field doesn't stick, lyric edits kept, idempotent); backup preservation; adversarial source test for church filters in reapplyThemeToSongs; pp7/keyboard/theme tests still pass.
5. What's New note.

## Non-goals (PR 2)
Projector placing text by layout; scripture options + theme transitions applied on output; content-type defaults to DB.
