# changes/ — What's New, automatically

Every user-facing change adds ONE file here: `changes/<short-slug>.md`.
You do **not** edit `src/lib/changelog.ts` for new releases any more.

## Create a note

```sh
npm run changes:new -- sign-in-lockout-fix
```

This creates `changes/sign-in-lockout-fix.md` already stamped with the next
version (one patch above the highest version in `src/lib/changelog.ts` and every
existing change file) and today's date. Fill in the headline and highlights:

```md
---
headline: Signing in no longer locks out a whole church
audience: operator        # operator | admin (default operator)
version: 0.1.405          # REQUIRED — set by changes:new
date: 2026-09-14          # REQUIRED — real YYYY-MM-DD, set by changes:new
order: 1                  # optional — lower shows first within a release
highlights:
  - Plain words describing what the operator SEES change.
  - One bullet per line. No markdown, no internal jargon.
---
```

### Rules

- **`version` and `date` are required.** A file without them (or with an
  impossible date like `2026-13-45`, or a duplicated key) fails the build.
- **Never edit a released note's version**, and never add a new note to a
  version that has already shipped. Operators who dismissed What's New for that
  version would never see it. Always use `changes:new` for a new note.
- Deliberately grouping two notes into one release is fine *before* it ships:
  give the second file the same `version:` as the first (like the two OBS
  notes, 0.1.403).
- A headline must be distinct from every curated history entry's headline.

## How it becomes What's New

`scripts/build-changelog.mjs` runs on `predev` and `prebuild`. It reads every
file here, groups them by `version`, and writes `src/lib/changelog.generated.ts`
(commit it). `src/lib/changelog.ts` merges that with the curated history, so
the What's New modal, Recent updates panel, Activities card and announcement
bar pick it up with no code change.

- **Several files in one release:** the headline comes from the first file
  (by `order`, then filename); highlights are concatenated in that order; the
  entry date is the latest file date.
- **Already hand-merged:** a file whose `version` AND `headline` both match a
  curated history entry is skipped. Same version with a different headline, or
  a headline already used by a different version, is an error.
- **Lower than the newest release:** the local build warns; CI rejects it for
  newly added files (below).
- **Idempotent:** running it again with no changes writes nothing.
  `node scripts/build-changelog.mjs --check` fails if the committed file is stale.
- `audience` is validated and kept for future filtering; today every audience
  is shown.

## The CI check

`npm run check:changes` (also a CI step) compares against the merge base with
`origin/main` (or the PR base branch) and fails when:

- a change file **added** in the branch doesn't parse, or its version is not
  strictly above the highest version on the merge base;
- files under `src/` changed but no change file was added/edited that parses
  (deleting a note doesn't count), and there is no `no-user-change` marker.

If a change is genuinely invisible to users (refactor, tests, tooling), put a
line containing only `no-user-change` in the PR description or a commit
message, or add the `no-user-change` PR label. Locally the script only warns;
it's strict when `CI=true` (where a missing merge base also fails) or with
`--strict`.
