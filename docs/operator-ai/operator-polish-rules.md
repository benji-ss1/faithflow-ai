# Operator Polish Rules

## Visual Tone

- base panel tone should center on `#232b2b`
- darker surrounding surfaces should separate shell, content, and overlays cleanly
- operator UI should feel production-grade, not decorative SaaS chrome

## Compact Typography

- prioritize tight but readable text scales
- labels should be short, crisp, and high-contrast
- avoid oversized headings inside dense control panels
- reserve larger text for live-critical states only

## Glossy Borders

- use subtle glossy or light-catching borders on panels and cards
- borders should suggest depth without becoming neon
- top-edge or inset sheen is acceptable when restrained

## Active States

- active cards, rows, and tabs should feel locked in place
- combine:
  - border emphasis
  - background shift
  - icon or text brightness
- active states should read instantly from peripheral vision

## Hover States

- hover should confirm interactivity, not redraw the whole layout
- use modest surface lift or tint shift
- avoid hover motion that competes with live reading

## Danger and Live States

- use stronger accenting only for:
  - live output
  - disconnected systems
  - destructive actions
  - warnings requiring intervention
- danger states should be unmistakable but not visually chaotic

## No Overlap

- text, badges, icons, and controls must never collide
- internal panel content should be clipped or truncated cleanly
- sticky headers and scroll regions must not obscure actionable rows

## No Excessive Decoration

- avoid glass overload, heavy blur, or layered ornament that hurts legibility
- operator surfaces should favor calm precision over flashy effects
- decoration must never outrank content or state signals

## Internal Scrolling Panels

- long lists should scroll inside bounded panels
- headers and critical actions may remain sticky if they do not hide content
- scrollbars should be visible enough to suggest overflow without dominating the UI

## Responsive Behavior

- preserve readability at laptop-width operator setups
- stacked mobile behavior should still maintain clear hierarchy
- do not allow the sidebar or card chrome to consume too much small-screen space
- compact modes should reduce spacing before removing essential context

## Practical Rules

- every dense panel needs a dominant purpose
- every warning needs a reason and an expected next action
- every live-ready action must be visually distinguishable from informational UI
- premium polish is acceptable only when it improves trust, clarity, or speed
