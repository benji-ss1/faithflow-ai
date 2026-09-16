# MultiView + Scenes/Looks + display hot-plug — plan (2026-09-15)

Branch `feat/multiview-scenes` (worktree `../faithflow-scenes`, off origin/main f0ad61b).
Not touching: `src/lib/audio/*`, `AudioTab.tsx`, `SlideGrid.tsx` slide-actions (other agents).

## Ground truth (research, file:line)
- All outputs already render via `src/components/live/OutputCompositor.tsx` (`mode: live|stage|livestream|ndi`), incl. `previewFrozen` for cheap previews. Operator preview: `pro/right/LivePreviewPanel.tsx:136-151`.
- Layer overrides are ONE global map sent to every output (`useLiveLayers`, `OutputState.layers`); `appearance` is global. No per-screen mask, no per-screen theme, no side/lyric-strip output exists.
- Electron: zero `screen` event listeners (`electron/windows/OutputWindow.ts`, `electron/ipc/screens.ts`). Unplugging a projector leaves the window to the OS.
- No screens/looks DB tables. Closest store pattern: `src/lib/projection-zone-store.ts` (localStorage + change event).

## Increment 1 — MultiView (renderer only → Vercel, zero risk to outputs)
- New `pro/right/MultiViewPanel.tsx`: grid of tiles, one `<OutputCompositor previewFrozen transition={null}>` per screen (Main/live, Stage, Livestream, NDI) fed from the operator's existing `ctx` state. No subscription, no network, no new BroadcastChannel traffic.
- Tile shows: screen name, active scene, "layers hidden" indicators, "why dark?" hint (layer off / no content).
- Side + Lyric strip: rendered as VIRTUAL tiles (Main content with the scene's theme override) — no new routes/windows in this increment.
- Opens as a full-width overlay from a RightIconBar button. Flag: localStorage `presentflow.pro.multiview.v1="1"` OR `NEXT_PUBLIC_MULTIVIEW=1`; default OFF.
- Legacy (layers engine off): tiles fall back to the same renderer LivePreviewPanel uses.

## Increment 2 — Scenes/Looks (renderer only → Vercel)
- Pure module `src/lib/scenes.ts`: `Scene = { id, name, builtIn, screens: { [screen]: { layers: {[LayerKind]: boolean}, themeId?: string } } }`, validate/sanitize, `resolveScreenOverrides(scene, screen, globalOverrides)` (AND with operator eye toggles — a scene can only HIDE, never force-show something the operator cleared).
- 5 built-ins (read-only, cloneable): Worship, Teaching, Announcement, Offering, Pre-Service.
- Wire: `OutputState.scene?: {id, rev, screens}` — optional, sanitized in `sanitizeOutputState`; outputs that don't understand it ignore it. Each route applies its own screen's mask before `resolveLayeredInput`. One `output` post = atomic switch.
- NO-REGRESSION CONTRACT: when `scene` is absent (flag off, or "No scene" selected) every route is byte-identical to today — locked by extending the existing 96-fixture parity test.
- Persistence: localStorage (`presentflow.pro.scenes.v1`) with the projection-zone store pattern. **No DB migration in this branch.** Church-wide sync of custom scenes = follow-up (additive `scenes` table, rollback SQL first) once the feature is field-proven.
- Scene Rail in the right sidebar under the flag; one click = switch.

## Increment 3 — Electron display hot-plug (needs a NEW DMG)
- `electron/ipc/screens.ts`: listen `screen.on('display-removed'|'display-added'|'display-metrics-changed')`.
  - removed: output window on the lost display → move to a non-operator display if one exists, else close it (never cover the operator UI fullscreen); remember it as "pending".
  - added: if a role's saved display returns (match by id, then by size+label because macOS ids change) → re-spawn it fullscreen there.
  - metrics changed: re-fit bounds.
- Push `screens:changed` to the renderer; ScreensPanel refreshes + toast "Projector disconnected — will restore when reconnected". Renderer handles the event being absent (old DMGs) = no change.
- Pure placement function `planDisplayReplacement()` unit-tested; real unplug is hardware → documented as untestable headless, needs a manual field check.

## What could break → how it's verified
| Risk | Guard |
|---|---|
| Live/stage/livestream/NDI output changes when feature is off | `scene` optional + absent ⇒ parity test byte-identical; flag default off |
| OBS overlay editor / livestream look | untouched files; livestream route only gains an ignored-when-absent branch; OBS test re-run |
| Operator perf (4 extra compositors) | `previewFrozen`, panel mounts only when opened, memoised tiles; stress agent measures |
| Remote screens get unsanitised scene data | sanitizer + `coerceLiveMessage` bounds; adversarial test |
| Eye/clear-layer buttons stop working | scene masks AND with overrides, can never re-show a cleared layer; test |
| Electron hot-plug closes a window mid-service wrongly | pure function tested; only acts on windows whose display disappeared |

## Gate
tsc + all existing output tests (multi-output, projector-output, output-layers*, theme-*, bible-antireplay, service-mode) + new tests → 6-9 review agents (reviewer, security, stress, no-regression vs prod, E2E flow via Playwright on `next dev`, design/UX, Electron) → Vercel preview checked in desktop app → What's New note → main. Ship target ≥95% confidence or not shipped.
