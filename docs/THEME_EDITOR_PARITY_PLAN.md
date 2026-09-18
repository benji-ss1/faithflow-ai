# Theme / slide editor — ProPresenter parity plan

Written 2026-09-18 against `origin/main` @ `af80704`, on branch `feat/theme-editor-parity`.
Line numbers are for that commit — re-grep before trusting them.

Scope: the owner's parity list for our theme editor (`DesktopSlideEditorModal` in
theme mode) — object toolbar, Shape/Text/Build inspector tabs, status bar
(X/Y/W/H + zoom), rulers, size lock + object lock, flip H/V.

Governing rules: CLAUDE.md rule 0 (**never regress**), rule 2 (plan first, agent
gate, end-to-end tests), `docs/WINDOWS_DESIGN.md` (3–4 of the 5 churches
installing this weekend run Windows), memory note *lyrics-never-clip*, and
`PP7_REBUILD_PLAN.md` §4 — **no fake controls: never ship a control that does
nothing.**

---

## 0. Research honesty warning (read this before scoping anything)

Renewed Vision's first-party documentation of the PP7 **editor** is thin and
getting thinner: `learn.renewedvision.com` deep links now 302 to the Zendesk KB
root, the Pro7 User Guide PDF
(`https://files.renewedvision.com/propresenter/support/Pro7UserGuide.pdf`)
returns HTTP 522, and the web-cues article is login-gated. A research pass on
2026-09-18 (blog + KB + shortcut list) verified some items and could **not**
verify others.

**Verified [V]:**
- Editor add menu offers **text, media, video input, web**, plus **shapes**
  (including a parametric arrow with a control point and a star with adjustable
  point count / radius).
  https://www.renewedvision.com/blog/using-the-presentation-editor-in-propresenter-7
- Shape tab groups: alignment, **Position**, **Size**, **Transformation**,
  **Opacity**, **Fill** (color / gradient / media / website / video input /
  slide objects), **Stroke**, **Shadow**, **Feathering**, visibility. (same URL)
- Text tab: font/size/bold/underline + gear (All Caps, character spacing, line
  height, line spacing), **Text Scaling** (fit container to text / scale up /
  scale down / up-or-down), **Lines Only**, list options, stroke, shadow,
  **linked text**, **scrolling**.
  https://support.renewedvision.com/hc/en-us/articles/34551484745875-Guide-to-Using-Themes-in-ProPresenter
- Scrolling fields: Direction, Speed, Start Position (automatic / Off-Screen),
  Feathering (**left/right lockable by clicking the lock**), Distance, Repeat;
  **Line Transform → Remove Line Returns** sits under Text Color.
  https://support.renewedvision.com/hc/en-us/articles/4403013895059-Using-Scrolling-Text-in-ProPresenter
- Media fill Scaling: Scale to Fit / Scale to Fill / Stretch to Fill / Scale +
  Blur (Pro+). That article has **no** flip/rotate/crop.
  https://support.renewedvision.com/hc/en-us/articles/360011694174-Media-Scaling-Options
- Editor view options include a **transparency grid, slide guides, template
  guides, grid, and a ruler toggle**; PP7 shipped "new snapping and alignment".
  https://www.renewedvision.com/blog/using-the-presentation-editor-in-propresenter-7
- **Object lock exists** — the object list lets you "toggle the visibility of
  objects or lock an object" so you don't move it accidentally. (same URL)
- **Fit Slide into Edit Window = ⌘0 / Ctrl+0.** Bring/Send forward/backward have
  documented shortcuts. Key Mappings (7.7+) let users remap any menu command.
  https://support.renewedvision.com/hc/en-us/articles/360042123293-Keyboard-Shortcuts-in-ProPresenter
- The **Theme editor is a restricted subset** of the slide editor: a media
  button at the top (adds to the *slide*), a **Shape** tab, a **Text** tab, and a
  **Theme** tab whose media action targets the **media layer**. It "focuses on
  styling rather than entering specific text".
  https://support.renewedvision.com/hc/en-us/articles/34551484745875-Guide-to-Using-Themes-in-ProPresenter

**NOT verified [?] — do not present these as "what ProPresenter does":**
- Status-bar contents, units, origin; zoom range and step values.
- Ruler units/origin; whether guides drag out of the rulers; the toggle
  affordance (described as editor "view options", **not** confirmed as a View
  menu item).
- **Aspect-ratio ("size") lock in the Shape tab** — no source. The only verified
  lock-the-paired-fields idiom in RV's docs is the scrolling feathering lock.
- **Flip horizontal / vertical** — no source. The Shape tab's verified
  "Transformation" group is where it would live.
- The Build tab's field list.
- Default insert size/position per object type.
- Arrow-key nudge / shift-constrain / alt-drag duplicate.
- **A Pen / bezier tool.** No evidence PP7 has one; masking is a separate output
  **Mask layer** built from shapes or imported alpha images.

**Consequence for this plan:** where PP7 behaviour is `[?]`, we design for *our*
operator and say so, rather than inventing a citation. Anything the owner wants
matched exactly needs someone with a PP7 licence to look at the app and fill in
§0's gap list.

---

## 1. Item-by-item

### 1.1 Object toolbar (add Text / Shape / Image / Video)

| | |
|---|---|
| **PP7** | [V] Add menu in the editor toolbar: text, media, video input, web, shapes (rect/ellipse/arrow/star). Theme editor is a restricted subset (shape + text + a top media button). |
| **We have today** | Every one of these already exists — but in the **right drawer's "Add" tab**, not on a toolbar: `DesktopSlideEditorModal.tsx` `AddPanel` (Text / Rect / Ellipse at the "Add to slide" grid; Image / Video via `MediaLibraryPicker`). Factories: `slide-objects.ts:154-186` (`emptyTextObject`, `emptyShape`, `emptyImage`, `emptyVideo`). `addFocus()` (`:425`) switches to the Design tab after inserting. |
| **Gap** | Placement + discoverability only. An operator must find a tab before they can add anything; PP7 puts it one click away above the canvas. |
| **Build** | A horizontal object toolbar across the top of the canvas column, calling the *existing* `editor.addTextObject` / `addShape` / media-picker handlers. Keep the Add tab working (no removal — rule 0). Arrow/star shapes are a separate, later decision (see §3). |
| **Data model** | **None.** Reuses existing factories. |
| **Regression risk** | Steals vertical space from the canvas — must be measured at 911×512 CSS px (1366×768 @150%). Two entry points for "add" must stay in sync. |

### 1.2 Shape / Text / Build inspector tabs

| | |
|---|---|
| **PP7** | [V] Shape tab and Text tab as listed in §0; Build tab is per-object build in/out [?] fields. |
| **We have today** | One **Design** panel that switches on the selected object's kind: `DesignPanel` → `TextProps` / `ShapeProps` / `ImageProps` / `VideoProps` (`DesktopSlideEditorModal.tsx` ~`:870-900`). It already covers a good slice of PP7's Shape tab (position X/Y/W/H, rotation, opacity, fill incl. a 2-stop gradient + angle, stroke, corner radius, align, layer order, lock, hide) and Text tab (font family/size/weight, colour, align, italic, underline, line height, letter spacing, uppercase, shadow, text stroke). Per-object **entrance** animation (`anim` + `animDelayMs`, `ObjectAnim` in `slide-objects.ts:35`) is our Build-tab equivalent, already rendered by `SlideObjectsLayer`. |
| **Gap** | Our controls are all in ONE long scroll, so they read as "fewer" than PP7 even where they aren't. No build-**out**. No text scaling mode. |
| **Build** | Re-group `DesignPanel` into named, collapsible sections matching PP7's vocabulary (**Shape** / **Text** / **Build**) so an operator moving from ProPresenter recognises them — presentation only, same controls, same state. Then add genuinely-missing fields one at a time, each with a renderer. |
| **Data model** | Grouping: **none**. Any new field is an additive optional key on the existing object JSON (same pattern as `flipH`/`flipV` in PR 1). **No new DB columns** — slide objects live in the existing `objectsJson`; themes in the existing theme config. |
| **Regression risk** | Re-grouping a 300-line panel can drop a control. Mitigate with a control-inventory test that asserts every existing label still renders for each object kind. |
| **Do NOT copy** | See §3. |

### 1.3 Status bar (X / Y / W / H + zoom) — **shipped in PR 1**

| | |
|---|---|
| **PP7** | [?] Exists (our blueprint records it), contents/units undocumented. |
| **We had** | X/Y/W/H numeric inputs in the Design panel only — invisible unless the Design tab is open, and no zoom at all. |
| **Built** | `EditorStatusBar` under the canvas: selection label, X/Y/W/H (bounding box for a multi-selection), the canvas size (1920×1080), and a zoom group (− / readout / + / **Fit**). Values are canvas units, origin top-left — *the same units the Design inputs use*, so the two can never disagree. |
| **Data model** | **None.** Pure readout of editor state; zoom is component state, never saved, never published. |

### 1.4 Rulers — **not built yet (PR 2)**

| | |
|---|---|
| **PP7** | [V] Ruler toggle plus transparency grid, slide guides, template guides, grid. Units/origin [?]. |
| **We have today** | No rulers. We *do* have live snap guides while dragging (`SlideCanvas.tsx` ~`:150-170`: snaps each edge/centre to the canvas edges/centre and to every other object's edges/centre, within 20 canvas units, and draws a teal line) and a live Projection-Zone overlay. |
| **Build (PR 2)** | Top + left rulers outside the canvas box, ticked in canvas units, with a marker tracking the pointer and the selection's extent; a **View** popover that toggles rulers / grid / transparency checker / the existing snap guides. Rulers must read the SAME measured fitted-canvas width the zoom uses, or they will lie when zoomed. |
| **Data model** | None. Toggles persist per operator in `localStorage`, never in the DB. |
| **Regression risk** | Rulers change the canvas's available box → every existing overlay positioned in % (zone preview, snap guides, marquee, object badges) must be re-verified. This is why rulers are **not** in PR 1. |

### 1.5 Size lock (aspect) and lock object

| | |
|---|---|
| **PP7** | Object lock [V] (in the object list). Aspect/size lock [?] — undocumented. |
| **We had** | **Lock object already exists and works**: `locked?: boolean` on every object (`slide-objects.ts:43,72,90,116`), a Lock/Unlock button in `DesignPanel` (`~:815`), honoured by the canvas (no drag/resize, excluded from marquee hits, never deleted by the Delete key — `SlideCanvas.tsx` ~`:85-95`, `:210`). Aspect lock did not exist. |
| **Built (PR 1)** | `lockAspect` editor state + a **"Lock size (keeps its shape)"** toggle under X/Y/W/H. When on: drag-resize is constrained by the pure `constrainAspect()` and typing W or H moves the other via `lockedSizePatch()`. |
| **Data model** | **None** — `lockAspect` is editor session state, deliberately NOT saved (it is a tool mode, not a property of the slide). |
| **Regression risk** | The resize maths is shared with unlocked resize. Guarded: `constrainAspect` returns `next` untouched for any handle that isn't one of the eight, and the whole branch is behind `lockRef.current`. A real bug was caught by that test — `"move".includes("e")` is true, so a naive substring check would have resized objects the operator was only dragging. |

### 1.6 Flip horizontal / vertical — **shipped in PR 1**

| | |
|---|---|
| **PP7** | [?] Not documented. The Shape tab's verified "Transformation" group is where it would be. Media-fill scaling explicitly has no flip. |
| **We had** | Nothing. `rotation` existed; no mirror. |
| **Built** | `flipH?: boolean` / `flipV?: boolean` — additive optional fields on all four object kinds (`slide-objects.ts`), on `SlideObjectWire` (`broadcast.ts:24-32`), validated in `isValidSlideObject`, and rendered by BOTH the editor canvas and the projector through the shared pure `flipTransform()`, using the **independent `scale` CSS property** (not the `transform` shorthand) for exactly the reason `rotate` already does: so it composes with the entrance animation's transform instead of being overwritten. |
| **Data model** | Additive JSON only. **No DB columns, no migration.** An object with neither flag produces `undefined` → the style is byte-identical to before. |
| **Regression risk** | (a) The output identity. `slideDesignSig` gains an `H`/`V` marker **only when a flag is set**, so existing content's identity string is unchanged (test-locked against the literal string) — while a flip on an already-live object still defeats the already-live skip and re-projects, which is what rule-0 correctness requires. `slideOutputIdentity` itself is untouched. (b) Flipping text mirrors it and makes it unreadable — that is what a flip *is*, and the operator sees it immediately in the WYSIWYG canvas. |

---

## 2. PR breakdown (each ≤600 LOC)

| PR | Contents | LOC | Risk |
|---|---|---|---|
| **1 — status bar, zoom, size lock, flip** ✅ *this branch* | `editor-geometry.ts` (new, pure) · flip fields + validator + identity marker · `flipTransform` in both renderers · `zoom`/`lockAspect` props on `SlideCanvas` · `EditorStatusBar` · size-lock + Flip controls in `DesignPanel` · ⌘/Ctrl+0 Fit, ⌘/Ctrl ± zoom · 18 tests | ~330 | Low. Zoom `null` = the untouched original layout path; flip absent = byte-identical render. |
| **2 — rulers + View toggles** | Ruler gutters, pointer/selection markers, View popover (rulers / grid / transparency / snap guides), `localStorage` persistence. | ~350 | Medium — changes the canvas box; re-verify every %-positioned overlay. |
| **3 — object toolbar** | Horizontal add-toolbar over the canvas reusing existing handlers; Windows compaction to icon-only under 1180 CSS px; keep the Add tab. | ~250 | Low–medium (vertical space at 150% scaling). |
| **4 — inspector re-grouping** | `DesignPanel` split into Shape / Text / Build collapsible sections + a control-inventory test. **No behaviour change.** | ~400 | Medium — a dropped control is a silent regression; the inventory test is the guard. |
| **5 — Text Scaling (fit / scale down / scale up-or-down)** | The one genuinely-missing Text-tab field with clear operator value. Needs a real measuring implementation in BOTH renderers. | ~450 | **High** — this is the *lyrics-never-clip* blast radius (font cache, PR #29). Must not ship without field verification on Windows. |
| **6 — Build out + trigger** | Extend `ObjectAnim` to a build-out and a `startOn` trigger, rendered by `SlideObjectsLayer`. | ~350 | Medium. Additive fields; needs a renderer before any control appears. |

PR 5 and 6 are explicitly **not** required for this weekend's installs.

---

## 3. What PP7 has that we should NOT copy (no-fake-controls)

Per `PP7_REBUILD_PLAN.md` §4, a control ships only when our renderer supports
it. Keep these **hidden**, not visible-disabled, until they have a renderer:

- **Video Input object / video-input fill** [V in PP7] — NDI / SDI / Cam Link /
  Syphon composited into a slide object. Impossible in a browser without a
  server-side transcode; Syphon and SDI are impossible full stop. Our NDI work is
  an *output*, not a slide-object input.
- **Website object / website fill** — an iframe breaks on X-Frame-Options/CSP for
  most sites and can't composite with slide effects. A control that works for one
  URL in ten is a fake control.
- **"Slide objects" as a fill** — an object filled with other slide content
  (render-to-texture). No web analogue.
- **Feathering** — CSS `mask-image` approximates it, but not combined with a
  stroke + shadow on a media fill. Ship only if we accept "close, not exact".
- **Scale + Blur** media scaling — doable via CSS `filter`, but at 1080p on the
  **Windows iGPUs these churches run** it is exactly the class of effect
  `globals.css:686` already disables `backdrop-filter` for. Needs a perf test
  first, not a toggle.
- **Pen / bezier mask** — [?] there is no evidence PP7 even has this. Do not
  scope it off our own blueprint's "Pen" toolbar entry without confirming.
- **Linked text boxes** (text flowing between boxes) — a real layout engine.
- **Scrolling text** — a marquee locked to the output clock; a browser rAF will
  drift. Defer.
- **Arrow / star parametric shapes** — cheap in SVG, but our `ShapeObject.shape`
  is `"rect" | "ellipse"` and every renderer branches on it. Additive, but it is
  a renderer change in three places; treat as its own PR, not a freebie.

---

## 4. Windows checks applied in PR 1

Against `docs/WINDOWS_DESIGN.md` §9:
1. No `⌘ ⇧ ⌥` glyphs added; the new shortcuts are handled with
   `e.metaKey || e.ctrlKey` and are **not** the only path — every zoom action has
   an on-screen button.
2. No platform-conditional styling added at all (nothing to scope).
3. No platform check inside render → no SSR mismatch.
4. The status bar is a single 32px row with `overflow-x-auto`; buttons are real
   `<button>`s, so the Windows no-hover-lift / no-press-scale CSS applies.
5. Nothing is hover-only; every control has a `title` and a visible label or
   `aria-label`.
6. The zoomed canvas uses `overflow-auto`, and at Fit (the default) the layout is
   byte-identical to before, so no new horizontal scrollbar appears.
7. Still to confirm on a real Windows PC at 125% / 150%: that the extra 32px row
   does not squeeze the canvas below usability at 911×512.

---

## 5. Open questions for the owner

1. **Does PP7 actually have flip H/V and an aspect "size lock"?** Both are `[?]`.
   Ours are built the way *our* editor wants them. If exact PP7 behaviour matters,
   someone with a licence needs to check §0's gap list.
2. **Should `lockAspect` be per-object and saved, or a tool mode?** Built as a
   tool mode (not saved) — that matches Figma/Keynote. PP7 unknown.
3. **Flip on TEXT** — allowed today (mirrors the text). Should it be restricted to
   shapes/images/video?
4. **Text Scaling (PR 5)** touches the exact code path behind the *lyrics-never-clip*
   fix. Confirm it is wanted before that risk is taken, and not before the
   weekend installs.
5. **Arrow / star shapes** — wanted, or is rect/ellipse enough?
