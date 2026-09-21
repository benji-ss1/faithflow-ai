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
| R2 | **Theme apply wipes all manual text formatting.** PP7 preserves "special" (differential) bold/italic/underline/colour — formatting that differs from the rest of its text box. We have one style per object, no per-run model, so every re-apply stomps it. | OPEN |
| R3 | **No Clear Groups and no Clear to Logo (F12).** PP7 has both; F-keys only map F1–F7 here. IMAG operators have no safe "clear all but camera". | OPEN |
| R4 | **No video trim (in/out points) and no end-of-clip action.** PP7 has both; we have only `loop` on/off. | OPEN |

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
| Y7 | **Media load failure is silent** (`visibility: hidden`) — the operator gets no warning that an image never loaded. | OPEN |
| Y8 | **No per-layer transitions** (PP7 splits media vs slide). | OPEN |
| Y9 | **No true Builds** — our per-object `anim` is an entrance stagger, not build-in/build-out with on-click sequencing. | OPEN |
| Y10 | **Stage display is a fixed view**, not PP7's composable layout with per-screen assignment. | OPEN |
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

## Needs verification, not code

- **`bgExplicit` in `slideDesignSig`** — if any heartbeat path omits it while another sets it, the identity flips and a held slide replays its transition (the 2026-08-19 fade-pulse bug). Hold one slide live >5s and diff the sends.
- **PP7 object grouping** — two sources conflict on whether persistent Group/Ungroup exists separately from slide "Groups". Settle before building.
- **Everything visual** — none of the compositing rebuild has been seen on a real projector.
