# Build the native NDI addons (sender + AUDIO receiver) for the current Electron
# ABI on WINDOWS, before electron-builder packages the .exe. NON-FATAL: if the NDI
# SDK isn't installed (or a build fails), we log + continue so the installer still
# builds — NDI just stays unavailable at runtime.
#
# Requires: NDI 6 SDK installed (C:\Program Files\NDI\NDI 6 SDK) + MSVC build tools
# + node-gyp prerequisites. Run from the repo root:  powershell -File scripts\ndi-rebuild.ps1
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sdk = $env:NDI_SDK_DIR
if (-not $sdk) { $sdk = "C:\Program Files\NDI\NDI 6 SDK" }

if (-not (Test-Path (Join-Path $sdk "Include"))) {
  Write-Host "[ndi-rebuild] NDI SDK not found at $sdk — skipping NDI addon build (NDI unavailable in this build)."
  exit 0
}

$electronVersion = ""
try { $electronVersion = (Get-Content (Join-Path $here "node_modules\electron\package.json") | ConvertFrom-Json).version } catch {}
if (-not $electronVersion) {
  Write-Host "[ndi-rebuild] Could not resolve Electron version — skipping (NDI unavailable)."
  exit 0
}

function Build-Addon($name, $out) {
  $addon = Join-Path $here "native\$name"
  if (-not (Test-Path $addon)) { Write-Host "[ndi-rebuild] $name not present — skipping."; return }
  Write-Host "[ndi-rebuild] Vendoring SDK + rebuilding $name for Electron $electronVersion..."
  Push-Location $addon
  try {
    powershell -ExecutionPolicy Bypass -File (Join-Path $addon "prepare-sdk.ps1")
    if (-not (Test-Path (Join-Path $addon "node_modules"))) {
      npm install --no-audit --no-fund --ignore-scripts
    }
    npx --yes @electron/rebuild@latest -v $electronVersion -m .
  } catch {
    Write-Host "[ndi-rebuild] $name build failed — continuing WITHOUT it. $_"
  } finally {
    Pop-Location
  }
  $node = Join-Path $addon "build\Release\$out"
  if (Test-Path $node) { Write-Host "[ndi-rebuild] OK: $node" }
  else { Write-Host "[ndi-rebuild] WARNING: $out not produced — that NDI feature will be unavailable." }
}

Build-Addon "ndi-sender" "ndi_sender.node"
Build-Addon "ndi-receiver" "ndi_receiver.node"
exit 0
