# Updating the Windows NDI desktop app

**Normal path (automatic):** the GitHub "Release desktop app (Windows)" workflow builds NDI into the Windows installer, and it fails if NDI is missing. Windows installs auto-update to it. You don't need to do anything.

**Manual path (Victor's laptop over AnyDesk):** use this only if the automatic build is broken, or to test a branch before release. Victor's laptop (`C:\dev\faithflow-ai`) already has the NDI 6 SDK, Visual Studio Build Tools, Node, Git and GitHub CLI installed. First-time setup on a new PC: install those tools (winget), install the NDI 6 SDK from https://downloads.ndi.tv/SDK/NDI_SDK/NDI%206%20SDK.exe, run `gh repo clone benji-ss1/faithflow-ai`, `npm ci`, then `npm run ndi:rebuild:win`.

Paste **one line at a time**. AnyDesk scrambles multi-line pastes. If a line starts with `>>`, press Enter, or press Ctrl+C and paste it again.

```powershell
cd C:\dev\faithflow-ai
```
```powershell
gh auth login
```
Only needed if you've logged out. Pick GitHub.com → HTTPS → Yes → Login with a web browser.
```powershell
git pull
```
```powershell
npm run electron:build:tsc
```
```powershell
npx electron-builder --win nsis --x64 --publish never
```
```powershell
Start-Process (Get-ChildItem .\release\PresentFlow-Setup-*.exe | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
```

Only if the NDI native code changed (anything under `native/`), run this before the `electron-builder` line:
```powershell
npm run ndi:rebuild:win
```

**Checks:**
```powershell
Get-ChildItem release\win-unpacked\resources\native -Recurse -File | Select-Object FullName
```
This must list `ndi_receiver.node`, `ndi_sender.node` and two `Processing.NDI.Lib.x64.dll` files.

In the app, go to **Audio panel → NDI network audio**, pick the **(OBS PGM)** source, and check that the meter moves and it says "receiving".

**When done:** run `gh auth logout`.

**Traps:**
- If Present Flow won't open, a copy is stuck in the background. Run `Get-Process "Present Flow" -ErrorAction SilentlyContinue | Stop-Process -Force`.
- The DistroAV plugin is only loaded when OBS restarts.
- Never upload a hand-built installer to GitHub Releases.
