#!/usr/bin/env bash
# One-time setup for macOS code signing + notarization.
# Run this AFTER you have an active Apple Developer Program membership.
set -euo pipefail

echo "== PresentFlow code-signing setup =="
echo

if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "A 'Developer ID Application' certificate is already in your Keychain:"
  security find-identity -v -p codesigning | grep "Developer ID Application"
  echo
  echo "Skip to step 3 below."
else
  echo "No 'Developer ID Application' certificate found. Steps:"
  echo
  echo "1. Generate a CSR:"
  echo "   Open Keychain Access -> Certificate Assistant -> Request a Certificate From a Certificate Authority"
  echo "   - Enter your Apple ID email, leave CA email blank, select 'Saved to disk'"
  echo
  echo "2. Get the certificate:"
  echo "   Go to https://developer.apple.com/account/resources/certificates/list"
  echo "   -> '+' -> 'Developer ID Application' -> upload the CSR -> download the .cer"
  echo "   -> double-click the downloaded .cer to install it into Keychain Access"
  echo
  echo "Re-run this script after installing the certificate."
  exit 0
fi

echo "3. App-specific password for notarization:"
echo "   Go to https://appleid.apple.com -> Sign-In and Security -> App-Specific Passwords -> generate one"
echo "   Copy it, then run:"
echo "     ! ~/PresentFlow/presentflow-electron/scripts/save-notarize-creds.sh"
echo "   (that script reads your clipboard directly, the password is never typed into chat)"
