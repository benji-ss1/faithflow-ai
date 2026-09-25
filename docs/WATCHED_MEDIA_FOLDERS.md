# Watched media folders (PP7 "Smart Playlist") — plan + decisions

Status: **plan**, written 2026-09-25 before any code.
Supersedes the open question left in `docs/SMART_FOLDERS.md:26-29`.

## What PP7 actually does

Verified 2026-09-22 against Renewed Vision's docs and restated in this repo's
own spec (`docs/PROPRESENTER_MVP_SPEC.md`, "12. MEDIA SYSTEM"):

> **Smart Playlist**: watches an OS folder; any file added to that folder
> appears instantly in ProPresenter

It lives only in the Media Bin / Audio Bin, is recursive, is read-only inside
PP7 (you add and remove files in the OS, not in the app), and covers media and
audio — never songs or presentations.

This is a **different feature** from the rule-based smart folders shipped on
2026-09-22. That one is a PresentFlow original. This one is the PP7 feature.

---

## Decision 1 — synced to S3, NOT referenced from local disk

**Decided: sync into `media_assets` as ordinary rows, uploaded to S3.**

This was the open question. It is now settled by evidence, not preference.

A local-disk reference **cannot reach any output**:

1. Every media URL on an output is minted server-side from S3
   (`presignGet(m.s3Key)`, `src/app/api/media/list/route.ts`). There is no code
   path that produces a URL for a non-S3 asset.
2. The output URL sanitiser **rejects `file:` outright**. Measured directly
   against the real `src/lib/render-url.ts`:

   ```
   file:///Users/me/clip.mp4    clean=null  renderable=false
   file://C:/media/bg.jpg       clean=null  renderable=false
   /Users/me/clip.mp4           clean=null  renderable=false
   https://example.com/a.jpg    clean="https://…"  renderable=true
   ```

   `isRenderableUrl` gates every media URL rendered on `/live`, `/stage`,
   `/livestream` and `/ndi`.
3. Outputs are genuinely other windows, and often other **devices** — a
   projector subscribing over Supabase Realtime (`src/lib/realtime.ts`) has no
   access to the operator's filesystem and no session to re-mint anything.

So local referencing would need a second, parallel media pipeline plus a
sanitiser exception. That is a large change that weakens a security control,
to save an upload. Not worth it.

**Cost of the chosen design, stated honestly:** a watched folder uploads its
contents, so it consumes storage and takes upload time on first sync. That is
the price of the projector working.

## Decision 2 — a new `kind`, not a reuse of `'smart'`

`libraries.kind` gains `'watched'`. It must NOT reuse `'smart'`, because the
smart-folder invariant is *"NOTHING is ever written to a content row's
library_id"* (`src/lib/db/schema.ts`) and a watched folder does exactly that —
its files are real `media_assets` rows carrying a real `library_id`. Reusing
the kind would break that invariant and the `listMedia` short-circuit.

Because the rows are ordinary, **every downstream consumer is untouched**: the
existing library index, ordering, thumbnails, drag-to-playlist, send-to-live
and all four outputs work with no change.

The folder path goes in a new `watch_path` column, not in `rules` — `rules` is
typed and validated as `SmartRules`, and smuggling a path through it would
defeat that validation.

## Decision 3 — a vanished file is UN-FILED, never deleted

PP7 removes a file from the playlist when it leaves the folder. We match that
**visible** behaviour without destroying anything: the asset's `library_id` is
set to NULL, so it drops out of the watched folder and falls back to the
Default bucket. The media itself is untouched.

Hard-deleting would be genuinely dangerous — `deleteMediaAsset`
(`src/lib/actions.ts`) also **deletes service-plan items**:

```sql
DELETE FROM service_items si USING service_plans sp
 WHERE … si.type = 'media' AND si.payload->>'mediaAssetId' = $1
```

and `songs.defaultBackgroundAssetId` would be nulled, while themes, slide
objects and announcement presets hold **stringly-typed key references with no
FK at all** (`src/lib/server/media-dedupe.ts`) that nothing would repair.

A USB drive unmounted mid-service must not destroy a service plan. So:
un-file, never delete.

## Decision 4 — renderer-driven, no new dependency

The main process **cannot register media**: it has no HTTP client to the app
API and no session cookie — every upload rides the renderer's cookie. So the
sync must run in the renderer, and it reuses primitives that already exist:

| Need | Already exists |
|---|---|
| pick a folder | `dialog:openDirectory` (also authorises the path) |
| list it | `fs:readDirRecursive` — bounded walk, symlink-safe |
| read bytes | `fs:readFile` |
| upload | `uploadMediaFile()` — presign → S3 PUT → `registerMediaAsset` |

No `chokidar`, no new dependency, no main-process file watcher. Sync is a
**reconcile** (list the folder, diff, act) rather than an event stream: it is
simpler, self-healing, and cannot miss an event.

## Known limits — stated up front, not discovered later

- **The path lives on the library row, so it is church-wide.** On a different
  machine that path usually does not exist; sync there is a no-op with a clear
  "folder not found on this computer" message. The *media* is still shared,
  because it is in S3 — only the *syncing* is local. A per-machine path would
  need a second store; not worth it for v1.
- **Not instant.** PP7 says files appear "instantly". This reconciles ONLY when
  the operator presses **Sync now** — there is no filesystem event and no
  sync-on-open. Honest wording in the UI: "Sync now", not "live". An earlier
  draft of this doc claimed a sync-on-open that was never built; the review
  caught that the UI copy had inherited the same overstatement.
- **The Electron path allowlist is session-scoped** and cleared on quit
  (`electron/ipc/fs.ts`), so after a restart the folder must be re-picked
  before the first sync. Persisting a re-grant across restarts would hand the
  renderer read access to a whole tree with no fresh dialog — a security
  decision that deserves its own sign-off, so v1 does not do it.
- **Audio** is excluded for now: `listMedia` already filters audio out of every
  surface except the Media Bin.

## Test plan

- Pure reconcile logic (what to add, what to un-file) unit-tested with no FS.
- `render-url` rejecting `file:` — currently **untested**; add it, since it is
  the control this whole decision rests on.
- Adversarial: a watched library in church A must never sync into church B.
- No-regression: manual and smart libraries behave exactly as before.

---

## Review findings (2026-09-25) — what changed after the build

Two independent adversarial reviewers ran per NO_BS rule 5. Both found real
defects. The most serious were mine, and are worth recording.

| | Finding | Fix |
|---|---|---|
| 🔴 | **The feature did not work at all.** `MediaBrowser` filtered its library list to `kind === "manual"` and then searched that same list for a watched one — so the Sync button could never render and the drop guard never fired. | `libs` holds every library; a separate `moveTargets` filters to manual for the "Move to library" menu only. This also fixes the same latent bug for smart folders. |
| 🔴 | **`fs:readDirRecursive` does not return an array on failure.** It resolves to `{ ok:false, error, entries: [] }` when the path is not authorised — which is the state after *every* restart. The `try/catch` never fired, `reconcile` threw `TypeError: disk is not iterable`, and `runWatchedSync` had no `catch`: a spinner that stopped with nothing said. The ambient type in `src/types/electron.d.ts` declares only the array, so TypeScript could not catch it. | `Array.isArray` guard plus a real `catch`. |
| 🔴 | **A truncated listing would un-file the whole folder.** The walker swallows per-directory read errors and stops silently at its depth/entry caps, so a permission-denied subfolder or a half-mounted drive returns a short list — which read as "everything vanished", mid-service. | Un-filing is refused when the listing looks implausible (nothing on disk, or >50% vanishing at once). Uploads still proceed; only the destructive half is held, with a message saying so. |
| 🔴 | **"Self-healing" was false.** Un-filing cleared `sourceRelPath`, erasing the reconcile identity — so replugging a drive re-uploaded every byte as new assets while the originals sat stranded in Default, and service items still pointed at the old ones. | `sourceRelPath` is kept, and `refileReturnedWatchedAssets` returns a recognised file to its folder instead of duplicating it. |
| 🔴 | **The copy claimed automatic sync** — "appear here automatically", "appears by itself", "without importing anything by hand" — breaking the rule *this document itself wrote* three sections above. An earlier draft also claimed a sync-on-open that was never built. | All user-facing strings now say Sync now. The doc's own false claim is corrected above. |
| 🟡 | Unicode **NFD vs NFC** (macOS stores decomposed) and **case-only renames** each made the same file look new — re-uploading it on every single sync, forever. | `relPathKey()` folds both for comparison while the operator's own spelling is what gets stored. Test-locked. |
| 🟡 | Raw `Error.message` leaked into operator toasts; a server failure was labelled a folder problem; an un-file failure was swallowed and reported as "up to date"; no progress on a long first sync; the error told operators to re-pick a folder the UI offered no way to re-pick. | All fixed — including a "Choose folder…" item on a watched row, which is also the supported way back after a restart. |

Confirmed clean by the security reviewer, having actively tried to break them:
cross-church writes and un-files (church **and** library scoped, `kind` re-verified
server-side), `sourceRelPath` injection/traversal (never touches the filesystem;
reads are gated by the Electron session allowlist), and data loss (nothing in
the feature can delete a `media_assets` row or cascade to `service_items`).

### Known, accepted, not fixed

- **No uniqueness on `(library_id, source_rel_path)`.** Two simultaneous syncs
  could both upload the same file. Needs a unique index and a decision about
  what to do with the loser; not worth blocking on for a feature only one
  machine syncs at a time in practice.
- **Two libraries may watch the same folder, or nest.** Each uploads its own
  copy. No containment check.
- **`watchPath` is returned by `listLibraries`**, which needs only `requireUser`,
  so any church member can see the operator's folder layout (often containing
  the OS username). Low severity, but new surface.
- **Rolling the migration back drops `source_rel_path`**, so a rollback-then-
  re-apply re-uploads the whole folder as duplicates.
- **`atob()` on a 50 MB file** is a ~250 MB transient on the renderer that is
  also driving live output. Fine for images, heavy for video.
