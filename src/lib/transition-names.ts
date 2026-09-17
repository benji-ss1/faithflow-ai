// Shared transition display-name → effect-id mapping (moved from BottomBar.tsx
// for Theme → Projector PR 2 so theme transitions resolve the same way).

/** Operator transition prefs in localStorage: {name, durationMs, off}. */
export const TRANSITION_KEY = "presentflow.pro.transition.v1";

// 2026-07-25 Fix 4 — the TransitionChooser exposes display names
// ("Cut", "Fade", "Slide (L→R)") but the projector's TransitionWrapper
// expects effect IDs from src/lib/effects.ts ("fade_in", "slide_right").
// Before this mapping, every picked transition passed through as an
// unknown effectId and TransitionWrapper silently fell back to no
// animation. This is why the transition picker "did nothing".
// "Cut" is deliberately null so no animation applies.
// Effects we don't have real implementations for (Amoeba, Color Burn,
// Iris) fall back to the closest visible substitute rather than doing
// nothing — the operator picked SOMETHING, they should see SOMETHING.
export const TRANSITION_NAME_TO_EFFECT_ID: Record<string, string | null> = {
  "Cut": null,
  "Fade": "fade_in",
  "Dissolve": "cross_fade",
  "Slide (L→R)": "slide_right",
  "Slide (R→L)": "slide_left",
  "Wipe": "wipe_right",
  "Amoeba": "dissolve",       // best available substitute
  "Dispersion Blur": "blur_in",
  "Color Burn": "dissolve",   // best available substitute
  "Iris": "zoom_in",
  "Push": "slide_right",
};
