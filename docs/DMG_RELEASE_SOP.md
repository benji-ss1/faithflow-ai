# DMG Release SOP

**Purpose:** How to cut a new PresentFlow desktop shell (`.dmg`) release, push all changes to GitHub, and keep the web app + shell version numbers aligned. Written after the July 2026 release cycle where the same mistakes were made 3-4 times — read this first, don't wing it.

**Audience:** anyone (human or agent) about to run `./scripts/release.sh`.

---

## 0. First, decide if a new DMG is even needed

PresentFlow is a **thin-client Electron shell** loading `https://faithflow-ai.vercel.app` on launch. This means the DMG only needs re-cutting when the **shell** changes. Most work is web-side and doesn't need one.

### Cut a new DMG when

- The user explicitly asks for one
- You're onboarding a new tester (they need a bootstrap DMG regardless — grab whatever the current one is)
- Any file under `electron/*.ts` changed (main process, preload, screens, updater, etc.)
- `package.json` shell config changed (build target, publisher, entitlements, etc.)
- The shell version has drifted more than ~10 patches behind the web changelog head and testers might be seeing a confusingly different number in the "What's New" modal vs their app version
- Auto-updater delivery matters (e.g., "please ensure all testers have this ASAP" — the DMG's `latest-mac.yml` is what electron-updater reads)

### Don't cut a new DMG when

- Only React / Next.js code (`src/**`) changed — Vercel already serves this on next Cmd+R
- You just rapid-iterated through 5+ small fixes and are about to iterate more — wait for stability
- Another agent just shipped a shell change 10 minutes ago — one DMG per stable window, not per commit
- User is testing a specific web-only feature and you're mid-fix — Cmd+R is faster than a DMG cycle

**Rule of thumb:** if the change is entirely under `src/**` and doesn't touch `electron/**` or `package.json`'s `build` section, don't cut. Tell the user Cmd+R gets them there.

---

## 1. Version alignment

The shell version (in `package.json`) and the web changelog head (top entry in `src/lib/changelog.ts`) **should match** so testers see one consistent number end-to-end.

If the web changelog is at `v0.1.68` and the shell is at `v0.1.62`, cut the shell at `v0.1.68`, **not** `v0.1.63`. Small +1 increments cause the "installed v0.1.63 but see v0.1.68 in the What's New modal" confusion that wastes tester time.

**Only exception:** if you're cutting purely to distribute an electron/*.ts fix and the web hasn't moved, then a small +1 is fine — but note it in the release notes.

---

## 2. Preconditions

Before running the release script, verify:

- Working tree is clean: `git status` → "nothing to commit"
- On `main`, up to date with remote: `git pull --rebase origin main`
- Vercel deploy of the current commit is **green** (the DMG will pin testers to fetching this exact Vercel state)
- Typecheck clean: `npx tsc --noEmit 2>&1 | grep -v "test/adversarial/audio-reconnect\|jsdom" | head` returns nothing
- `gh auth status` shows authenticated with `repo` scope
- `fly` CLI available if the bridge also needs redeploying (`~/.fly/bin/fly` on this machine)
- **Swift audio helper (since v0.1.92):** run `bash native/macos/build.sh` and verify
  `resources/native/macos/PresentFlowAudioHelper` exists and `file` reports a
  **universal (arm64 + x86_64)** Mach-O — a single-arch helper silently downgrades
  Apple Silicon churches to the ffmpeg tier. The build script needs a Swift
  toolchain; with bare Command Line Tools it uses the `--triple` + `lipo` path.
  When Apple Developer signing lands, the helper needs its own codesign entry
  (currently ad-hoc signed, which is sufficient for the unsigned .app).

---

## 3. The cut procedure (annotated)

The following is what actually works, including the workarounds for the known bugs in `scripts/release.sh`.

### 3a. Run the release script

```bash
GH_TOKEN=$(gh auth token) ./scripts/release.sh v0.1.XX
```

**Expected outcome:** the script bumps `package.json` to `0.1.XX`, builds arm64 + x64 DMG + zip in `release/`, and tries to publish to GitHub. **It will almost certainly fail** on the publish step with:

```
HttpError: 422 Unprocessable Entity
"message": "Validation Failed",
"errors": [{"resource": "Release", "code": "custom",
            "message": "Published releases must have a valid tag"}]
```

This is a **known bug** in electron-builder's GitHub publisher for the first publish of a new tag — it creates the release but fails to attach the artifacts. **The artifacts DID build** (verify with `ls release/`), and the release + tag DID get created on GitHub. It just didn't upload the files.

### 3b. Re-run publish to actually upload

```bash
GH_TOKEN=$(gh auth token) CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder --mac --arm64 --publish always
```

This second run sees the release exists, skips the re-create, and uploads all files. Watch for `overwrite published file` lines for already-uploaded ones and `uploading` lines for the remaining ones.

### 3c. Verify all 9 assets are present

```bash
gh release view v0.1.XX --json assets | \
  python3 -c "import json,sys; d=json.load(sys.stdin); [print(f'  {a[\"name\"]:<50} {a[\"size\"]//1024//1024} MB') for a in d['assets']]"
```

You want to see **exactly 9 assets**:

1. `latest-mac.yml` — **critical** for auto-updater; without this, testers on old versions won't auto-upgrade
2. `Present-Flow-0.1.XX-arm64-mac.dmg` (~114 MB)
3. `Present-Flow-0.1.XX-arm64-mac.dmg.blockmap`
4. `Present-Flow-0.1.XX-arm64-mac.zip` (~114 MB)
5. `Present-Flow-0.1.XX-arm64-mac.zip.blockmap`
6. `Present-Flow-0.1.XX-x64-mac.dmg` (~116 MB)
7. `Present-Flow-0.1.XX-x64-mac.dmg.blockmap`
8. `Present-Flow-0.1.XX-x64-mac.zip` (~116 MB)
9. `Present-Flow-0.1.XX-x64-mac.zip.blockmap`

If `latest-mac.yml` is missing, auto-update won't work for existing testers. Re-run step 3b.

### 3d. Commit the version bump — SURGICALLY

⚠️ **NEVER `git add -A`** in this repo. It will sweep in:

- `.claude/worktrees/agent-*` embedded git repos from parallel agent sessions
- Other agents' in-progress test files (`src/tests/bibleDetection/*` etc.)
- Any modified files in the working tree you didn't intend to commit

Do this instead:

```bash
git add package.json package-lock.json
git commit -m "chore(release): bump to 0.1.XX for tester DMG cut (<one-line summary>)"
```

`.gitignore` was updated in `f9b579f` to exclude `.claude/worktrees/` but stay alert for other similar leaks.

### 3e. Rebase-push (parallel agents may have shipped)

```bash
git pull --rebase origin main
```

If it succeeds cleanly, `git push origin main`. If it hits a **changelog conflict**, resolve as in §5 below.

### 3f. Set proper release notes

```bash
gh release edit v0.1.XX --title "PresentFlow v0.1.XX — <what testers actually see>" \
  --notes "$(cat <<'EOF'
<body>
EOF
)"
```

**Structure the body:**

- 1-2 sentence lede: what the headline change is + which prior version had the field-reported bug (if it's a hotfix)
- **What changed** — 2-4 bullets, operator-facing not internal
- **Also bundled** — list web changelog entries the shell now delivers to a fresh installer
- **Install** — direct links to both arch DMGs, sizes, unsigned-build unquarantine instructions
- **Existing testers on vA.B.C+ auto-update on next launch** — this line matters, it's what makes the user feel safe not manually re-installing on every tester machine

Example title patterns:

- `PresentFlow v0.1.62 — audio reliability pass + parser homophone repairs`
- `PresentFlow v0.1.68 — song stale-echo re-fire hotfix (v0.1.67 loop)`
- `PresentFlow v0.1.54 — matches web app; audio diagnostics + playlist Bible fix`

---

## 4. Handoff to the user

After a successful cut, tell them:

- The release URL: `https://github.com/benji-ss1/faithflow-ai/releases/tag/v0.1.XX`
- Direct download links per arch (with which chip type is which)
- The unsigned-DMG right-click → Open → Open workaround for first launch (this trips up EVERY new tester on macOS — always include it)
- **What existing testers get automatically** — auto-update on next launch (or up to 1 hour later via the updater's polling)
- **Which testers need a fresh install** — anyone on v0.1.34 or earlier who doesn't have the Cmd+R hard-reload fix from v0.1.36 (they may serve cached JS forever without a fresh DMG)

---

## 5. Merge conflict recovery for `src/lib/changelog.ts`

Because parallel agents ship changelog entries constantly, `git pull --rebase` often hits a conflict at the top of `changelog.ts`. This is expected — resolve as follows:

1. Look at the conflict markers. The `HEAD` side is what remote has (their new entries). Your side is your entry.
2. Your entry's version number is now stale because they took your number. **Rename your entry to the next available version** (e.g., if remote is at `v0.1.61` and yours was `v0.1.55`, rename yours to `v0.1.62`).
3. Place your entry **at the very top** of the array, above their newest entry.
4. Remove all `<<<<<<<`, `=======`, `>>>>>>>` markers.
5. Also update `package.json` to the new number if you were cutting a DMG (you'll usually need to re-run 3b for the new version).
6. `git add src/lib/changelog.ts && git rebase --continue`
7. `git push origin main`

**Do NOT** try to keep both entries at the same version number. The "What's New" modal displays them by version and duplicates confuse testers.

---

## 6. Common failure modes and their fixes

| Symptom | Cause | Fix |
|---|---|---|
| Release exists but 0 assets | electron-builder 422 on first publish | Re-run step 3b |
| `latest-mac.yml` missing | Publish partial | Re-run step 3b; verify with 3c |
| Auto-update didn't fire for a tester | Their app is on v0.1.34 or older (pre-hard-reload-fix) | Send them a fresh DMG once |
| Rebase changelog conflict | Parallel agent shipped | Resolve per §5 |
| `.claude/worktrees/agent-*` in commit | You used `git add -A` | `git rm --cached` + `git commit --amend` (or a follow-up cleanup commit if already pushed) |
| Wrong version in DMG filename | You built for one version but the tag is another | Delete the release, `git tag -d vA.B.C`, `git push origin :refs/tags/vA.B.C`, restart at 3a |
| `fly` CLI not found | Not installed | It's at `~/.fly/bin/fly` on this machine — check there first before trying `brew install flyctl` |
| Fly bridge running old parser | Bridge wasn't redeployed after `bible-parser.ts` changed | `~/.fly/bin/fly deploy -a faithflow-audio --dockerfile Dockerfile.audio` |

---

## 7. Whole-thing check (paste-friendly)

```bash
# 0. Preconditions
git status                    # clean?
git pull --rebase origin main # up to date?
gh auth status                # authenticated?

# 1. Cut
VERSION=v0.1.XX               # match web changelog head
GH_TOKEN=$(gh auth token) ./scripts/release.sh "$VERSION"

# 2. Republish (workaround for 422)
GH_TOKEN=$(gh auth token) CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder --mac --arm64 --publish always

# 3. Verify assets
gh release view "$VERSION" --json assets | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(len(d['assets']), 'assets:'); [print(f'  {a[\"name\"]}') for a in d['assets']]"
# Expect: 9 assets including latest-mac.yml

# 4. Commit bump — NEVER `git add -A`
git add package.json package-lock.json
git commit -m "chore(release): bump to ${VERSION#v} for tester DMG cut (<summary>)"
git pull --rebase origin main    # handle any parallel-agent commits
git push origin main

# 5. Release notes
gh release edit "$VERSION" \
  --title "PresentFlow $VERSION — <headline>" \
  --notes "<body per §3f>"
```

---

## 8. What NOT to do

- Do NOT ever `git add -A`
- Do NOT commit `.claude/worktrees/*` — it's a submodule pointer to another agent's temp worktree, worthless in the repo
- Do NOT push --force to `main`
- Do NOT delete published releases without user sign-off (auto-updater will 404 on testers already downloading)
- Do NOT skip step 3c (asset verification) — a release with 8 of 9 assets is broken for auto-update and looks fine in the UI
- Do NOT set the release title to just the version number — testers ignore version-only titles; give them a headline
- Do NOT cut a DMG "just in case" — every cut invalidates the last DMG for new testers browsing the releases page. One cut per stable milestone
- Do NOT try to cut without `GH_TOKEN` in the env — the release script fails opaquely on auth
