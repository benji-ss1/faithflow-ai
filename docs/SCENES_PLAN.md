# Scenes (ProPresenter "Looks") — build plan, 2026-09-16

Branch: `feat/multiview-scenes` (MultiView already on it, reviewed 96%, awaiting merge).
User decisions: **scenes stored in the church DATABASE from the start** (2026-09-16); MultiView first (done);
projector-unplug Electron fix explicitly DROPPED.

## What a Scene is
A named, church-saved snapshot of **routing**, not content: for each screen (Main / Stage / Stream / NDI),
which layers are shown (background, camera, slide, logo, announcement) + an optional per-screen theme.
Switching a Scene never changes what is playing — only what each screen shows of it.
5 built-ins ship in code (Worship, Teaching, Announcement, Offering, Pre-Service), cloneable.

## THE load-bearing finding (research)
`NEXT_PUBLIC_LAYERS_V2` is **OFF in production**, and routes gate the layers render path on that env var alone
(`live/page.tsx:583`, `stage`, `livestream:524`, `ndi:163`). `docs/DECOUPLING_PLAN.md` calls the layers path a
prerequisite for Scenes — if we honour that literally, Scenes is dead code in prod.
**Decision:** Scenes is gated on DATA PRESENCE (`OutputState.scene` present + non-empty), not on `LAYERS_V2`.
The mask is applied inside `resolveLayeredInput(base, overrides, mask)`, which is a pure PlanInput→PlanInput
function and works with an EMPTY override map. So:
- No scene ⇒ resolver not called ⇒ byte-identical to today (parity-locked by the existing ≥96-fixture matrix).
- Scene present ⇒ per-screen mask applies whether or not the layers engine is on for that church.
- The operator's own eye/clear overrides ALWAYS win over a scene mask (`maskOff = mask[id]===false && !overrideMap.has(id)`),
  so a scene can never fight the operator and SHOW still restores from base (Wave-5A non-destructive-hide contract).

## Increment A — data + wire (additive, reversible)
1. **Migration FIRST** `docs/migrations/2026-09-16-add-scenes.sql`, additive + idempotent, rollback comment written first:
   `scenes` (id, church_id FK cascade, name, config jsonb, is_built_in, sort_order, created_at, updated_at),
   `idx_scenes_church(church_id, sort_order)`, `ALTER TABLE scenes ENABLE ROW LEVEL SECURITY`,
   plus `ALTER TABLE church_preferences ADD COLUMN IF NOT EXISTS scenes_enabled boolean NOT NULL DEFAULT false`.
   Rollback: `DROP TABLE IF EXISTS scenes;` + `ALTER TABLE church_preferences DROP COLUMN IF EXISTS scenes_enabled;`
   **APPLIED TO PROD BY THE USER BEFORE THE CODE DEPLOYS** (drizzle selects every column; AI_HANDOFF.md:50).
2. `src/lib/db/schema.ts` — `scenes` table after `macros` (:654), matching `timerDefinitions` style exactly; `scenesEnabled` on `churchPreferences`.
3. `src/lib/scenes.ts` (pure, unit-tested): `SceneWire`/`ScreenMask` types, the 5 built-ins, `sanitizeSceneConfig`,
   `sceneToWire`, `maskFor(scene, screen)`, `isEmptyScene`.
4. `src/lib/broadcast.ts` — additive `scene?: SceneWire | null` on OutputState + `isValidScreenMask`/`isValidSceneWire`
   (pollution-key reject, LAYER_ID_RE ids, ≤MAX_LAYERS keys, 0..1 opacity, appearance via existing `isValidThemeAppearance`),
   one line in `isValidOutputState`, fail-open drop in `sanitizeOutputState`. `scrubOutputStateForRemote` needs NO change
   (a mask is booleans/numbers/validated appearance — no machine-local data); locked by a test.
5. Server actions in `src/lib/actions.ts`: `listScenes` (requireUser), `createScene`/`updateScene`/`deleteScene`
   (`requireCap("edit_library")`, `and(id, churchId)` scoping, rowCount===0 ⇒ "Scene not found", MAX_SCENES=50,
   name clamp 120, jsonb key whitelist). Built-ins are code, never DB rows a user can delete.

## Increment B — render (renderer-only, Vercel)
6. `resolveLayeredInput(base, overrides, mask?)` + `layerOpacities(overrides, mask?)` — additive 3rd arg, operator wins.
7. `OutputCompositor` — new `scene?: SceneWire | null` + `screen?: ScreenName`; calls the resolver when
   `layersEnabled || sceneActive`; per-screen theme via `mask.appearance ?? appearance`.
8. All four routes: read `state.scene` into local state, add it to the dedupe signature (NOT gated on LAYERS_V2),
   pass `scene` + `screen` to the compositor. Epoch/ghost-tab guard already covers the whole snapshot.
9. MultiView tiles pass the scene through ⇒ the monitor wall shows the scene's effect (the "verify in MultiView" requirement).

## Increment C — operator UI + automation
10. `SceneRail` in the right `<aside>` BETWEEN LivePreviewPanel and TranscriptDisplay (spec §21.7:1534 order),
    reusing the MultiView radiogroup markup (h-7, roving tabindex, ring-inset). Must NOT shrink the locked h-[280px] preview.
    "None" is always the first option and is a true no-op.
11. `SceneBuilderModal` on the ThemesModal pattern (radix dialog + `presentflow:open-scenes-settings` event):
    layers (rows) × screens (columns) on/off grid from `LAYER_META` + `MULTIVIEW_SCREENS`, cell = the proven
    `LayerCue` button, per-screen theme `<select>` from `GET /api/themes`.
12. One atomic switch: `setActiveScene` → the existing single `safePost({type:"output", state})` in OperatorConsole
    (~:874 rawState + dep array :926). NOT layer-patches (BroadcastChannel-only, per-layer, would tear across ~20 messages).
13. Automation: add `{type:"scene", sceneId}` to `src/engine/actions/spec.ts` union + `SPEC_TO_ENGINE` + `validateSpec`
    (SAFE_TOKEN) + `sanitizeSpec` + `describeSpec` + ONE `ACTION_PALETTE` entry (lights up Automations AND the slide menu
    with no SlideGrid.tsx edit — that file belongs to another agent).
14. Discoverability: `presentflow.scenes.opened.v1` pulse dot; `changes/scenes.md` What's New with an "Open Scenes →" deep link.
15. "Why is this screen dark?" helper: when a live layer is not routed on a screen, one-line hint in MultiView (spec :904).

## Flags + kill switches
- `scenes_enabled` per church (default false) AND `NEXT_PUBLIC_SCENES_V1` module constant kill-switch.
- Operator-side only for the UI; the RENDER path is data-gated so an already-published scene still renders.
- "None" scene + flag off ⇒ no `scene` field on the wire ⇒ provably byte-identical output.

## What could break → guard
| Risk | Guard |
|---|---|
| Any output changes when no scene is selected | resolver not called; existing ≥96-fixture parity matrix re-run with mask undefined AND null |
| A scene fights the operator's hide/clear | mask loses to any explicit override; unit test per layer id |
| A bad scene blanks a projector | fail-open sanitize drops only the scene field; adversarial test |
| Scene leaks across churches | church-scoped actions + new `test/adversarial/` scenes leak test |
| Per-screen theme clears the shared background template | per-screen background goes through the MASK, never by mutating backgroundSpec |
| Migration/deploy order | migration applied to prod by the user BEFORE merge; rollback SQL written first |
| Sidebar layout regression | SceneRail is a single h-8 row; preview h-[280px] unchanged; checked in preview build |
| Camera reopened by a scene | scene can only toggle camera VISIBILITY; never carries a deviceId (test) |

## Gate
tsc + all output/layer/obs/multiview suites + new scenes suites → 6–9 review agents (reviewer, security, stress,
no-regression vs prod, E2E real-UI with a scene switch, design/UX, parity, adversarial church scoping) → ≥95% →
Vercel preview checked in the desktop app → user sign-off → main. What's New note required.
