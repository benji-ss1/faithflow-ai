# Groups & Arrangements — Operator Shell (wave 6D) — as-built

The engine + backend for Groups & Arrangements landed in commit `d7a4917`
(song_groups / song_arrangements / `payload.arrangementId`, `expandArrangement`,
11 CRUD actions, the song-page editor). That work was invisible to the operator.
This wave surfaces the whole model in the operator so it can be **seen and driven**
during a live service. Changelog `0.1.392`.

## What shipped

1. **Loader carries the model** — `getExpandedServicePlan` (`src/lib/server/services.ts`).
   `ExpandedItem` gained four optional fields, populated **only** for song items
   that actually use groups (groupless songs get `undefined` everywhere → byte-
   identical output to before, the no-regression line):
   - `arrangementId?` — the pinned arrangement id **when it resolved** (undefined
     for master, or when a stale pin fell back to master).
   - `arrangements?` — all of the song's arrangements (for the playlist picker).
   - `groups?` — group meta (`id/name/kind/color/order`) for chip + badge colours.
   - `slideGroupIds?` — per-slide group id, aligned 1:1 with `slides` (null =
     ungrouped). Round-trips both the arranged path (from `expandArrangement`'s
     `SlideRef.groupId`) and the master/slideOrder path (from the ordered rows).
   Groups + arrangements are loaded **once** per song item (removed the arranged-
   path's separate query).

2. **Group badges on slide thumbnails** — `SlideGrid.tsx`. Each card renders a
   small colour-coded chip (top-left, beside the slide number) with the group
   name, derived from `slideGroupIds` + `groups` via `groupColor()`. Additive
   chrome; nothing renders for a groupless song.

3. **Arrangement strip in the centre** — new `center/ArrangementStrip.tsx`,
   mounted above `SlideGrid` in `ProOperatorShell` (slides mode only). Shows the
   arrangement's group sequence as coloured chips (pinned name, else "Master"),
   highlights the block containing the current preview slide, and **click-jumps**
   to a block's first slide (preview-only, via `ctx.onJumpSlide`). When an
   arrangement is pinned it also offers **live add** ("+" → group popover) and
   **live remove** ("×" per chip), persisting through `reorderArrangement` +
   `router.refresh()`. An "Edit" affordance opens the full editor (song page, v1).
   Block computation is a pure, unit-tested helper: `src/lib/arrangement-strip.ts`
   (`computeArrangementBlocks` / `blockAtSlide`) — handles repeated groups
   (one chip per order entry) and master coalescing.

4. **Arrangement picker in the playlist** — `left/PlaylistSection.tsx`. A song
   item's context menu gains an **"Arrangement ▸"** submenu ("Master (all
   sections)" + each arrangement) when the song has arrangements; selecting calls
   `setServiceItemArrangement` then `router.refresh()`. The row shows a small
   arrangement tag when pinned. This enables the **same song twice with different
   orders** — add the song twice, pin different arrangements, and each item's
   slides differ per its order.

## Live-safety guard

Add/remove/pin only mutate plan **data** and reflow the preview/grid via
`router.refresh()`. The live projector is a separate broadcast that is untouched
until the operator sends a slide — so a currently-live slide is never disturbed
by an arrangement edit. Verified: live output stayed IDLE across add/remove/pin.

## Verification (browser, dev :3005)

Seeded Adonai with groups Verse(2)/Chorus(3)/Bridge(2) and arrangements
`Full Set` (V,C,B,C) + `Reprise` (C,B), then in the operator:
- badges render on every slide (Verse/Chorus/Bridge) ✓
- master strip renders with V/C/B chips, active chip highlighted ✓
- right-click → Arrangement → "Full Set" pinned: slides reflowed 7 → 10 with the
  **Chorus block appearing twice** (same song, different order) + row tag ✓
- clicking the 2nd Chorus chip jumped selection to slide 8 (start of the repeated
  block) ✓
- "×" on the 2nd Chorus chip removed that instance live → back to 7 slides, live
  output undisturbed ✓
- "+" shows the colour-coded Add-group popover ✓

## Tests

- `test/arrangement-strip.test.ts` — new, pure block logic (7 cases: pinned
  repeats, consecutive repeat, ghost group skip, master coalesce, nulls,
  `blockAtSlide` range).
- `test/arrangements.test.ts` — existing engine tests unchanged.
- `tsc` clean for all files in this change.

---

## Wave 6G — Full section/arrangement management for EVERY song, in the shell

Field rec12: "there should be arrangements for everything… where's Add group?
how do I make this the bridge?" Operators could only see/drive arrangements on
the one seeded song, and had to visit the song library page to create groups.
6G brings the whole workflow into the operator shell for any song.

### What changed

1. **Strip for every song (honest empty state).** The loader
   (`src/lib/server/services.ts`) now carries `groups` / `arrangements` /
   `slideGroupIds` meta for EVERY song item, not only ones that already use
   groups (empty arrays for a fresh song). `ArrangementStrip` renders for any
   previewed song: with no sections it shows "No sections yet — add sections…"
   plus an **Add sections** CTA; with sections it shows the chips as before. It
   still renders nothing for non-song items (no-regression), and the SlideGrid
   badge chips still hide themselves when `groups.length === 0`, so a groupless
   song is visually identical to before.

2. **Per-slide Section assignment (SlideGrid right-click).** The slide card
   context menu gains an additive **Section ▸** submenu: assign to an existing
   group, one-tap create+assign a standard section (Verse 1/2/3, Chorus,
   Pre-Chorus, Bridge, Intro, Tag, Ending) via `createSongGroup` +
   `assignSlidesToGroup`, or clear to Ungrouped. Badge + strip refresh live.
   Purely additive to the menu (6C/6D also touched this file).

3. **Inline manager popover.** The strip's **Manage sections** / **Add sections**
   button opens the full `SongArrangements` editor in a Radix popover (compact),
   reused directly instead of linking to `/library/songs/[id]`. A new optional
   `onChanged` prop on `SongArrangements` fires after each successful mutation so
   the shell calls `router.refresh()` and the grid/strip reflow live.

4. **Quick-edit section-wipe mitigation.** `updateSongSlides` used to drop every
   slide's `group_id` on its delete+reinsert. It now preserves group ids **by
   index when the slide count is unchanged** (pure helper
   `src/lib/song-group-preserve.ts`), so an in-place text edit keeps sections.
   When the count changes (line added/removed) it can't match positionally, so
   slides come back ungrouped — surfaced as a small ⚠ warning affordance in the
   strip (no silent data loss).

### Tests
- `test/song-group-preserve.test.ts` — new, pure index-match preservation (6
  cases: equal-count carry, grew→null, shrank→null, no-prior-groups no-op,
  empty, no-mutation).
- `test/arrangement-strip.test.ts` — converted off the (uninstalled) `vitest`
  import to the repo's `node:test` runner via a tiny local shim; same 7 cases.
- `test/arrangements.test.ts` — unchanged, still green. `tsc` clean.

### Concurrency
- Stayed out of LayersPanel / VerticalClearRail (agent 6F) and
  MediaBinSection / DesktopSlideEditorModal (agent 6E). SlideGrid edits are
  additive context-menu entries only.
