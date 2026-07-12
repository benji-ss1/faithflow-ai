# Decisions — Present Flow Rebrand

Judgment calls made during the global FaithFlow AI → Present Flow rename (electron shell).

## Intentionally-preserved references

The following FaithFlow references were **not** renamed because they are load-bearing against live infrastructure or existing data:

### 1. `fly.toml` — Fly.io app name

- **Line 9:** `app = "faithflow-audio"`
- **Why kept:** This is the Fly.io application identifier bound to the live audio bridge deployment (`wss://faithflow-audio.fly.dev`). Renaming here without also renaming the Fly.io app would break `fly deploy`, and renaming the Fly.io app is a separate operational change (would invalidate the WSS URL that the Vercel app currently talks to via `NEXT_PUBLIC_AUDIO_WS_URL`).
- **Follow-up:** When we're ready to migrate the audio bridge, create a new Fly.io app (`presentflow-audio`), update `NEXT_PUBLIC_AUDIO_WS_URL` in Vercel env, then update this file and delete the old app.
- Comments and other prose inside `fly.toml` were rebranded.

### 2. `src/lib/db/schema.ts` — `command_prefix` default

- **Line 299:** `commandPrefix: text("command_prefix").notNull().default("faithflow")`
- **Why kept:** This is the DB column default. Existing rows in production already contain `"faithflow"` as the wake-word prefix, and the command parser matches on this literal. Changing the schema default alone would create an inconsistency between old and new rows without also running a data migration + updating the parser + retraining users' muscle memory.
- **Follow-up:** A future migration should either (a) rename the wake-word to `"presentflow"` with a data migration + user-facing changelog, or (b) make it fully user-configurable and drop the default.

### 3. `scripts/seed-demo.ts` — demo user email

- **Line 22:** `const DEMO_EMAIL = "demo@jpd.faithflow.ai"`
- **Why kept:** This email exists in the live Supabase auth table (see memory: `demo@jpd.faithflow.ai / JpdReview2026!` demo credentials for JPD review). Renaming the seed script literal without also rotating the auth row would break demo access.
- **Follow-up:** When we cut over the demo tenant, provision `demo@jpd.presentflow.app` (or similar), update Supabase auth, then update this literal.

## Placeholder URL choice

All hardcoded references to `https://faithflow-ai.vercel.app` were replaced with `https://presentflow.app`. Rationale:

- The final domain for the Electron shell is not yet decided (could be `presentflow.app`, `getpresentflow.com`, etc.), and Vercel-preview URLs are not the right shape for a shipping app.
- `presentflow.app` is used as a stable placeholder that (a) is obviously not a live URL yet, and (b) is easy to `grep` for and swap out once the real domain is chosen.
- External live service URLs (Supabase project URL, Fly.io `*.fly.dev`) were **not** changed — those live in `.env.local` and remain bound to the current backend.

## Excluded from rewrite

- `node_modules/`, `.git/`, `.next/` — build/vendor output
- `package-lock.json` — will be regenerated on next `npm install`
- `.env.local` — secrets file, contains references to live infra keys and URLs that must stay bound to current backend

## Electron shell judgment calls

### 1. `sandbox: false` on BrowserWindows

Kept `sandbox: false` on both the main window and output windows so the
preload script can call `require('electron')` for `contextBridge` +
`ipcRenderer`. `contextIsolation: true` + `nodeIntegration: false` still
prevent the renderer itself from touching Node. This matches the guidance
in the step-2 spec.

### 2. Random free port instead of fixed 3000 in prod

Spec asked for a random free port when spawning the standalone Next server.
Implemented via a transient `net.createServer().listen(0)` at startup. Dev
mode still hits :3000 (next dev is fixed there).

### 3. Fullscreen via `setFullScreen(true)` after show

Frameless + fullscreen at construction time can crash on macOS if the
target display isn't ready. Windows are constructed non-fullscreen at
target `display.bounds`, then flipped to fullscreen on `ready-to-show`.

### 4. `audio:listInputs` returns a "strategy" hint, not the actual device list

`navigator.mediaDevices.enumerateDevices()` runs in the renderer with real
device labels because the main process pre-approves the media permission.
Duplicating that in main would require an extra hidden window. The IPC
handler is retained (returns `{strategy: 'renderer-mediadevices'}`) for
API-shape symmetry with `listSystemSources`; renderer code calls
`navigator.mediaDevices` directly.

### 5. `desktopCapturer.getSources` types restricted to `screen | window`

Electron's TypeScript types don't accept `'audio'` in the `types` array,
even though the underlying OS APIs support audio-loopback selection via
`getUserMedia` constraints keyed off the returned source id. We pass
`['screen', 'window']` — audio capability is picked up by the renderer
using `chromeMediaSource: 'desktop'` + the source id.

### 6. `fs:readFile` 50 MB cap; no chunked transport yet

Files larger than 50 MB are refused with `{tooLarge: true}`. A chunked
IPC transport (streaming base64 or a Node `net` socket) is deferred until
we hit a real >50 MB import file. PPTX exports and ProPresenter bundles
almost always fit in this budget.

### 7. System-audio picker UI wiring deferred

The `audio:listSystemSources` IPC is exposed and returns loopback-capable
sources, but the Settings audio picker wasn't re-wired to render them —
the existing microphone flow still works unchanged. Added a reusable
`ElectronFilePickers` component instead so the desktop-only surfaces are
one import away wherever needed. Wiring the system-audio section into
`SettingsForm.tsx` is a follow-up.

### 8. File/folder import buttons wired only through reusable component

Rather than editing every import surface (song import, PPTX upload,
ProPresenter migration wizard, EasyWorship migration wizard), added a
shared `ElectronPickFilesButton` / `ElectronPickFolderButton` that
render `null` outside Electron. Concrete surface wiring is a follow-up.

### 9. Code signing skipped

`electron:build` builds unsigned by default. Signing on macOS needs an
Apple developer team ID + application password / Developer ID cert;
Windows needs an EV cert. Both are blocked on credentials.

### 10. Auto-restore mapping stored in `localStorage`

The screens page stores `{ [displayId]: {role, preset, spawned} }` in
localStorage under `presentflow.screenAssignments.v1`. Displays IDs are
stable per hardware but not across machines — this is intentional
(per-machine config, not synced to the cloud).

## Electron import surfaces — rehydrating File blobs

The Electron pickers return `{ base64, name, ext, absPath }` records over
IPC. Rather than plumb a second upload path for absolute file paths, the
picker callbacks reconstruct standard `File` blobs from the base64 payload
and hand them to the *existing* upload/parse flows (`/api/media/presign`,
`/api/imports/parse`). Costs: an extra memcpy per file, and the 50 MB
cap already enforced by `electronAPI.fs.readFile`. Benefit: zero new
server code, and the browser build stays byte-identical.

For the wizard folder picker, `webkitRelativePath` is patched onto each
`File` via `Object.defineProperty` so the server parser continues to see
folder-relative source paths (used for skip/collision reporting).
