# Windows build of the Blackmagic embedded-audio addon. NON-FATAL (see decklink-rebuild.sh).
$here = Split-Path -Parent $PSScriptRoot
$addon = Join-Path $here "native\decklink-audio"
$sdk = if ($env:DECKLINK_SDK_DIR) { $env:DECKLINK_SDK_DIR } else { "C:\Blackmagic DeckLink SDK" }
if (-not (Test-Path (Join-Path $sdk "Win\include\DeckLinkAPI.idl"))) {
  Write-Host "[decklink-rebuild] Desktop Video SDK not found at '$sdk' - skipping (Blackmagic audio unavailable)."
  exit 0
}
try {
  Push-Location $addon
  $env:DECKLINK_SDK_DIR = $sdk
  & powershell -ExecutionPolicy Bypass -File prepare-sdk.ps1
  if ($LASTEXITCODE -ne 0) { throw "prepare-sdk failed" }
  if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund --ignore-scripts }
  npx --yes node-gyp@10.2.0 rebuild --arch=x64
  if ($LASTEXITCODE -ne 0) { throw "node-gyp failed" }
  Write-Host "[decklink-rebuild] OK"
} catch {
  Write-Host "[decklink-rebuild] build failed - continuing WITHOUT Blackmagic audio: $_"
} finally { Pop-Location }
exit 0
