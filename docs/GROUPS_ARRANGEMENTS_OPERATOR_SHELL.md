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
