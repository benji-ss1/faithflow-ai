# Media Fit Plan: backgrounds and logos never cropped

Status: PLAN ONLY (no app code changed). Base: `origin/main` @ 567b338. Worktree `/Users/benjisanusi/faithflow-mediafit`, branch `feat/media-fit`.
Rule 0 applies: nothing ships until every path in section 8 is verified.

## 0. Problem and signed-off decisions

A square JPD crown logo used as a slide, theme or media background gets cropped top and bottom in slide thumbnails, stage thumbnails, the live preview and on the projector. The cause is `cover` semantics (`background-size: cover`, `center/cover`, `objectFit: "cover"`, or the backgrounds store's `imageFit` being unset or `"fill"`, which both mean cover).

The user signed off on three things:
- (a) Empty space is filled with **black bars**, like ProPresenter "Fit".
- (b) **Fit is the default for everything.** Each item can also be set to Fit, Fill (crops edge to edge, which is today's look) or Stretch.
- (c) Existing saved backgrounds switch to Fit too. **If an item has no fit setting, it uses Fit.**

Good news: media slides (`kind: "image" | "video"`) **already default to contain** (`SlideRenderer.tsx:771` `slide.fit ?? "contain"`). They already have a Fit/Fill/Stretch switch that re-projects (`MediaBrowser.tsx:300`), and `fit` is already part of `slideOutputIdentity`. The crop comes from the **background** paths below.

### Naming trap (must fix in the helper)
There are three different vocabularies today:
| Where | Values | Meaning |
|---|---|---|
| `SlidePayload` image/video `fit`, `SlideObjectWire.fit` | `contain \| cover \| fill` | CSS names (`fill` = stretch) |
| `BackgroundSpec.imageFit` (`broadcast.ts:318`, `BackgroundTypes.ts:37`) | `fill \| fit \| stretch \| tile` | ProPresenter names (`fill` = **cover**) |
| `OutputState.fitMode` (`broadcast.ts:422`) | `contain \| fill \| crop` | whole-output scaler, NOT part of this work |

Operators will only ever see **Fit / Fill / Stretch**. On the wire, each field keeps its existing vocabulary, so validators and old clients stay compatible. The helper converts between them.

## 1. Inventory (origin/main line numbers)

Legend: **CHANGE** = the default becomes fit. **KEEP** = no behaviour change. "Vis" = visible somewhere other than the projector.

### 1a. Output renderers (projector, stage, livestream, NDI, thumbnails all go through these)
| # | File:line | What renders | Current | Proposed | Vis |
|---|---|---|---|---|---|
| 1 | `src/components/live/SlideRenderer.tsx:66-86` `themeBackgroundStyle` | Theme `bgImageUrl` as a CSS background on every themed slide (text, blank, lower third, band fallback `:927`) | `backgroundSize: cover` | CHANGE: size comes from `cssBackgroundSize(appearance.bgImageFit)`. Default `contain` with `backgroundColor:#000` and `no-repeat`. The dim gradient stays full-frame (see §5) | Yes: SlideGrid thumbnails, ThemedSlideCard, DesktopSlideEditorModal `:412` preview, stage, livestream |
| 2 | `SlideRenderer.tsx:393` (lower-third), `:469` (text with objects), `:640` (plain text) | Per-slide design bg `slide.bgImageUrl` | `#000 url() center/cover no-repeat` | CHANGE: `#000 url() center/<contain\|cover\|100% 100%> no-repeat` via helper, reading a new `slide.bgImageFit` | Yes: thumbnails, preview, stage |
| 3 | `SlideRenderer.tsx:766-781` media image | `kind:"image"` slide | `fit ?? "contain"` | KEEP (already Fit). Only route it through the helper so there is one source of truth | Yes |
| 4 | `SlideRenderer.tsx:790-795` third-band image | Image inside the band | same `fit` | KEEP | Yes |
| 5 | `SlideRenderer.tsx:803-817`, `SlideObjectsLayer.tsx:150-160`, `SlideCanvas.tsx:492` | blurFill backdrop copy | `cover` | KEEP. It is a deliberately blurred cover layer that fills the bars | Yes |
| 6 | `SlideRenderer.tsx:976,981` media video | `kind:"video"` | `fit==="cover"?cover:contain` (ignores `fill`) | CHANGE (small bug): honour `fill` (Stretch) through the helper. Default stays contain | Yes |
| 7 | `SlideRenderer.tsx:334` logo slide | `kind:"logo"` | `object-contain` max 60% | KEEP | Yes |
| 8 | `src/backgrounds/components/BackgroundLayer.tsx:38` | Active Background Template image (OutputCompositor `:226`, `:244`) | `imageFit` undefined or `"fill"` means **cover** | CHANGE: undefined means **fit**. `"fill"` stays cover, which is the user's explicit Fill. See §2 for the stored `"fill"` values that were written as defaults | Yes: projector, stage, livestream, NDI |
| 9 | `BackgroundLayer.tsx:63` | Background Template video | hard `cover` | CHANGE: helper using a new `videoFit` (default fit) | Yes |
| 10 | `src/components/live/ThemeLayers.tsx:22` `ThemeVideoBackground` (used by `OutputSlide.tsx:64`) | Theme `bgVideoUrl` | hard `cover` | CHANGE: `appearance.bgVideoFit` via helper. The wrapper is already `bg-black`, so the bars are free | Yes |
| 11 | `src/lib/theme-appearance.ts:201` `themeDecorFromSlide` | Theme LAYOUT slide bg turned into a full-canvas decor image object | `fit:"cover"` | CHANGE to `fit: toObjectFit(slide.bgImageFit)`, default contain. **Conflicts with feat/theme-gaps-a** (theme decor), see §10 | Yes |
| 12 | `SlideObjectsLayer.tsx:134,170`, `SlideCanvas.tsx:504,525` | Image/video OBJECTS | `obj.fit ?? "contain"` | KEEP. See §4 | Yes |
| 13 | `src/components/live/LiveVideoLayer.tsx:71`, `left/VideoInputPanel.tsx:232` | Camera / capture input | default `cover` | **KEEP, flagged.** A camera feed that fills the frame is expected, and the operator already has a fit control. Not a "background/logo" | Yes |
| 14 | `src/app/live/page.tsx:34` | comment only | — | none | — |

Stage (`/stage`), livestream/OBS (`/livestream`) and NDI all render through `OutputSlide`/`OutputCompositor` → `SlideRenderer` + `BackgroundLayer`. They inherit rows 1-11 automatically, and no separate change is needed. OBS overlay uses `transparentBg`, which already skips the bg image (`SlideRenderer.tsx:317,391,776`). That stays unchanged.

### 1b. Operator previews that must match the projector exactly
| # | File:line | What | Current | Proposed |
|---|---|---|---|---|
| 15 | `operator/pro/center/ThemedSlideCard.tsx:64` | Slide card Background Template image | `imageFit` default cover | CHANGE: same helper as row 8 (the parity requirement) |
| 16 | `operator/editor/SlideCanvas.tsx:260` | Editor canvas per-slide `bgImageUrl` | `backgroundSize: cover` | CHANGE: helper (editor must equal output) |
| 17 | `operator/pro/DesktopSlideEditorModal.tsx:415` | Editor theme bg video | `object-cover` | CHANGE: helper |
| 18 | `library/ThemesManager.tsx:465` | Theme preview bg video | `object-cover` | CHANGE: helper. Image bg already goes through `themeBackgroundStyle` |
| 19 | `operator/pro/ThemePopover.tsx:42` | Theme swatch card image | `backgroundSize: cover` | CHANGE to the theme's fit (it previews the look) |
| 20 | `operator/pro/right/tabs/ThemesTab.tsx:28` | Theme swatch card image | cover | CHANGE (same as row 19) |

### 1c. Pure UI tiles and pickers (not a representation of output)
| # | File:line | Proposed |
|---|---|---|
| 21 | `left/MediaBinSection.tsx:609,612`, `MediaBinUploadQueue.tsx:310`, `center/MediaBrowser.tsx:944,948`, `left/PlaylistSection.tsx:597,600`, `shell/LeftColumn.tsx:193`, `library/MediaLibraryPicker.tsx:76,78`, `library/ThemeImportDialog.tsx:340`, `backgrounds/components/BackgroundSelector.tsx:50,52`, `right/LayersPanel.tsx:312` | **KEEP cover.** These are grid tiles for recognising a file, and a tidy crop is standard (ProPresenter bins crop too). Optional follow-up, not in this PR: a small "Fit" badge on a tile whose item is set to Fill or Stretch. `MediaBrowser.tsx:757,767`, `MediaCard.tsx`, `MediaBinMode.tsx` already use contain. |
| 22 | `globals.css:355,370`, `openflow.css`, `ZoneEditor.tsx:197`, checker patterns, `error.tsx`, `not-found.tsx` | Not media. Ignore. |

## 2. Data model (no DB migration)

Every new field is an **optional** key inside JSON that already exists. If the key is missing, the item uses **fit** (decision c).

| Item | Stored where today | New field | Validator to extend |
|---|---|---|---|
| Theme image bg | theme `config` jsonb (`schema.ts:590`) → `ThemeAppearance` | `bgImageFit?: "fit"\|"fill"\|"stretch"` | `isValidThemeAppearance` (`broadcast.ts:~975`); sanitiser `theme-appearance.ts:86` must copy it through |
| Theme video bg | same | `bgVideoFit?` | same |
| Theme layout slide bg (decor) | theme config layout slides | `bgImageFit?` on the layout slide | `themeDecorFromSlide` |
| Per-slide design bg (songs, `songSlides.objectsJson`, presentation slides) | objects json via `slide-objects.ts:136,212` | `bgImageFit?` | `slide-objects.ts` parse/serialise; wire `SlidePayload` text `bgImageFit?` + validator near `broadcast.ts:979/1212/1445`; `projectableTextSlide(..)` (`:1086`) passes it along |
| Background Template (backgrounds store, localStorage per operator) | `PFBackground.imageFit` already exists | add `videoFit?`; **stored `"fill"` rewritten, see below** | `BackgroundTypes.ts:37,68`, `broadcast.ts:753` |
| Media slide / media bin item | `SlidePayload.fit` on the slide or playlist item | none (already exists, default contain) | — |

**Stored `"fill"` on Background Templates.** `mediaAsBackground.ts:80` and `BackgroundUploader.tsx:44` wrote `imageFit:"fill"` as an automatic default, not a user choice, and `BackgroundSelector.tsx:111` shows `"fill"` as the default. Decision (c) says existing items become Fit, but we can't tell apart a stored `"fill"` the operator explicitly picked from one written by default.
- Recommendation: new writes store nothing (which means fit). When the backgrounds store loads, do a one-time **client-side** normalisation: turn `imageFit:"fill"` into `"fit"` and write a marker key `pf.bg.fitMigrated.v1`.
- After that, a Fill the user sets again is kept. The store is local to each operator, so no server write and no church_id surface.
- Rollback: delete the normaliser. The only thing lost is a bar/crop preference.
- Built-in backgrounds are shader or gradient, so they are unaffected.

Wire compatibility: an older renderer (e.g. an un-updated desktop DMG) that receives the new optional keys ignores them and keeps cropping. Nothing breaks. Validators must *accept* the new keys, or a newer operator would get frames rejected by strict validators. Ship the validator/renderer change before, or together with, the UI that writes the keys. Renderer-only → Vercel; the Electron shell loads the renderer remotely, so no DMG is needed (confirm with `docs/AI_HANDOFF.md` at build time).

## 3. Shared helper `src/lib/media-fit.ts`

```ts
export type MediaFit = "fit" | "fill" | "stretch";
export const DEFAULT_MEDIA_FIT: MediaFit = "fit";
export function normalizeMediaFit(v: unknown): MediaFit;            // accepts fit/fill/stretch AND contain/cover + css "fill"? NO — see ctx arg
export function fromObjectFit(v: "contain"|"cover"|"fill"|undefined): MediaFit; // contain→fit, cover→fill, fill→stretch, undefined→fit
export function toObjectFit(f: MediaFit|undefined): "contain"|"cover"|"fill";   // fit→contain, fill→cover, stretch→fill
export function toBackgroundSize(f: MediaFit|undefined): "contain"|"cover"|"100% 100%";
export function bgShorthand(url: string, f?: MediaFit): string;     // `#000 url("…") center/<size> no-repeat`
export function fromBackgroundImageFit(v: "fill"|"fit"|"stretch"|"tile"|undefined): MediaFit; // tile → fit (tile not rendered today)
export const MEDIA_FIT_LABEL: Record<MediaFit,string> = { fit:"Fit", fill:"Fill", stretch:"Stretch" };
```
Rules:
- `normalizeMediaFit` never takes an ambiguous `"fill"`. Each field calls its own `from*` so the naming trap in §0 can't leak.
- Every row marked CHANGE in §1a/§1b calls this helper. Media slides (rows 3, 4, 6) and ThemedSlideCard use it too, so thumbnail and projector come from the same function.
- Pure, no React. Unit-testable.

## 4. Designed image objects (placed and sized in the editor)

Recommendation: **do not change them.**
- `obj.fit` already defaults to `contain`. The box is the operator's explicit geometry.
- `MediaImageEditor.tsx:264` "fill frame" and `mediaFrame.ts:164` blur backdrops set `fit:"cover"` on purpose. Those values are stored and must survive (decision b: per-item Fill is kept).
- The only full-canvas objects that are really "backgrounds" are the ones generated by `themeDecorFromSlide` (row 11). Those get the new default.
- Do NOT add a heuristic like "a 1920x1080 object with cover means background → switch it to contain". That would silently break slides built with the media image editor's "Fill frame" (regression).
- Existing editor objects keep their stored `fit`. The per-object fit control in the editor is already there.

## 5. Layering and letterbox colour

- **Theme image bg (row 1)** order, back to front:
  1. theme `bgColor` if set, otherwise `#000`
  2. the image with `contain`
  3. the dim gradient, which stays full-frame (`background-size` in the shorthand list gives the dim layer `100% 100%` and the image layer `contain`)
  - Result: bars are black unless the theme has a colour. Today an image theme has no visible colour, so the operator sees black, as signed off.
  - Theme decor (`ThemeDecorLayer`, gaps-a) and `AnimatedThemeBg` render as separate siblings above the base. They are not covered, because the bars are paint on the root, not an overlay element.
- **Per-slide bg (row 2)**: `#000` base (already in the shorthand). The per-slide bg already wins over the theme, so no theme colour bleeds through (unchanged).
- **Background Template (row 8/9)**: `BackgroundLayer` sits ABOVE the theme bg.
  - Contain leaves transparent bars, so the theme bg or colour would show through instead of black.
  - Proposal: when the fit is not `fill`, give the BackgroundLayer container `background:#000`. This is signed-off black and avoids a surprising theme peek.
  - Exception: when `mediaOverCamera` (`OutputCompositor.tsx:244`) is used, keep it transparent over the camera. Flag for review.
  - The overlay tint stays full-frame.
- **Transparent / OBS overlay**: unchanged. No bars are ever painted there.

## 6. slideOutputIdentity and the fade-pulse contract

- Theme fields (`bgImageFit`, `bgVideoFit`) and the Background Template `imageFit/videoFit` live in `appearance`/`background`, **not** slide identity. Changing them re-renders in place (a style change on the mounted node) with no `TransitionWrapper` remount, so no pulse. This matches how theme dim changes work today.
- `slide.bgImageFit` (per-slide) must go into `slideDesignSig` (`broadcast.ts:1111`, next to `bgImageUrl`). That way, switching fit on the LIVE slide gets past the already-live skip in `sendSlideToLive` and re-projects, the same way media `fit` already does (`:1164-1169`).
  - It only changes on an operator action, so it is heartbeat-safe.
  - Absent vs `"fit"` must produce the same signature. Normalise before joining, otherwise loading old data could flap identity once.
- Operator changing fit on a live item: send with `{instant:true, carryLiveOrigin:true}`, like `SlideGrid.tsx:246`. Hard cut, no transition.

## 7. UI for choosing fit per item

One reusable `FitMenuItems` radio sub-menu (Radix `ContextMenu.RadioGroup`, same classes as `MediaBinSection.tsx:534-556`), labelled **"Scaling ▸ Fit / Fill / Stretch"**, with a check on the current value:
1. **Media bin tile** (`MediaBinSection.tsx` image/video tiles, ~`:600`). Sets the fit used when the item is sent as a media slide, and when "Use as background" is chosen. Stored on the media slide payload / playlist item (`fit`). Because media assets have no jsonb column, we don't store a fit per asset in the DB. Instead, keep a per-church localStorage map `pf.mediaFit.v1[assetId]` that the bin uses as the default when building the slide. Decided: per-machine for now. DB sync (additive column + church-scoped action + adversarial test) is deferred.
2. **Slide card with a bg image** (`SlideGrid.tsx` context menu near the existing "use image on all slides" `:928`). Sets `bgImageFit` on that slide (and "on all slides" alongside the existing action). It is saved through the existing song `objectsJson` save path, which is already church-scoped.
3. **Theme background picker** (`ThemeEditorTab.tsx` image and video bg controls). A Fit / Fill / Stretch segmented control writes `bgImageFit`/`bgVideoFit`.
4. **Background Template picker**:
   - `BackgroundSelector.tsx:111` already has a segmented control. Relabel it Fit/Fill/Stretch, change its default display to `fit`, and add the same control for video.
   - Also add it to the Background right-click menu on the slide card, if present.
5. **Media slide live** (`MediaBrowser.tsx:300`): already exists. Relabel it to the shared labels if they differ.
6. **Slide editor** (`DesktopSlideEditorModal.tsx:1030`, under "Change background image"): a segmented control.

## 8. Test plan

Unit (new `test/media-fit.test.ts`):
- every mapping in both directions
- undefined → fit
- `tile` → fit
- `bgShorthand` output
- the backgrounds-store "fill"→"fit" normaliser runs exactly once (marker)

Parity / no-regression:
- Render (react-dom/server) SlideRenderer text/lower-third/plain/logo/media image/video, BackgroundLayer, ThemeVideoBackground and ThemedSlideCard against a fixture set on `origin/main` vs the branch. Diff the markup. The **only** allowed differences are `background-size`/`object-fit`/the `#000` backing in the changed rows. Store the fixture in the same style as `test/fixtures/theme-gaps-baseline.json`.
- Explicit `fill` (cover) must produce byte-identical markup to main. This proves the per-item Fill restores the old look.
- `slideOutputIdentity`: absent == `"fit"`. Changing `bgImageFit` changes identity. Changing theme `bgImageFit` does NOT change slide identity. Heartbeat re-post is stable (extend `test/bible-antireplay.test.ts`-style identity tests).
- Validators: `isValidThemeAppearance`, slide text payload and BackgroundSpec accept the new keys and reject garbage (`"bogus"`, objects, prototype pollution).
- `themeDecorFromSlide` defaults to contain. Stored designed objects with `fit:"cover"` stay unchanged.
- Existing suites green: bible-antireplay, theme-decor*, theme-layout-sanitize, band-media, slide-objects, service-mode, `tsc`.

Adversarial scoping: no new server write in this plan. Per-slide fit rides the existing `saveSlideObjects`/`createSongSlide` actions and theme fit rides the existing theme save; add a case to `test/adversarial/` asserting that a cross-church theme/slide save containing `bgImageFit` is still rejected. If the synced per-asset option in §7.1 is chosen, it needs a new adversarial test.

Visual checklist (Vercel preview + desktop app pointed at it, rule 0b):
1. Square JPD crown as the theme bg: black bars left and right in the slide grid, stage thumbnail, live preview, `/live` projector, `/stage`, `/livestream`, NDI.
2. Same logo as a per-slide song bg, then set to Fill: identical to prod today.
3. 16:9 photo bg: looks identical (fit == fill at matching aspect).
4. Portrait flyer media slide with blurFill: unchanged.
5. Background Template image + video, and a video theme bg: bars; Fill restores.
6. Shader backgrounds: unchanged.
7. Camera input: unchanged.
8. OBS overlay keyed over camera: no black bars.
9. Change fit on the LIVE slide: instant, no fade pulse; holding a slide for 60s: no pulse.
10. Editor canvas matches the projector for each mode.
11. Media bin tiles look unchanged.

## 9. Risks

| Sev | Risk | Mitigation |
|---|---|---|
| 🟡 | Photos that used to fill the frame edge to edge now get bars on non-16:9 images. **Expected per sign-off (c)** | Fill is one right-click away. Add a "What's New" note (`changes/*.md`, mandatory) that says how to restore it |
| 🟡 | Background Template stored `"fill"` can't be told apart from a deliberate choice | One-time normaliser (§2). Tell the user their deliberate Fills need to be picked again |
| 🟡 | Video backgrounds (motion loops are usually 16:9) show hairline bars when the aspect is slightly off (e.g. 1920x1088) | Acceptable. Optionally treat aspect within 1% as fill — **don't** without sign-off |
| 🟡 | Animated theme bg (`AnimatedThemeBg`) only applies to solid/gradient | None needed; confirm in checklist |
| 🟡 | `mediaOverCamera` background with a black backing would hide the camera | Keep transparent in that path (§5) |
| 🟢 | Camera input left as cover | Deliberately out of scope (row 13) |
| 🟡 | OBS lower-third / transparent overlay | Already skips bg images. Parity test locks it |
| 🟡 | Old desktop DMG renderer ignores new keys and keeps cropping | Renderer is web-loaded. Verify the Electron build loads the remote renderer |
| 🟡 | Theme decor full-canvas image now contain, and it may sit over a theme colour → bars in the theme colour, not black | That is correct layering (the theme colour is the designer's intent). Call it out in review |
| 🔴 | Merge conflicts with in-flight theme branches (below) could silently drop a fit path | Sequencing in §10 + parity fixture re-run after merge |

## 10. Conflict minimisation with in-flight branches

- **feat/theme-gaps-a** (worktree `/Users/benjisanusi/faithflow-gapsa`) touches `SlideRenderer.tsx` (+48), `OutputSlide.tsx`, `OutputCompositor.tsx`, `SlideObjectsLayer.tsx`, `ThemeDecorLayer.tsx` (new), `ThemePopover.tsx`, `SlideGrid.tsx`, `theme-rebake.ts`, `theme-decor-plan.ts`.
- **feat/church-styles-b** touches `ThemesManager.tsx`, `ThemeEditorTab.tsx`, `OperatorConsole.tsx`, `schema.ts`, `content-type-styles.ts`, `scripture-design.ts`.

Approach:
1. Land **gaps-a first**, then merge `main` into `feat/media-fit` before building (rule 0e).
2. Keep media-fit's edits to the shared files **one-line swaps**: replace a literal `cover`/`center/cover` with a helper call. No restructuring and no moving blocks in `SlideRenderer`, `OutputSlide`, `OutputCompositor`, `SlideGrid`, `ThemePopover`, `ThemesManager`, `ThemeEditorTab`.
3. Put all new logic in new files: `src/lib/media-fit.ts`, `FitMenuItems.tsx`, the backgrounds normaliser.
4. Don't touch `OutputSlide.tsx`, `OutputCompositor.tsx` or `SlideObjectsLayer.tsx` at all (rows 10/8 are fixed inside `ThemeLayers.tsx`/`BackgroundLayer.tsx`). Exception: the `mediaOverCamera` black-backing flag, which is passed as a prop default inside `BackgroundLayer`.
5. `themeDecorFromSlide` (row 11): check whether gaps-a moved it into `theme-decor-plan.ts`. Apply the change wherever it lives after the merge.
6. `ThemeEditorTab` UI (§7.3): schedule it after church-styles-b lands, or keep it as a separate tiny commit.

## 11. Preview == Live parity (scope addition, user 2026-09-17)

User problem: "preview not showing as the same size as it is on the actual live screen: images, backgrounds etc". Requirement (like ProPresenter): every preview surface shows EXACTLY the live output. That means:
- the same aspect ratio as the real output
- the same fit/crop
- the same text size relative to the frame
- the same background, decor and logo placement

### 11a. How /live renders (the reference path)
`src/app/live/page.tsx:583` → `OutputCompositor` (`mode="live"`) → `output-plan.ts:188-194` picks the canvas: **1920x1080, or 1440x1080 when `aspectRatio==="4:3"`**. Then `PresentationCanvas` (`PresentationCanvas.tsx:~60-104`) places that fixed canvas in the middle of the physical screen, scaled uniformly with `transform: scale(min(w/cw, h/ch))`, with the leftover as bars. Inside it, the layers are:
1. `BackgroundLayer`
2. camera
3. `SlideRenderer` with **`projectorFit`**, `fontScale`, `referenceScale`, `referenceColor`, `overVideo` when a template or camera is active, and `zone`
4. the theme logo layer

`projectorFit` switches `AutoFitText` to canvas-height-proportional sizing (`AutoFitText.tsx:135-145`, word-count banded, 3% floor). Without it, text uses the pixel floor (`textMinPx`) and the preview-only pagination. **This is the main source of wrong text size in previews.**

"Real output aspect" in this app is the operator setting `aspectRatio` (`OperatorConsole.tsx:430`: 16:9 / 4:3 / custom), carried in OutputState. `/live` does not read the physical monitor size. A 16:10 or 4:3 projector with the setting on 16:9 gets letterboxed on the projector. So previews must follow the canvas from `output-plan`, never a hard-coded `aspect-video`. `"custom"` currently falls back to 1920 wide; the plan keeps that and says so in the UI.

### 11b. Inventory of preview surfaces (Pro shell = production; legacy shell flagged)
| # | Surface | File:line | Sizing today | Renderer / props | Divergence from /live |
|---|---|---|---|---|---|
| P1 | Slide grid card | `pro/center/SlideGrid.tsx:1461,1477` (`aspect-video`) → `ThemedSlideCard.tsx:25-45` | Tailwind `aspect-video` box, text sized to the DOM box | `SlideRenderer` **without** `projectorFit`, `textMinPx={14}`, pagination ON, no `fontScale`/`referenceScale`/`referenceColor`/`zone`, no `PresentationCanvas`; `CardBackground` copy of BackgroundLayer (image fit logic duplicated, video/shader through SharedShaderCard offscreen 480x270) | Different text sizing (px floor + pagination vs % of height). Always 16:9 even when output is 4:3. Operator fontScale ignored. Zone ignored. Separate background code path (row 15). No camera. No theme logo layer (check). |
| P2 | Grid drag ghost / hover big preview | `SlideGrid.tsx:1157-1161` (`textMinPx=8`), `:1215-1216` | `aspect-video`, `w-[min(42vw,380px)]` | ThemedSlideCard | Same as P1, with yet another `textMinPx` |
| P3 | Songs browser card | `pro/center/SongsBrowser.tsx:781,818,853` | `aspect-video` | ThemedSlideCard, default `textMinPx` | Same as P1 |
| P4 | Bible cards + selected preview | `pro/center/BibleMode.tsx:1069-1070,1145-1154` | `aspect-video` | ThemedSlideCard via `previewLayout()` | Same as P1. Also check `previewLayout` against what `sendSlideToLive` actually sends |
| P5 | Right Live monitor, layers engine ON | `pro/right/LivePreviewPanel.tsx:193,213-237` | `aspect-video` box → `OutputCompositor` (own PresentationCanvas) | Full /live props + `previewFrozen`, `transition={null}` | Nearly the same. Only the outer `aspect-video` box is fixed 16:9, so a 4:3 output shows pillarbox in the monitor. That is correct as a letterbox, but the box should use the output aspect |
| P6 | Right Live monitor, legacy (layers OFF) | `LivePreviewPanel.tsx:238-243` | `PresentationCanvas zone` (**no canvasW/H**, so always 1920x1080) | BackgroundLayer + SlideRenderer `projectorFit` + scales | Ignores 4:3 (canvas always 1920). No theme logo layer / camera compared with the compositor. Layers now default-on per memory; confirm prod flag before deleting anything (rule 0) |
| P7 | Transition demo overlay | `LivePreviewPanel.tsx:276-279` | PresentationCanvas | SlideRenderer only | Missing background template. Acceptable (demo), note only |
| P8 | MultiView tiles (Main/Stage/Stream/NDI) | `pro/right/MultiView.tsx:101,120,135-148` | Fixed 1920x1080 inner, `scale(clientWidth/1920)`, box `aspectRatio:"16 / 9"` | `OutputCompositor {...view.props}` via `resolveScreenView`; stage "next" via PresentationCanvas + SlideRenderer `projectorFit ignoreThemeLayout` (same as `stage/page.tsx:436`) | Very close (already the target technique). Wrong on 4:3: fixed 1920 width and 16/9 box. Stage "next" matches the stage page |
| P9 | Stage strip thumbnails (Stage screen next/current) | `src/app/stage/page.tsx:395,436` (the page itself) | PresentationCanvas | as above | It IS the output. Operator-side stage thumbs = P8 |
| P10 | OBS overlay card | `operator/screens/ObsOverlayCard.tsx:208` | 1920 scaled | OutputCompositor | Matches (MultiView copied it) |
| P11 | Theme swatch cards | `pro/ThemePopover.tsx:79-80`, `right/tabs/ThemesTab.tsx:28,121,187`, `library/ThemesManager.tsx:465` | `aspect-video`, CSS bg `cover` (not via `themeBackgroundStyle`) | SlideRenderer `THUMB_SLIDE`, `textMinPx 4/6`, `disablePagination` | Sample text is a representation, not live content. Background fit must match (rows 19/20). Text size: switch to projectorFit-in-canvas so proportions match. Low priority |
| P12 | Editor canvas | `operator/editor/SlideCanvas.tsx:260,492-525`; modal `pro/DesktopSlideEditorModal.tsx:412-415,551` | Own 1920x1080 object geometry, CSS bg `cover`, theme video `object-cover` | Own renderer (not SlideRenderer) | Parallel implementation: bg fit (rows 16/17). Text boxes are edited objects, so the object geometry already matches `SlideObjectsLayer`. Theme decor (gaps-a) and Background Template are not shown behind (check after gaps-a lands). Always 16:9 |
| P13 | Media image editor frame | `pro/center/MediaImageEditor.tsx:635` | `aspectRatio 16/9` | own | 16:9 only |
| P14 | Scripture lower-third editor preview | `operator/scripture/ScriptureSlideEditor.tsx:204-220` | PresentationCanvas | SlideRenderer `projectorFit` | Matches, except no background template |
| P15 | Playlist item thumbs | `pro/left/PlaylistSection.tsx:597,600` | 40x24 `object-cover` media tiles | raw img/video | Icon-size, file identity only. KEEP (like §1c) |
| P16 | AI chat plan / slide previews | `openflow/messages/SlidePreview.tsx:22`, `ServicePlanCard.tsx` | ThemedSlideCard | as P1 | Same as P1 (fixed automatically) |
| P17 | Legacy shell (non-Pro): `LiveOutputThumb.tsx:52-64` fixed 200x112 px; `OutputStack.tsx:159-225`; `RightInspector.tsx:56`; `CenterWorkspace.tsx:215`; `BottomTray.tsx:127`, `WorkspaceTabs.tsx:120,150`, `BottomDrawer.tsx:138`, `workspace/SermonDeckMode.tsx:59,106` | mixed: fixed px / `projectorFit` without canvas / bare SlideRenderer with no appearance | various | Legacy `OperatorShell` (`OperatorConsole.tsx:54`). **Out of scope, do not touch** unless someone confirms it is still reachable in prod. List only |

### 11c. Design: one preview primitive
New `src/components/live/OutputPreview.tsx` (new file → no merge conflict):
```tsx
<OutputPreview slide appearance background? videoInput? zone? fontScale? referenceScale? referenceColor?
               aspectRatio  // from ctx (OutputState), never assumed
               frozen       // thumbnails: no autoplay video, no transitions, first frame
               screen="main" />
```
- It computes `{w,h}` with the **same exported function** `output-plan.ts` uses (extract `canvasFor(mode, aspectRatio)`; pure, test-locked).
- The outer box uses `style={{aspectRatio: `${w} / ${h}`}}` in place of `aspect-video`.
- Inside, it renders the live stack at full output resolution: `OutputCompositor mode="live"` with `transition={null}` and `previewFrozen`, which already exists for P5. The compositor's `PresentationCanvas` does the uniform `scale()`.
- The result is the **same DOM as /live** apart from the scale transform and the frozen media flags. Text sizing (`projectorFit` measures inside the 1920/1440 canvas, not the tiny DOM box), bg fit, decor, logo and zone then match automatically.

Migration of surfaces:
1. **P1-P4, P16: `ThemedSlideCard`.** Change internally to render `OutputPreview` (all call sites unchanged → minimal conflict with gaps-a's SlideGrid edits).
   - `textMinPx` / pagination props become ignored for parity. **Regression watch:** 2026-07-25 raised grid text to 14px because lyrics were "unreadable" at glance size. True parity makes text exactly as big as on the projector, scaled. Mitigation: ship behind a per-church `pf.previewParity.v1` default ON with an operator toggle "Exact output preview" and legacy fallback, and show the user a side-by-side before flipping. **Needs user confirmation**, because it reverses a signed-off readability decision.
   - `CardBackground`/`SharedShaderCard` (the offscreen shader cache for 100s of cards) must be KEPT for performance. `OutputPreview` gets a `backgroundRenderer="shared"` slot so cards still use the shared shader, while image backgrounds go through `BackgroundLayer`'s helper-driven fit.
2. **P5/P6: outer box** `aspect-video` → output aspect. Pass `canvasW/H` to the legacy `PresentationCanvas`.
3. **P8 MultiView:** `scale = min(clientWidth/w, clientHeight/h)` with `w` from `canvasFor`, box `aspectRatio` from state. Otherwise unchanged.
4. **P11 theme swatches:** background via `themeBackgroundStyle` (helper fit). Text stays representative, not changed in this PR.
5. **P12 editor:** background fit via helper. Canvas aspect follows `canvasFor`. Showing theme decor/template behind the editor waits until gaps-a lands (separate PR).
6. **Performance guard:** the grid can show 100+ cards. Full-resolution DOM scaled down costs about the same as today (it's one DOM either way; `transform` is compositor-only). But `AutoFitText` binary search runs per card at 1920 size, which is fine because measurement is layout-only. Video must be frozen (poster / `preload="metadata"`). The existing BibleMode windowing stays. Measure the SlideGrid 150-slide song on a low-end Windows laptop before and after (rule 0 perf regression gate).

### 11d. Windows (most of the Fri-Mon churches run Windows)
Existing work to respect:
- `src/lib/platform.ts` (`isWindowsUA`, `PLATFORM_ATTR_SCRIPT`)
- `globals.css:671-697` `html[data-platform="win"]` overrides: backdrop-blur off, hover translate off, right aside `overflow-x:hidden` + narrower widths at <1240/<960px

Everything below is additive and must not change macOS output.

| Sev | Windows factor | Effect on parity | Plan |
|---|---|---|---|
| 🔴 | DPI scaling 125/150% (`devicePixelRatio` 1.25/1.5) | CSS px change on the operator laptop, while the projector is on a different monitor with its own DPI. A fixed-px surface (e.g. `LiveOutputThumb` 200x112, `textMinPx` px floors) then shows different proportions than the output. Fractional `scale()` can blur 1px lines/text. | Parity path uses only canvas-relative sizing (no px floors), so DPI cancels out. Round `scale` to 4 decimals (PresentationCanvas already ignores changes <0.0001). Test at 100/125/150% |
| 🟡 | Classic (non-overlay) scrollbars take about 17px | A `aspect-video` card inside a scroll container changes width when the scrollbar appears, so ResizeObserver rescales and text re-fits (flicker). Right panel width math (`globals.css:691-697`) | `scrollbar-gutter: stable` on the grid scroller, scoped to `html[data-platform=win]`. ResizeObserver-based scale (already in use) keeps previews proportional anyway |
| 🟡 | Font availability / rendering (Segoe vs SF, ClearType, missing Google/church fonts) | Different glyph widths → different AutoFitText wrap/size. **Operator machine and projector machine are usually the same PC** (second display), so they agree with each other. The risk is only operator-vs-remote-output (NDI/stage on another machine) | Ensure theme fonts load through the existing font cache (see memory "Lyrics never clip" PR #29 font-cache root cause) before the first fit. Parity tests use a fixed test font |
| 🟡 | Electron `webPreferences.zoomFactor` / Ctrl+/- zoom on Windows | Operator UI zoom changes box px but not canvas → fine with scale path; px-floor paths diverge | Covered by the parity path |
| 🟢 | GPU `transform: scale` with blurred text on some Intel iGPUs | Thumbnails slightly soft | Cosmetic. Accept. Already true for MultiView |
| 🟡 | Projector on a 1366x768 / 1280x800 / 4:3 display (common in church PCs) | Physical aspect differs from the 16:9 setting → /live letterboxes; previews must show the same bars only if we preview the *physical* screen | Phase 1: preview the canvas (what the design is). Phase 2 (optional): Electron reports the output display bounds (`screen.getAllDisplays()` in `electron/main.ts`) into OutputState as `outputPx`, so previews can draw the physical bars. Needs a DMG → separate PR |

### 11e. Parity tests
- `test/output-canvas.test.ts`: `canvasFor` returns 16:9 → 1920x1080, 4:3 → 1440x1080, custom → 1920x1080, ndi → 1920x1080; `output-plan` uses it (drift guard).
- `test/preview-parity.test.tsx` (react-dom/server + jsdom): for a fixture matrix, render `/live`'s `OutputCompositor` tree and `OutputPreview`/`ThemedSlideCard`, strip the `transform: scale(...)` value and the `previewFrozen` media attributes (`autoplay`, `preload`, `poster`), and assert the markup is **equal**.
  - Slide kinds: text, lyric paged, scripture with reference, lower-third, image fit/fill/stretch, video, logo, blank.
  - Appearances: none, theme image bg, theme video bg, decor.
  - Background: none, image template, shader.
  - Aspect: 16:9 and 4:3.
  - Plus zone and fontScale 1.3.
  - AutoFitText measurement cannot run in jsdom. Assert the props passed to AutoFitText (`projectorFit`, `fontScale`, canvas size) are equal, and cover real sizing in the Playwright check.
- Playwright visual (preview deploy, Windows runner or Windows VM, DPI 100/125/150):
  - Screenshot `/live` at 1920x1080 and the operator grid card / right monitor.
  - Downscale the live shot to the card size and require perceptual diff ≤ 2% (SSIM) per fixture.
  - Repeat with aspect 4:3.
  - `windows-latest` is already used for the NDI build (memory: Windows NDI build), so reuse that CI runner.
- Existing suites stay green (bible-antireplay identity, theme-decor*, band-media, lyrics-never-clip font tests).

### 11f. Extra risks from 11
| Sev | Risk | Mitigation |
|---|---|---|
| 🔴 | Grid text gets smaller (true parity) → reverses the 2026-07-25 readability pull-back | Toggle + user confirmation before default ON (11c.1) |
| 🟡 | Perf: 150-card grid re-fit on panel resize | Measure on Windows low-end, keep shared shader cache, freeze videos |
| 🟡 | Layers engine OFF path (P6) diverges from ON | Both get canvas dims; parity test runs both flags |
| 🟡 | Conflicts: gaps-a edits SlideGrid/OutputCompositor/OutputSlide | Parity work only adds `OutputPreview.tsx` + edits inside `ThemedSlideCard` + one-line box-style swaps; land after gaps-a |

## 12. Build order (once approved)
Media-item fit: **per-machine** (localStorage) for now, per the coordinator; DB sync deferred.

1. `media-fit.ts` + tests.
2. Validators + types (additive).
3. Renderer swaps (rows 1, 2, 6, 8-11, 15-20) + parity fixture.
4. Backgrounds normaliser.
5. UI menus.
6. What's New note.
7. 6-9 agent review gate + preview + visual checklist.
8. Record prod deployment ID → merge to main.
9. (Second PR) `canvasFor` extraction + `OutputPreview` + surface migration (11c) behind the parity toggle + Windows DPI/scrollbar checks + parity tests. Optional Phase 2 physical-display bars (DMG).
