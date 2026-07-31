# PresentFlow — Logo & Brand Mark Inventory

> Extracted 2026-07-29 from `presentflow-electron` (read-only sweep).
> **Headline finding: the entire repo contains exactly ONE raster brand asset.** Everything else that looks like "branding" in the product is either CSS text styling or an inline SVG effect.

## Assets that exist

| File | Size | Dimensions | Format | Where it's used |
|---|---|---|---|---|
| `logos/pf-logo-mark.png` (from `public/brand/pf-logo-mark.png`) | 45,953 bytes (~45 KB) | **185 × 205 px** (note: not square) | PNG, 8-bit RGBA, transparent background | The one and only logo. Used as: web favicon + apple-touch icon (`src/app/layout.tsx` metadata), sidebar brand tile (`src/components/layout/Sidebar.tsx:356`), operator TopBar (`src/components/operator/pro/TopBar.tsx:823`), auth screens (`src/components/auth/AuthShell.tsx:31,60,200`), upgrade layout (`src/app/upgrade/layout.tsx:25`), onboarding splash + wizard |

**What the mark looks like:** a layered, glossy "play button" (triangle-in-rounded-triangle) with a purple → magenta → orange gradient. This gradient is echoed in code by two token sets:

- CSS token `--pf-gradient-brand: linear-gradient(135deg, #9B8FE8 0%, #9C481B 50%, #D4537E 100%)` (purple → terracotta → pink, `globals.css` admin scope)
- Auth "flow mesh" inline SVG gradient (`AuthShell.tsx:151-156`): `#ffb861 → #ff6a1f → #a874d6 → #ff6a1f → #ffb861` (animated)

## The wordmark is NOT an asset — it's styled text

There is no wordmark image/SVG anywhere. "PresentFlow" is always rendered as live text:

- **Sidebar** (`Sidebar.tsx:369-372`): `Present` in the header text token + `Flow` hardcoded terracotta `#9C481B`, font = Plus Jakarta Sans/Sora stack, semibold.
- **Electron splash** (`electron/splash.html:13-14,25`): `Present<span>Flow</span>` — 22px, weight 700, system font (`-apple-system`), `Flow` in `#ff7a2c` on `#0a0a0a` background.
- **Auth screens** use `.pf-brand-text` gradient-clipped text: `linear-gradient(90deg, #ffb861, #ff7a2c)`.

So the "wordmark" exists in at least 3 slightly different colorings (`#9C481B` terracotta, `#ff7a2c` orange, gradient clip). Marketing will need one canonical lockup.

## Electron / desktop branding (DMG + app icon)

- **No app icon is configured.** `package.json > build` (the electron-builder config) has **no `icon` field**, no `build/` resources folder, no `.icns`, no `.ico` anywhere in the repo. The shipped DMG and the installed "Present Flow.app" therefore use the **default Electron icon**.
- **Tray icon is deliberately empty**: `electron/main.ts:262-263` uses `nativeImage.createEmpty()` for the Tray.
- **Splash screen** (`electron/splash.html`): pure HTML/CSS — near-black `#0a0a0a` bg, white/orange text wordmark, orange `#ff7a2c` spinner. No image assets.
- Product name on disk: **"Present Flow"** (with a space) per `productName`; appId `com.presentflow.app`; artifact `Present-Flow-<version>-<arch>-mac.dmg`.

## Gap list (what marketing needs that does NOT exist)

Confirming the design tool's flags — all three are real gaps, plus more:

1. **No SVG version of anything.** The mark exists only as a 185×205 PNG. No vector source (no .svg, .ai, .fig in repo).
2. **No light-background logo variant.** The single PNG has a transparent background and its gradient was designed against dark UI; there is no tested light/ivory variant (the web admin default theme is light `#faf8f5` — the same PNG is simply reused).
3. **No icon decision / no app icon set.** No `.icns`, no `.ico`, no favicon.ico, no 512/1024 marks, no maskable icons. Desktop app ships with the stock Electron icon. Tray icon is intentionally blank.
4. **No wordmark asset** (horizontal lockup, stacked lockup) — only styled HTML text, with 3 competing accent colors.
5. **No square version of the mark** — 185×205 is a non-square odd size; favicon/apple-touch usage is technically off-spec.
6. **No opengraph/social image** (`opengraph-image`, `twitter-image` — nothing in `src/app/`).
7. **No font binaries** (see `fonts.md`) — Sora + Plus Jakarta Sans load from Google Fonts CDN at runtime.
8. **No brand color single source of truth** — canonical dark-mode brand is `#ff7a2c`, but `#9C481B` (admin/terracotta), `#cf5f1e` (light mode), and hardcoded Tailwind `#f97316` (44 occurrences in operator components) all coexist. See `colors.md`.
