#!/usr/bin/env bash
# Build the Blackmagic embedded-audio addon (native/decklink-audio). NON-FATAL,
# same contract as ndi-rebuild.sh: if the Desktop Video SDK isn't present the app
# still builds — Blackmagic audio is simply unavailable in that build.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ADDON="$HERE/native/decklink-audio"
SDK="${DECKLINK_SDK_DIR:-$HOME/Blackmagic DeckLink SDK}"
if [ ! -f "$SDK/Mac/include/DeckLinkAPI.h" ]; then
  echo "[decklink-rebuild] Desktop Video SDK not found at '$SDK' — skipping (Blackmagic audio unavailable in this build)."
  exit 0
fi
(
  cd "$ADDON" || exit 1
  DECKLINK_SDK_DIR="$SDK" bash prepare-sdk.sh || exit 1
  [ -d node_modules ] || npm install --no-audit --no-fund --ignore-scripts || exit 1
  export SDKROOT="$(xcrun --show-sdk-path)"
  # N-API: one build works for every Electron version; build per target arch.
  # `node-gyp rebuild` wipes build/, so per-arch outputs are staged OUTSIDE it.
  STAGE="$(mktemp -d)"
  for ARCH in arm64 x64; do
    npx --yes node-gyp@13.0.2 rebuild --arch="$ARCH" || exit 1
    cp build/Release/decklink_audio.node "$STAGE/decklink_audio-$ARCH.node" || exit 1
  done
  # Universal binary so the single extraResources path works for both DMGs.
  lipo -create "$STAGE/decklink_audio-arm64.node" "$STAGE/decklink_audio-x64.node" -output build/Release/decklink_audio.node || exit 1
  lipo -info build/Release/decklink_audio.node
  rm -rf "$STAGE"
) || { echo "[decklink-rebuild] build failed — continuing WITHOUT Blackmagic audio."; exit 0; }
echo "[decklink-rebuild] OK: $ADDON/build/Release/decklink_audio.node"
