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
#
# NDI (network audio receive): this helper links NOTHING against libndi — it
# dlopen()s the runtime at launch. But it DOES need the NDI SDK C HEADERS to
# compile (import CNDI). Those headers are license-gated, so they are NOT in
# the repo; this script copies them from the installed "NDI SDK for Apple"
# into Sources/CNDI/include. It also copies the universal libndi.dylib into
# resources/native/macos so the app can bundle + dlopen it (per the accepted
# NDI SDK license — remember the required "NDI®" attribution in the UI).
#
# Get the SDK (free, license-gated): https://ndi.video/for-developers/ndi-sdk/
# Installs to /Library/NDI SDK for Apple/. Override locations with env vars:
#   NDI_SDK_DIR=/path/to/sdk   ./build.sh
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
OUT_DIR="$REPO_ROOT/resources/native/macos"
OUT_BIN="$OUT_DIR/PresentFlowAudioHelper"
SRC_DIR="Sources/PresentFlowAudioHelper"
CNDI_INCLUDE="Sources/CNDI/include"

mkdir -p "$OUT_DIR"

if ! command -v swiftc >/dev/null 2>&1 && ! command -v swift >/dev/null 2>&1; then
  echo "ERROR: no Swift toolchain found (swiftc/swift missing)." >&2
  echo "Install with: xcode-select --install  (or full Xcode)" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# NDI SDK: copy headers (required to compile) + runtime dylib (bundled).
# ---------------------------------------------------------------------------
find_ndi_sdk() {
  local candidates=(
    "${NDI_SDK_DIR:-}"
    "/Library/NDI SDK for Apple"
    "/Library/NDI Advanced SDK for Apple"
    "$HOME/NDI SDK for Apple"
  )
  for c in "${candidates[@]}"; do
    [ -n "$c" ] && [ -d "$c/include" ] && { echo "$c"; return 0; }
  done
  return 1
}

if NDI_SDK="$(find_ndi_sdk)"; then
  echo "== NDI SDK: $NDI_SDK =="
  # Headers → Sources/CNDI/include (our module.modulemap/CNDI.h stay in place).
  mkdir -p "$CNDI_INCLUDE"
  cp -f "$NDI_SDK/include/"*.h "$CNDI_INCLUDE/" 2>/dev/null || true
  # Runtime dylib (universal) → bundled resources. Search common layouts.
  NDI_DYLIB=""
  for p in \
    "${NDI_RUNTIME_DYLIB:-}" \
    "$NDI_SDK/lib/macOS/libndi.dylib" \
    "$NDI_SDK/lib/macOS/libndi_advanced.dylib"; do
    [ -n "$p" ] && [ -f "$p" ] && { NDI_DYLIB="$p"; break; }
  done
  if [ -z "$NDI_DYLIB" ]; then
    # Fall back to the newest libndi*.dylib anywhere under the SDK lib dir.
    NDI_DYLIB="$(/usr/bin/find "$NDI_SDK/lib" -name 'libndi*.dylib' 2>/dev/null | head -1 || true)"
  fi
  if [ -n "$NDI_DYLIB" ] && [ -f "$NDI_DYLIB" ]; then
    cp -f "$NDI_DYLIB" "$OUT_DIR/libndi.dylib"
    # Warn (don't silently swallow) if signing the dylib fails — an unsigned
    # dylib can ship and then fail to load at runtime with no build-time signal.
    if ! codesign --force --sign - "$OUT_DIR/libndi.dylib"; then
      echo "WARNING: failed to ad-hoc sign $OUT_DIR/libndi.dylib" >&2
    fi
    echo "installed runtime: $OUT_DIR/libndi.dylib (from $NDI_DYLIB)"
  else
    echo "WARNING: NDI runtime dylib not found under $NDI_SDK/lib — NDI will be" >&2
    echo "         unavailable at runtime until libndi.dylib is placed in $OUT_DIR" >&2
  fi
else
  echo "ERROR: NDI SDK for Apple not found (looked for */include)." >&2
  echo "       The helper needs the NDI SDK headers to compile (import CNDI)." >&2
  echo "       Download (free): https://ndi.video/for-developers/ndi-sdk/" >&2
  echo "       Then re-run, or set NDI_SDK_DIR=/path/to/sdk ./build.sh" >&2
  exit 1
fi

# Sanity: the SDK umbrella header must now be present for the CNDI module.
if [ ! -f "$CNDI_INCLUDE/Processing.NDI.Lib.h" ]; then
  echo "ERROR: $CNDI_INCLUDE/Processing.NDI.Lib.h missing after header copy." >&2
  echo "       Check the SDK layout under $NDI_SDK/include." >&2
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
  # CNDI is consumed as a Clang module (module.modulemap) via -I; we dlopen
  # the runtime so there is nothing to link.
  swiftc -O \
    -I "$CNDI_INCLUDE" \
    -Xcc -fmodule-map-file="$CNDI_INCLUDE/module.modulemap" \
    "$SRC_DIR/DeviceEnumerator.swift" \
    "$SRC_DIR/ChannelProbe.swift" \
    "$SRC_DIR/AudioCapture.swift" \
    "$SRC_DIR/NDIRuntime.swift" \
    "$SRC_DIR/NDIDiscovery.swift" \
    "$SRC_DIR/NDIReceiver.swift" \
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
