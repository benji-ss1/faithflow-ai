# Smart Folders & Smart Playlists

> ## ⚠️ Important correction: this is NOT what ProPresenter calls a Smart Playlist
>
> Researched 2026-09-22 against Renewed Vision's own support docs, and
> independently confirmed by **this repo's own spec**
> (`docs/PROPRESENTER_MVP_SPEC.md:427`, written well before this feature):
>
> > *"**Smart Playlist**: watches an OS folder; any file added to that folder
> > appears instantly in ProPresenter"*
>
> In ProPresenter 7, a "Smart Playlist" is an **OS folder watcher** (formerly
> "hot folder") that lives **only in the Media Bin / Audio Bin**. It has **no
> rule builder at all** — the only "rule" is a folder path. It is recursive,
> live-updating, read-only inside PP7, can sit inside a Playlist Folder, and
> covers **media and audio only** — never songs or presentations. PP7 has no
> "Smart Folder" in its own terminology.
>
> **So the rule engine documented below is a PresentFlow original — a superset,
> not PP7 parity.** It is genuinely more powerful (PP7 cannot express "every
> song added in the last 30 days"), and it does copy the PP7 *behaviours* that
> matter: auto-populating, live, read-only, refuses drops. But nobody should
> justify or describe it as "what ProPresenter does".
>
> **The actual PP7 feature — a folder-watching media playlist — is NOT built.**
> It needs Electron filesystem watching plus a decision we have not made: does
> watched media get uploaded to S3 (so other devices and the projector can see
> it) or referenced locally (fast, but breaks cross-device output)? That
> decision should be made before it is built. Tracked, not started.

A **manual library** owns its membership: each song / media row carries a
`library_id`, set by dragging it in.

A **smart folder** owns nothing. Its contents are computed at query time from a
rule set. That single design decision is why it is safe:

- it can never drift out of sync with its rules;
- deleting one can never orphan content (it has no membership rows);
- rolling back the migration turns it into an empty manual library and
  **no song or media row is touched**.

## Where the pieces live

| Concern | File |
|---|---|
| Rule types, validation, SQL compilation (pure) | `src/lib/smart-folders.ts` |
| Query-time resolution | `src/lib/server/services.ts` → `resolveSmartFolder`, `listSongs`, `listMedia` |
| Actions + counts + write guard | `src/lib/actions.ts` → `createSmartFolder`, `updateSmartFolderRules`, `countSmart`, `libraryMoveError` |
| Rule editor UI | `src/components/operator/pro/left/SmartFolderDialog.tsx` |
| Rail integration | `src/components/operator/pro/left/LibrarySection.tsx` |
| Smart PLAYLIST synthesis | `src/lib/server/services.ts` → `synthesizeSmartPlanItems`, `getExpandedServicePlan` |
| Smart playlist actions | `src/lib/actions.ts` → `createSmartPlaylist`, `updateSmartPlaylistRules` |
| Playlist rail gating | `src/components/operator/pro/left/PlaylistSection.tsx` (`isSmart`) |
| Migration | `docs/migrations/2026-09-22-add-smart-folders.sql` |
| Tests | `test/smart-folders.test.ts` (18) |

## The rule model

```ts
{ match: "all" | "any", rules: [{ field, op, value? }] }
```

Fields are a **whitelist** per target (`songs` / `media`) in `SMART_FIELDS`.
Operators are constrained by the field's kind (text / enum / number / date).
Max 12 rules.

## Security properties (these are the load-bearing ones)

1. **A user-supplied `field` can never reach SQL.** It is looked up in
   `SMART_FIELDS`; an unknown key fails closed and the rule is dropped. The
   only thing passed to `sql.raw()` is the whitelisted column name and a table
   literal supplied by our own caller.
2. **Every user VALUE is a bound parameter.** Verified against the real
   compiled query, not by inspecting internals — a `%'; DROP TABLE songs; --`
   title rule compiles to `("songs"."title"::text ILIKE $1)` with the payload
   in `params`.
3. **church_id is always `and()`-ed on**, in the folder lookup, the content
   query and the count query (CLAUDE.md rule 5). The rule predicate is a
   *content* filter only and is never the tenant boundary.
4. **Validation runs on read as well as write**, because the rules column is
   jsonb that an older or newer app version may have written.

## Two deliberate design choices worth knowing

**An empty rule set matches NOTHING, not everything.** `compileRules` returns
`null` and the callers return `[]`. Treating "no predicate" as "no filter"
would show the church's entire library inside an empty smart folder — exactly
the kind of confident wrongness this codebase avoids.

**Smart folders refuse content writes at the server**, in `libraryMoveError`
(the shared chokepoint behind `setSongLibrary`, `setMediaLibrary` and
`registerMediaAsset`). A stored `library_id` pointing at a smart folder would
be invisible inside it *and* would vanish from the Default bucket. The UI
refusal — the row does not arm on drag-over, and the "Move to library" menus
omit smart folders — is affordance, not the boundary.

## Deploy order (required)

Apply `docs/migrations/2026-09-22-add-smart-folders.sql` **before** the app
code deploys. Drizzle's `db.select()` lists every schema column, so the app
errors on `libraries` reads if `kind` / `rules` are missing. The migration is
additive and idempotent; existing rows default to `kind='manual'` with empty
rules, which is byte-for-byte today's behaviour — so the migration alone
changes nothing until the new code ships. Rollback SQL is at the bottom of the
file and was written first.

## Known limits / not yet done

- **Rules are authored against the SONGS field set.** A smart folder applies
  its rule set to media too (by field name), so a media-only field cannot be
  targeted from the current editor. A per-folder `target` column is the clean
  fix if churches ask for media-specific folders.
- **No nesting.** `libraries` has no `parentId`; smart folders are flat, like
  manual ones.
- **Counts cost one query per smart folder** in `listLibraries`. Fine at the
  handful of folders a church actually creates; revisit if that grows.
- **Not field-tested with a real church yet.** The rule engine is unit-tested
  and the query path is typechecked and built, but no Sunday has run on it.

---

## Review gate (2026-09-22)

Three independent adversarial reviewers (security, no-regression, correctness)
ran in parallel per CLAUDE.md rule 2. Findings and disposition:

### Fixed in this change

| | Finding | Fix |
|---|---|---|
| 🔴 | **Manifest parser DoS, empirically reproduced.** The depth caps were reset to 0 on every re-entry, so they bounded each call but not total work (O(n·depth²)). A 57 KB deflate-bomb blocked the synchronous pipeline for ~50 s. | One shared `MAX_STEPS` budget threaded through every helper, honest `depth + 1`, a 2 MB manifest cap, and a 4 KB cap on `asText`. Re-measured: the 12,930 ms case is now **0 ms**, the 3,100 ms case **23 ms**. |
| 🔴 | A folder could be **saved with no usable rule** (the seeded blank row is dropped server-side) and reported success — a permanently empty folder with no diagnostic. | The dialog now validates with the *same* `validateRules` the server uses and refuses to save, naming the incomplete rules. |
| 🔴 | Changing a rule's **field kept the stale value** (`Title contains "christmas"` → `Date added`), so the rule was silently dropped — quietly emptying a folder that used to work. | `setRule` clears `value` when `field` changes. |
| 🟡 | A smart row returned from `dragover` **before `preventDefault()`**, so the browser build **navigated the operator console away** to the dropped file. | `preventDefault()` + `dropEffect = "none"`. |
| 🟡 | One manifest reordered **every** container in a multi-playlist drop, scrambling the second service. | Manifests are keyed per container; `playlist` is only reported for a single-container drop. |
| 🟡 | Numeric `is`/`isNot` compared as **text** while `gt`/`lt` compared numerically (`"1e3"` never matched). | Numeric fields now compare as numbers. |
| 🟡 | `compileRules(… table: string)` was exported with an unconstrained table name — only a comment stopped a future caller passing user input into `sql.raw`. | Narrowed to a `SmartTable` literal union (it immediately caught two loose call sites). |
| 🟡 | Fragments were only wrapped as a whole, so a future non-atomic op would turn `match:"all"` into `(a AND x) OR y` — returning **more** rows than asked. | Every fragment is individually parenthesised. |
| 🟡 | Media smart folders were **unreachable config**: both write paths hardcode the songs target, so media rules were silently stripped, yet `createdAt` still counted media into the badge. | Smart folders are explicitly **songs-only**; `listMedia` returns `[]`, `mediaCount` is 0, and the media field map is reduced with a note. |
| 🟡 | Dropping media onto the grid while a smart folder was selected silently landed it in Default. | The operator is told, and the upload goes to the main media library. |
| 🟡 | `listSongs`/`listMedia` had no error containment, unlike `countSmart`. | A malformed rule set now yields an empty folder, never a 500. |

### Confirmed clean (reviewers actively tried to break these)

- **SQL injection: not exploitable.** `field` can only select a whitelisted
  `FieldDef` or fail closed; `table` is a literal union. Every value is a bound
  parameter — verified against real compiled SQL, not internals.
- **Cross-church leakage: not exploitable.** Fails closed twice (church-scoped
  folder lookup, then church-scoped content query). Proven empirically against
  a real Postgres in `test/adversarial/smart-folders-cross-church.test.ts`.
- **`validateRules` bypass: none.** Every read and write path validates, so
  even a hand-written `psql` row is scrubbed.
- **Newlines in slide text: no regression.** Traced through bulk insert,
  song-chunk, lyric-fragment, song-match and all renderers — every consumer was
  already newline-aware, and the `.pro6` path has always emitted them.

### Accepted, NOT fixed — needs sign-off

- 🔴 **Deploy order is a manual step with no guard.** The migration lives in
  `docs/migrations/` (matching how `libraries` itself shipped) and is therefore
  **not** applied by `npm run db:migrate`, which only reads `./drizzle`. If the
  code ships first, the Library rail and any library-filtered list will 500.
  Apply the SQL by hand first. (Applied and verified idempotent on the local
  dev DB; **not** applied to production.)
- 🟡 **`listLibraries` costs one `COUNT(*)` per smart folder**, uncached, on
  every rail render, and `ILIKE '%x%'` cannot use an index. Fine at the handful
  of folders a church creates; there is no cap on library count, so it wants a
  limit or a cache before it is offered to large churches.
- 🟡 **Extra `SELECT` on the library-filtered list path** to resolve the folder
  kind. Correct but one round-trip more than before.
- 🟡 **`countSmart` swallows all errors**, so a missing migration shows as a
  silent `0` badge rather than a loud failure. Wants a log line.


---

## Smart Playlists (the same idea, applied to service plans)

A smart **playlist** is a `service_plans` row with `kind='smart'` and a rule
set. It owns **no `service_items` rows at all** — `getExpandedServicePlan`
synthesises its item list at read time.

The synthesised rows are shaped **exactly** like `serviceItems.$inferSelect`
(`{ id, servicePlanId, order, type, title, payload, createdAt }`), so the
~280-line expansion pipeline below that call site — slide building, themes,
arrangements, the projector payload, the operator preview — runs completely
unchanged. That was the whole point of inserting at that single line.

### Sentinel ids are deliberate

A derived item's `id` is `smart:<songId>`, not a real `service_items` UUID.
Any mutation aimed at one therefore **matches no row and fails closed**, rather
than silently editing a different item. The UI withholds those affordances
(rename / remove / move / duplicate / add-slide are passed `undefined`, so the
menu entries don't render), and the server refuses writes outright in
`addServiceItem`, `addServiceItems` and `reorderServiceItems` — which also
covers `addPlaylistHeader`, since it delegates to `addServiceItem`. **The
server checks are the boundary; the UI is affordance.**

### Bounded by design

`SMART_PLAYLIST_MAX_ITEMS = 500`. A service plan is something a human runs on a
Sunday; a rule matching 6,000 songs is a mistake, and expanding them all would
stall the operator console.

### Verified

`test/adversarial/smart-playlists.test.ts` — 9 tests against a real Postgres:
rule-derived items, full expansion (slides actually present, not stubs),
sentinel ids + zero owned rows, cross-church isolation both directions,
empty-on-unusable-rules, and two no-regression cases (a manual plan still reads
its rows; a legacy plan with no `kind` behaves as manual).

### Not yet built for smart playlists

- **No rail UI to create one.** `createSmartPlaylist` / `updateSmartPlaylistRules`
  exist and are tested at the DB level, but `PlaylistSection` renders exactly
  one plan (today's) and has no playlist picker to hang a "New smart playlist"
  control on. The rail correctly *renders* a smart plan read-only if one is
  selected; creating one currently needs the action called directly.
- **No ordering control.** Derived items are sorted by song title. PP7-style
  manual ordering is meaningless for a derived list, but "newest first" or a
  `sort` key in the rules json would be reasonable.
