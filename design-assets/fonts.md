# PresentFlow — Fonts

> **No font binaries exist in the repo** (zero .woff/.woff2/.ttf/.otf outside node_modules). `design-assets/fonts/` is intentionally empty. No `next/font` usage and no `@font-face` rules either.

## How fonts load

Single Google Fonts CSS import at the top of `src/app/globals.css` (line 2):

```css
@import url("https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap");
```

## Families to fetch for the design system

| Role | Family | Weights loaded | Declared at | Applied to |
|---|---|---|---|---|
| Display / headings | **Sora** | 400, 500, 600, 700, 800 | `globals.css:2` + `--font-display` token (`globals.css:72`) | `h1, h2, h3, .font-display` (letter-spacing −0.02em) |
| Body / UI | **Plus Jakarta Sans** | 400, 500, 600, 700 | `globals.css:2` + `--font-sans` token (`globals.css:71`) | `html, body` (letter-spacing −0.005em) |
| Mono / eyebrow labels | system mono (`ui-monospace, "SF Mono", Menlo, Monaco, Consolas`) | n/a | `--font-mono` (`globals.css:73`) | `.eyebrow` micro-labels (10px, 600, uppercase, tracking 0.14em) |

Full fallback stacks as declared:

```
--font-sans:    "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif;
--font-display: "Sora", ui-sans-serif, system-ui, -apple-system, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif;
--font-mono:    ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

## Slide-theme fonts (projector content — separate system from app chrome)

- Library theme editor (`src/components/library/ThemesManager.tsx:20`): `FONT_CHOICES = ["Inter", "Sora", "Plus Jakarta Sans", "Georgia", "Helvetica", "Arial", "Times New Roman"]`, default `Inter`, default sizes 72px lyrics / 56px scripture, weight 600.
- Operator quick-theme dialog (`src/components/operator/pro/right/tabs/ThemesTab.tsx:21-26`): Inter / Georgia (serif) / ui-monospace / system-ui.

**Caveat worth flagging:** `Inter` is the default slide font and appears in fallback stacks, but **Inter is never actually loaded** — it resolves only if installed on the machine, otherwise falls through to system fonts.

## Electron splash

`electron/splash.html` uses only the system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI"`), no webfonts (correct for offline-first splash).

## Marketing takeaway

Fetch from Google Fonts: **Sora (400–800)** and **Plus Jakarta Sans (400–700)**. Decide whether Inter is officially part of the brand (currently referenced but never shipped).
