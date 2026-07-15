# Installing the Present Flow tester build

This build is unsigned and intended for internal testers only. Do not
redistribute publicly.

## macOS

1. Download the latest `Present Flow-<version>.dmg` from the `release/`
   directory (or the URL your Present Flow contact shared with you).
2. Open the `.dmg` and drag **Present Flow** into your `Applications`
   folder.
3. The first time you launch the app, macOS will refuse to open it
   because it is not code-signed. To bypass:
   - Open Finder → `Applications`.
   - Right-click **Present Flow** → **Open** → **Open** again in the
     dialog.
   - (Alternatively: System Settings → Privacy & Security → scroll to
     the blocked-app notice → **Open Anyway**.)
4. Sign in with the demo credentials:
   - Email: `demo@jpd.faithflow.ai`
   - Password: `JpdReview2026!`

Demo credentials are for review only. Do **not** post them in public
channels or reuse them for production data.

## Reporting issues

Include:
- macOS version (`sw_vers`)
- Build filename (e.g. `Present Flow-0.1.0-arm64.dmg`)
- What you clicked / what happened
- Console log if the app crashed (Console.app → search "Present Flow")

## Rebuilding locally

```bash
npm install
npm run electron:build:tester
```

The `.dmg` will land at `release/Present Flow-<version>.dmg`.
