/**
 * Tiny critically-damped spring for the Sarah spotlight glide. Pure + deterministic
 * so it can be unit-tested; the component drives it from requestAnimationFrame and
 * writes the result straight to SVG attributes (zero React renders per frame).
 */
export type Rect = { x: number; y: number; w: number; h: number };
export type SpringState = { pos: Rect; vel: Rect };

export const SPRING = { stiffness: 260, damping: 32 } as const; // ~critical: 2*sqrt(260)≈32

const KEYS = ["x", "y", "w", "h"] as const;

/** Advance one step (dt in seconds, clamped so a tab switch can't explode it). */
export function stepSpring(state: SpringState, target: Rect, dtSec: number, k = SPRING): SpringState {
  const dt = Number.isFinite(dtSec) ? Math.min(Math.max(dtSec, 0), 1 / 30) : 0;
  // A non-finite target would poison the state forever (and the rAF loop never settles).
  if (!["x", "y", "w", "h"].every((k) => Number.isFinite(target[k as keyof Rect]))) return state;
  const pos = { ...state.pos }; const vel = { ...state.vel };
  for (const key of KEYS) {
    const a = -k.stiffness * (pos[key] - target[key]) - k.damping * vel[key];
    vel[key] += a * dt;
    pos[key] += vel[key] * dt;
  }
  return { pos, vel };
}

export function settled(state: SpringState, target: Rect, eps = 0.5): boolean {
  return KEYS.every((key) => Math.abs(state.pos[key] - target[key]) < eps && Math.abs(state.vel[key]) < eps);
}
