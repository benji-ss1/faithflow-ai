/**
 * Scenes (ProPresenter "Looks") — pure model + the 5 built-ins. 2026-09-16.
 *
 * A Scene is a named snapshot of ROUTING, never of content: for each screen
 * (main / stage / livestream / ndi) which layers are shown, and an optional
 * per-screen theme. Switching a Scene changes what each screen SHOWS of the
 * currently-playing content — it never changes what is playing.
 *
 * Contracts that must not be broken (see docs/SCENES_PLAN.md):
 *  - NO scene (or an empty one) ⇒ the render path is untouched ⇒ output is
 *    byte-identical to today. Gated on DATA PRESENCE, not NEXT_PUBLIC_LAYERS_V2
 *    (which is off in production, so an env-gated scene would be dead code).
 *  - The operator's own eye/clear overrides ALWAYS beat a scene mask: a scene
 *    can hide a layer on a screen, but can never force-show what the operator
 *    cleared, and can never restore a layer the operator hid.
 *  - A scene may toggle the CAMERA's visibility but never carries a deviceId,
 *    so it stays safe to fan out to remote screens.
 *
 * This module is pure (no window, no DB) so it is directly unit-testable and
 * safe to import from both the operator and the output routes.
 */
import type { ThemeAppearance } from "./broadcast";

/** The four real output routes (mirrors MULTIVIEW_SCREENS / the output pages). */
export type SceneScreen = "main" | "stage" | "livestream" | "ndi";
export const SCENE_SCREENS: SceneScreen[] = ["main", "stage", "livestream", "ndi"];
export const SCENE_SCREEN_LABELS: Record<SceneScreen, string> = {
  main: "Projector",
  stage: "Stage",
  livestream: "Livestream",
  ndi: "NDI feed",
};

/**
 * Routable layer ids — these are the ids `outputStateToLayers()` emits
 * (src/lib/output-layers.ts), which is what makes a mask composable with the
 * operator's override map keyed on the same ids.
 *
 * EXCEPTION — ROUTE-DRAWN layers ("announcement", "timer"): the compositor never
 * sees these; each output route draws them itself and therefore applies the scene
 * mask itself (see /live, /stage, /livestream; "announcement" additionally in
 * multiview.ts, which draws no timer at all). They are NOT emitted
 * by `outputStateToLayers()`, so a mask on them is composable only with the route's
 * own render, never with the operator's override map. "timer" (2026-09-21) follows
 * the "announcement" precedent exactly — see docs/PP7_TIMERS_PLAN.md Phase 1.
 */
export type SceneLayerId = "background" | "camera" | "slide" | "logo" | "announcement" | "timer";
export const SCENE_LAYER_IDS: SceneLayerId[] = ["background", "camera", "slide", "logo", "announcement", "timer"];
export const SCENE_LAYER_LABELS: Record<SceneLayerId, string> = {
  background: "Background",
  camera: "Camera",
  slide: "Words",
  logo: "Logo",
  announcement: "Announcement",
  timer: "Timer",
};

/** Per-screen routing. A layer absent from `layers` is left exactly as-is. */
export type ScreenMask = {
  /** layer id → shown. `false` hides it on this screen; `true`/absent = no change. */
  layers?: Partial<Record<SceneLayerId, boolean>>;
  /** layer id → 0..1. Absent = no change. */
  opacity?: Partial<Record<SceneLayerId, number>>;
  /**
   * Per-screen theme, RESOLVED operator-side into a wire ThemeAppearance (the
   * output routes are public surfaces with no church DB access, and a themeId
   * lookup there would break the same-machine zero-latency path, rule 8).
   */
  appearance?: ThemeAppearance | null;
};

/** What rides on OutputState.scene. */
export type SceneWire = {
  /** Stable short id (built-in slug or a DB uuid). */
  id: string;
  /** Display name, for the operator's own UI + "why is this dark?" hints. */
  name?: string;
  /** Monotonic stamp, same convention as LayerWire.rev. */
  rev?: number;
  screens: Partial<Record<SceneScreen, ScreenMask>>;
};

/** A scene as stored/edited (config jsonb of the `scenes` table). */
export type SceneConfig = {
  screens: Partial<Record<SceneScreen, {
    layers?: Partial<Record<SceneLayerId, boolean>>;
    opacity?: Partial<Record<SceneLayerId, number>>;
    /** Theme id from the church `themes` table; resolved to an appearance at switch time. */
    themeId?: string | null;
  }>>;
};

export type SceneRecord = {
  id: string;
  name: string;
  config: SceneConfig;
  isBuiltIn: boolean;
  sortOrder: number;
};

/** Global kill-switch (env). Per-church opt-in is church_preferences.scenes_enabled. */
export const SCENES_V1: boolean = process.env.NEXT_PUBLIC_SCENES_V1 !== "0";

export const SCENE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_SCENE_NAME = 120;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/**
 * Whitelist-rebuild a stored/incoming scene config: unknown screens, unknown
 * layer ids and bad values are DROPPED (never stored, never rendered).
 *
 * Prototype pollution is structurally impossible here rather than guarded: we
 * only ever READ the four known screen names and five known layer ids off the
 * input, so an own "__proto__"/"constructor" key can never be reached, and the
 * output object is built fresh. A hostile key therefore cannot poison anything
 * AND cannot take the rest of a legitimate scene down with it (an earlier
 * bail-out made one bad key silently no-op the whole scene).
 */
export function sanitizeSceneConfig(raw: unknown): SceneConfig {
  const out: SceneConfig = { screens: {} };
  if (!isPlainObject(raw)) return out;
  const screens = raw.screens;
  if (!isPlainObject(screens)) return out;
  for (const screen of SCENE_SCREENS) {
    const s = screens[screen];
    if (!isPlainObject(s)) continue;
    const entry: { layers?: Partial<Record<SceneLayerId, boolean>>; opacity?: Partial<Record<SceneLayerId, number>>; themeId?: string | null } = {};
    if (isPlainObject(s.layers)) {
      const layers: Partial<Record<SceneLayerId, boolean>> = {};
      for (const id of SCENE_LAYER_IDS) {
        const v = (s.layers as Record<string, unknown>)[id];
        if (typeof v === "boolean") layers[id] = v;
      }
      if (Object.keys(layers).length) entry.layers = layers;
    }
    if (isPlainObject(s.opacity)) {
      const opacity: Partial<Record<SceneLayerId, number>> = {};
      for (const id of SCENE_LAYER_IDS) {
        const v = (s.opacity as Record<string, unknown>)[id];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) opacity[id] = v;
      }
      if (Object.keys(opacity).length) entry.opacity = opacity;
    }
    if (typeof s.themeId === "string" && s.themeId.length > 0 && s.themeId.length <= 64) entry.themeId = s.themeId;
    if (entry.layers || entry.opacity || entry.themeId) out.screens[screen] = entry;
  }
  return out;
}

/** A scene that routes nothing is a no-op and must never reach the wire. */
export function isEmptySceneConfig(cfg: SceneConfig | null | undefined): boolean {
  if (!cfg || !cfg.screens) return true;
  return !SCENE_SCREENS.some((s) => {
    const e = cfg.screens[s];
    return !!e && (!!e.layers && Object.keys(e.layers).length > 0 || !!e.opacity && Object.keys(e.opacity).length > 0 || !!e.themeId);
  });
}

/**
 * Build the wire payload for a scene. `resolveAppearance` maps a themeId to a
 * wire ThemeAppearance operator-side (undefined ⇒ that screen keeps the shared
 * theme). Returns null for an empty scene so "None" is a provable no-op.
 */
export function sceneToWire(
  scene: Pick<SceneRecord, "id" | "name" | "config">,
  opts?: { rev?: number; resolveAppearance?: (themeId: string) => ThemeAppearance | null | undefined },
): SceneWire | null {
  const cfg = sanitizeSceneConfig(scene.config);
  if (isEmptySceneConfig(cfg)) return null;
  const screens: Partial<Record<SceneScreen, ScreenMask>> = {};
  for (const screen of SCENE_SCREENS) {
    const e = cfg.screens[screen];
    if (!e) continue;
    const mask: ScreenMask = {};
    if (e.layers) mask.layers = { ...e.layers };
    if (e.opacity) mask.opacity = { ...e.opacity };
    if (e.themeId && opts?.resolveAppearance) {
      const appearance = opts.resolveAppearance(e.themeId);
      if (appearance) mask.appearance = appearance;
    }
    if (mask.layers || mask.opacity || mask.appearance) screens[screen] = mask;
  }
  if (!Object.keys(screens).length) return null;
  const wire: SceneWire = { id: scene.id, screens };
  if (scene.name) wire.name = scene.name.slice(0, MAX_SCENE_NAME);
  if (typeof opts?.rev === "number" && Number.isFinite(opts.rev)) wire.rev = opts.rev;
  return wire;
}

/** The mask that applies to one screen (undefined ⇒ nothing to apply). */
export function maskFor(scene: SceneWire | null | undefined, screen: SceneScreen): ScreenMask | undefined {
  if (!scene || !scene.screens) return undefined;
  const m = scene.screens[screen];
  if (!m) return undefined;
  const has = (m.layers && Object.keys(m.layers).length > 0)
    || (m.opacity && Object.keys(m.opacity).length > 0)
    || !!m.appearance;
  return has ? m : undefined;
}

/** True when a layer is hidden on a screen by the scene (used for "why is this screen dark?"). */
export function sceneHidesLayer(scene: SceneWire | null | undefined, screen: SceneScreen, layer: SceneLayerId): boolean {
  return maskFor(scene, screen)?.layers?.[layer] === false;
}

// ── The 5 built-ins (spec §22.2) ────────────────────────────────────────────
// Code, not DB rows: identical for every church, nothing to seed or delete.
// Only the layers a scene deliberately HIDES are listed — every other layer is
// left exactly as the operator has it.
const B = (id: string, name: string, screens: SceneConfig["screens"]): SceneRecord => ({
  id, name, config: { screens }, isBuiltIn: true, sortOrder: 0,
});

export const BUILT_IN_SCENES: SceneRecord[] = [
  // Worship: words everywhere; stage keeps it plain (no background/logo clutter);
  // stream shows words over the camera.
  B("builtin-worship", "Worship", {
    stage: { layers: { background: false, logo: false, camera: false } },
    livestream: { layers: { background: false, logo: false } },
  }),
  // Teaching: scripture on the projector; stage plain; stream lower-third only
  // (background off so the camera shows through).
  B("builtin-teaching", "Teaching", {
    stage: { layers: { background: false, logo: false, camera: false } },
    livestream: { layers: { background: false, logo: false } },
    ndi: { layers: { background: false, logo: false } },
  }),
  // Announcement: announcements are the point — keep them everywhere, drop the
  // camera from the projector so nothing competes.
  B("builtin-announcement", "Announcement", {
    main: { layers: { camera: false } },
    stage: { layers: { background: false, camera: false, logo: false } },
  }),
  // Offering: words + background on the projector, nothing on the stream
  // (churches routinely keep giving details off the public stream).
  B("builtin-offering", "Offering", {
    livestream: { layers: { slide: false, background: false, logo: false, announcement: false } },
    stage: { layers: { background: false, camera: false, logo: false } },
  }),
  // Pre-Service: holding screen — logo + background, no words yet.
  B("builtin-pre-service", "Pre-Service", {
    main: { layers: { slide: false, camera: false } },
    stage: { layers: { slide: false, background: false, camera: false } },
    livestream: { layers: { slide: false } },
    ndi: { layers: { slide: false } },
  }),
];

export function builtInScene(id: string): SceneRecord | undefined {
  return BUILT_IN_SCENES.find((s) => s.id === id);
}
