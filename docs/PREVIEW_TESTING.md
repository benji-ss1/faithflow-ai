# Testing a preview build — steps for Victor (and for you)

## Why this is needed at all

The operator console **cannot be opened in a normal browser**. `src/middleware.ts`
redirects any browser request for `/operator` to `/settings/outputs` —
*"a plain browser must not be able to reach any part of the live-show surface"*.

Only the desktop app is allowed through, and the desktop app is hardcoded to
the live site (`electron/main.ts` `DEFAULT_HOSTED_URL`). So until now, **no
preview could be used to test the thing PresentFlow actually does.**

The app already reads a `PF_APP_URL` override. The launcher just wraps that in
a file you can double-click.

---

## For Victor — 4 steps, nothing to install

You already have PresentFlow installed. This does not install anything, change
your app, or touch the live site. It opens the app you already have against a
**test build** instead.

1. **Save the file** you were sent (`PresentFlow PREVIEW.command` on a Mac,
   `PresentFlow PREVIEW.bat` on Windows) anywhere — Desktop is fine.

2. **First time only, macOS:** right-click it → **Open** → **Open** again.
   (A normal double-click shows "unidentified developer". Right-click → Open
   gets past it once, then it works normally.)
   **Windows:** if SmartScreen appears, click **More info** → **Run anyway**.

3. **Double-click it.** A small black window appears saying which build it is
   opening, then PresentFlow opens. You can close the black window.

4. **Log in as normal.**

To go back to the live app, just open PresentFlow the way you always do. The
launcher only affects the window it opened.

### What to expect

- It looks identical to the real app. **That is the point** — and also the risk,
  so keep the black window's message in mind: it tells you which build you are on.
- You may be asked to log in again. Normal: a test build does not share the
  live app's login.

### What is worth reporting

Anything that looks wrong, but especially: something that worked before and
doesn't now, anything on the projector/stage output, and anything that made you
hesitate or hunt for a control.

---

## For the developer — making a launcher

```bash
node scripts/preview/make-preview-launcher.mjs <preview-url>
```

Get `<preview-url>` from Vercel → **Deployments** → the row marked **Preview**
→ **Visit** → copy the address.

It writes both launchers into `preview-launchers/`. Send Victor the one for his
platform. It refuses a non-https URL and refuses the production URL, so it
cannot quietly point someone at the live site.

You can use the same launcher yourself — there is nothing Victor-specific in it.

---

## What this DOES NOT cover — read before trusting a result

- **Only the website changes.** The Electron shell — NDI, the LAN overlay
  server, output windows, auto-update — is whatever version is installed. A
  change there needs a new build, not this launcher.
- **A preview may share the live database.** If it does, anything created or
  DELETED while testing is real. See `docs/STAGING_AUDIT.md` — the decisive
  check is at the top and takes a minute.
- **AI detection is not equivalent on a preview.** The audio bridge's callback
  secret is production-only, so detection is silently degraded. Do not
  benchmark detection quality on a preview.
- **Cross-device sync is untestable on a preview** (the Supabase keys are
  production-only). Same-machine output works normally.
