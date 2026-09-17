# Release tokens + Blackmagic support: DO NOT LET THESE LAPSE

PresentFlow's desktop releases (Mac DMG + Windows installer, auto-updated to every church) depend on **two GitHub fine-grained tokens**. Both are stored as Actions secrets on `benji-ss1/faithflow-ai`, and both **expire after 1 year**.

| Secret | What it unlocks | Created | Renew by | If it expires |
|---|---|---|---|---|
| `RELEASES_REPO_TOKEN` | Publishing installers + `latest.yml` to the PUBLIC `benji-ss1/presentflow-releases` repo (where auto-update and downloads come from) | 2026-09-16 | **2027-09-01** | Release workflow fails at "Mirror installer" → **churches stop getting updates** |
| `BUILD_DEPS_TOKEN` | Reading the Blackmagic Desktop Video SDK from the PRIVATE `benji-ss1/presentflow-build-deps` repo | 2026-09-17 | **2027-09-01** | ⚠️ **Blackmagic audio SILENTLY drops out of new releases.** The build still passes and only shows a warning. Churches auto-update into a version with no Blackmagic support. |

## ⚠️ Watch for Blackmagic quietly dropping out
After every release, open the GitHub Actions run and check:
- **Windows run:** step **"Build Blackmagic audio addon"** ran (not skipped), and there's no warning `BUILD_DEPS_TOKEN not set`.
- **Mac run:** step **"Build Blackmagic audio addon (universal)"** printed `x86_64 arm64`.
If either was skipped, the release has **no Blackmagic audio**. Fix the token and re-run the release before churches update.

## How to renew (5 min, per token)
1. https://github.com/settings/personal-access-tokens → open the token → **Regenerate** (or create a new one):
   - `BUILD_DEPS_TOKEN`: repo access **presentflow-build-deps only**, Contents **Read-only**.
   - `RELEASES_REPO_TOKEN`: repo access **presentflow-releases only**, Contents **Read and write**.
2. Copy it → https://github.com/benji-ss1/faithflow-ai/settings/secrets/actions → update the matching secret.
3. Run a release (Actions → Release desktop app / Release desktop app (Windows) → Run workflow) and check the steps above.

## Repo layout (why three repos)
- `faithflow-ai` (PUBLIC): source code. Must never contain the Blackmagic SDK (licensed).
- `presentflow-build-deps` (PRIVATE): licensed SDKs, read only by the release build. **Never make public.**
- `presentflow-releases` (PUBLIC, code-free): compiled installers + auto-update manifests. Churches download from here.

The compiled installer being public is fine. The SDK itself never leaves the private repo. **Confirm with an expert** that Blackmagic's SDK licence allows distributing the compiled addon before wide release.

## Updating the SDK later
Upload the new zip as a new release (e.g. `decklink-sdk-16.1`) on `presentflow-build-deps`, and change the tag in both `.github/workflows/release-*.yml` files.
