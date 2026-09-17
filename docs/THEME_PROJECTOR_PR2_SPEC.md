# Theme → Projector (PR 2) spec — approved 2026-09-17

PR 1 (live, #48) saves theme layout (lyrics/scripture slides with main/verse/reference boxes), scripture options and a transition. PR 2 makes the projector use them. Renderer-only → Vercel.

## Signed-off decisions
1. Songs already themed (single centred text object) USE the theme's lyrics box. Slides with designed multi-object layouts (or images/shapes/video) keep their own objects.
2. Stage display stays full-screen (opt-out); projector (/live), livestream (non-transparent, non-OBS-band) and NDI use theme boxes.
3. Transition precedence, resolved ONCE per send and sticky while that slide is live: instant (Bible clicks) → AI/voice auto 150ms → operator Off switch → theme transition (only if the resolved theme sets one) → operator global.
4. Saved Scripture Style (per machine) WINS. Theme scripture options apply only when !hasSavedScriptureStyle(churchId) AND the theme explicitly opts in (scripture layout slide present or explicit option keys; ignore import default fontSizeScripturePx 56 alone).

## A. Layout placement (see research: SlideRenderer)
- ThemeAppearance gains optional compact `layout`: { lyrics?: {main?: Frame}, scripture?: {verse?: Frame, reference?: Frame} }, Frame = {x,y,w,h (1920x1080), fontFamily?, fontSize?, fontWeight?, color?, align?, italic?, uppercase?, shadow?}. Built in themeConfigToAppearance only when config.layout was actually saved (ignore seed box `theme_main_text` default geometry 80,340,1760x400 if unchanged); count layout as meaningful.
- broadcast.ts isValidThemeAppearance: strict isValidThemeLayoutWire (pollution, known keys, finite in-range numbers, w/h>=40, font regex, colour, byte cap). Mapper output must always pass (test). sanitizeOutputState nulls bad appearance (existing).
- SlideRenderer: shared framed-box helper; plain-text path (lyrics → layout.lyrics.main; scripture → verse box + reference box with refPx from box × referenceScale; referenceColor still wins; if no reference box keep footer inside verse box) and single-text-object path (decision 1). AutoFitText inside an absolutely positioned % box with projectorFit={false} + disablePagination so it measures the box (never-clip); ensure refit on frame size change. Frame fontSize = maxPx ceiling × fontScale.
- Gated OFF for: lowerThird band, transparentBg/OBS, fitBandFraction band, over-camera verticalAlign modes, designed multi-object slides, and when `ignoreThemeLayout` prop set (stage page + stage next thumbnail).
- NEVER add layout/appearance to slideOutputIdentity/slideDesignSig.

## B. Scripture options (see research: scripture pipeline)
- New pure src/lib/theme-scripture.ts: themeScriptureOptions(cfg) (null unless explicit opt-in), designFromThemeScripture(opts) → ScriptureDesign fullscreen (verse box/size from layout or fontSizeScripturePx; reference show/showTranslation; position above/below/inline).
- scriptureStyle.ts styleScriptureSlide/applyChurchLayout accept optional themeOpts; saved style path byte-identical; theme path tags role verse/reference and keeps `reference` field ALWAYS (hidden reference object when hidden/inline) — anti-replay depends on it.
- SlideRenderer dedupe footer when a role:"reference" object exists or inline.
- slideDesignSig appends `h` ONLY when an object is hidden (existing identities unchanged).
- OperatorConsole resolves scripture theme config by slide (reference present): live item theme if scripture item → contentStyles.scripture → default theme; memo+ref; pass to applyChurchLayout at ALL call sites (~1330, ~1405, ~623, ~1040).
- Verify wire sanitiser keeps object role/hidden.

## C. Transitions (see research: transitions pipeline)
- Move TRANSITION_NAME_TO_EFFECT_ID to src/lib; new src/lib/transition-resolve.ts: normalizeThemeTransition(cfg) (name/effectId → real effect id; Cut → null; clamp 0-5000; transitionDurationMs fallback; whitelisted name; undefined when theme sets none) and resolveSendTransition(...) per decision 3.
- sendSlideToLive: compute once after already-live skip; fastTransitionSlideRef = {slide, transition: resolved} for every send; always include transition (incl null) in `set`; OutputState heartbeat uses sticky marker; stage publisher same.
- Operator Off: read TRANSITION_KEY.off at send time.
- Theme lookup synchronous from refs (item themeId → content-type style by slide kind → default).
- ThemeEditorTab: save a valid transition (name + real effect id) and only when user touched it; data-fix normalizer handles already-saved name-as-effectId.
- Drift test: every TRANSITIONS name whitelisted + mapped.

## Tests
theme-appearance (layout mapping, seed ignored, validator invariant, hostile rejected), projector-output, scripture-live-parity (byte-identical when no theme opts / saved style wins / above/below/inline / hidden keeps reference / translation hidden still parses), scripture-lowerthird, bible-antireplay additions, text-size-freedom (fontScale in frame), output-compositor(-frozen) identity unchanged + no remount, output-scenes, obs-lowerthird (frames ignored), transition-resolve matrix, transition-publish, theme-scripture.
