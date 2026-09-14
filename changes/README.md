# changes/ — What's New, automatically

Every user-facing change adds ONE file here: `changes/<short-slug>.md`.
You do **not** edit `src/lib/changelog.ts` for new releases any more.

```md
---
headline: Signing in no longer locks out a whole church
audience: operator        # operator | admin (default operator)
date: 2026-09-14          # optional, defaults to build day
version: 0.1.404          # optional — leave out to go into the next release
order: 1                  # optional — lower shows first within a release
highlights:
  - Plain words describing what the operator SEES change.
  - One bullet per line. No markdown, no internal jargon.
---
```

## How it becomes What's New

`scripts/build-changelog.mjs` runs on `predev` and `prebuild`. It reads every
file here, groups them by release, and writes `src/lib/changelog.generated.ts`
(commit it). `src/lib/changelog.ts` merges that with the curated history, so
the What's New modal, Recent updates panel, Activities card and announcement
bar pick it up with no code change.

- **Release version:** a file's `version:` if set; otherwise the next release —
  `package.json`'s version if it's newer than every known entry, else one patch
  past the newest entry.
- **Several files in one release:** the headline comes from the first file
  (by `order`, then filename); highlights are concatenated in that order.
- **Dedupe:** a file whose headline already exists in the curated history is
  skipped, and a history entry always wins over a generated one with the same
  version. So hand-merging an entry into `changelog.ts` later never duplicates.
- **Idempotent:** running it again with no changes writes nothing.
  `node scripts/build-changelog.mjs --check` fails if the committed file is stale.
- `audience` is validated and kept for future filtering; today every audience
  is shown (the entry shape consumers read is unchanged).

## The CI check

`npm run check:changes` (also a CI step) fails when files under `src/` changed
vs the merge base and no `changes/*.md` was added. If the change is genuinely
invisible to users (refactor, tests, internal tooling), put
`no-user-change` in the PR description or any commit message. Locally the
script only warns; it's strict when `CI=true` or with `--strict`.
