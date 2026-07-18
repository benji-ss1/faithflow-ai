#!/usr/bin/env bash
# Cut a new tester release: bump package.json version, build the unsigned mac
# .dmg + .zip via electron-builder, and publish the artifacts + latest-mac.yml
# to a GitHub Release. Existing testers pick the update up automatically on
# next launch (or within an hour of the release).
#
# Usage: ./scripts/release.sh vX.Y.Z
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: ./scripts/release.sh vX.Y.Z"
  exit 1
fi

# Bump package.json version (strip leading v — npm version rejects the prefix).
# Skip if already at target (initial release cutting the current version).
TARGET="${VERSION#v}"
CURRENT="$(node -p "require('./package.json').version")"
if [ "$CURRENT" != "$TARGET" ]; then
  npm version "$TARGET" --no-git-tag-version
else
  echo "package.json already at $TARGET — skipping npm version bump"
fi

# electron-builder needs a GitHub token with `repo` scope to create/upload the
# release. Easiest source: `gh auth token`.
if [ -z "${GH_TOKEN:-}" ]; then
  echo "ERROR: GH_TOKEN env var required. Run: export GH_TOKEN=\$(gh auth token)"
  exit 1
fi

# Thin-client shell: no `next build` needed — the desktop app loads the
# hosted Next.js app at PF_APP_URL (default https://faithflow-ai.vercel.app).
# Just compile the Electron main/preload and package. CSC_IDENTITY_AUTO_DISCOVERY=false
# forces an unsigned build on machines that happen to have a code-signing
# identity in the keychain.
npm run electron:build:tsc
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --publish always

echo "✓ Released $VERSION → https://github.com/benji-ss1/faithflow-ai/releases/tag/$VERSION"
