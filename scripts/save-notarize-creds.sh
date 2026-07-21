#!/usr/bin/env bash
# Prompts for Apple notarization credentials and writes them to .env.local.
# Values are typed/pasted locally and never printed back.
set -euo pipefail

ENV_FILE="$(dirname "$0")/../.env.local"

read -rp "APPLE_ID (your Apple Developer account email): " APPLE_ID
read -rp "APPLE_TEAM_ID (Membership -> Team ID, developer.apple.com/account): " APPLE_TEAM_ID
read -rsp "APPLE_APP_SPECIFIC_PASSWORD (from appleid.apple.com): " APPLE_APP_SPECIFIC_PASSWORD
echo

grep -vE '^(APPLE_ID|APPLE_TEAM_ID|APPLE_APP_SPECIFIC_PASSWORD)=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
{
  cat "$ENV_FILE.tmp"
  echo "APPLE_ID=$APPLE_ID"
  echo "APPLE_TEAM_ID=$APPLE_TEAM_ID"
  echo "APPLE_APP_SPECIFIC_PASSWORD=$APPLE_APP_SPECIFIC_PASSWORD"
} > "$ENV_FILE"
rm -f "$ENV_FILE.tmp"

echo "Saved. Next: edit package.json build.mac.identity to your cert name"
echo "(security find-identity -v -p codesigning to see the exact string),"
echo "then run: npm run electron:build"
