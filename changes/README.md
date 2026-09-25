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
audience: operator
version: 0.1.405
date: 2026-09-14
order: 1
highlights:
  - Plain words describing what the operator SEES change.
  - One bullet per line. No markdown, no internal jargon.
---
```

- `audience` — `operator` | `admin` (optional, default `operator`)
- `version` — REQUIRED, set by `changes:new`: `X.Y.Z`, whole numbers, no
  leading zeros (it starts above the curated history, every change file and the
  `package.json` app version)
- `date` — REQUIRED, set by `changes:new`: a real `YYYY-MM-DD`
- `order` — optional, lower shows first within a release

The parser is strict: no trailing `# comments` after a value, the file
extension must be lowercase `.md`, and values may not contain U+2028/U+2029.

### Rules

- **`version` and `date` are required.** A file without them (or with an
  impossible date like `2026-13-45`, or a duplicated key) fails the build.
### When CI says your version must be above something

This happens when `main` ships a note *after* yours was written — your branch is
not wrong, the world moved. Fix it in one command:

```sh
npm run changes:bump          # renumber this branch's UNRELEASED notes
node scripts/build-changelog.mjs
```

`changes:bump` only touches notes that are **not** on the base (a released
note's version is frozen), only moves ones at or below the base's newest, and
keeps their relative order. `--dry-run` shows the plan without writing.

`changes:new` also reads the base branch now, so a fresh note starts above
whatever `main` has — it no longer guesses from local files alone. That is what
used to mint a number `main` had already used, so the note merged under someone
else's headline and disappeared from What's New.

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
  strictly above the highest version on the merge base (a renamed note counts
  as added);
- a change file that already exists on the merge base (released) has its
  `version` or `date` edited;
- a change file has a non-lowercase extension (`.MD`);
- files under `src/` changed but no change file was added/edited that parses
  (deleting a note doesn't count), and there is no `no-user-change` marker.

If a change is genuinely invisible to users (refactor, tests, tooling), put a
line containing only `no-user-change` in the PR description or a commit
message, or add the `no-user-change` PR label. Locally the script only warns;
it's strict when `CI=true` (where a missing merge base also fails) or with
`--strict`.

**Repo setting (required):** two open PRs can both run `changes:new` and claim
the same next version; each passes CI against the old base. Enable GitHub branch
protection on `main` → "Require branches to be up to date before merging" (or use
a merge queue) so the second PR is re-checked against the merged first one and
fails until it takes a new version.
