# PresentFlow — Complete Color System

> Source of truth: `src/app/globals.css` (Tailwind v4 `@theme` block — there is **no tailwind.config file**; all customization lives in this CSS file). Three distinct palettes coexist:
> 1. **App chrome (operator/desktop)** — dark-default token set + `.light` inversion
> 2. **Admin scope** (`.pf-admin-scope`) — warm-ivory/terracotta palette for the web admin overhaul
> 3. **Slide themes** — user-content palettes for projector output (separate system, not chrome)

## 1. Canonical brand colors

| Token | Value | Usage |
|---|---|---|
| `--color-brand` (dark mode, canonical) | **`#ff7a2c`** | THE brand orange. Primary, ring, splash accent, `Flow` in splash wordmark, default custom-theme accent |
| `--color-accent` / `--color-ai-listening` | **`#ff9048`** | Lighter companion orange |
| `--color-brand-hi` | `#ffb861` | High/glow end of the orange ramp |
| `--color-brand-muted` | `#cf5f1e` | Muted orange; becomes the brand color in light mode |
| Admin accent `--pf-admin-accent` | **`#9C481B`** | Terracotta — admin surfaces + sidebar `Flow` wordmark (deliberately deepened from `#E8742A`, per comment in globals.css) |

⚠️ **`#f97316` (Tailwind orange-500) is NOT the canonical brand color** — but it is hardcoded **44 times** across ~12 operator components (`AudioTab.tsx`, `AudioDiagnosticsScan.tsx`, `VocalChannelAutoDetectModal.tsx`, `SettingsModal.tsx`, `MediaSection.tsx`, `AIDetectionsPanel.tsx`, settings tabs, etc.) as an inline accent. It's a drift/inconsistency, not the brand definition. Canonical = `#ff7a2c` (globals.css line 9 comment: "Orange (#ff7a2c / #ff9048) is the single accent, echoing the flowing gradient in the brand mark").

### Brand gradients (the logo IS a gradient mark — purple→magenta→orange play button)

| Token | Stops | Where |
|---|---|---|
| `--pf-gradient-brand` | `135deg, #9B8FE8 0% → #9C481B 50% → #D4537E 100%` | Signature stripe/hero glows (admin scope), `.pf-brand-stripe` |
| `--pf-gradient-brand-subtle` | same stops at 15% alpha | Subtle washes |
| `--pf-gradient-dark-bg` | `135deg, #0B0B0B 0% → #1A0A14 40% → #0B0B0B 100%` | Dark sidebar header plate |
| `--pf-sidebar-header-bg` (light) | `135deg, #FAF6EF 0% → #F0E7DA 55% → #E9D9C4 100%` | Sidebar brand plate on ivory |
| Auth flow-mesh SVG (`AuthShell.tsx:151-156`) | `#ffb861 → #ff6a1f → #a874d6 → #ff6a1f → #ffb861` | Animated auth-panel mesh ("gold→orange→purple") |
| `.pf-brand-text` | `90deg, var(--color-brand-hi) #ffb861 → var(--color-brand) #ff7a2c` | Gradient-clipped wordmark text |

## 2. App chrome — dark mode (default; desktop shell)

All hex/rgba values are literal in `globals.css` (no oklch or unresolved vars).

| Token | Value | Usage |
|---|---|---|
| `--color-app-bg` / `--color-background` | `#000000` | App background (near-black console) |
| `--color-shell` | `#050405` | Deepest shell layer |
| `--color-sidebar-bg` | `#0a0810` | Sidebar |
| `--color-panel` / `--color-muted` | `#0e0b12` | Elevated panel |
| `--color-raised-shell` / `--color-card` / `--color-popover` | `#171319` | Card surface |
| `--color-elevated` / `--color-secondary` / `--color-sidebar-item-active` | `#1c1820` | Highest surface |
| `--color-shell-edge` | `rgba(255,255,255,0.06)` | Hairline edges |
| `--color-overlay-soft` | `rgba(255,255,255,0.03)` | Soft overlay |
| `--color-glow` | `rgba(255,144,72,0.18)` | Orange glow |
| `--color-foreground` (+card/popover-foreground) | `#ece7e0` | Primary text (warm off-white) |
| `--color-muted-foreground` | `#9c958b` | Secondary text |
| `--color-sidebar-fg` | `#d5cdc1` | Sidebar text |
| `--color-sidebar-fg-muted` | `#847d72` | Sidebar muted text |
| `--color-primary` | `#ff7a2c` | Primary actions |
| `--color-primary-foreground` / `--color-accent-foreground` / `--color-destructive-foreground` | `#17130c` | Text on orange |
| `--color-accent` | `#ff9048` | Accent |
| `--color-success` / `--color-ai-approved` | `#4fd18b` | Success green |
| `--color-warning` | `#f0b35a` | Warning amber |
| `--color-destructive` | `#ff6d6d` | Destructive red |
| `--color-border` / `--color-input` | `rgba(255,255,255,0.10)` | Borders/inputs |
| `--color-ring` | `#ff7a2c` | Focus ring |
| `--color-sidebar-item-hover` | `#171319` | Sidebar hover |
| `--color-ai-idle` | `#6f685e` | AI status: idle |
| `--color-ai-listening` | `#ff9048` | AI status: listening |
| `--color-ai-processing` | `#ffb861` | AI status: processing |

Radii: `--radius-md: 8px`, `--radius-lg: 12px`, `--radius-xl: 14px`.

## 3. App chrome — light mode (`html.light`; web admin default)

| Token | Value |
|---|---|
| `--color-app-bg` / `--color-background` / `--color-sidebar-bg` | `#faf8f5` (warm ivory) |
| `--color-panel` / `--color-raised-shell` / `--color-card` / `--color-popover` / `--color-primary-foreground` | `#ffffff` |
| `--color-elevated` / `--color-muted` / `--color-secondary` / `--color-sidebar-item-hover` | `#f4efe8` |
| `--color-shell` / `--color-sidebar-item-active` | `#eae5dd` |
| `--color-shell-edge` | `rgba(23,19,25,0.08)` |
| `--color-overlay-soft` | `rgba(23,19,25,0.03)` |
| `--color-glow` | `rgba(255,122,44,0.14)` |
| `--color-foreground` (+card/popover/secondary/accent-foreground, sidebar-fg) | `#17130c` |
| `--color-muted-foreground` / `--color-sidebar-fg-muted` / `--color-ai-idle` | `#6a635a` |
| `--color-primary` / `--color-brand` / `--color-ai-listening` | `#cf5f1e` (darkened orange for contrast on ivory) |
| `--color-brand-muted` | `#a24818` |
| `--color-brand-hi` | `#ff9048` |
| `--color-accent` | `#ffe6d1` (pale orange wash) |
| `--color-border` / `--color-input` | `#e3ddd2` |
| `--color-ring` | `#ff7a2c` |
| `--color-ai-processing` | `#b9531a` |
| `--color-ai-approved` | `#159a5c` |

Theme default logic (`src/app/layout.tsx`): web admin defaults **light**, desktop Electron shell defaults **dark**; explicit `ff_theme` cookie wins.

## 4. Admin scope (`.pf-admin-scope`) — light

| Token | Value | Usage |
|---|---|---|
| `--pf-admin-bg-page` | `#F5F1EA` | Page |
| `--pf-admin-bg-card` | `#FAF6EF` | Cards |
| `--pf-admin-bg-subtle` | `#EFEBE2` | Subtle bg |
| `--pf-admin-bg-muted` | `#E8E3D8` | Muted bg |
| `--pf-admin-bg-hover` | `#E1DBCE` | Hover |
| `--pf-admin-bg-accent` | `rgba(156,72,27,0.05)` | Accent wash |
| `--pf-admin-text` | `#1A1614` | Text |
| `--pf-admin-text-secondary` | `#6B665E` | Secondary |
| `--pf-admin-text-muted` | `#96908A` | Muted |
| `--pf-admin-text-inverse` | `#FAF6EF` | Inverse |
| `--pf-admin-border` | `#DED7C8` | Border |
| `--pf-admin-border-subtle` | `#E8E2D3` | Subtle border |
| `--pf-admin-border-strong` | `#C7BFAD` | Strong border |
| `--pf-admin-accent` / `-hover` | `#9C481B` | Terracotta accent |
| `--pf-admin-accent-soft` | `rgba(156,72,27,0.08)` | Soft accent |
| `--pf-admin-accent-ring` | `rgba(156,72,27,0.25)` | Focus ring |
| `--pf-admin-purple` | `#9B8FE8` | Gradient stop / categorical |
| `--pf-admin-pink` | `#D4537E` | Gradient stop / categorical |
| `--pf-admin-gold` | `#EF9F27` | Categorical |
| `--pf-admin-green` | `#3D9A50` | Success |
| `--pf-admin-red` | `#DC3545` | Error |

### Admin scope — dark override (`html:not(.light) .pf-admin-scope`)

| Token | Value |
|---|---|
| `--pf-admin-bg-page` / `--pf-admin-text-inverse` | `#0B0B0B` |
| `--pf-admin-bg-card` / `--pf-admin-bg-subtle` | `#141414` |
| `--pf-admin-bg-muted` | `#1E1E1E` |
| `--pf-admin-bg-hover` | `#252525` |
| `--pf-admin-bg-accent` | `rgba(156,72,27,0.10)` |
| `--pf-admin-text` / sidebar-header-text | `#F1EFE8` |
| `--pf-admin-text-secondary` | `#A8A6A0` |
| `--pf-admin-text-muted` | `#6B6A66` |
| `--pf-admin-border` | `rgba(255,255,255,0.08)` |
| `--pf-admin-border-subtle` | `rgba(255,255,255,0.04)` |
| `--pf-admin-border-strong` | `rgba(255,255,255,0.15)` |
| `--pf-admin-accent-soft` | `rgba(156,72,27,0.14)` |
| `--pf-admin-accent-ring` | `rgba(156,72,27,0.3)` |

## 5. Slide themes (projector content — NOT app chrome)

User-defined per church, stored in DB (`themes` table) + localStorage quick-themes. Code-level defaults/presets:

**Library editor seed** (`ThemesManager.tsx:28-38`): text `#F1EFE8` on solid `#0B0B0B` (gradient second stop `#1A0A14`), font Inter 600, 72px lyrics / 56px scripture.

**Operator quick-theme defaults** (`ThemesTab.tsx:190-192`): text `#ffffff`, bg `#111111`, accent `#ff7a2c`.

**Demo swatches** (`ThemesTab.tsx:13`, explicitly "content, not chrome"): `#0e0b12`, `#1c1820`, `#ff7a2c`, `#ff9048`, `#4fd18b`, `#f0b35a`.

**Premium theme preview gradients** (`ThemesTab.tsx:29-34`, mock, Max-tier locked):
- Cinematic: `135deg, #0b1220 → #1a2a5e`
- Modern: `135deg, #111 → #3a3a3a`
- Elegant: `135deg, #2b1b3d → #8a4fbf`
- Youth: `135deg, #ff5c8a → #ffb85c`

## 6. Other notable literals

- Electron splash (`electron/splash.html`): bg `#0a0a0a`, text `#fff`, accent/spinner `#ff7a2c`, spinner track `rgba(255,255,255,0.15)`.
- Song-pulse highlight: amber `rgba(251,191,36,…)` (Tailwind amber-400).
- Auto-correction flash: yellow `rgba(250,204,21,…)` / `#fef3c7` / `#fde68a` (Tailwind yellow ramp).
- Auth background: `radial-gradient(1100px 780px at 18% 0%, #0c0c0c 0%, #000 62%)`.
- Selection: `color-mix(in oklab, var(--color-brand) 30%, transparent)`.
- A leftover `.ff-card-premium:hover` ring uses `rgba(111,224,194,0.06)` (a cyan remnant — the file header says "No cyan").

## Marketing recommendation

Canonical set: **`#ff7a2c` (brand orange)**, `#ff9048` (accent), `#ffb861` (hi), `#cf5f1e` (light-mode orange), `#9C481B` (admin terracotta), plus the signature gradient `#9B8FE8 → #9C481B → #D4537E`, on near-black (`#000`/`#0B0B0B`) and warm ivory (`#faf8f5`/`#F5F1EA`) grounds. Decide whether `#f97316` drift gets folded into `#ff7a2c`.
