# Composable Everything: Component + Link + Override (DRAFT v2, 2026-09-23)

Status: DRAFT v2. Nothing is built. Folds in all findings from the 7-reviewer gate on v1.
Worktree: `/Users/benjisanusi/faithflow-composable`, branch `feat/composable-v1`, based on `origin/main` `89dc2dde`.
**Every fact and file:line below was re-checked against this checkout.** v1 was written from `fix/todays-fixes-2026-09-09`, which is 193 commits behind main. Several v1 facts were wrong (see §0.1). Nothing in this plan may be built from `/Users/benjisanusi/faithflow-ai`.

User direction (2026-09-23): themes, images, logos, text, looks, background templates, logo backgrounds, props, announcements and media should all be linkable to a shared source and unlinkable from it, 1:1 with PP7 layering.
Two constraints limit that: Victor's 2026-09-18 decisions (`docs/PP7_LAYERS_SPEC.md` §8) and the #1 rule, "never regress". Where they conflict, they win, and the conflict is listed in §12 as a decision.

---

## 0. Verified facts on main (89dc2dde)

### 0.1 What v1 got wrong
| v1 claim | Truth on main |
|---|---|
| `applyThemeToSong` is not atomic: one update per slide, backup written after the loop | **Already fixed** (PR #48). `actions.ts:2997` runs one `db.transaction`, locks the song row `FOR UPDATE`, computes the backup first (the first snapshot is kept across repeat applies, via `mergeThemeBackup`/`pruneThemeBackup`), then writes all slides with batched `UPDATE … FROM (VALUES…)` in chunks of 100 (`writeSongSlideObjects` :2983). What's missing is a **DB-backed test**, not the fix. |
| Bake mints the `#010101` black guard | Stopped minting it on 2026-09-21. The bake now sets `bgExplicit: true` (`theme-bake.ts:47-53`). Older rows still carry `#010101` and still render. |
| Layers is behind `layersV2`, so gate on it | `church_preferences.layers_v2` defaults to **true** (`schema.ts:535`) and `NEXT_PUBLIC_LAYERS_V2=1` is set in prod. Layers is ON everywhere. Gating on it does nothing. |
| Scenes code not found | Scenes is on main: `src/lib/scenes.ts` (254 LOC) and the `scenes` table at `schema.ts:778`. It's live, but OFF per church (`scenes_enabled` default false, `schema.ts:542`). |
| Mutual-exclusion site at `OperatorConsole.tsx:474-487` | There are **three** sites: `OperatorConsole.tsx:593` (mount self-heal for the default theme), `:653` (explicit `presentflow:theme-changed` apply, stamps `markThemeBackgroundPicked`), and `:801` (effective-appearance heal, 2026-08-29). Rule: `backgroundStore.ts:139 shouldKeepTemplateOverThemeBg`. |
| z-order bg0/cam5/slide10/logo20/ann30 | That order only applies when the flag is off. With `pp7DrawOrder` on (default ON via `pp7-draw-order.ts:38`, parent flag `pp7-layers-flag.ts` also default ON) the camera sits at z −10 (below Media) and announcements at z 15 (below the logo/Props). `output-layers.ts:199-212, 217-315`. |
| "Pp7Stack / 9-slot OutputState" | **Neither exists on main.** `OutputState` (`broadcast.ts:478`) is still built from legacy fields (`background` :504, `appearance` :507, `videoInput` :509, `announcement` :490, `scene` :557, `layers?` LayerWire[]). The PP7 stack is **derived** by `outputStateToLayers` plus `pp7-layer-model.ts` / `pp7-clear.ts` / `pp7-keep-theme-bg.ts`. |

### 0.2 Themes and songs
- `themes` table: `schema.ts:630-645`. Columns: `config` jsonb, `isDefault`, `sortOrder`. There is **no `rev`, no `deleted_at`, and no index besides the PK** (`idx_themes_church` is missing).
- `songs`: `schema.ts:215`. Has `settings` jsonb (`appliedThemeId`, `themeBackup{slides,bakedConfigs}`, `slideThemeBackups{slideId:{themeId,bakedConfigs,…}}`), `defaultBackgroundAssetId` and `idx_songs_church_title`. There is **no `theme_id` column**.
- "Songs using theme X": `songsUsingThemeWhere` (`actions.ts:~3217`) scans the jsonb (`appliedThemeId` OR `jsonb_each(slideThemeBackups)`), and **no index backs it**. It's used by `countSongsUsingTheme` and `reapplyThemeToSongs`.
- `reapplyThemeToSongs` (`actions.ts:3250`) **already fans writes out from a theme edit**. The client pages through it (≤25 songs per call, one transaction per song). This is the fan-out the scaling reviewer flagged. It exists today and was signed off in PR #48 ("save re-applies to every song using it").
- `createTheme` :2508. `updateTheme` :2519 replaces the whole config blob with **no concurrency check**. `patchThemeConfig` (~:2554) merges per field on the server under `FOR UPDATE`, also with no rev. `deleteTheme` :2620 is a **hard delete with no used-by check**. `setDefaultTheme` :2660 runs outside any transaction.
- Per-slide apply: `applyThemeToSongSlides` :3077. Undo: `removeThemeFromSongSlides` :3131. Song revert: `revertSongTheme` :3171 is well defined (it restores theme-owned fields from the *first* snapshot, keeps current content, and clears markers). The plan-level apply is `applyThemeToPlan` :586 (it returns `previous` for Undo).
- Bake: `theme-bake.ts:31 bakeThemeIntoObjectsJson`. There's one bake used by whole-song, per-slide and re-apply. It keeps PP7 "special runs", auto-contrast, gradient pass-through, and `themeOwnsBg` drops leftover bg keys.
- Sanitizer: `sanitizeThemeConfig` / `THEME_ALLOWED_KEYS` in the pure `theme-config` module. `materializeBuiltinTheme` :2962 uses an advisory lock.

### 0.3 Slides / editor (the no-regression 🔴)
- `normalizeEditableSlide` (`slide-objects.ts:248`) keeps **only** `bgColor, bgImageUrl, bgExplicit, objects, transition, lyrics`. It **drops `bgType`, `bgColor2`** and every other key, including any future `links`.
- `saveSlideObjects` (`actions.ts:1131`) **rewrites** `objects_json` as `{bgColor,bgImageUrl,bgExplicit?,objects}`. It **drops `transition`, `bgType` and `bgColor2`** that the theme bake wrote.
- ⇒ **Live bug today (🟡, pending a confirming test):** open a theme-applied song in Edit Slide, save, and the slide loses its theme transition plus its gradient/`bgType` keys. It then re-renders from the theme's *appearance* instead of the baked slide. This needs a round-trip test in Phase 0 before anyone relies on it.
- **`bgImageFrame` does not exist on main.** The saved media framing is stored per asset in localStorage (`pf.mediaFrame.v1.<church>.<asset>`, `components/operator/pro/center/mediaFrame.ts:64`) and baked at send (`mediaFrameBake.ts`). It is never stored in `objects_json`, so the normalizer can't drop it. **Not a live bug.** (It *is* a composability gap: framing is per-machine and never syncs. See G-list.)

### 0.4 Output, broadcast, renderer
- `slideOutputIdentity` `broadcast.ts:1497` must stay content-only (rule 7 fade-pulse).
- URL policy: `broadcast.ts:1026/1038` delegates to `render-url.ts` (ONE URL POLICY, 2026-09-14). `SlideRenderer.tsx` still interpolates raw `url("${…}")` at **:86, :448, :551, :727**. These are CSS-escape sinks to harden.
- Logo: `appearance.logoUrl` (`broadcast.ts:284`) → derived `logo` row → PP7 "Props". Clear to Logo (F12) exists (`pp7-clear.ts:76-117`).
- Scenes: `SceneLayerId` = background|camera|slide|logo|announcement|timer (`scenes.ts:47`). There's no mask, screen colour or messages row. Per-screen `themeId` is resolved operator-side to a ThemeAppearance. Sanitized by `sanitizeSceneConfig` :122. `SCENES_V1` defaults ON (`scenes.ts:102`) and the per-church flag defaults OFF.
- Transition precedence (PR #52): `transition-resolve.ts:64 resolveSendTransition` (cut > AI 150ms > Off > theme > global).
- Offline: `offline/serviceCache.ts` stores a church-scoped KV. The themes list is cached at `OperatorConsole.tsx:610/617`. There's no style_components cache, because those don't exist yet.
- Media: `media_assets` `schema.ts:303` has no `settings` column. `deleteMediaAsset` `actions.ts:1800` cleans plan items but **doesn't check themes/songs/logo that reference the URL**.
- Logo has three sources: `churches.logo_s3_key` (`schema.ts:36`), `settings.logo_s3_key` (`updateSettings` `actions.ts:1974`, the sidebar reads this) and `theme.config.logoUrl`.
- Song G-key confirm: `operatorConstants.ts:103 SONG_AUTOSTAGE_CONFIRM_KEY="KeyG"`. The PP7 F-keys F1–F7/F12 are taken by the clear rail.

### 0.5 Tests and CI on main
- `test/suites/ci.txt`: 242 pure test files, **alphabetical-insert rule** (merge hygiene). CI job "Tests (offline suite)" runs `node scripts/run-tests.mjs --suite ci`. A second job "Tests (database)" runs `test/suites/db.txt` against a pgvector Postgres with the schema pushed. `test/suites/known-failing.txt` lists the skips.
- Golden fixtures **already exist**: `test/fixtures/output-plan-main.golden.json`, `output-dom-main.golden.json`, `output-dom-empty-main.golden.json`, `theme-gaps-baseline.json`, `theme-pr2-baseline.json`. There's **no objects_json / slideOutputIdentity / OutputState-per-song golden**.
- `playwright` is in `package.json:130`, but there's **no `playwright.config`**. `test/e2e/*.test.ts` are tsx DB scripts, not browser tests.

### 0.6 Baseline on main (run 2026-09-23 in this worktree)
- `npm ci`: the `sharp` native build (under `@xenova/transformers`) **fails locally** (node 26 / node-gyp). I reran with `npm ci --ignore-scripts`: OK, 1094 packages.
- `npx tsc --noEmit`: **exit 0 (clean).**
- `node scripts/run-tests.mjs --suite ci` (the CI gate): **242/242 pass.**
- `--all` with `/Users/benjisanusi/faithflow-ai/.env.local` loaded: **252/262 pass.** The failures:
  - `known-failing.txt` "broken", as expected: `audio-latency`, `phrase-search`, `propresenter-import`, `stress-wave5`, `swift-helper-protocol`. The four from the brief are all still failing.
  - `known-failing.txt` "needs-db", as expected: `rechunk-cross-church`.
  - **Local-env artefacts (sharp not built):** `adversarial/cross-church`, `api-search-bible-arm`, `bible-hybrid-search`. The last two pass in the offline CI run.
  - Timeout: `adversarial/desktop-signin` (180s, DB/network).
  - ⚠ `.env.local` points DB-backed tests at whatever `DATABASE_URL` it holds. Phase 0 must pin DB tests to a Supabase **branch** or the CI Postgres, **never prod**.

### 0.7 Branch classification (`git branch -a --merged origin/main`)
- **Merged into main (no conflict):** decoupling-{compositor,layers-panel,layers-wire}, layers-default-on, multiview-scenes, pp7-{clear-rail,draw-order,layers-panel,theme-popover}, retire-themes-manager, slide-clear-keeps-theme-bg, song-bg-and-theme-band, theme-{editor-parity,editor-pp7,gaps-a,import-export,projector-pr2}, fix/{background-marker-everywhere,background-parity,content-type-theme-race,desktop-dmg-live-lookup,edited-image-as-background,layout-theme-red-yellow,playlist-background-projector,pp7-layer-followups,theme-applies-to-every-slide,theme-route-capability}.
- **Absorbed (docs-only residue):** `feat/themes-v3` is 3 ahead, 2 unmerged commits, docs only (+157 lines, PP7 clear-rail spec). Nothing to rebase onto.
- **Open and touching shared files (merge main in before each phase; not blocking):** `origin/feat/pp7-timers` (touches `broadcast.ts`). `origin/feat/propresenter-import-smart-folders` (10 ahead: `actions.ts`, `schema.ts`, `import-actions.ts`, `check-schema.mjs`). It will conflict on `schema.ts`/`actions.ts`, so land our migration after it, or rebase.
- **Not a source:** `/Users/benjisanusi/faithflow-ai` on `fix/todays-fixes-2026-09-09` (193 behind, heavy uncommitted theme/background edits). Don't cherry-pick from it.
- **Blocking:** none.

---

## 1. Principles (changed from v1)
1. **Extend what's shipped; add no parallel models.** Build on the derived PP7 stack (PR #39 media-over-camera, the draw-order flag, keep-theme-bg, clear rail/F-keys). Looks = **Scenes** (no `looks` table). Props = **the single church logo** (Victor 2026-09-18).
2. **Resolve once per send, operator-side, and FREEZE on live.** Receivers never resolve. The wire carries resolved values only: no `links`, `sourceId`, `snapshot` or `rev` ever reach BroadcastChannel, Realtime or the LAN WS.
3. **A theme edit never re-resolves live content** and never fans out writes *because of linking*. Linked songs read the source at their next send. The existing baked `reapplyThemeToSongs` stays as it is for detached/baked songs.
4. **Styling never changes auto-fire decision inputs.** Detection, confidence, anti-replay and song-switch-hold read content identity only.
5. **Legacy fields stay authoritative on the wire** until the dual-emit expiry. Old DMG receivers must render the same.
6. **Flag off = byte-identical**, proved against the golden fixtures.

## 2. Unified model: `src/lib/composable.ts` (pure, sync)
```ts
type LinkKind = "theme" | "media" | "logo" | "textStyle" | "slideTemplate" | "messageStyle";
type Piece = "text" | "background" | "scripture" | "transition" | "logo";
type Link = { kind: LinkKind; sourceId: string; piece?: Piece; mode: "linked" | "detached";
              overrides?: Record<AllowedKey, unknown>; rev?: number };
// snapshots are per SONG, not per object: song.settings.linkSnapshots["<sourceId>@<rev>"]
resolve(link, sourceMap, snapshots, fallback)
  -> { value, fieldState: "inherited"|"overridden"|"detached"|"missing-source"|"deleted-source", trace }
override / resetField / detach / relink        // pure, return new objects, never mutate
```
- The per-piece override key allowlist comes from `THEME_ALLOWED_KEYS`, split by `splitThemeConfig`. **No generic deep merge.** Drop `__proto__`/`constructor`/`prototype`. Validate with zod. Caps: `objects_json` ≤ 256 KB, overrides ≤ 50 keys, depth ≤ 4.
- A missing, foreign or deleted source falls back to the snapshot, then to the baked value. It never goes blank.
- `resolve` gets a **preloaded, church-scoped source map**. It's memoised on `(sourceId, rev, overridesHash)`, with a <1 ms benchmark per slide.
- Theme pieces: `text`, `background` (split into **colour → Slide-background-colour row** and **media → Media layer**, see §3), `scripture`, `transition` (**Slide layer only**; PR #52 precedence unchanged), `logo` (the single church-logo Prop). `lowerThird` is **not a piece** (see decision D3).
- Cascade: Global → Scene (per-screen theme) → content-type style (`contentTypeStyles`) → service-item theme → song/slide link → object overrides → live (`fontScale`). The saved Scripture Style keeps winning over theme scripture options (PR #52).

## 3. Mapping to the PP7 stack (as shipped)
| PP7 row (top→bottom) | Composable? | Source → instance | Notes |
|---|---|---|---|
| Mask | **No** (display-only row, greyed) | — | No PF equivalent. Deferred with Looks. |
| Messages | Style only | message style → `messageStyle` link | Announcement banner = a **Message style** (signed off 2026-09-16). Tokens work per §7 item 3. |
| Props | Logo only | `churches.logo_s3_key` (proposed canonical) → logo link | Single logo only. Generic props need a Victor sign-off (D3). |
| Announcements | **No** (deferred) | `announcements.preset_id` → preset | Links go to the **preset**, not the theme. Lobby-presentation layer is deferred. |
| Slide | Yes | theme `text`/`scripture`/`transition`, textStyle, slideTemplate | Scripture is its own content-type row. |
| Slide bg colour | Yes | theme `background.color` | Above Media since PP7 7.11. See D2 for the black-guard/`bgExplicit` semantics. |
| Media | Yes | theme `background.media`, Background Templates, media_assets | `media_assets.settings` is the source (fit/position/loop/mute/start). Per-instance overrides are a PF extension. |
| Video Input | **No** (display row) | — | Camera stays its own layer (PR #39 lesson). |
| Audio | **No** (greyed row) | — | Victor 2026-09-18. |
| Screen Color | **No** (display row) | — | Could ride along with the draw order later. |

Per-output resolution: `resolve` takes `mode: live|stage|livestream|ndi` and applies piece masks. **Stage is byte-identical and ignores links.** Livestream/NDI with transparent keying keeps the background transparent (OBS alpha) and the logo suppressed, as `outputStateToLayers` does today.

## 4. Data model (additive; rollback SQL written first) — `docs/migrations/2026-09-XX-composable-*.sql`
Phase 0 migration (indexes + soft delete only):
```sql
-- ROLLBACK FIRST:
-- DROP INDEX IF EXISTS idx_themes_church; DROP INDEX IF EXISTS idx_songs_church_theme;
-- ALTER TABLE themes DROP COLUMN IF EXISTS deleted_at; ALTER TABLE themes DROP COLUMN IF EXISTS rev;
-- ALTER TABLE songs DROP COLUMN IF EXISTS theme_id;
ALTER TABLE themes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE themes ADD COLUMN IF NOT EXISTS rev integer NOT NULL DEFAULT 0;
ALTER TABLE songs  ADD COLUMN IF NOT EXISTS theme_id uuid REFERENCES themes(id) ON DELETE SET NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_themes_church ON themes(church_id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_church_theme ON songs(church_id, theme_id);
-- backfill songs.theme_id from settings->>'appliedThemeId' in resumable chunks (server job)
```
Later phases add: `media_assets.settings jsonb` (whitelisted), `announcements.preset_id`/`style_overrides`, and a `style_components` table (`church_id` FK **ON DELETE CASCADE**, index `(church_id, kind)`, **RLS enabled** as defence in depth, `deleted_at`, `rev`). **There's no `looks` table.** The Scenes `config` gains optional fields only via `sanitizeSceneConfig`.
Order: migration → verify pages that `db.select()` every column (dashboard/settings/operator) → code. Record the prod deployment id before each phase (rollback = `vercel promote <id>`).

## 5. Renderer and broadcast
- `resolve-output.ts` runs on the operator. It resolves once per send and returns plain values into the **existing** `OutputState` fields (`appearance`, `background`, slide payload). It uses a single atomic state update carrying a `resolveSeq`, and drops stale results (20-rapid-switch test).
- Under the flag, the appearance splits: bg colour goes to the slide-bg row and bg media to the Media (`background`) row. **The legacy `appearance` fields keep being dual-emitted until a dated expiry** (D6). There's a `validateAppearance` old-receiver fixture.
- `slideOutputIdentity` never includes link/rev/overrides/sourceId. There's a test for that.
- A linked-source edit while the song is live is **staged**: "Apply to live now" or "after this item". Applying uses a **cut**, not the transition (fade-pulse rule).
- Never-clip: a linked font change triggers the same refit (`text-fit.ts`, font-cache key) as a manual font change.
- SlideRenderer `url()` sinks (:86/:448/:551/:727) go through `cssUrl()` escaping plus the `render-url.ts` allowlist.

## 6. Three mutual-exclusion sites
`OperatorConsole.tsx:593/:653/:801` are gated **together** behind one injectable helper `composableBgMode()`. Flag off means today's rule at all three (test-locked). Flag on means theme bg colour and Background Template coexist (colour row above Media). The `markThemeBackgroundPicked` stamp stays authoritative for "which media is on the Media row".

## 7. UI
- Two badges only: **Theme** (linked; source name resolved live, "(deleted)" when soft-deleted) and **Custom** (overridden/detached). Each field has Reset. There's a "Why does this look like this?" trace (from `resolve().trace`).
- Apply menu: piece checkboxes. Scope asks "This song only" vs "Change theme (N songs)" (N from `idx_songs_church_theme`). Bulk apply has a **keep/replace** step, a backup, and an **Undo toast**. Link changes have history; Cmd+Z works in the editor.
- Default: **new applies linked, existing songs stay detached** (they classify as detached with no source and render byte-identical).
- PP7-imported songs get a hidden "Imported: <name>" style component. Imports **strip foreign links** and land detached.
- Theme delete: soft delete, a used-by count, and a choice of Detach all / Replace with… / Cancel. Snapshots are written when the link is created.
- Media delete: a used-by warning (themes, songs.default_background_asset_id, logo, templates).
- localStorage Background Templates / custom slide templates **can't be linked until they're saved to the DB** (the button says "Save to library to link").
- Keyboard: no new single-letter keys. **G** (song confirm), Bible nav, **F1–F7/F12** (clear rail), Esc/L/B are all taken. Proposed: Cmd+Shift+L relink, Cmd+Shift+D detach (check against the `keyboard-shortcuts` test).
- a11y: badges have text plus aria-labels, not colour alone. Dialogs use `useConfirm` (Electron-safe; no `window.confirm`).
- Multi-operator: optimistic concurrency on `themes.rev` (compare-and-swap in `patchThemeConfig`/`updateTheme`). The conflict toast offers "reload / overwrite".
- Offline: `themes` + `style_components` + per-song `linkSnapshots` go into the `serviceCache` KV. Edits made offline replay with the rev CAS, and a conflict goes to the toast.

## 8. Flags (server reads its own)
`NEXT_PUBLIC_COMPOSABLE_V1` (kill switch) AND `church_preferences.composable_v1` (per church; the server action reads it and never trusts the client). One injectable `composableEnabled({env, pref})` helper with a 4-cell truth-table test. `layersV2` is no longer part of the gate (it's moot). The "no flips within 48h of a service" rule is a **proposal** (D8).

---

## 9. Phases

### Phase 0: prerequisites (no user-visible change; each item is its own small PR)
0.1 **Golden capture before any code:** for N real-shaped fixture songs (baked, per-slide override, gradient, legacy `#010101`, scripture, image slide, PP7-imported), capture `objects_json`, SlideRenderer HTML, the `OutputState` from `outputStateToLayers` in all 4 modes, and `slideOutputIdentity`. Add these to `test/fixtures/composable-*.golden.json` next to the existing output-plan/dom goldens.
0.2 **Playwright harness:** `playwright.config.ts` with `E2E_BASE_URL` required (no default; **refuses a prod host**), a seeded test church, and a test-DB guard. Not in `ci.txt`. It's a separate manual/preview job.
0.3 **DB-backed theme tests** on a Supabase branch / the CI Postgres (`test/suites/db.txt`): `applyThemeToSong` atomicity (simulate a mid-write failure → rollback), repeated applies keep the first snapshot, `revertSongTheme`, per-slide apply/remove, `reapplyThemeToSongs` paging. (No transaction fix is needed. It's already atomic, §0.1.)
0.4 **Normalizer/save fix:** `normalizeEditableSlide` + `saveSlideObjects` + `EditableSlideInput` pass through `transition`, `bgType`, `bgColor2` (and a validated `links` later). Add an Edit Slide round-trip test (load → save → the golden `objects_json` is unchanged). This fixes the §0.3 live bug.
0.5 **Theme soft delete + used-by:** `deleteTheme` → `deleted_at`, filtered from lists. The used-by count uses the new index. Detach/replace/cancel dialog.
0.6 **Sanitizer + adversarial tests:** one `sanitizeStyle()` used at write AND resolve: hex/rgba colour regex, fontFamily char allowlist, URL allowlist (https + own storage origin; `blob:` in preview only; no `data:`/`javascript:`/`file:`), numeric clamps, enum checks. Plus `cssUrl()` for the SlideRenderer sinks. New tests: `adversarial/composable-cross-church`, `composable-hostile-links`, `composable-output-payload`, `slide-renderer-url-breakout`.
0.7 **Indexes/soft-delete/rev/theme_id migration** (§4), with rollback written first. Backfill `songs.theme_id` as a chunked, resumable server job.
0.8 Record the prod deployment id. Merge in main and the open `propresenter-import-smart-folders` schema changes first.

### Phase 1: provenance only (zero output change)
- `composable.ts` + `splitThemeConfig` + `sanitizeStyle` (pure, tested).
- `applyThemeToSong(s)`/`applyThemeToSongSlides` gain optional `pieces` (default = all = today's bake) and write **provenance links + per-song snapshot** alongside the baked values in the **same transaction**. They also set `songs.theme_id`.
- Every save path asserts ownership of the `sourceId` (reject foreign ids). Links are stripped from every wire payload (output-payload test).
- Renderer ignores links. Goldens are byte-identical with the flag on and off.
- Behind the flag, the partial-apply UI (piece checkboxes) produces the same baked result for the chosen pieces.
- Gate: 6–9 agents. Suites: bible-antireplay + song-switch-hold + output-sanitize + wire-contract-drift, **with the flag on**. Then preview → desktop check → field check.

### Phase 2: linked resolve for text/scripture/transition (Slide layer)
Resolve at send and freeze on live. Badges, Reset/Detach/Relink, staged live edits, rev CAS, offline snapshot, undo history. A classify dry-run for baked songs is **read-only** (reports only).

### Phase 3: background split (Slide-bg colour + Media)
The three mutual-exclusion sites are gated together. `media_assets.settings` is added. Background Templates move to the DB (opt-in save). `setMediaOnActiveTheme` (`theme-quick-apply.ts:92`) must **not** restyle linked songs under the flag: it edits the theme source only, and linked songs pick that up at their next send. Old-receiver dual-emit. OBS alpha check.

### Phase 4: logo Prop unification
Per-church dry-run report of the 3 logo sources → pick canonical (D4) → the resolver reads own-church only.

### Phase 5: message styles, text styles, slide templates to DB. Announcements link to a **preset**.
### Deferred (Victor): Looks per-screen grid (extend Scenes), Announcements layer, generic Props, Mask.

---

## 10. Review findings resolution
| # | Finding (reviewer, tag) | How v2 handles it | Phase |
|---|---|---|---|
| S1 | 🔴 ownership assert on every sourceId/lookId/preset/asset id; resolve filters by session church; RLS only defence in depth | §7/§9 P1 ownership assert on save; resolver loads a church-scoped map only; test `composable-cross-church` | 0.6 / 1 |
| S2 | 🔴 one sanitizer at write + resolve (colour, font, URL, clamps, enums) + CSS-escape url() sinks | `sanitizeStyle` + `cssUrl()` for SlideRenderer :86/:448/:551/:727 | 0.6 |
| S3 | 🔴 no generic deep merge; key allowlist; proto keys; zod; size caps | §2 per-piece allowlist, zod, 256 KB / 50 keys / depth 4 | 0.6 / 1 |
| S4 | 🟡 new tables: FK cascade + index + RLS; imports strip links; media settings whitelisted; logo own-church; nothing over the wire; Looks switch auth-gated; server reads flag | §4, §7, §8. Looks are deferred (Scenes switching is already capability-gated) | 1–5 |
| S5 | adversarial tests (4 named) | Listed in 0.6 | 0.6 |
| P1 | 🔴 split theme bg: colour → bg-colour row, media → Media; decide #010101 | §3 table; D2. Minting already stopped (bgExplicit) | 3 |
| P2 | 🔴 build on shipped pp7 stack / PR #39 | §0.1, §1.1, §3 (derived stack, camera own layer) | all |
| P3 | 🔴 Props = single logo; lower third → slide piece or sign-off | §3; `lowerThird` removed as a piece; D3 | 4 |
| P4 | 🔴 no looks table; extend Scenes; Looks deferred | §4, deferred list | deferred |
| P5 | 🟡 Mask/Screen Color/Audio/Video Input rows, not composable | §3 table | 3 (display) |
| P6 | 🟡 banner → Message style; Announcements deferred | §3 | 5 |
| P7 | 🟡 clears never mutate links; Clear All fixed | Clears act on live state only; `pp7-clear.ts` untouched; test | 2 |
| P8 | 🟡 transition piece Slide only; PR #52 precedence | §2 | 2 |
| P9 | 🟡 stage byte-identical, ignores links | §3 per-output | 2 |
| P10 | 🟡 media_assets.settings source; overrides = PF extension | §3 | 3 |
| C1 | 🔴 theme edit never fans out; bulk classify = chunked resumable job | §1.3. Existing `reapplyThemeToSongs` fan-out kept only for baked songs (D5). Classify is a server job | 2 |
| C2 | 🔴 applyThemeToSong non-atomic | **Stale: already atomic on main** (§0.1). Replaced by the DB test 0.3 | 0 |
| C3 | 🔴 songs.theme_id + (church_id, theme_id) index + idx_themes_church | §4 migration | 0.7 |
| C4 | 🔴 snapshots once per song | §2 `settings.linkSnapshots[sourceId@rev]` | 1 |
| C5 | 🔴 wire carries resolved only; OutputState <32 KB test; dual-emit expiry | §5; size test in `composable-output-payload`; D6 | 1 / 3 |
| C6 | 🟡 resolve sync, pure, preloaded, memoised, <1 ms bench | §2 | 1 |
| C7 | 🟡 single atomic state update with resolveSeq; 20-rapid-switch | §5 | 2 |
| C8 | 🟡 rev CAS | §7 multi-operator | 2 |
| C9 | 🟡 offline cache includes themes/style_components | §7 offline | 2 |
| C10 | 🟡 setMediaOnActiveTheme must not restyle linked songs | Phase 3 | 3 |
| D1 | 🔴 build from this worktree only | Header + §0.7 | — |
| D2 | 🟡 conflicting branches; reconcile DECOUPLING_PLAN + clear rail; layersV2 moot; 48h rule a proposal | §0.7, §0.1, §8, D8 | — |
| R1 | 🔴 normalizeEditableSlide drops links (+ bgImageFrame?) | It drops `bgType`/`bgColor2`/links. `saveSlideObjects` also drops `transition`. **bgImageFrame isn't on main (not a bug)** | 0.4 |
| R2 | 🔴 fade-pulse: resolve once per send, freeze; no re-resolve of live; cut; antireplay + song-switch-hold with flag on | §1.2, §5, P1 gate | 1–2 |
| R3 | 🔴 revert/backups for partial apply + slideThemeBackups well defined | Partial apply reuses the existing first-snapshot backup (the backup covers all theme-owned fields, so it's piece-independent). Link history adds undo | 1 |
| R4 | 🟡 3 sites gated together; old DMG receivers; validateAppearance fixture; OBS alpha; offline snapshot; never-clip refit; logo dry-run; PP imports detached; prod deploy id | §6, §5, §7, Phase 4, 0.8 | 1–4 |
| G1 | 🔴 theme delete soft + used-by + detach/replace/cancel; snapshots at link creation | 0.5, §7 | 0 / 1 |
| G2 | 🔴 live edits staged | §5 | 2 |
| G3 | 🔴 scripture content-type row; styling never alters auto-fire inputs | §1.4, §2 cascade | 1 |
| G4 | 🔴 undo: link history, Cmd+Z, bulk undo toast | §7 | 2 |
| G5 | 🔴 PP7 imports: hidden "Imported: X" component; bulk keep/replace + backup | §7 | 2 |
| G6 | 🔴 per-output resolution; livestream bg transparent | §3 | 2 |
| G7 | 🟡 two badges; live name / "(deleted)"; trace; missing types (timers, captions, video loop/mute/start, shaders, message styling); localStorage templates; clear semantics; canonical logo; multi-op CAS; offline replay; shortcuts; Save-to-all prompt; a11y; media delete warning; announcements → preset; default linked-new/detached-existing | §7 in full. Missing types: timers/captions/shaders are **not composable in v2** (listed out of scope); video settings go in `media_assets.settings` (P3); message styling P5. Media framing (localStorage per machine) noted as a gap | 2–5 |
| E1 | baseline tsc + tests re-checked on main | §0.6 | — |
| E2 | 🔴 Playwright harness | 0.2 | 0 |
| E3 | 🔴 golden capture before Phase 1 | 0.1 | 0 |
| E4 | 🔴 DB-backed theme tests on a Supabase branch | 0.3 | 0 |
| E5 | 🟡 4-cell flag table; Edit Slide round-trip; hardware rows manual | §8, 0.4, §11 | 0–1 |

## 11. Test matrices

### P1/P2 matrix (automated unless marked M = manual field check)
| Path | Flag off | Flag on | Kind |
|---|---|---|---|
| Baked song renders identical (goldens) | = | = | golden |
| Edit Slide load→save round-trip | = | = + links kept | unit |
| applyThemeToSong / revert / per-slide / reapply | = | + links, snapshot, theme_id | DB |
| Partial apply (text only) | n/a | only text keys change | unit+DB |
| slideOutputIdentity excludes link/rev | = | = | unit |
| OutputState has no links/sourceId; <32 KB | = | = | unit |
| bible-antireplay, song-switch-hold, service-mode | pass | pass | unit |
| Transition precedence (resolveSendTransition) | = | = | unit |
| Theme edit while song live → staged, no pulse | n/a | staged; cut on apply | unit + M |
| 20 rapid theme switches → last wins (resolveSeq) | n/a | pass | unit |
| Cross-church sourceId rejected | n/a | reject | adversarial DB |
| Hostile links JSON (proto, huge, deep, js: URL) | n/a | rejected/sanitized | adversarial |
| Old-receiver fixture (legacy appearance only) | = | = | unit |
| Template + theme bg (3 sites) | today's rule | coexist | unit + M |
| OBS alpha / NDI transparent | = | = | unit + M |
| Camera + media (PR #39) | = | = | M (real camera) |
| Never-clip on linked font change | n/a | refit | unit + M |
| Offline: snapshot resolves with network off | = | = | M |
| Multi-operator rev conflict | n/a | toast | DB |

### Tester break list (hand to Victor/testers on preview)
1. Apply a theme to a song, open Edit Slide, change one word, save. The look must not change.
2. Delete a theme that 10 songs use. You should get the dialog, songs still render, and "(deleted)" shows.
3. Edit a linked theme's font while its song is live. The projector must not change until you choose "Apply to live". No fade flicker.
4. Two laptops edit the same theme at once. One gets the conflict toast and nothing is lost.
5. Put a Background Template and a coloured theme on together with a camera live (flag on). The order should be camera < media < colour < words.
6. Livestream/OBS with a transparent key. There should be no background or logo bleeding through.
7. A preacher repeats the on-screen verse and a song is detected mid-restyle. Auto-fire behaviour should be unchanged.
8. Import a ProPresenter song. It arrives detached and looks identical.
9. Pull the network, reload, and project a linked song. It should render from the snapshot.
10. Bulk-apply a theme to 200 songs, then Undo. Every song should come back.
11. Delete a media asset a theme uses. You should get a warning first.
12. Paste a theme JSON with `javascript:`/`data:` URLs or `__proto__`. It should be rejected.

---

## 12. Decisions needed from Benji/Victor (recommended default in bold)
1. **Default link mode:** **new applies linked, existing songs stay detached** (no migration of baked songs).
2. **Black-guard semantics after the bg split:** **keep `bgExplicit` as the "chosen" signal; legacy `#010101` reads as explicit black; never mint `#010101` again.**
3. **Lower third / generic props:** **no generic props (Victor 2026-09-18). Lower third stays a Slide-layer theme style (scripture `lowerThird` layout). Anything more needs a new sign-off.**
4. **Canonical logo source:** **`churches.logo_s3_key`**, after a per-church dry-run that shows where the 3 sources disagree. Proposal only.
5. **Theme edit → baked songs:** **keep today's `reapplyThemeToSongs` for baked/detached songs (signed off in PR #48); linked songs update on their next send, with no fan-out.**
6. **Dual-emit expiry for legacy `appearance` fields:** **keep until every active desktop reports a build ≥ the Phase 3 release, and at least 30 days.**
7. **Live edit of a linked source:** **stage it; default to "after this item"; "Apply to live" uses a cut.**
8. **Flag flip rule:** **no per-church flips within 48h before a scheduled service** (a proposal; needs sign-off).
9. **localStorage Background Templates → DB:** **opt-in "Save to library" per template; never migrate automatically.**
10. **Announcements styling:** **link to `announcement_presets`, not to themes.**
11. **Looks:** **stay deferred (Victor). When revived, extend Scenes `config`; no new table.**
12. **Keyboard shortcuts for detach/relink:** **Cmd+Shift+D / Cmd+Shift+L, no single-letter keys.**

---

## Addendum A — Victor's ProPresenter reference videos (2026-09-23 23:02 + 23:12)

Source: `~/presentflow-layering-brief/` (brief + 6 frames) and the original recordings (Messages attachments `Screen Recording 2026-09-23 at 23.02.24.mov` / `23.12.42.mov`). Independently re-transcribed with whisper.cpp (small.en) and frame-checked every 4s: brief transcript is ACCURATE. A third recording (22.12.43) is unrelated (Bible projection-speed comparison vs JPD livestream).

### Corrections to the brief (from the raw frames/audio)
1. **Theme bg is NOT a separately-clearable third layer.** In the video the JPD (black) theme bg belongs to the SLIDE: "I press the slide, the slide goes over the image; I clear the slide, the image shows." Clearing the slide removes text AND its theme bg together. Correct PP7 model = Media layer (bottom) + Slide layer (theme bg colour + text, bg colour drawn ABOVE media since 7.11). Brief criterion 2 ("three independent layers") is restated below.
2. **"Even when I clear the image, it doesn't show"** describes the CORRECT PP7 behaviour (clear media → image gone), not a PresentFlow bug quote. The PresentFlow clear bug is real anyway (see A.3 row 5).
3. **Frame 00:04–00:08 of 23.12:** Victor right-clicks the slide → "Remove Action: Screenshot…png" — the PP7 slide had a MEDIA ACTION attached. PP7's way of coupling media to a slide is a slide action that fires the Media layer (still a separate layer), never baking the image into the slide bg. Brief omitted this.
4. New-presentation dialog (23.02, frames 1–7): Theme picker is a thumbnail grid of real themes incl. a transparent/none theme, plus Size/Library/Playlist.

### A.1 Acceptance criteria (corrected, 1:1 PP7)
- AC1 New songs/slides default to TRANSPARENT slide bg unless a theme is chosen; transparent shown as checkerboard in thumbnails + editor.
- AC2 New-song dialog: real theme picker (specific theme / current global default / none=transparent).
- AC3 Single-click media in the bin → MEDIA LAYER (persistent background), persists across slide advances until Clear Media. Never becomes the slide.
- AC4 Output order bottom→top: Media → Slide (theme/slide bg colour, then text). An OPAQUE slide/theme bg covers media; a transparent slide shows media through. Clear Slide reveals media.
- AC5 Clear Slide and Clear Media are independent and each reliably removes only its layer from /live, /stage, /livestream, NDI.
- AC6 No welding: media never written into slide bgImageUrl or theme config by a click/drag (explicit editor "slide background image" remains a deliberate, labelled design choice).
- AC7 Slide media action: a slide can carry a media action that fires the Media layer when triggered (coupled, but still its own layer; removable = decouple).

### A.2 Main today vs criteria (fact-traced on origin/main 89dc2dde)
| AC | Verdict | Evidence |
|---|---|---|
| 1 | FAILS | `schema.ts:613` bg_color default `#000000`; `actions.ts:1442`; renderer treats #000 as unset → theme or black (`SlideRenderer.tsx:58-62,327,363,556`) |
| 2 | FAILS | `SongsBrowser.tsx:877,968-977` hardcoded Default/Dark/Light/Brand → localStorage key nobody reads (`:909-912`); `createSong` `actions.ts:642` stores no theme |
| 3 | FAILS | click → `sendLive` → `toSlide` media-as-slide (`MediaBrowser.tsx:320-336,724-735`; `MediaBinSection.tsx:180-196,584-600`); only the separate "Bg" button uses `setMediaAsBackground` |
| 4 | PARTIAL/inverted | active template forces slide bg transparent (`output-plan.ts:215`, `output-layers.ts:242-244`, `SlideRenderer.tsx:363,547-556`) — opposite of PP7; mutual exclusion `OperatorConsole.tsx:585-594,644,791` |
| 5 | FAILS | `clearMedia` (`OperatorConsole.tsx:2066-2069`) clears the SLIDE; background template not cleared by Clear Media; `clearSlide` (`:2065`) only clears staged items |
| 6 | FAILS | `MediaBinSection.tsx:202-217` setCurrentSlideBg welds bgImageUrl; `setMediaOnActiveTheme` (`MediaBrowser.tsx:924,934`, `LayersPanel.tsx:370`) writes into theme |
| 7 | PARTIAL | slide actions exist; `SET_BACKGROUND_MEDIA` → `setMediaAsBackground` (`OperatorConsole.tsx:1860-1872`); `songs.default_background_asset_id` (`schema.ts:227`) never read at fire time |
| 8 | PARTIAL | checkerboard only in editor/ThemePopover/MultiView, not slide thumbnails (`ThemedSlideCard.tsx:43-46`) |

### A.3 Impact on phases
Victor's videos make the MEDIA LAYER + CLEARS the core, user-visible ask. Re-order:
- Phase 0 unchanged (golden capture, harness, sanitizer, normalizer fix, soft-delete, indexes).
- **NEW Phase 1 = "Layer truth" (AC3, AC4, AC5, AC6)**, behind a per-church flag `pp7_media_layer`:
  media click → Media layer cue (reuse BackgroundSpec/`setMediaAsBackground` machinery, linked to media_assets id, no copy); Clear Media clears the Media layer only; Clear Slide clears the slide only; slide bg colour draws above media (retire `overVideo` suppression + the 3 mutual-exclusion sites under flag); remove welding paths under flag (setCurrentSlideBg, setMediaOnActiveTheme → Media-layer cue instead). Previews (LiveOutputThumb, LivePreviewPanel) and /live, /stage, /livestream, NDI all driven from the same compositor.
- **NEW Phase 2 = "Transparent by default + theme at creation" (AC1, AC2, AC8)**: new slides store a transparent sentinel (existing `#000000` rows unchanged — no data rewrite); new-song dialog uses real themes + "None (transparent)" + "Current default"; checkerboard in thumbnails.
- **Phase 3 = old Phase 1+2** (links/pieces/linked mode) and AC7 (slide media action + song default background read at fire time).
- Later phases unchanged.

### A.4 New regressions to guard (added to §8)
- Operators who rely on single-click "media goes live as a slide" (announcement images, sermon graphics shown full-screen WITHOUT lyrics) — with Media layer, a clicked image with no slide live looks identical; with a slide live it now sits UNDER the slide instead of replacing it. Needs explicit sign-off + an operator-visible hint; keep "Send as slide" in the right-click menu.
- Opaque theme bg now COVERS an active Background Template (PP7). Churches currently using a shader template + a theme with a bg would see the template disappear behind the theme colour. Mitigation: theme "background: none" option (AC1 transparent) and a one-time diff check per church before flag flip.
- Livestream/OBS alpha: media layer must stay OFF the livestream alpha output unless routed (existing behaviour).
- AI auto-fire (bible/song) sends slides; with a media layer beneath, lyric/verse contrast over images needs the existing auto-contrast/scrim.

### A.5 Decisions added
13. Single-click media = Media layer (PP7), "Send as slide" moves to right-click. [Recommended: yes — it is Victor's explicit ask.]
14. Opaque theme bg covers background media (PP7 7.11). [Yes; transparent theme option provided.]
15. Existing songs keep their current black/theme look; only NEW songs default transparent. [Yes — no data rewrite.]

### A.6 New-song dialog spec (user screenshot 2026-09-24, PP7 "New Presentation")
Build 1:1 with the PP7 dialog: Filename field (focused), **Theme** = thumbnail preview (default = transparent checkerboard) with a ▾ that opens a thumbnail grid of the church's themes (+ "None (transparent)", "Current default"), **Size** select (1920x1080 default), **Library** select (Default), **Playlist** select (No Playlist / service plans), Cancel + New (primary). Replaces the hardcoded Default/Dark/Light/Brand select in SongsBrowser.tsx (~877,968-977) whose localStorage value nothing reads; chosen theme must be persisted on the song (applyThemeToSong / songs.settings.appliedThemeId path) and a "None" choice leaves slides transparent. Imports: slides transparent; theme changeable afterwards via existing apply-theme menu.

### A.7 Theme picker popover spec (user screenshot 2026-09-24, PP7 "Themes" popover)
The ▾ next to the Theme thumbnail opens a popover anchored to it (arrow pointing at the ▾): header "Themes" with a media/image icon button at right; a **Recents** section (last ~3 used, selected one outlined in blue) divided by a rule from the full grid of ALL church themes; 3-column grid of 16:9 live-rendered thumbnails (transparent themes show checkerboard; real bg/text/decor rendered), each with a coloured dot + theme name below; current selection has a thick blue outline; scrolls vertically; click selects and closes, updating the dialog thumbnail. Reuse the existing ThemePopover / theme thumbnail renderer if present (ThemePopover.tsx already has a checkerboard swatch) rather than a new renderer. Recents persisted per-user (localStorage acceptable).
