/**
 * OBS EDITOR — live look + per-look settings (2026-09-14).
 *
 * The OBS setup card is a full editor for all three stream looks:
 *   - "camera"     — transparent full-frame words over the church's camera
 *   - "lowerthird" — broadcast band caption (geometry/style in obs-lowerthird.ts)
 *   - "full"       — the projector look (theme background + words)
 *
 * Every control rides OutputState.obsLook (validated in broadcast.ts, strict +
 * fail-open) over BroadcastChannel / Realtime / LAN, and ONLY /livestream reads
 * it. The projector (/live), /stage and /ndi never read it → their output is
 * unchanged.
 *
 * BACK-COMPAT CONTRACT (locked by test/obs-editor.test.ts):
 *  - The LIVE look choice is OPT-IN PER LINK: only a link carrying `&live=1`
 *     (every link the new editor creates/copies) follows the editor's look.
 *     A link pasted in OBS before this existed (no `live=1`) keeps its URL look
 *     forever; per-look SETTINGS still restyle the look that link shows.
 *   - No live obsLook (or all-default settings) ⇒ resolveObsRender returns the
 *     exact legacy compositor inputs (same fontScale, same appearance object,
 *     no overlay hints) ⇒ byte-identical render.
 *
 * Pure + deterministic (no window/DOM) so the card preview and /livestream share
 * the same resolution — preview == OBS.
 */
import type { SlidePayload, ThemeAppearance, ObsLookWire, ObsTextColorWire } from "./broadcast";
import { clampObsBand, parseObsBand, DEFAULT_OBS_BAND, type ObsBandConfig, type ObsThemeColors, type ObsBandExtras } from "./obs-lowerthird";

export type ObsLook = "camera" | "lowerthird" | "full";
export const OBS_LOOKS: ObsLook[] = ["camera", "lowerthird", "full"];
export type ObsTextColor = ObsTextColorWire;
export type ObsCamPos = "top" | "middle" | "bottom";
export type ObsCamEffect = "shadow" | "outline" | "none";

/** Per-look settings (everything except the look choice + band geometry). */
export type ObsLookSettings = {
  ltText: ObsTextColor;   // lower third text colour
  ltRef: boolean;         // lower third: show the verse reference line
  camScale: number;       // camera: text size multiplier 0.5..2
  camPos: ObsCamPos;      // camera: vertical position
  camText: ObsTextColor;  // camera: text colour
  camEffect: ObsCamEffect;// camera: readability effect
  camScrim: number;       // camera: dark scrim behind words 0..0.9 (0 = none)
  fullScale: number;      // full: text size multiplier 0.5..2
  fullDim: number;        // full: background dim 0..0.9
};

export const DEFAULT_OBS_LOOK_SETTINGS: ObsLookSettings = {
  ltText: "auto", ltRef: true,
  camScale: 1, camPos: "middle", camText: "auto", camEffect: "shadow", camScrim: 0,
  fullScale: 1, fullDim: 0,
};

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export function isObsTextColor(v: unknown): v is ObsTextColor {
  return v === "auto" || v === "white" || v === "black" || v === "theme" || (typeof v === "string" && HEX_RE.test(v));
}
const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Clamp any raw settings object to safe values (never throws). */
export function clampObsLookSettings(raw: unknown): ObsLookSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_OBS_LOOK_SETTINGS;
  return {
    ltText: isObsTextColor(r.ltText) ? r.ltText : d.ltText,
    ltRef: typeof r.ltRef === "boolean" ? r.ltRef : d.ltRef,
    camScale: num(r.camScale, 0.5, 2, d.camScale),
    camPos: r.camPos === "top" || r.camPos === "middle" || r.camPos === "bottom" ? r.camPos : d.camPos,
    camText: isObsTextColor(r.camText) ? r.camText : d.camText,
    camEffect: r.camEffect === "shadow" || r.camEffect === "outline" || r.camEffect === "none" ? r.camEffect : d.camEffect,
    camScrim: num(r.camScrim, 0, 0.9, d.camScrim),
    fullScale: num(r.fullScale, 0.5, 2, d.fullScale),
    fullDim: num(r.fullDim, 0, 0.9, d.fullDim),
  };
}

// ── Device-local editor store (one versioned object) ─────────────────────────
export const OBS_EDITOR_KEY = "presentflow.obs.editor.v2";
export const LEGACY_LOOK_KEY = "presentflow.obs.look";
export const LEGACY_BAND_KEY = "presentflow.obs.lowerThird.v1";

export type ObsEditorStore = {
  v: 2;
  look: ObsLook;
  /** true once the operator explicitly picked a look in the editor → the look
   *  is published live. false (migrated / never picked) → the OBS link's URL
   *  keeps deciding the look (old links unchanged). */
  lookLive: boolean;
  band: ObsBandConfig;
  settings: ObsLookSettings;
};

/**
 * Read the editor store from raw localStorage strings, migrating the legacy
 * `presentflow.obs.lowerThird.v1` band + `presentflow.obs.look` so existing
 * users keep their band. Pure (caller passes the raw strings).
 */
export function readObsEditorStore(rawV2: string | null, rawLegacyBand: string | null, rawLegacyLook: string | null): ObsEditorStore {
  if (rawV2) {
    try {
      const p = JSON.parse(rawV2) as Record<string, unknown>;
      if (p && typeof p === "object" && p.v === 2) {
        return {
          v: 2,
          look: OBS_LOOKS.includes(p.look as ObsLook) ? (p.look as ObsLook) : "camera",
          lookLive: p.lookLive === true,
          band: clampObsBand((p.band && typeof p.band === "object" ? p.band : {}) as Partial<ObsBandConfig>),
          settings: clampObsLookSettings(p.settings),
        };
      }
    } catch { /* fall through to migration */ }
  }
  let band = DEFAULT_OBS_BAND;
  if (rawLegacyBand) { try { band = clampObsBand(JSON.parse(rawLegacyBand)); } catch { /* ignore */ } }
  const look: ObsLook = OBS_LOOKS.includes(rawLegacyLook as ObsLook) ? (rawLegacyLook as ObsLook) : "camera";
  return { v: 2, look, lookLive: false, band, settings: { ...DEFAULT_OBS_LOOK_SETTINGS } };
}

/** The obsLook wire the operator publishes for a store (look only when picked). */
export function obsLookWireFromStore(s: ObsEditorStore): ObsLookWire {
  const w: ObsLookWire = { ...clampObsLookSettings(s.settings) };
  if (s.lookLive) w.look = s.look;
  return w;
}

// ── Render resolution (shared by /livestream + the editor preview) ───────────
export type ObsUrlDefaults = {
  transparent: boolean;
  mode: "full" | "lower_third";
  band: ObsBandConfig;
  /** ?live=1 → this link follows the editor's live look choice. Absent (every
   *  link pasted before the editor existed) → the URL look is fixed. */
  live: boolean;
};

/** Parse the /livestream URL exactly as the legacy page did (+ live opt-in). */
export function parseObsUrl(get: (k: string) => string | null): ObsUrlDefaults {
  let transparent = get("bg") === "transparent";
  let mode: "full" | "lower_third" = get("mode") === "lower_third" ? "lower_third" : "full";
  if (get("obs") === "lowerthird") { mode = "lower_third"; transparent = true; }
  return { transparent, mode, band: parseObsBand(get), live: get("live") === "1" };
}

/** The look a URL-only link produces (legacy semantics). */
export function urlLook(u: Pick<ObsUrlDefaults, "transparent" | "mode">): ObsLook {
  if (u.mode === "lower_third") return "lowerthird";
  return u.transparent ? "camera" : "full";
}

export type ObsOverlayHints = {
  textColor?: string;
  textShadow?: string;
  verticalAlign?: "top" | "center" | "bottom";
  scrim?: number;
};

// Heavier 8-direction outline for "outline" readability (font-agnostic).
export const OBS_OUTLINE_TEXT_SHADOW =
  "2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000, " +
  "0 2px 0 #000, 0 -2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 3px 8px rgba(0,0,0,0.8)";

export function resolveTextColor(c: ObsTextColor, theme?: ObsThemeColors): string | undefined {
  switch (c) {
    case "auto": return undefined;
    case "white": return "#ffffff";
    case "black": return "#111111";
    case "theme": return theme?.textColor || undefined;
    default: return HEX_RE.test(c) ? c : undefined;
  }
}

/** Theme colours for the "theme" band style / text colour (livestream parity). */
export function obsThemeColorsOf(appearance: ThemeAppearance | null | undefined): ObsThemeColors {
  const solid = appearance && (appearance.bgType === "solid" || appearance.bgType === "gradient" || appearance.bgType === undefined) ? appearance.bgColor : undefined;
  return { textColor: appearance?.textColor, bgColor: solid, bgColor2: solid ? appearance?.bgColor2 : undefined, bgAngle: appearance?.bgAngle };
}

/** The OBS live fields /livestream stores from an applied OutputState. A null or
 *  absent band clears back to the link's URL band (fixes Reset not reaching OBS). */
export function applyObsLiveFields(state: { obsLowerThird?: unknown; obsLook?: ObsLookWire | null }): { liveBand: ObsBandConfig | null; liveLook: ObsLookWire | null } {
  let liveBand: ObsBandConfig | null = null;
  if (state.obsLowerThird && typeof state.obsLowerThird === "object") {
    try { liveBand = clampObsBand(state.obsLowerThird as Partial<ObsBandConfig>); } catch { liveBand = null; }
  }
  const liveLook = state.obsLook && typeof state.obsLook === "object" ? state.obsLook : null;
  return { liveBand, liveLook };
}

export type ObsRenderInput = {
  url: ObsUrlDefaults;
  /** Live obsLook from OutputState (null/undefined → none received). */
  liveLook?: ObsLookWire | null;
  /** Live band from OutputState.obsLowerThird (null/undefined → URL band). */
  liveBand?: ObsBandConfig | null;
  fontScale: number;
  appearance: ThemeAppearance | null;
  themeColors: ObsThemeColors;
  lowerThird: { line1: string; line2: string } | null;
  /** A template BackgroundSpec is showing (full-look darken uses the veil over
   *  it instead of the theme dim — ONE mechanism, never both stacked). */
  hasTemplateBackground?: boolean;
};

/** Effective font scale ceiling (stream fontScale × look text size). */
export const OBS_MAX_FONT_SCALE = 4;

export type ObsRenderResolved = {
  look: ObsLook;
  transparent: boolean;
  mode: "full" | "lower_third";
  obsBand: ObsBandConfig | null;
  obsBandExtras: ObsBandExtras | undefined;
  fontScale: number;
  appearance: ThemeAppearance | null;
  obsOverlay: ObsOverlayHints | undefined;
  backgroundDim: number | undefined;
};

export function resolveObsRender(i: ObsRenderInput): ObsRenderResolved {
  let transparent = i.url.transparent;
  let mode = i.url.mode;
  const live = i.liveLook ?? null;
  if (live?.look && i.url.live) {
    if (live.look === "camera") { transparent = true; mode = "full"; }
    else if (live.look === "lowerthird") { transparent = true; mode = "lower_third"; }
    else { transparent = false; mode = "full"; }
  }
  const look = urlLook({ transparent, mode });
  const s = live ? clampObsLookSettings(live) : null;
  const out: ObsRenderResolved = {
    look, transparent, mode,
    obsBand: mode === "lower_third" ? (i.liveBand ? clampObsBand(i.liveBand) : i.url.band) : null,
    obsBandExtras: undefined,
    fontScale: i.fontScale,
    appearance: i.appearance,
    obsOverlay: undefined,
    backgroundDim: undefined,
  };
  if (look === "lowerthird") {
    const ex: ObsBandExtras = {};
    if (s) {
      const tc = resolveTextColor(s.ltText, i.themeColors);
      if (tc) ex.textColor = tc;
      if (!s.ltRef) ex.hideReference = true;
    }
    // Operator's own lower third wins over lyrics (production a0f53c8 parity).
    if (i.lowerThird && (i.lowerThird.line1 || i.lowerThird.line2)) ex.lowerThird = i.lowerThird;
    if (Object.keys(ex).length) out.obsBandExtras = ex;
  } else if (look === "camera" && s) {
    if (s.camScale !== 1) out.fontScale = Math.min(OBS_MAX_FONT_SCALE, i.fontScale * s.camScale);
    const h: ObsOverlayHints = {};
    const tc = resolveTextColor(s.camText, i.themeColors);
    if (tc) h.textColor = tc;
    if (s.camEffect === "outline") h.textShadow = OBS_OUTLINE_TEXT_SHADOW;
    else if (s.camEffect === "none") h.textShadow = "none";
    if (s.camPos !== "middle") h.verticalAlign = s.camPos === "top" ? "top" : "bottom";
    if (s.camScrim > 0) h.scrim = s.camScrim;
    if (Object.keys(h).length) out.obsOverlay = h;
  } else if (look === "full" && s) {
    if (s.fullScale !== 1) out.fontScale = Math.min(OBS_MAX_FONT_SCALE, i.fontScale * s.fullScale);
    if (s.fullDim > 0) {
      // ONE darkening mechanism: the veil over a template background, else the
      // theme's own dim layer (raised to the slider, never lowered) — monotonic.
      if (i.hasTemplateBackground) out.backgroundDim = s.fullDim;
      else if (i.appearance) out.appearance = { ...i.appearance, dim: Math.max(i.appearance.dim ?? 0, s.fullDim) };
    }
  }
  return out;
}

// ── Operator lower-third title lifetime ─────────────────────────────────────
/** The operator's title is held against the slide identity that was live when it
 *  was sent. It shows while that slide stays live (heartbeats / re-sends of the
 *  same slide keep it) and is gone the moment a DIFFERENT slide goes live. */
export type HeldLowerThird = { lt: { line1: string; line2: string }; identity: string };
export function heldLowerThirdFor(held: HeldLowerThird | null, liveIdentity: string): { line1: string; line2: string } | null {
  return held && held.identity === liveIdentity ? held.lt : null;
}

// ── Remote publish coalescing (editor slider drags) ─────────────────────────
/** Trailing throttle for REMOTE (Realtime/LAN) publishes of editor-driven state.
 *  Leading send when idle, then at most one send per `intervalMs` carrying the
 *  LATEST value; the final value is always delivered. `sendNow` bypasses it (and
 *  drops any pending older value, since the immediate send is newer). */
export function createTrailingPublisher<T>(send: (v: T) => void, intervalMs: number, clock: { now: () => number; setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void } = {
  now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}) {
  let last = -Infinity; let pending: { v: T } | null = null; let timer: unknown = null;
  const fire = () => { timer = null; if (!pending) return; const v = pending.v; pending = null; last = clock.now(); send(v); };
  return {
    schedule(v: T) {
      pending = { v };
      if (timer !== null) return;
      const wait = last + intervalMs - clock.now();
      if (wait <= 0) fire(); else timer = clock.setTimeout(fire, wait);
    },
    sendNow(v: T) {
      if (timer !== null) { clock.clearTimeout(timer); timer = null; }
      pending = null; last = clock.now(); send(v);
    },
    dispose() { if (timer !== null) clock.clearTimeout(timer); timer = null; pending = null; },
  };
}

// ── Same-window preview feed (operator console → OBS editor card) ────────────
// The editor preview renders the ACTUAL live OutputState. The console caches the
// last emitted snapshot on window + fires a local event (no channel traffic).
export const OBS_PREVIEW_EVENT = "presentflow:output-state-local";
type PreviewWin = { __pfLastOutputState?: unknown };
export function publishObsPreviewState(state: unknown): void {
  if (typeof window === "undefined") return;
  try {
    (window as unknown as PreviewWin).__pfLastOutputState = state;
    window.dispatchEvent(new CustomEvent(OBS_PREVIEW_EVENT, { detail: state }));
  } catch { /* ignore */ }
}
export function readObsPreviewState(): unknown {
  if (typeof window === "undefined") return null;
  return (window as unknown as PreviewWin).__pfLastOutputState ?? null;
}

/** Sample text for the editor preview when nothing is live. */
export const OBS_PREVIEW_SAMPLES: Record<"song" | "verse", SlidePayload> = {
  song: { kind: "text", text: "Amazing grace, how sweet the sound\nThat saved a wretch like me" },
  verse: { kind: "text", text: "For God so loved the world, that he gave his only begotten Son", reference: "John 3:16 (KJV)" },
};
