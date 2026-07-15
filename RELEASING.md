# Releasing a new tester build

Present Flow ships auto-updates via `electron-updater` + GitHub Releases. The
tester installs the app once from a `.dmg`; every subsequent release is
downloaded silently in the background and applied on the next restart.

## Cut a release

1. Bump the version in `package.json` (or let `scripts/release.sh` do it for
   you — it calls `npm version` under the hood).
2. Export a GitHub token with `repo` scope. Easiest:
   ```
   export GH_TOKEN=$(gh auth token)
   ```
3. Run:
   ```
   ./scripts/release.sh v0.1.1
   ```
4. `electron-builder` publishes `Present Flow-<version>.dmg`,
   `Present Flow-<version>-mac.zip`, and `latest-mac.yml` to the GitHub Release
   at https://github.com/benji-ss1/faithflow-ai/releases/tag/vX.Y.Z .
5. Existing testers auto-update within the hour (or on their next app launch).

## What testers see

- Blue banner at the top of the operator shell: `⬇ Downloading update X.Y.Z…`
  (silent, background download; can keep working).
- Once the zip is downloaded and verified, banner turns green:
  `✓ Update X.Y.Z ready. Click here to restart & install.`
- Click it — the app closes, replaces itself from the downloaded zip, and
  relaunches on the new version. No manual re-download required.

## Notes

- Builds are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Testers will see
  the macOS Gatekeeper "unidentified developer" prompt once on first install
  (right-click → Open). Subsequent auto-updates bypass Gatekeeper because they
  replace the already-approved bundle in place.
- The `.zip` target is required in addition to `.dmg` — `electron-updater` on
  macOS can only atomically replace the app from a zip. DMGs can't be mounted
  in-place.
- `mac.identity: null` is set explicitly in `package.json` to prevent
  electron-builder from picking up a random keychain identity on developer
  machines and producing an inconsistently-signed artifact.
