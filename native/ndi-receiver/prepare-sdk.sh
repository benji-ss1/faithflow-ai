#!/usr/bin/env bash
# Vendor the license-gated NDI SDK headers + library into a local ndi-sdk/ dir so
# node-gyp can build. The copied dir is gitignored — do NOT commit the licensed
# SDK. Run before `node-gyp build` / `electron-rebuild`.
#
# macOS: reads /Library/NDI SDK for Apple (override with NDI_SDK_DIR).
# WINDOWS: this bash script targets macOS. On Windows, run prepare-sdk.ps1
#          (PowerShell) instead, which copies from "C:\Program Files\NDI\NDI 6 SDK".
set -euo pipefail
SDK="${NDI_SDK_DIR:-/Library/NDI SDK for Apple}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/ndi-sdk"

if [ ! -d "$SDK/include" ]; then
  echo "ERROR: NDI SDK not found at: $SDK" >&2
  echo "Install the NDI SDK for Apple, or set NDI_SDK_DIR to its location." >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST/include" "$DEST/lib"
cp -R "$SDK/include/." "$DEST/include/"
cp "$SDK/lib/macOS/libndi.dylib" "$DEST/lib/libndi.dylib"
echo "Vendored NDI SDK -> $DEST (from: $SDK)"
