# Sidebar Navigation UX

## Goals

- keep the operator shell compact, readable, and stable during live use
- make navigation state obvious without wasting width
- preserve fast switching between workspaces while preventing accidental clicks

## Expanded and Collapsed Behavior

### Expanded mode

- show icon, label, and active state clearly
- support one-line labels by default
- keep section headings small and visually secondary
- reserve enough width for common church-service labels without clipping every row

### Collapsed mode

- icon-only rows
- active item still needs a strong visual rail or pill state
- hover and focus should reveal tooltip labels
- collapsed mode should never hide which workspace is currently active

## Active Workspace State

- the active workspace should be visible at a glance in both expanded and collapsed modes
- active state should include:
  - stronger background
  - brighter icon
  - clear left-edge or inset highlight
  - optional live-context accent where appropriate
- active state should not rely on color alone

## Icon-Only Mode

- use consistent icon sizing and padding
- click targets should stay at least comfortable touch size
- maintain the same vertical rhythm as expanded mode
- avoid tiny floating icons with ambiguous hit areas

## Tooltips

- required in collapsed mode
- optional in expanded mode only for truncated or ambiguous labels
- tooltips should appear quickly but not flicker
- tooltip content should include:
  - full label
  - short state note if relevant

## Text Truncation

- truncate long labels with ellipsis
- never let text overlap badges, chevrons, or locks
- preserve the first meaningful words
- avoid wrapping nav labels to two lines in the main operator sidebar

## Workspace Switching

- place workspace or church switcher near the top
- current workspace should be obvious before the nav list begins
- switching should not feel like the same interaction as opening a route
- if multiple workspace types exist later, show:
  - church
  - service
  - operator context

## Recommended Section Order

1. Current workspace switcher
2. Primary operator actions
3. Service content tools
4. AI and review tools
5. Secondary admin or settings links

Section order should match frequency of use during a live service, not org-chart logic.

## Compact Sizing Rules

- use dense row height, but keep click targets safe
- minimize vertical chrome between sections
- avoid oversized logos or ornamental headers
- collapsed width should still feel intentional, not squeezed

## Polish Rules

- transitions should be quick and quiet
- no bouncing or theatrical sidebar motion
- badges should align cleanly with label baselines
- icons must stay optically centered
- the shell should feel premium and engineered, not generic

## Accessibility and Focus Rules

- keyboard focus must remain visible in both expanded and collapsed states
- focus order should be:
  - workspace switcher
  - primary nav
  - secondary nav
  - bottom utilities
- tooltips should not be the only way to understand a focused item
- use `aria-current` for active route semantics
- preserve contrast on low-light operator screens

## Failure States to Avoid

- active item lost in collapsed mode
- badge overlap with truncated labels
- sidebar width changes causing adjacent panel jumps
- hidden workspace context during live operation
- settings/admin routes visually competing with primary operator controls
