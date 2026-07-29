#!/usr/bin/env bash
# build.sh — builds PresentFlowAudioHelper and installs it where the
# Electron main process (electron/audio/captureTier.ts) looks for it:
#   resources/native/macos/PresentFlowAudioHelper
#
# Requires a Swift toolchain (full Xcode OR Command Line Tools):
#   xcode-select --install    # if `swiftc --version` fails
#
# The binary is ad-hoc signed (`codesign --sign -`) — sufficient for
# arm64 execution from the unsigned .app exactly like the bundled ffmpeg
# (see docs/agents/research-audio-native.md §5). Re-run this script any
# time the Swift sources change, BEFORE cutting a DMG.
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
OUT_DIR="$REPO_ROOT/resources/native/macos"
OUT_BIN="$OUT_DIR/PresentFlowAudioHelper"
SRC_DIR="Sources/PresentFlowAudioHelper"

mkdir -p "$OUT_DIR"

if ! command -v swiftc >/dev/null 2>&1 && ! command -v swift >/dev/null 2>&1; then
  echo "ERROR: no Swift toolchain found (swiftc/swift missing)." >&2
  echo "Install with: xcode-select --install  (or full Xcode)" >&2
  exit 1
fi

build_universal_spm() {
  # SwiftPM universal build (requires full Xcode toolchain).
  swift build -c release --arch arm64 --arch x86_64 2>/dev/null || return 1
  local bin
  bin="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/PresentFlowAudioHelper"
  [ -f "$bin" ] || return 1
  cp "$bin" "$OUT_BIN"
}

build_universal_triple_lipo() {
  # CLT-only universal: SwiftPM --triple cross-compiles each slice
  # without full Xcode (verified 2026-07-29 on the Intel dev machine),
  # then lipo stitches them. This is the path that actually works with
  # bare Command Line Tools — the --arch multi-arch form needs xcbuild.
  swift build -c release --triple arm64-apple-macosx12.0 || return 1
  swift build -c release --triple x86_64-apple-macosx12.0 || return 1
  local a=".build/arm64-apple-macosx/release/PresentFlowAudioHelper"
  local x=".build/x86_64-apple-macosx/release/PresentFlowAudioHelper"
  [ -f "$a" ] && [ -f "$x" ] || return 1
  lipo -create "$a" "$x" -output "$OUT_BIN"
}

build_arm64_spm() {
  swift build -c release || return 1
  local bin
  bin="$(swift build -c release --show-bin-path)/PresentFlowAudioHelper"
  [ -f "$bin" ] || return 1
  cp "$bin" "$OUT_BIN"
}

build_swiftc() {
  # Direct swiftc — works with bare Command Line Tools, host arch only.
  swiftc -O \
    "$SRC_DIR/DeviceEnumerator.swift" \
    "$SRC_DIR/ChannelProbe.swift" \
    "$SRC_DIR/AudioCapture.swift" \
    "$SRC_DIR/main.swift" \
    -framework CoreAudio \
    -framework AVFoundation \
    -framework AudioToolbox \
    -o "$OUT_BIN"
}

echo "== Building PresentFlowAudioHelper =="
if build_universal_spm; then
  echo "built: universal (arm64 + x86_64) via SwiftPM"
elif build_universal_triple_lipo; then
  echo "built: universal (arm64 + x86_64) via --triple + lipo"
elif build_arm64_spm; then
  echo "built: host arch via SwiftPM (WARNING: single-arch — Apple Silicon churches need arm64!)"
elif build_swiftc; then
  echo "built: host arch via direct swiftc"
else
  echo "ERROR: all build strategies failed" >&2
  exit 1
fi

chmod +x "$OUT_BIN"
# Ad-hoc signature — REQUIRED for arm64 execution; harmless elsewhere.
codesign --force --sign - "$OUT_BIN"

echo "== Done =="
file "$OUT_BIN" || true
codesign -dv "$OUT_BIN" 2>&1 | head -3 || true
echo "installed: $OUT_BIN"
