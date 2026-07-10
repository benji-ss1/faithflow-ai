// Phase 5D-2 — effects catalog. 20 named transitions. Each produces a pair
// of animation strings (in/out) that consumers apply as `animation:` CSS.
// Keyframes are declared once (see effectKeyframesCss() below) and injected
// wherever an effect is played (canvas preview, TransitionWrapper).

export type EffectId =
  | "fade_in" | "fade_out" | "cross_fade"
  | "slide_up" | "slide_down" | "slide_left" | "slide_right"
  | "zoom_in" | "zoom_out"
  | "blur_in" | "blur_out"
  | "dissolve" | "type_on"
  | "wipe_left" | "wipe_right" | "wipe_up" | "wipe_down"
  | "bounce_in" | "scale_pop" | "soft_rise";

export type EffectCategory = "fade" | "slide" | "zoom" | "blur" | "wipe" | "other";

export type Effect = {
  id: EffectId;
  label: string;
  category: EffectCategory;
  css: (durationMs: number, easing: string) => { in: string; out: string };
};

const mk = (name: string, cat: EffectCategory, keyIn: string, keyOut = keyIn): Effect => ({
  id: name as EffectId,
  label: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  category: cat,
  css: (durationMs, easing) => ({
    in: `ff-${keyIn}-in ${durationMs}ms ${easing} both`,
    out: `ff-${keyOut}-out ${durationMs}ms ${easing} both`,
  }),
});

export const EFFECTS: Effect[] = [
  mk("fade_in", "fade", "fade"),
  mk("fade_out", "fade", "fade"),
  mk("cross_fade", "fade", "crossfade"),
  mk("slide_up", "slide", "slideup"),
  mk("slide_down", "slide", "slidedown"),
  mk("slide_left", "slide", "slideleft"),
  mk("slide_right", "slide", "slideright"),
  mk("zoom_in", "zoom", "zoomin"),
  mk("zoom_out", "zoom", "zoomout"),
  mk("blur_in", "blur", "blurin"),
  mk("blur_out", "blur", "blurout"),
  mk("dissolve", "other", "dissolve"),
  mk("type_on", "other", "typeon"),
  mk("wipe_left", "wipe", "wipeleft"),
  mk("wipe_right", "wipe", "wiperight"),
  mk("wipe_up", "wipe", "wipeup"),
  mk("wipe_down", "wipe", "wipedown"),
  mk("bounce_in", "other", "bouncein"),
  mk("scale_pop", "zoom", "scalepop"),
  mk("soft_rise", "other", "softrise"),
];

export function getEffect(id: EffectId | string | undefined | null): Effect | null {
  if (!id) return null;
  return EFFECTS.find((e) => e.id === id) ?? null;
}

/** Injects @keyframes into the DOM once (idempotent). Client-side only. */
export function ensureEffectKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("ff-effect-keyframes")) return;
  const style = document.createElement("style");
  style.id = "ff-effect-keyframes";
  style.textContent = EFFECT_KEYFRAMES_CSS;
  document.head.appendChild(style);
}

export const EFFECT_KEYFRAMES_CSS = `
@keyframes ff-fade-in { from{opacity:0} to{opacity:1} }
@keyframes ff-fade-out { from{opacity:1} to{opacity:0} }
@keyframes ff-crossfade-in { from{opacity:0} to{opacity:1} }
@keyframes ff-crossfade-out { from{opacity:1} to{opacity:0} }
@keyframes ff-slideup-in { from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
@keyframes ff-slideup-out { from{transform:translateY(0);opacity:1} to{transform:translateY(-40px);opacity:0} }
@keyframes ff-slidedown-in { from{transform:translateY(-40px);opacity:0} to{transform:translateY(0);opacity:1} }
@keyframes ff-slidedown-out { from{transform:translateY(0);opacity:1} to{transform:translateY(40px);opacity:0} }
@keyframes ff-slideleft-in { from{transform:translateX(60px);opacity:0} to{transform:translateX(0);opacity:1} }
@keyframes ff-slideleft-out { from{transform:translateX(0);opacity:1} to{transform:translateX(-60px);opacity:0} }
@keyframes ff-slideright-in { from{transform:translateX(-60px);opacity:0} to{transform:translateX(0);opacity:1} }
@keyframes ff-slideright-out { from{transform:translateX(0);opacity:1} to{transform:translateX(60px);opacity:0} }
@keyframes ff-zoomin-in { from{transform:scale(0.85);opacity:0} to{transform:scale(1);opacity:1} }
@keyframes ff-zoomin-out { from{transform:scale(1);opacity:1} to{transform:scale(1.15);opacity:0} }
@keyframes ff-zoomout-in { from{transform:scale(1.2);opacity:0} to{transform:scale(1);opacity:1} }
@keyframes ff-zoomout-out { from{transform:scale(1);opacity:1} to{transform:scale(0.85);opacity:0} }
@keyframes ff-blurin-in { from{filter:blur(24px);opacity:0} to{filter:blur(0);opacity:1} }
@keyframes ff-blurin-out { from{filter:blur(0);opacity:1} to{filter:blur(24px);opacity:0} }
@keyframes ff-blurout-in { from{filter:blur(0);opacity:0} to{filter:blur(0);opacity:1} }
@keyframes ff-blurout-out { from{filter:blur(0);opacity:1} to{filter:blur(24px);opacity:0} }
@keyframes ff-dissolve-in { from{opacity:0;filter:contrast(1.4) brightness(1.2)} to{opacity:1;filter:none} }
@keyframes ff-dissolve-out { from{opacity:1;filter:none} to{opacity:0;filter:contrast(1.4) brightness(1.2)} }
@keyframes ff-typeon-in { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0 0 0)} }
@keyframes ff-typeon-out { from{clip-path:inset(0 0 0 0)} to{clip-path:inset(0 0 0 100%)} }
@keyframes ff-wipeleft-in { from{clip-path:inset(0 0 0 100%)} to{clip-path:inset(0 0 0 0)} }
@keyframes ff-wipeleft-out { from{clip-path:inset(0 0 0 0)} to{clip-path:inset(0 100% 0 0)} }
@keyframes ff-wiperight-in { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0 0 0)} }
@keyframes ff-wiperight-out { from{clip-path:inset(0 0 0 0)} to{clip-path:inset(0 0 0 100%)} }
@keyframes ff-wipeup-in { from{clip-path:inset(100% 0 0 0)} to{clip-path:inset(0 0 0 0)} }
@keyframes ff-wipeup-out { from{clip-path:inset(0 0 0 0)} to{clip-path:inset(0 0 100% 0)} }
@keyframes ff-wipedown-in { from{clip-path:inset(0 0 100% 0)} to{clip-path:inset(0 0 0 0)} }
@keyframes ff-wipedown-out { from{clip-path:inset(0 0 0 0)} to{clip-path:inset(100% 0 0 0)} }
@keyframes ff-bouncein-in { 0%{transform:scale(0.6);opacity:0} 60%{transform:scale(1.08);opacity:1} 100%{transform:scale(1)} }
@keyframes ff-bouncein-out { from{transform:scale(1);opacity:1} to{transform:scale(1.2);opacity:0} }
@keyframes ff-scalepop-in { 0%{transform:scale(0.9);opacity:0} 100%{transform:scale(1);opacity:1} }
@keyframes ff-scalepop-out { from{transform:scale(1);opacity:1} to{transform:scale(0.9);opacity:0} }
@keyframes ff-softrise-in { from{transform:translateY(20px) scale(0.98);opacity:0;filter:blur(6px)} to{transform:translateY(0) scale(1);opacity:1;filter:blur(0)} }
@keyframes ff-softrise-out { from{transform:translateY(0);opacity:1;filter:blur(0)} to{transform:translateY(-20px);opacity:0;filter:blur(6px)} }
`;
