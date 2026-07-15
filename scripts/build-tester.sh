#!/usr/bin/env bash
# Tester build: bakes .env.local into .env.production.local, builds the
# Next.js standalone bundle, tsc-compiles the Electron main, and packages
# an unsigned macOS .dmg into release/.
#
# WARNING: the resulting build embeds whatever creds are in .env.local
# (Supabase URL/keys, Groq, etc.). Do NOT distribute publicly. See
# DECISIONS.md > "Tester build creds baking".
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
TEMP_ENV="$ROOT/.env.production.local"
CLEANUP_TEMP=0

if [[ -f "$ROOT/.env.local" ]]; then
  cp "$ROOT/.env.local" "$TEMP_ENV"
  CLEANUP_TEMP=1
  echo "[tester-build] baked .env.local → .env.production.local"
else
  echo "[tester-build] WARNING: no .env.local found; build will lack runtime keys"
fi

cleanup() {
  if [[ "$CLEANUP_TEMP" == "1" && -f "$TEMP_ENV" ]]; then
    rm -f "$TEMP_ENV"
    echo "[tester-build] removed temp .env.production.local"
  fi
}
trap cleanup EXIT

export CSC_IDENTITY_AUTO_DISCOVERY=false
echo "[tester-build] next build ..."
npx next build

echo "[tester-build] compile electron main ..."
npm run electron:build:tsc

echo "[tester-build] electron-builder (unsigned mac dmg) ..."
npx electron-builder --mac dmg --publish=never

echo "[tester-build] artifacts:"
ls -lh release/*.dmg 2>/dev/null || true
