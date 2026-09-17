#!/usr/bin/env bash
# Vendor the Blackmagic Desktop Video SDK (macOS) headers into sdk/include.
# DECKLINK_SDK_DIR = the unzipped "Blackmagic DeckLink SDK x.y" folder.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${DECKLINK_SDK_DIR:-$HOME/Blackmagic DeckLink SDK}"
SRC="$SDK/Mac/include"
[ -f "$SRC/DeckLinkAPI.h" ] || { echo "[decklink] SDK headers not found at $SRC"; exit 1; }
mkdir -p "$HERE/sdk/include"
cp "$SRC"/*.h "$SRC"/DeckLinkAPIDispatch.cpp "$HERE/sdk/include/"
echo "[decklink] headers vendored from $SRC"
