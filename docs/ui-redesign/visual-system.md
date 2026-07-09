# Visual System

## Core Direction

- dark-first premium SaaS
- calm production-tech tone
- structural anchor: `#232b2b`
- layered, legible surfaces
- subtle gloss and glass only where it adds hierarchy

## Token Ideas

### Base neutrals

- `--background`: `#151919`
- `--surface`: `#1b2121`
- `--panel`: `#232b2b`
- `--elevated`: `#2b3434`
- `--border`: `#394444`
- `--muted`: `#8c9797`
- `--foreground`: `#eef3f2`

### Accent system

- `--primary`: `#6fe0c2`
- `--accent`: `#7bc7ff`
- `--success`: `#4fd18b`
- `--warning`: `#f0b35a`
- `--danger`: `#f26d6d`

### Supporting shades

- darker background scale:
  - `#111414`
  - `#151919`
  - `#1b2121`
  - `#232b2b`
  - `#2b3434`
- card overlay highlight:
  - `rgba(255,255,255,0.03)`
- border glow:
  - `rgba(111,224,194,0.16)`

## Card Colors

- default cards use `panel`
- elevated / premium cards use `elevated`
- special premium cards can use a low-contrast gradient from `#232b2b` to `#2b3434`
- billing / license / plan cards can get subtle accent rim lighting

## Border Colors

- standard border:
  - `#394444`
- hover border:
  - `#4a5757`
- active border:
  - tint toward `primary` or `accent`

## Typography

Recommended fonts:

- app UI:
  - `Inter`
  - or `Geist Sans`
- optional display font for marketing only:
  - `Sora` or `Manrope`
- operator UI:
  - keep neutral and readable
  - avoid decorative display fonts

Type hierarchy:

- page titles:
  - medium-bold, compact tracking
- card headings:
  - strong but not oversized
- metadata:
  - muted, small, tabular where numeric

## Spacing

- base spacing rhythm:
  - `4 / 8 / 12 / 16 / 24 / 32`
- dashboard gutters:
  - 24 desktop
  - 16 tablet
  - 12 mobile

## Radius

- shell and cards:
  - `16px`
- dense controls:
  - `10px`
- pills / badges:
  - full rounded

## Shadows and Glow

- ambient shadow:
  - soft black with low spread
- premium hover:
  - subtle teal/blue edge glow
- avoid giant bloom effects

## Icons

- `lucide-react`
- consistent stroke width
- icons inside badges and cards should support compact scan, not dominate

## Motion Guidelines

- page enter:
  - fade + small upward motion
- hover:
  - slight lift
  - slight border brighten
- sidebar:
  - spring, restrained
- locked cards:
  - subtle sheen or lock pulse on hover only
- avoid:
  - dramatic scale
  - long loops
  - ornamental floating blobs in app shell

## Accessibility

- contrast must remain strong on dark layers
- focus ring should use a high-visibility accent
- status colors must pair with text/icon labels
