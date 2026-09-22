#!/usr/bin/env node
/**
 * make-preview-launcher — build a double-clickable launcher that opens the
 * INSTALLED PresentFlow desktop app against a PREVIEW deployment instead of
 * production.
 *
 * WHY THIS EXISTS
 * The operator console is deliberately unreachable from a plain browser
 * (src/middleware.ts: a browser request for /operator is redirected to
 * /settings/outputs — "a plain browser must not be able to reach any part of
 * the live-show surface"). The desktop app sends `x-pf-shell: desktop`, so it
 * IS allowed through — but it is hardcoded to production
 * (electron/main.ts DEFAULT_HOSTED_URL).
 *
 * Net effect before this script: a Vercel preview could never be used to test
 * the thing PresentFlow actually does. Every operator change had to reach
 * production before anyone could try it.
 *
 * The app already supports a `PF_APP_URL` override (electron/main.ts). This
 * just wraps that in a file a non-technical tester can double-click.
 *
 * Usage:
 *   node scripts/preview/make-preview-launcher.mjs <preview-url> [--out <dir>]
 *
 * Produces, in ./preview-launchers/ by default:
 *   "PresentFlow PREVIEW.command"  (macOS)
 *   "PresentFlow PREVIEW.bat"      (Windows)
 */
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith("--"));
const outIdx = argv.indexOf("--out");
const outDir = resolve(outIdx >= 0 ? argv[outIdx + 1] : "preview-launchers");

if (!url) {
  console.error(`
Give it the preview URL.

  node scripts/preview/make-preview-launcher.mjs https://faithflow-xxxx.vercel.app

Find that URL in Vercel: Deployments -> the row marked "Preview" -> Visit.
`);
  process.exit(1);
}

// Fail loudly on a bad URL rather than shipping a launcher that silently opens
// production — a tester who thinks they are on preview and is not is the worst
// outcome this script can produce.
let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error(`Not a valid URL: ${url}`);
  process.exit(1);
}
if (parsed.protocol !== "https:") {
  console.error(`Refusing a non-https URL (${parsed.protocol}). The app ignores unsupported protocols anyway.`);
  process.exit(1);
}
if (parsed.hostname === "presentflow.org") {
  console.error(`That is PRODUCTION. A launcher pointing at production defeats the point — use the preview URL from Vercel.`);
  process.exit(1);
}

const clean = `${parsed.origin}`;
mkdirSync(outDir, { recursive: true });

// ── macOS ────────────────────────────────────────────────────────────────
// `open -na` starts a NEW instance with the env var applied. Without -n macOS
// would just focus the already-running production copy and ignore PF_APP_URL.
const command = `#!/bin/bash
# PresentFlow — PREVIEW launcher
# Opens the installed PresentFlow app against a preview build instead of the
# live site. Nothing is installed or changed; it only changes which address
# the app loads.
#
# Preview: ${clean}
# Made:    ${new Date().toISOString().slice(0, 10)}

export PF_APP_URL="${clean}"

echo ""
echo "  Opening PresentFlow against the PREVIEW build:"
echo "  ${clean}"
echo ""
echo "  This is NOT the live site. It is safe to experiment."
echo "  Close this window once the app has opened."
echo ""

if [ ! -d "/Applications/Present Flow.app" ]; then
  echo "  Could not find PresentFlow in your Applications folder."
  echo "  Install the desktop app first, then run this again."
  echo ""
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

open -na "/Applications/Present Flow.app"
sleep 2
`;
const cmdPath = join(outDir, "PresentFlow PREVIEW.command");
writeFileSync(cmdPath, command);
chmodSync(cmdPath, 0o755); // double-clickable in Finder

// ── Windows ──────────────────────────────────────────────────────────────
// `set` scopes the variable to this shell, so the launched app inherits it and
// nothing else on the machine is affected.
const bat = `@echo off
REM PresentFlow - PREVIEW launcher
REM Opens the installed PresentFlow app against a preview build instead of the
REM live site. Nothing is installed or changed.
REM
REM Preview: ${clean}
REM Made:    ${new Date().toISOString().slice(0, 10)}

set "PF_APP_URL=${clean}"

echo.
echo   Opening PresentFlow against the PREVIEW build:
echo   ${clean}
echo.
echo   This is NOT the live site. It is safe to experiment.
echo.

set "PF_EXE=%LOCALAPPDATA%\\Programs\\present-flow\\Present Flow.exe"
if not exist "%PF_EXE%" set "PF_EXE=%PROGRAMFILES%\\Present Flow\\Present Flow.exe"

if not exist "%PF_EXE%" (
  echo   Could not find PresentFlow on this computer.
  echo   Install the desktop app first, then run this again.
  echo.
  pause
  exit /b 1
)

start "" "%PF_EXE%"
timeout /t 2 >nul
`;
writeFileSync(join(outDir, "PresentFlow PREVIEW.bat"), bat);

console.log(`
Built two launchers in ${outDir}

  PresentFlow PREVIEW.command   macOS
  PresentFlow PREVIEW.bat       Windows

Both point at: ${clean}

Send the matching one to whoever is testing. They double-click it; the app they
already have opens against the preview instead of the live site.

NOTE: this changes which SITE the app loads. The Electron shell itself — NDI,
the LAN overlay server, window handling — is still whatever version they have
installed. A change to that needs a new build, not this.
`);
