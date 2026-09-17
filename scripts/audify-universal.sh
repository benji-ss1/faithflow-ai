#!/usr/bin/env bash
# Make node_modules/audify/build/Release a UNIVERSAL (arm64+x64) set before
# electron-builder packages BOTH Mac installers from one runner. prebuild-install
# only fetches the HOST arch, so without this the Intel DMG ships an arm64
# audify.node and silently loses the RtAudio tier (packaging review 🔴).
# Tarballs are pinned by sha256 (supply-chain review 🟡) — bump both together.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VER="1.10.1"; NAPI="8"
SHA_ARM64="d4cbe7fbe72de316b148e3f4b58b87cd80c4c622ba75cc2ec02b860d467cb699"
SHA_X64="a49d2f4dfe598c3b070c86610d0c5519db628f7fecdb96f2329c68e12cff6856"
DEST="$HERE/node_modules/audify/build/Release"
[ "$(uname)" = "Darwin" ] || { echo "[audify-universal] not macOS — skipping"; exit 0; }
[ -d "$HERE/node_modules/audify" ] || { echo "[audify-universal] audify not installed"; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fetch() { # arch sha
  local f="audify-v${VER}-napi-v${NAPI}-darwin-$1.tar.gz"
  curl -fsSL -o "$TMP/$f" "https://github.com/almoghamdani/audify/releases/download/v${VER}/$f"
  echo "$2  $TMP/$f" | shasum -a 256 -c - >/dev/null || { echo "[audify-universal] CHECKSUM MISMATCH for $f"; exit 1; }
  mkdir -p "$TMP/$1" && tar -xzf "$TMP/$f" -C "$TMP/$1"
}
fetch arm64 "$SHA_ARM64"
fetch x64 "$SHA_X64"
mkdir -p "$DEST"
for f in "$TMP/arm64/build/Release/"*; do
  name="$(basename "$f")"
  if [ -L "$f" ]; then
    cp -P "$f" "$DEST/$name"          # keep dylib version symlinks
  else
    lipo -create "$f" "$TMP/x64/build/Release/$name" -output "$DEST/$name"
  fi
done
lipo -info "$DEST/audify.node"
node -e "require('$HERE/node_modules/audify'); console.log('[audify-universal] OK (loads on', process.arch + ')')"
