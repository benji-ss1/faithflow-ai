# Vendor the license-gated NDI 6 SDK into ndi-sdk/ so node-gyp can build the
# Windows addon. Run in PowerShell on the Windows build machine BEFORE
# `npm run rebuild-electron` (electron-rebuild). The copied dir is gitignored.
#
# Copies: Include\*  ->  ndi-sdk\include
#         Lib\x64\Processing.NDI.Lib.x64.lib  ->  ndi-sdk\lib\
#         Bin\x64\Processing.NDI.Lib.x64.dll  ->  ndi-sdk\lib\   (runtime, bundled)
#
# Override the SDK location with:  $env:NDI_SDK_DIR = "C:\Path\To\NDI 6 SDK"
$ErrorActionPreference = "Stop"
$sdk = $env:NDI_SDK_DIR
if (-not $sdk) { $sdk = "C:\Program Files\NDI\NDI 6 SDK" }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $here "ndi-sdk"

if (-not (Test-Path (Join-Path $sdk "Include"))) {
  Write-Error "NDI SDK not found at: $sdk. Install the NDI 6 SDK or set `$env:NDI_SDK_DIR."
}

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path (Join-Path $dest "include") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dest "lib") | Out-Null

Copy-Item -Recurse -Force (Join-Path $sdk "Include\*") (Join-Path $dest "include")
Copy-Item -Force (Join-Path $sdk "Lib\x64\Processing.NDI.Lib.x64.lib") (Join-Path $dest "lib")
Copy-Item -Force (Join-Path $sdk "Bin\x64\Processing.NDI.Lib.x64.dll")  (Join-Path $dest "lib")

Write-Host "Vendored NDI SDK -> $dest (from: $sdk)"
