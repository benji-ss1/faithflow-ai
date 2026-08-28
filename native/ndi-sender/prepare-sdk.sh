#!/usr/bin/env bash
# Vendor the license-gated NDI SDK headers + dylib into a NO-SPACE local path so
# node-gyp/make can build (the system SDK path "/Library/NDI SDK for Apple" has
# spaces that break make). The copied dir (ndi-sdk/) is gitignored — do NOT commit
# the licensed headers/dylib. Run before `node-gyp build` / `electron-rebuild`.
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
# The macOS redistributable dylib.
cp "$SDK/lib/macOS/libndi.dylib" "$DEST/lib/libndi.dylib"
echo "Vendored NDI SDK -> $DEST (from: $SDK)"
