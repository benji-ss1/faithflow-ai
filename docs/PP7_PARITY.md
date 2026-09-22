# ProPresenter parity — the gap list

Rule 5 in [`AGENTS.md`](../AGENTS.md): ProPresenter 7 is the baseline. A red or
yellow flag here is a **bug to fix**, not a difference to document.

Audited 2026-09-21 by six parallel agents, each cross-checking public RV
documentation against the running code. **Status is updated as things land — if
a row says OPEN, it is still broken.**

## 🔴 Red — a PP7 user notices immediately

| # | Gap | Status |
|---|---|---|
| R1 | **Designed text boxes hard-clip on overflow.** PP7 offers four scale-to-fit modes. Ours rendered a fixed `fontSize` inside `overflow: hidden`, so a too-long line silently vanished off the projector. | ✅ **FIXED 2026-09-21** — `src/lib/text-fit.ts` + `FittedText.tsx`, `textScale` on the object + wire + a "Scale to fit" control in the editor. Default `"down"`: text that fits is byte-identical (DOM goldens prove it), text that would clip now shrinks. **Not yet seen on a projector.** |
| R2 | **Theme apply wiped all manual text formatting.** | ✅ **FIXED 2026-09-22** — `src/lib/text-runs.ts` implements PP7's CONTRAST rule: a run survives only where it differs from the rest of its own box. Uniform formatting is still wiped (RV: an all-bold box loses its bold), and position/size/family still always follow the theme. Four attributes only — bold/italic/underline/colour, RV's exhaustive list. `runs` is optional and additive, so every existing slide is untouched and no migration is needed. Editor: select words → B / I / U / colour. |
| R3 | **No Clear Groups and no Clear to Logo (F12).** IMAG operators had no safe "clear all but camera". | ✅ **FIXED 2026-09-21** — `PP7_CLEAR_GROUPS` + `pp7ClearGroup()`, rail buttons, and **F12** wired. "All But Video Input" (PP7's own worked example) and "Clear to Logo". Clear All stays FIXED per Victor 2026-09-18 — groups are additive, so the panic button can't be configured away. Clear to Logo is **hidden** when no church logo is set rather than being a button that does nothing. |
| R4 | **No video trim, end-of-clip action, rate or volume level.** | ✅ **FIXED 2026-09-22** — `src/lib/video-playback.ts` (pure) + `SlideVideo.tsx`. Trim in/out, end action (loop / hold last frame / take off screen), speed 0.25–4, volume 0–1 with `muted` still winning. Editor controls in the video inspector. Every default reproduces today's behaviour, and a clip with no trim and a plain loop is still handed entirely to the browser (`needsSupervision()`), so the common case costs nothing. |

### Open question on R3

PP7's docs verify Clear to Logo clears the **Media** layer and sends the logo
there. Whether it also clears Props / Announcements / Video Input is **not
documented** (their guide pages are down — flagged `[?]` in `PP7_LAYERS_SPEC`).
We clear the content layers and **leave the camera**, because "clear to logo" is
an end-of-service action and killing a live IMAG feed with it would be a nasty
surprise. Revisit if a real PP7 install says otherwise.

### Why a run model and not a simpler flag (R2)

A box-level "the operator customised this" flag was the cheaper option, and it
was rejected: once you bolded one word it would protect the **whole box**
forever, so the box could never follow a theme again. That is visibly wrong in
exactly the case the feature exists for. PP7's rule is a *contrast* rule, and
contrast cannot be computed without knowing which characters differ.

It is deliberately **not** full rich text: no font family or size inside a run
(PP7 always overwrites those), flat non-overlapping ranges, four attributes.
Anything more would be more powerful than ProPresenter itself.

## 🟡 Yellow — a power user notices

| # | Gap | Status |
|---|---|---|
| Y1 | Themes are **baked destructively** into `objects_json`; PP7 resolves at render. Undo depends on snapshot bookkeeping that has broken twice. | OPEN |
| Y2 | No text **vertical alignment** (hardcoded centre) and no adjustable box inset (hardcoded 2%). | OPEN |
| Y14 | **Editor canvas clipped where the projector scaled** — WYSIWYG broken. | ✅ **FIXED 2026-09-21** — the fit was extracted into a `useFitFontSize` hook so the editor and the projector share ONE implementation (test-locked: two fit loops = two behaviours that drift). |
| Y3 | **Shadow is a boolean** with one fixed look; PP7 exposes colour/angle/length/blur. | OPEN |
| Y4 | **No per-object name** — the layers list cannot be renamed. | OPEN |
| Y5 | **Scale + Blur is not a first-class fit mode** — we have `blurFill`/`blur` flags instead of PP7's fourth named mode. | OPEN |
| Y6 | **Fit-mode defaults differ**: PP7 uses Stretch for backgrounds, Fit for foregrounds. `emptyImage()` always defaults to Fit. | OPEN |
| Y7 | **Media load failure is silent.** | ✅ **FIXED 2026-09-21** — `media-failure.ts`: the operator is toasted, the projector still hides it, and the output pages have no listener (test-locked). |
| Y8 | **No per-layer transitions** (PP7 splits media vs slide). | OPEN |
| Y9 | **No true Builds** — our per-object `anim` is an entrance stagger, not build-in/build-out with on-click sequencing. | OPEN |
| Y10 | **Stage display is a fixed view**, not PP7's composable layout. | 🟠 **BUILT, UNPROVEN** — a Stage Layout editor exists on `feat/pp7-timers` (PR #97): named/duplicable presets, a canvas with current/next text, timer, clock, screen preview, message and static text, per-widget size/colour/alignment, and multiple stage screens via `/stage?screen=<id>`. Built-ins are code not rows, so "restore defaults" always works. **NOT field-verified on a real confidence monitor** — do not treat as closed. |
| Y11 | **No Mask, no Screen Color.** PP7's Screen Color is operator-configurable; we hardcode black per output route. | OPEN |
| Y12 | **Scenes include `stage`** as a controllable screen; PP7's Looks are audience-only. | OPEN |
| Y13 | **Legacy black backgrounds**: rows saved before 2026-09-21 with a deliberately chosen black have no `bgExplicit` and will render as transparent. Needs a backfill or explicit sign-off. | OPEN |

## Named divergences — deliberate, signed off

| What | Why |
|---|---|
| **Clear All stays fixed**, with named groups alongside. | PP7 lets you edit Clear All and warns you lose the panic button. Victor 2026-09-18: we do not copy that flaw. |
| **Props = one church logo.** | Victor 2026-09-18: no multi-prop collection. |
| **Transition precedence** (instant > AI 150ms > Off > theme > global). | Ours, for voice/AI-driven live production. PP7 is Slide > Presentation > Global. Must not be described as parity. |

## Cross-platform (see `WINDOWS_AND_MAC.md`)

| # | Gap | Status |
|---|---|---|
| W1 | **HEVC `.mov` may be silently black on a Windows projector** — allowed upload type, no codec check, stock Chromium cannot decode HEVC. | OPEN 🔴 (unverified — needs a Windows box) |

### Timers — noted from PR #97 (not this PR's work)

- PP's timer state machine is **five** states (stopped / running / complete /
  overrunning / overran), not two. Implemented on that branch.
- PP pushes a formatted time **string** ~1/sec to a dumb renderer. PR #97 sends
  an **anchor** and each screen ticks locally instead — deliberately different,
  far cheaper over Supabase, and it survives a wifi drop mid-countdown where
  PP's approach freezes on the last string it received. A **named divergence**,
  not a parity gap.

## Needs verification, not code

- **`bgExplicit` in `slideDesignSig`** — if any heartbeat path omits it while another sets it, the identity flips and a held slide replays its transition (the 2026-08-19 fade-pulse bug). Hold one slide live >5s and diff the sends.
- **PP7 object grouping** — two sources conflict on whether persistent Group/Ungroup exists separately from slide "Groups". Settle before building.
- **Everything visual** — none of the compositing rebuild has been seen on a real projector.
