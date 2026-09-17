# Vendor the Blackmagic Desktop Video SDK (Windows) headers into sdk\include and
# generate DeckLinkAPI_h.h + DeckLinkAPI_i.c with MIDL (Visual Studio Build Tools).
# $env:DECKLINK_SDK_DIR = the unzipped "Blackmagic DeckLink SDK x.y" folder.
$ErrorActionPreference = "Stop"
$sdk = if ($env:DECKLINK_SDK_DIR) { $env:DECKLINK_SDK_DIR } else { "C:\Blackmagic DeckLink SDK" }
$src = Join-Path $sdk "Win\include"
if (-not (Test-Path (Join-Path $src "DeckLinkAPI.idl"))) { Write-Host "[decklink] SDK not found at $src"; exit 1 }
$out = Join-Path $PSScriptRoot "sdk\include"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item "$src\*" $out -Force
Push-Location $out
midl /nologo /env x64 /h DeckLinkAPI_h.h /iid DeckLinkAPI_i.c DeckLinkAPI.idl
Pop-Location
Write-Host "[decklink] headers vendored + MIDL generated in $out"
