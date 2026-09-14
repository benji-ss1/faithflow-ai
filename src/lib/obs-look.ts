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
 *   - CAMERA LAYOUT RULE: a link WITHOUT live=1 NEVER changes camera layout from
 *     the wire — it always renders the legacy full-frame camera words, whatever
 *     camLayout (or the retired camLayoutSet) says. On a live=1 link the camera
 *     lower third applies ONLY when the received settings explicitly carry
 *     camLayout:"lowerthird"; missing settings, a missing camLayout (older
 *     operator build) or an invalid value all render full-frame.
 *   - No live obsLook (or all-default settings) ⇒ resolveObsRender returns the
 *     exact legacy compositor inputs (same fontScale, same appearance object,
 *     no overlay hints) ⇒ byte-identical render.
 *
 * Pure + deterministic (no window/DOM) so the card preview and /livestream share
 * the same resolution — preview == OBS.
 */
import type { SlidePayload, ThemeAppearance, ObsLookWire, ObsTextColorWire } from "./broadcast";
import { clampObsBand, parseObsBand, placementToTop, DEFAULT_OBS_BAND, OBS_BAND_STYLES, type ObsBandConfig, type ObsBandStyle, type ObsThemeColors, type ObsBandExtras } from "./obs-lowerthird";

export type ObsLook = "camera" | "lowerthird" | "full";
export const OBS_LOOKS: ObsLook[] = ["camera", "lowerthird", "full"];
export type ObsTextColor = ObsTextColorWire;
export type ObsCamPos = "top" | "middle" | "bottom";
export type ObsCamEffect = "shadow" | "outline" | "none";
/** "Over your camera" layout (2026-09-14): a see-through lower-third band over
 *  the camera (default) or the original full-frame words. */
export type ObsCamLayout = "lowerthird" | "full";
export type ObsCamBandPosition = "upper" | "mid" | "lower" | "custom";
export const OBS_CAM_BAND_MARGIN_PCT = 6;

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
  // ── Over your camera LAYOUT (2026-09-14) ──
  // BACK-COMPAT RULE (locked by test/obs-editor.test.ts): see the CAMERA LAYOUT
  // RULE in the file header — only live=1 links with an explicit "lowerthird"
  // render the band. New installs (genuinely empty store) default the editor to
  // "lowerthird"; any existing/corrupt/unknown store migrates to "full".
  camLayout: ObsCamLayout;
  camBandPosition: ObsCamBandPosition;
  camBandOffsetPct: number; // 0 (top) .. 100 (bottom) — used when position = custom
  camBandHeightPct: number; // 10..60
  camBandScale: number;     // 0.5..2
  camBandOpacity: number;   // 0..1
  camBandStyle: ObsBandStyle; // default "clear" = see-through band
};

export const DEFAULT_OBS_LOOK_SETTINGS: ObsLookSettings = {
  ltText: "auto", ltRef: true,
  camScale: 1, camPos: "middle", camText: "auto", camEffect: "shadow", camScrim: 0,
  fullScale: 1, fullDim: 0,
  camLayout: "lowerthird", camBandPosition: "lower", camBandOffsetPct: 100,
  camBandHeightPct: DEFAULT_OBS_BAND.heightPct, camBandScale: 1, camBandOpacity: 0.6, camBandStyle: "clear",
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
    camLayout: isObsCamLayout(r.camLayout) ? r.camLayout : d.camLayout,
    camBandPosition: isObsCamBandPosition(r.camBandPosition) ? r.camBandPosition : d.camBandPosition,
    camBandOffsetPct: num(r.camBandOffsetPct, 0, 100, d.camBandOffsetPct),
    camBandHeightPct: num(r.camBandHeightPct, 10, 60, d.camBandHeightPct),
    camBandScale: num(r.camBandScale, 0.5, 2, d.camBandScale),
    camBandOpacity: num(r.camBandOpacity, 0, 1, d.camBandOpacity),
    camBandStyle: OBS_BAND_STYLES.includes(r.camBandStyle as ObsBandStyle) ? (r.camBandStyle as ObsBandStyle) : d.camBandStyle,
  };
}
export function isObsCamLayout(v: unknown): v is ObsCamLayout { return v === "lowerthird" || v === "full"; }
export function isObsCamBandPosition(v: unknown): v is ObsCamBandPosition { return v === "upper" || v === "mid" || v === "lower" || v === "custom"; }

/** Band top% for a camera-band position (upper/mid/lower bands, or custom 0..100 placement). */
export function camBandTopPct(pos: ObsCamBandPosition, heightPct: number, offsetPct: number): number {
  const h = Number.isFinite(heightPct) ? Math.min(60, Math.max(10, heightPct)) : DEFAULT_OBS_BAND.heightPct;
  const room = 100 - h;
  switch (pos) {
    case "upper": return Math.min(room, OBS_CAM_BAND_MARGIN_PCT);
    case "mid": return Math.round(room / 2);
    case "lower": return Math.max(0, room - OBS_CAM_BAND_MARGIN_PCT);
    default: return placementToTop(offsetPct, h);
  }
}

/** The see-through band config the camera look uses in its lower-third layout. */
export function camBandConfig(s: ObsLookSettings): ObsBandConfig {
  return clampObsBand({
    heightPct: s.camBandHeightPct,
    topPct: camBandTopPct(s.camBandPosition, s.camBandHeightPct, s.camBandOffsetPct),
    fontScale: s.camBandScale, opacity: s.camBandOpacity, style: s.camBandStyle,
  });
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
  // Any v2 key at all (even corrupt / unknown version / "null") = existing user.
  const hadV2 = rawV2 != null;
  if (rawV2) {
    try {
      const p = JSON.parse(rawV2) as Record<string, unknown>;
      if (p && typeof p === "object" && p.v === 2) {
        return {
          v: 2,
          look: OBS_LOOKS.includes(p.look as ObsLook) ? (p.look as ObsLook) : "camera",
          lookLive: p.lookLive === true,
          band: clampObsBand((p.band && typeof p.band === "object" ? p.band : {}) as Partial<ObsBandConfig>),
          settings: migrateV2Settings(p.settings),
        };
      }
    } catch { /* fall through to migration */ }
  }
  let band = DEFAULT_OBS_BAND;
  if (rawLegacyBand) { try { band = clampObsBand(JSON.parse(rawLegacyBand)); } catch { /* ignore */ } }
  const look: ObsLook = OBS_LOOKS.includes(rawLegacyLook as ObsLook) ? (rawLegacyLook as ObsLook) : "camera";
  // A legacy (pre-editor) user already has a full-frame camera link → keep the
  // editor on full-frame too; a brand-new install defaults to the lower third.
  const legacyUser = hadV2 || rawLegacyBand != null || rawLegacyLook != null;
  const settings = { ...DEFAULT_OBS_LOOK_SETTINGS, ...(legacyUser ? { camLayout: "full" as const } : {}) };
  return { v: 2, look, lookLive: false, band, settings };
}

/**
 * What the OPERATOR CONSOLE publishes from raw localStorage on startup (pure).
 * - v2 key present (valid or corrupt) → the editor store (existing user).
 * - no v2 but any legacy key → legacy band (if any), obsLook null (unchanged).
 * - GENUINELY EMPTY (same "new install" rule as readObsEditorStore) → the
 *   new-install obsLook defaults (camLayout "lowerthird") so a live=1 camera
 *   link gets the band even if the card was never opened on this machine.
 *   Band stays null so old obs=lowerthird links keep their URL band. Never
 *   writes storage — the card still migrates/initialises normally later.
 */
export function consoleObsInitial(rawV2: string | null, rawLegacyBand: string | null, rawLegacyLook: string | null): { band: ObsBandConfig | null; look: ObsLookWire | null } {
  if (rawV2) {
    const store = readObsEditorStore(rawV2, rawLegacyBand, rawLegacyLook);
    return { band: store.band, look: obsLookWireFromStore(store) };
  }
  if (rawV2 == null && rawLegacyBand == null && rawLegacyLook == null) {
    return { band: null, look: obsLookWireFromStore(readObsEditorStore(null, null, null)) };
  }
  let band: ObsBandConfig | null = null;
  if (rawLegacyBand) { try { band = clampObsBand(JSON.parse(rawLegacyBand)); } catch { band = null; } }
  return { band, look: null };
}

/** v2 settings without a VALID camLayout (saved before it existed, or junk) →
 *  the user had full-frame camera words, so they keep "full". */
function migrateV2Settings(raw: unknown): ObsLookSettings {
  const s = clampObsLookSettings(raw);
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const valid = !!r && Object.prototype.hasOwnProperty.call(r, "camLayout") && isObsCamLayout(r.camLayout);
  return valid ? s : { ...s, camLayout: "full" };
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
  /** Camera look only: which layout rendered (undefined for other looks). */
  camLayout?: ObsCamLayout;
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
  let look = urlLook({ transparent, mode });
  const s = live ? clampObsLookSettings(live) : null;
  // CAMERA LAYOUT RULE (file header): only a live=1 link carrying a VALID
  // camLayout sets it; old links (no live=1) never read it from the wire, and a
  // missing/invalid value leaves camLayout undefined → the legacy full-frame path.
  let camLayout: ObsCamLayout | undefined;
  if (look === "camera" && i.url.live && live && isObsCamLayout(live.camLayout)) {
    camLayout = live.camLayout;
    if (camLayout === "lowerthird") mode = "lower_third";
  }
  const out: ObsRenderResolved = {
    look, transparent, mode,
    obsBand: mode === "lower_third" && camLayout !== "lowerthird" ? (i.liveBand ? clampObsBand(i.liveBand) : i.url.band) : null,
    obsBandExtras: undefined,
    fontScale: i.fontScale,
    appearance: i.appearance,
    obsOverlay: undefined,
    backgroundDim: undefined,
  };
  if (camLayout) out.camLayout = camLayout;
  if (look === "camera" && camLayout === "lowerthird") {
    // See-through band over the camera, geometry/style from the camera band
    // controls (defaults when no live settings reached us yet).
    const cs = s ?? DEFAULT_OBS_LOOK_SETTINGS;
    out.obsBand = camBandConfig(cs);
    const ex: ObsBandExtras = {};
    const tc = resolveTextColor(cs.camText, i.themeColors);
    if (tc) ex.textColor = tc;
    if (i.lowerThird && (i.lowerThird.line1 || i.lowerThird.line2)) ex.lowerThird = i.lowerThird;
    if (Object.keys(ex).length) out.obsBandExtras = ex;
  } else if (look === "lowerthird") {
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
/** The operator's title is held against the operator's live-send counter at the
 *  moment it was sent. It shows while no newer live send has happened (heartbeats,
 *  snapshot replies and already-live re-sends of the same position don't bump the
 *  counter) and is gone on the NEXT send — including the same content from a
 *  different deck position (repeated chorus, another blank). */
export type HeldLowerThird = { lt: { line1: string; line2: string }; sendSeq: number };
export function heldLowerThirdFor(held: HeldLowerThird | null, liveSendSeq: number): { line1: string; line2: string } | null {
  return held && held.sendSeq === liveSendSeq ? held.lt : null;
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
    /** Cancel the timer and FLUSH any pending trailing value (never drop the final value). */
    dispose() {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      if (pending) { const v = pending.v; pending = null; last = clock.now(); send(v); }
    },
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
