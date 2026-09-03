#!/usr/bin/env bash
# Build the native NDI addons (sender + AUDIO receiver) for the current Electron
# ABI, before electron-builder packages the app. NON-FATAL: if the NDI SDK isn't
# installed (or anything fails), we log and continue so the DMG still builds — NDI
# just stays unavailable at runtime (never block the app on NDI).
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "${NDI_SDK_DIR:-/Library/NDI SDK for Apple}/include" ]; then
  echo "[ndi-rebuild] NDI SDK not found — skipping NDI addon build (NDI will be unavailable in this build)."
  exit 0
fi

# Resolve the Electron version to build the addons' ABI against (electron-rebuild
# can't auto-detect it from the addon dir, which has no electron dep).
ELECTRON_VERSION="$(node -p "require('$HERE/node_modules/electron/package.json').version" 2>/dev/null || node -p "(require('$HERE/package.json').devDependencies.electron||'').replace(/[^0-9.]/g,'')" 2>/dev/null || echo '')"
if [ -z "$ELECTRON_VERSION" ]; then
  echo "[ndi-rebuild] Could not resolve Electron version — skipping (NDI unavailable)."; exit 0
fi

build_addon() {
  local name="$1" out="$2"
  local addon="$HERE/native/$name"
  [ -d "$addon" ] || { echo "[ndi-rebuild] $name not present — skipping."; return 0; }
  echo "[ndi-rebuild] Vendoring SDK + rebuilding $name for Electron ${ELECTRON_VERSION}..."
  (
    cd "$addon" || exit 1
    bash prepare-sdk.sh || exit 1
    [ -d node_modules ] || npm install --no-audit --no-fund --ignore-scripts || exit 1
    export SDKROOT="$(xcrun --show-sdk-path)"
    npx --yes @electron/rebuild@latest -v "$ELECTRON_VERSION" -m . || exit 1
  ) || { echo "[ndi-rebuild] $name build failed — continuing WITHOUT it."; return 0; }
  if [ -f "$addon/build/Release/$out" ]; then
    echo "[ndi-rebuild] OK: $addon/build/Release/$out"
  else
    echo "[ndi-rebuild] WARNING: $out not produced — that NDI feature will be unavailable."
  fi
}

build_addon "ndi-sender" "ndi_sender.node"
build_addon "ndi-receiver" "ndi_receiver.node"
exit 0
