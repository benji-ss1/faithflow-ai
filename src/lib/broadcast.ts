// NOTE: deliberately NOT "use client". This module is a shared wire-contract
// library (pure types + validators + channel helpers). The /operator SERVER
// page calls projectableTextSlide() via src/lib/server/services.ts — with a
// "use client" directive here, that import became an uncallable client-
// reference stub and every GET /operator 500'd in production (2026-08-11,
// digest 2696263515). Browser APIs (BroadcastChannel) are only touched inside
// functions that guard on `typeof window === "undefined"`, so server-side
// evaluation is safe. Do not re-add the directive.
//
// projection-zone is a pure module (types + math, no browser APIs / no
// "use client"), so importing it here keeps this file server-safe.
import { isValidZone, type ProjectionZone } from "./projection-zone";

// Rich slide objects for the projector (Phase 5D-2 → live). Coordinates are in
// the 1920×1080 virtual canvas the editor uses; renderers scale by percentage.
// A wire-validated subset of the editor's SlideObject (src/lib/slide-objects.ts).
export type SlideObjectWire =
  | { kind: "text"; x: number; y: number; w: number; h: number; anim?: "none" | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "zoom"; animDelayMs?: number; rotation?: number; locked?: boolean; hidden?: boolean; text: string;
      fontFamily?: string; fontSize?: number; fontWeight?: number; color?: string;
      align?: "left" | "center" | "right"; italic?: boolean; underline?: boolean; opacity?: number;
      lineHeight?: number; letterSpacing?: number; uppercase?: boolean; shadow?: boolean; stroke?: string; strokeWidth?: number }
  | { kind: "shape"; x: number; y: number; w: number; h: number; anim?: "none" | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "zoom"; animDelayMs?: number; rotation?: number; locked?: boolean; hidden?: boolean; shape: "rect" | "ellipse";
      fill?: string; fill2?: string; fillAngle?: number; stroke?: string; strokeWidth?: number; radius?: number; opacity?: number }
  | { kind: "image"; x: number; y: number; w: number; h: number; anim?: "none" | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "zoom"; animDelayMs?: number; rotation?: number; locked?: boolean; hidden?: boolean; url: string; fit?: "contain" | "cover" | "fill"; posX?: number; posY?: number; zoom?: number; opacity?: number; blurFill?: boolean }
  | { kind: "video"; x: number; y: number; w: number; h: number; anim?: "none" | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "zoom"; animDelayMs?: number; rotation?: number; locked?: boolean; hidden?: boolean; url: string; fit?: "contain" | "cover" | "fill"; loop?: boolean; muted?: boolean; opacity?: number };

export const SLIDE_CANVAS_W = 1920;
export const SLIDE_CANVAS_H = 1080;
export const MAX_SLIDE_OBJECTS = 60;

// Lower-third scripture band (Christ Embassy lower-third mode). Describes the
// coloured band drawn behind a lower-third verse. Present on a text payload ONLY
// when the church's scripture layout is "lowerThird" AND the band mode isn't
// "none" (a transparent lower-third sets scriptureLayout but omits the band).
// Geometry (band position/height + verse text region) is owned by the renderer
// (SlideRenderer's lower-third branch) so the editor preview is byte-identical
// to the projector — the wire only carries the paint (colour/gradient/opacity).
export type ScriptureBandWire = {
  color: string;       // solid fill, or gradient start
  color2?: string;     // gradient end (when set, band is a linear gradient)
  angle?: number;      // gradient angle in degrees (default 180 = vertical)
  opacity: number;     // 0..1
};

export type SlidePayload =
  // `objects`, when present, drives a positioned multi-object render on every
  // output surface; `text` is kept as the flattened fallback (AI/lyric matching,
  // and renderers that don't do objects). `bgImageUrl` is the per-slide design bg.
  // `reference`, when present, is rendered as a fixed always-visible footer
  // (scripture reference like "John 3:16 (KJV)") that never gets shrunk or
  // paginated off with the verse body — the body sizes independently above it.
  | { kind: "text"; text: string; bgColor?: string; bgImageUrl?: string; objects?: SlideObjectWire[]; reference?: string; scriptureLayout?: "lowerThird"; scriptureBand?: ScriptureBandWire }
  | { kind: "image"; url: string; fit?: "contain" | "cover" | "fill"; blurFill?: boolean }
  | { kind: "video"; url: string; fit?: "contain" | "cover" | "fill"; loop?: boolean; volume?: number }
  | { kind: "blank"; bgColor?: string }
  | { kind: "logo"; url?: string }
  | { kind: "empty" };

/**
 * Return a copy of a text slide with `newText` applied to BOTH the flattened
 * `text` fallback AND the FIRST text object (so a DESIGNED slide keeps its
 * layout/style — geometry, font, colour, all other objects — and only the words
 * change). Used by Quick Edit's save-and-push so the LIVE projection matches the
 * edited slide "no matter the design of the song or slide". No-op for non-text
 * slides. Pure/deterministic.
 */
export function applyTextToSlide(slide: SlidePayload, newText: string): SlidePayload {
  if (slide.kind !== "text") return slide;
  const objects = slide.objects;
  if (Array.isArray(objects) && objects.some((o) => o.kind === "text")) {
    let replaced = false;
    const next = objects.map((o) => {
      if (!replaced && o.kind === "text") { replaced = true; return { ...o, text: newText }; }
      return o;
    });
    return { ...slide, text: newText, objects: next };
  }
  return { ...slide, text: newText };
}

/**
 * Extended output state — one message shape drives every output surface
 * (audience/live projector, stage display, livestream). Each surface
 * consumes only the fields it needs.
 */
export type AnnouncementPosition = "lower_third" | "top_banner" | "ticker" | "center_card";
export type AnnouncementAlign = "left" | "center" | "right";

export type AnnouncementStyle = {
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  textColor: string;
  bgColor: string;
  bgOpacity: number; // 0..100
  padding: number;
  borderRadius: number;
  align: AnnouncementAlign;
};

// Church logo overlay on an announcement — placed independently of the text.
// Covers the 9-grid plus upper/lower third bands (what operators asked for).
export type AnnouncementLogoPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right"
  | "upper-third" | "lower-third";

export const ANNOUNCEMENT_LOGO_POSITIONS = new Set<string>([
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
  "upper-third", "lower-third",
]);

export type AnnouncementLogo = {
  url: string;                        // https / presigned S3 URL
  position: AnnouncementLogoPosition;
  sizePct: number;                    // logo width as % of output width (2..50)
  opacity: number;                    // 0..1
};

export type AnnouncementPayload = {
  line1: string;
  line2?: string;
  position: AnnouncementPosition;
  style: AnnouncementStyle;
  logo?: AnnouncementLogo | null;     // optional church-logo overlay
};

export type TransitionSpec = {
  effectId: string;      // EffectId — kept as string here to avoid circular imports
  durationMs: number;
  easing: string;
  name?: string;         // human-readable name (e.g. "Fade", "Amoeba")
};

// Whitelist of transition effect names accepted by /live consumers.
export const ALLOWED_TRANSITION_NAMES = new Set<string>([
  "Cut", "Fade", "Dissolve",
  "Slide", "Slide (L→R)", "Slide (R→L)",
  "Wipe", "Amoeba", "Dispersion Blur", "Color Burn", "Iris", "Push",
]);

// Default transition applied to AI-fired slides (song auto-live, Bible
// auto-approve). A short, gentle fade — smooth like ProPresenter but fast
// enough that it never lags live speech (rule 10). Deliberately NOT the
// operator's configured transition, which can be a slow (1–2 s) effect that
// would drag on rapid auto-fires; that configured transition is preserved for
// manual sends. `name: "Fade"` keeps it inside ALLOWED_TRANSITION_NAMES so the
// cross-device Realtime validator (isValidTransitionSpec) accepts it. Tunable
// in one place; a future themes overhaul may source this from the active theme.
export const AI_AUTO_TRANSITION: TransitionSpec = {
  effectId: "fade_in",
  durationMs: 150, // sermon-rate scripture: smooth but well under one spoken word
  easing: "ease-out",
  name: "Fade",
};

export function isValidTransitionSpec(t: unknown): t is TransitionSpec {
  if (t === null) return true;
  if (!t || typeof t !== "object") return false;
  if (hasPollutionKey(t)) return false;
  const p = t as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name : typeof p.effectId === "string" ? p.effectId : "";
  if (!name || name.length > 64) return false;
  if (!ALLOWED_TRANSITION_NAMES.has(name)) return false;
  if (typeof p.durationMs !== "number" || !Number.isFinite(p.durationMs)) return false;
  if (p.durationMs < 0 || p.durationMs > 5000) return false;
  // `easing` is string-interpolated into a CSS animation shorthand on the
  // projector. The CSSOM parser already drops anything that isn't a valid
  // timing-function, but keep the wire contract bounded (defense-in-depth):
  // reject over-long or non-CSS-timing charsets from cross-device payloads.
  if (p.easing !== undefined) {
    if (typeof p.easing !== "string" || p.easing.length > 64) return false;
    if (!/^[a-zA-Z0-9(),.\s%-]+$/.test(p.easing)) return false;
  }
  return true;
}

// ── Theme appearance (Themes Phase 1) ─────────────────────────────────────
// A render-focused subset of a church Theme, carried on OutputState so the
// active theme actually drives the projector. Fully additive/optional: when
// absent, output renders with the built-in defaults (dark bg, white text)
// exactly as before. One wire contract keeps same-machine (BroadcastChannel),
// cross-device (Realtime), and a future hybrid/local renderer in sync from a
// single source of truth (CLAUDE.md rule 8).
export type LogoPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right"
  | "none";

export type ThemeAppearance = {
  bgType?: "solid" | "gradient" | "image" | "video"; // Phase 2 adds "video"
  bgColor?: string;    // solid fill / gradient stop 1
  bgColor2?: string;   // gradient stop 2
  bgAngle?: number;    // gradient angle, degrees 0..360
  bgImageUrl?: string; // when bgType === "image" (https / presigned S3 URL)
  bgVideoUrl?: string; // when bgType === "video" — looping muted background (Phase 2)
  // Themes 3 — subtle GPU-composited motion for solid/gradient backgrounds
  // (behind verses/lyrics). No effect on image/video backgrounds.
  bgAnimation?: "none" | "drift" | "aurora" | "pulse";
  dim?: number;        // 0..1 dark overlay over the background for readability
  textColor?: string;
  fontFamily?: string;
  fontWeight?: number; // 100..900
  textShadow?: boolean;
  align?: "left" | "center" | "right";
  // Phase 2 — persistent church logo overlay on every output surface.
  logoUrl?: string;        // https / presigned S3 URL
  logoPosition?: LogoPosition;
  logoSizePct?: number;    // logo width as % of the output width (2..50)
  logoOpacity?: number;    // 0..1
};

// ── Live video input (Phase 2a) ───────────────────────────────────────────
// A camera / USB-HDMI-capture (UVC) source, selected in the operator's
// Hardware panel and composited BEHIND the current slide on the output
// surfaces. The output windows open their own getUserMedia stream on this
// deviceId (so the projector shows the feed directly); the operator only sends
// the selection over the wire. Additive/optional: null ⇒ normal output.
export type VideoInputState = {
  deviceId: string;                          // MediaDeviceInfo.deviceId
  label?: string;                            // display name (for reconnect UX)
  fit?: "contain" | "cover" | "fill";        // how the video fills the frame (default cover)
  mirror?: boolean;                          // flip horizontally (front cameras)
  overlay?: "normal" | "lower-third" | "full"; // how slide content sits over video
  lyricsPos?: "top" | "center" | "bottom";   // vertical placement of lyrics over the video (default center)
};

// Background Templates (2026-08-20): a compact, wire-safe render spec for the
// projector's Background Layer — sits BETWEEN the theme background and the text.
// Separate from ThemeAppearance (the existing theme system is untouched). type
// "none" ⇒ no layer (existing theme bg shows through, unchanged behaviour).
export type BackgroundSpec = {
  type: "none" | "image" | "shader" | "video";
  shaderPreset?: string;
  primaryColor?: string;
  secondaryColor?: string;
  speed?: number;
  intensity?: number;
  imageUrl?: string;
  imageFit?: "fill" | "fit" | "stretch" | "tile";
  imageBlur?: number;
  videoUrl?: string;
  videoSpeed?: number;
  overlayColor?: string;
  overlayOpacity?: number;
};

export type OutputState = {
  live: SlidePayload;                // audience/projector output
  next: SlidePayload | null;         // for stage display "Next up"
  itemTitle: string;                 // "Amazing Grace", "John 3:16"
  slideNumber: string;               // "3 / 7"
  aspectRatio: "16:9" | "4:3" | "custom";
  fitMode: "contain" | "fill" | "crop";
  safeArea: boolean;
  operatorMessage: string | null;    // stage display operator note
  lowerThird: { line1: string; line2: string } | null; // livestream overlay (legacy)
  countdownEndsAt: number | null;    // ms epoch — stage countdown target
  // Phase 5D-2 additions (all optional, additive)
  announcement?: AnnouncementPayload | null;
  transition?: TransitionSpec | null;
  // P5 additions — stage "NEXT" preview metadata (playlist item title + type)
  nextItem?: { title: string; type: string } | null;
  // B3 (2026-08-11): operator manual text-size multiplier for projected slide
  // text (AUTO = 1.0 / undefined). Synced same-machine to all output surfaces.
  fontScale?: number;
  // Independent size multiplier for the scripture reference footer (1.0 =
  // default). Lets the operator size "the scripture at the bottom" on its own.
  referenceScale?: number;
  // Operator-chosen reference footer colour.
  referenceColor?: string;
  // Background Templates: the active projector background (undefined/none ⇒
  // existing theme background, unchanged).
  background?: BackgroundSpec | null;
  // Themes Phase 1: active theme's render appearance (background/text styling).
  // Undefined/null ⇒ built-in defaults. Applies to text/blank slides.
  appearance?: ThemeAppearance | null;
  // Phase 2a: active live video input composited behind the slide. Null ⇒ off.
  videoInput?: VideoInputState | null;
  // Projection Zone Customizer (2026-08-16): normalised content-zone geometry.
  // Undefined/full ⇒ full-bleed (unchanged). PresentationCanvas positions +
  // sizes the composed slide inside this rect; its fontScale is folded into the
  // fontScale field above by the operator, so only the RECT travels here.
  zone?: ProjectionZone | null;
};

/**
 * Message overlay — a lower-third bubble drawn ON TOP of the current slide
 * on the projector/live output. Auto-dismisses after `dismissAfterMs` from
 * the moment the output page receives it (client-side timer, so cross-tab
 * clock skew doesn't matter). Send `{clear:true}` to hide immediately.
 */
/** Overlay placement on the output canvas. Corners never cover slide text;
 * "center" is reserved for messages the operator explicitly chooses. */
export type OverlayPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "lower-third" | "center";
export const OVERLAY_POSITIONS: OverlayPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right", "lower-third", "center"];
const OVERLAY_POSITION_SET = new Set<string>(OVERLAY_POSITIONS);
function isValidOverlayPosition(p: unknown): boolean {
  return p === undefined || (typeof p === "string" && OVERLAY_POSITION_SET.has(p));
}

export type MessageOverlay =
  /** `allowWeb` gates the PUBLIC /livestream surface only (default true for
   * old-format compat). /live and /stage are in-building operator surfaces
   * and always render. */
  | { text: string; dismissAfterMs?: number | null; position?: OverlayPosition; allowWeb?: boolean;
      /** Horizontal ticker: when true the message scrolls across its band
       * (continuous loop). `scrollDir` is the travel direction; `scrollSec` is
       * the seconds for one full pass (lower = faster). Absent/false = static. */
      scroll?: boolean; scrollDir?: "ltr" | "rtl"; scrollSec?: number; clear?: false }
  | { clear: true };

// Ticker speed bounds (seconds for one pass). Clamped on both the wire and the
// operator control so a hostile/typo'd value can't freeze or hyper-spin the band.
export const MSG_SCROLL_MIN_SEC = 4;
export const MSG_SCROLL_MAX_SEC = 120;
export const MSG_SCROLL_DEFAULT_SEC = 18;

/**
 * Timer overlay — countdown / count-up displayed on outputs. `remainingSec`
 * is authoritative; renderers just format it. Send `{clear:true}` to hide.
 */
export type TimerOverlay =
  | { name?: string; remainingSec: number; running: boolean; kind: "countdown" | "elapsed"; position?: OverlayPosition; clear?: false }
  | { clear: true };

export type LiveMessage =
  | { type: "set"; slide: SlidePayload; transition?: TransitionSpec | null } // legacy + optional one-shot override
  | { type: "clear" }
  | { type: "ping"; join?: boolean } // join:true = genuine (re)connect; wants a full OutputState snapshot back, not just a pong
  | { type: "pong"; slide: SlidePayload }
  | { type: "output"; state: OutputState }             // new: full multi-surface state
  | { type: "message"; overlay: MessageOverlay }       // P2: transient message overlay
  | { type: "timer"; overlay: TimerOverlay }            // F1: timer overlay on outputs
  | { type: "media-control"; command: "play" | "pause" | "seek" | "volume" | "mute" | "unmute" | "restart" | "loop" | "unloop"; value?: number }
  | { type: "media-status"; currentTime: number; duration: number; paused: boolean; volume: number; muted: boolean; loop: boolean }
  // Continuous playback-clock heartbeat: the operator's live preview video is
  // the master; it broadcasts its position ~1×/sec so the projector can
  // reconcile drift (seek only past a threshold) and match play/pause — keeping
  // the projector frame-aligned with what the operator sees, not free-running.
  | { type: "media-sync"; currentTime: number; paused: boolean };

/**
 * Runtime validator for LiveMessage. Renderer pages should NEVER trust an
 * incoming BroadcastChannel payload — a stale extension, another tab from
 * a prior app version, or a fuzzed message could feed us garbage. Rejecting
 * unknown `type` values here keeps the projector black rather than crashing.
 */
// Y12: 24-hour cap for message dismiss timers — a value larger than this
// almost certainly indicates operator error or a malicious payload trying to
// pin an overlay indefinitely (or overflow setTimeout's 32-bit ms range).
const MAX_DISMISS_MS = 24 * 60 * 60 * 1000;

/** Y3 defense-in-depth: reject payloads carrying prototype-pollution keys. */
function hasPollutionKey(o: object): boolean {
  return Object.prototype.hasOwnProperty.call(o, "__proto__")
      || Object.prototype.hasOwnProperty.call(o, "constructor")
      || Object.prototype.hasOwnProperty.call(o, "prototype");
}

export function isValidLiveMessage(m: unknown): m is LiveMessage {
  if (!m || typeof m !== "object") return false;
  if (hasPollutionKey(m)) return false;
  const type = (m as { type?: unknown }).type;
  if (typeof type !== "string") return false;
  switch (type) {
    case "ping":
    case "clear":
      return true;
    case "set": {
      const candidate = m as { slide?: unknown; transition?: unknown };
      return isValidSlide(candidate.slide)
        && (candidate.transition === undefined || isValidTransitionSpec(candidate.transition));
    }
    case "pong":
      return isValidSlide((m as { slide?: unknown }).slide);
    case "output":
      return isValidOutputState((m as { state?: unknown }).state);
    case "message":
      return isValidMessageOverlay((m as { overlay?: unknown }).overlay);
    case "timer":
      return isValidTimerOverlay((m as { overlay?: unknown }).overlay);
    case "media-control":
      return isValidMediaControl(m);
    case "media-status":
      return isValidMediaStatus(m);
    case "media-sync":
      return isValidMediaSync(m);
    default:
      return false;
  }
}

/** Timer overlay validator. Bounds keep a malicious payload from pinning
 * a 999-hour timer or shipping through NaN/Infinity. */
export function isValidTimerOverlay(overlay: unknown): overlay is TimerOverlay {
  if (!overlay || typeof overlay !== "object") return false;
  if (hasPollutionKey(overlay)) return false;
  const o = overlay as Record<string, unknown>;
  if (o.clear === true) return true;
  if (typeof o.remainingSec !== "number" || !Number.isFinite(o.remainingSec)) return false;
  // Allow -3600s (0 mm:ss with negatives for overtime), cap upper at 24h.
  if (o.remainingSec < -3600 || o.remainingSec > 24 * 60 * 60) return false;
  if (typeof o.running !== "boolean") return false;
  if (o.kind !== "countdown" && o.kind !== "elapsed") return false;
  if (o.name != null && (typeof o.name !== "string" || o.name.length > 120)) return false;
  if (!isValidOverlayPosition(o.position)) return false;
  return true;
}

const MEDIA_COMMANDS = new Set(["play", "pause", "seek", "volume", "mute", "unmute", "restart", "loop", "unloop"]);
function isValidMediaControl(m: unknown): boolean {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  if (typeof o.command !== "string" || !MEDIA_COMMANDS.has(o.command)) return false;
  if (o.value !== undefined && (typeof o.value !== "number" || !Number.isFinite(o.value))) return false;
  return true;
}

function isValidMediaStatus(m: unknown): boolean {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  if (typeof o.currentTime !== "number" || !Number.isFinite(o.currentTime)) return false;
  if (typeof o.duration !== "number" || !Number.isFinite(o.duration)) return false;
  if (typeof o.paused !== "boolean") return false;
  if (typeof o.volume !== "number" || !Number.isFinite(o.volume)) return false;
  if (typeof o.muted !== "boolean") return false;
  if (typeof o.loop !== "boolean") return false;
  return true;
}

function isValidMediaSync(m: unknown): boolean {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  if (typeof o.currentTime !== "number" || !Number.isFinite(o.currentTime)) return false;
  if (typeof o.paused !== "boolean") return false;
  return true;
}

/** Y7: bounded message overlay validation. */
export function isValidMessageOverlay(overlay: unknown): overlay is MessageOverlay {
  if (!overlay || typeof overlay !== "object") return false;
  if (hasPollutionKey(overlay)) return false;
  const o = overlay as Record<string, unknown>;
  if (o.clear === true) return true;
  if (typeof o.text !== "string") return false;
  if (o.text.length === 0 || o.text.length > 2000) return false;
  // dismissAfterMs: null / undefined => "never"; else finite positive ≤ 24h.
  if (o.dismissAfterMs != null) {
    const ms = o.dismissAfterMs;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0 || ms > MAX_DISMISS_MS) return false;
  }
  if (!isValidOverlayPosition(o.position)) return false;
  // allowWeb: optional boolean (absent = true, old-format compat).
  if (o.allowWeb !== undefined && typeof o.allowWeb !== "boolean") return false;
  // Ticker: scroll boolean, direction enum, bounded numeric seconds.
  if (o.scroll !== undefined && typeof o.scroll !== "boolean") return false;
  if (o.scrollDir !== undefined && o.scrollDir !== "ltr" && o.scrollDir !== "rtl") return false;
  if (o.scrollSec !== undefined) {
    const s = o.scrollSec;
    if (typeof s !== "number" || !Number.isFinite(s) || s < MSG_SCROLL_MIN_SEC || s > MSG_SCROLL_MAX_SEC) return false;
  }
  return true;
}

// Y11: allowed URL protocols for image/video slides. `javascript:` /
// `data:` / `file:` are explicitly rejected — no XSS, no local-file leak.
const ALLOWED_URL_PROTOCOLS = new Set(["https:", "http:", "blob:"]);
// Basic CSS color: hex or rgb()/rgba(). No `red;--x:url(...)` shenanigans.
const COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+(?:\s*,\s*\d+){2}\s*(?:,\s*(?:0|1|0?\.\d+))?\s*\))$/;
function isValidColor(c: unknown): boolean {
  if (typeof c !== "string") return false;
  if (c.length > 32) return false;
  return COLOR_RE.test(c.trim());
}
function isValidMediaUrl(u: unknown): boolean {
  if (typeof u !== "string" || u.length === 0 || u.length > 2048) return false;
  try {
    const parsed = new URL(u);
    return ALLOWED_URL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

// Font-family is interpolated into a CSS value, so bound it to a safe charset
// (names, quotes, spaces, commas, dots, hyphens) — a cross-device payload must
// not be able to inject CSS through it.
const FONT_FAMILY_RE = /^[a-zA-Z0-9 ,._'"-]{1,120}$/;

// A media URL interpolated into a CSS url("...") or an <img>/<video> src on the
// projector. Requires https (media must load on the https output page — and it
// matches the mapper, so a mapped appearance always passes) AND rejects the raw
// quote/whitespace chars that could break out of url("...") (legit https/S3
// URLs percent-encode those).
// Dev-only http-loopback allowance. In production this is `false` (statically
// inlined + dead-code-eliminated by the Next/webpack build), so the loopback
// branch never ships to prod validators — closing the cross-device
// localhost-probe vector. Production media is S3/presigned-https regardless.
const ALLOW_HTTP_LOOPBACK = process.env.NODE_ENV !== "production";
function isValidRenderUrl(u: unknown): boolean {
  if (typeof u !== "string" || u.length === 0 || u.length > 2048) return false;
  if (/["'\s<>\\]/.test(u)) return false;
  try {
    const p = new URL(u);
    if (p.protocol === "https:") return true;
    // Local dev only: the dummy app serves media from MinIO over
    // http://localhost:9000. Allow http ONLY for loopback hosts, and ONLY in
    // dev; every other host stays https-only, so a cross-device payload can
    // never point at an arbitrary http:// host.
    if (ALLOW_HTTP_LOOPBACK && p.protocol === "http:" && (p.hostname === "localhost" || p.hostname === "127.0.0.1" || p.hostname === "[::1]")) return true;
    return false;
  } catch { return false; }
}
const LOGO_POSITIONS = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right", "none",
]);

export function isValidBackgroundSpec(b: unknown): b is BackgroundSpec {
  if (!b || typeof b !== "object") return false;
  const s = b as Record<string, unknown>;
  if (!["none", "image", "shader", "video"].includes(s.type as string)) return false;
  if (s.shaderPreset !== undefined && (typeof s.shaderPreset !== "string" || s.shaderPreset.length > 40)) return false;
  if (s.imageFit !== undefined && !["fill", "fit", "stretch", "tile"].includes(s.imageFit as string)) return false;
  for (const k of ["primaryColor", "secondaryColor", "overlayColor"] as const) {
    if (s[k] !== undefined && !isValidColor(s[k])) return false;
  }
  for (const k of ["imageUrl", "videoUrl"] as const) {
    if (s[k] !== undefined && !isValidRenderUrl(s[k])) return false;
  }
  for (const k of ["speed", "intensity", "imageBlur", "videoSpeed", "overlayOpacity"] as const) {
    const v = s[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)) return false;
  }
  return true;
}

export function isValidThemeAppearance(a: unknown): a is ThemeAppearance {
  if (a === null) return true;
  if (!a || typeof a !== "object") return false;
  if (hasPollutionKey(a)) return false;
  const p = a as Record<string, unknown>;
  if (p.bgType !== undefined && !["solid", "gradient", "image", "video"].includes(p.bgType as string)) return false;
  if (p.bgColor !== undefined && !isValidColor(p.bgColor)) return false;
  if (p.bgColor2 !== undefined && !isValidColor(p.bgColor2)) return false;
  if (p.textColor !== undefined && !isValidColor(p.textColor)) return false;
  if (p.bgImageUrl !== undefined && !isValidRenderUrl(p.bgImageUrl)) return false;
  if (p.bgAngle !== undefined && (typeof p.bgAngle !== "number" || !Number.isFinite(p.bgAngle) || p.bgAngle < 0 || p.bgAngle > 360)) return false;
  if (p.bgAnimation !== undefined && !["none", "drift", "aurora", "pulse"].includes(p.bgAnimation as string)) return false;
  if (p.dim !== undefined && (typeof p.dim !== "number" || !Number.isFinite(p.dim) || p.dim < 0 || p.dim > 1)) return false;
  if (p.fontWeight !== undefined && (typeof p.fontWeight !== "number" || !Number.isFinite(p.fontWeight) || p.fontWeight < 100 || p.fontWeight > 900)) return false;
  if (p.textShadow !== undefined && typeof p.textShadow !== "boolean") return false;
  if (p.align !== undefined && !["left", "center", "right"].includes(p.align as string)) return false;
  if (p.fontFamily !== undefined && (typeof p.fontFamily !== "string" || !FONT_FAMILY_RE.test(p.fontFamily))) return false;
  // Phase 2 — video background + logo overlay.
  if (p.bgVideoUrl !== undefined && !isValidRenderUrl(p.bgVideoUrl)) return false;
  if (p.logoUrl !== undefined && !isValidRenderUrl(p.logoUrl)) return false;
  if (p.logoPosition !== undefined && !LOGO_POSITIONS.has(p.logoPosition as string)) return false;
  if (p.logoSizePct !== undefined && (typeof p.logoSizePct !== "number" || !Number.isFinite(p.logoSizePct) || p.logoSizePct < 2 || p.logoSizePct > 50)) return false;
  if (p.logoOpacity !== undefined && (typeof p.logoOpacity !== "number" || !Number.isFinite(p.logoOpacity) || p.logoOpacity < 0 || p.logoOpacity > 1)) return false;
  return true;
}

export function isValidVideoInput(v: unknown): v is VideoInputState {
  if (v === null) return true;
  if (!v || typeof v !== "object") return false;
  if (hasPollutionKey(v)) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.deviceId !== "string" || p.deviceId.length === 0 || p.deviceId.length > 512) return false;
  if (p.label !== undefined && (typeof p.label !== "string" || p.label.length > 256)) return false;
  if (p.fit !== undefined && !["contain", "cover", "fill"].includes(p.fit as string)) return false;
  if (p.mirror !== undefined && typeof p.mirror !== "boolean") return false;
  if (p.overlay !== undefined && !["normal", "lower-third", "full"].includes(p.overlay as string)) return false;
  if (p.lyricsPos !== undefined && !["top", "center", "bottom"].includes(p.lyricsPos as string)) return false;
  return true;
}

// A finite number within a generous canvas band (objects may sit slightly
// off-canvas; reject NaN/Infinity and absurd values that could break layout).
function isCanvasCoord(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= -SLIDE_CANVAS_W && v <= SLIDE_CANVAS_W * 2;
}

export function isValidSlideObject(o: unknown): o is SlideObjectWire {
  if (!o || typeof o !== "object") return false;
  if (hasPollutionKey(o)) return false;
  const p = o as Record<string, unknown>;
  if (!isCanvasCoord(p.x) || !isCanvasCoord(p.y) || !isCanvasCoord(p.w) || !isCanvasCoord(p.h)) return false;
  if ((p.w as number) < 0 || (p.h as number) < 0) return false;
  // Entrance animation (common to all object kinds).
  if (p.anim !== undefined && !["none", "fade", "slide-up", "slide-down", "slide-left", "slide-right", "zoom"].includes(p.anim as string)) return false;
  if (p.animDelayMs !== undefined && (typeof p.animDelayMs !== "number" || !Number.isFinite(p.animDelayMs) || p.animDelayMs < 0 || p.animDelayMs > 10000)) return false;
  if (p.rotation !== undefined && (typeof p.rotation !== "number" || !Number.isFinite(p.rotation) || p.rotation < -360 || p.rotation > 360)) return false;
  if (p.opacity !== undefined && (typeof p.opacity !== "number" || !Number.isFinite(p.opacity) || p.opacity < 0 || p.opacity > 1)) return false;
  if (p.locked !== undefined && typeof p.locked !== "boolean") return false;
  if (p.hidden !== undefined && typeof p.hidden !== "boolean") return false;
  switch (p.kind) {
    case "text":
      if (typeof p.text !== "string" || p.text.length > 5000) return false;
      if (p.fontFamily !== undefined && (typeof p.fontFamily !== "string" || !FONT_FAMILY_RE.test(p.fontFamily))) return false;
      if (p.fontSize !== undefined && (typeof p.fontSize !== "number" || !Number.isFinite(p.fontSize) || p.fontSize < 1 || p.fontSize > 2000)) return false;
      if (p.fontWeight !== undefined && (typeof p.fontWeight !== "number" || !Number.isFinite(p.fontWeight) || p.fontWeight < 100 || p.fontWeight > 900)) return false;
      if (p.color !== undefined && !isValidColor(p.color)) return false;
      if (p.align !== undefined && !["left", "center", "right"].includes(p.align as string)) return false;
      if (p.italic !== undefined && typeof p.italic !== "boolean") return false;
      if (p.underline !== undefined && typeof p.underline !== "boolean") return false;
      if (p.lineHeight !== undefined && (typeof p.lineHeight !== "number" || !Number.isFinite(p.lineHeight) || p.lineHeight < 0.5 || p.lineHeight > 4)) return false;
      if (p.letterSpacing !== undefined && (typeof p.letterSpacing !== "number" || !Number.isFinite(p.letterSpacing) || p.letterSpacing < -50 || p.letterSpacing > 200)) return false;
      if (p.uppercase !== undefined && typeof p.uppercase !== "boolean") return false;
      if (p.shadow !== undefined && typeof p.shadow !== "boolean") return false;
      if (p.stroke !== undefined && !isValidColor(p.stroke)) return false;
      if (p.strokeWidth !== undefined && (typeof p.strokeWidth !== "number" || !Number.isFinite(p.strokeWidth) || p.strokeWidth < 0 || p.strokeWidth > 200)) return false;
      return true;
    case "shape":
      if (p.shape !== "rect" && p.shape !== "ellipse") return false;
      if (p.fill !== undefined && !isValidColor(p.fill)) return false;
      if (p.fill2 !== undefined && !isValidColor(p.fill2)) return false;
      if (p.fillAngle !== undefined && (typeof p.fillAngle !== "number" || !Number.isFinite(p.fillAngle) || p.fillAngle < 0 || p.fillAngle > 360)) return false;
      if (p.stroke !== undefined && !isValidColor(p.stroke)) return false;
      if (p.strokeWidth !== undefined && (typeof p.strokeWidth !== "number" || !Number.isFinite(p.strokeWidth) || p.strokeWidth < 0 || p.strokeWidth > 200)) return false;
      if (p.radius !== undefined && (typeof p.radius !== "number" || !Number.isFinite(p.radius) || p.radius < 0 || p.radius > 2000)) return false;
      // opacity validated once before the switch (common to all kinds)
      return true;
    case "image":
      if (!isValidRenderUrl(p.url)) return false;
      if (p.fit !== undefined && p.fit !== "contain" && p.fit !== "cover" && p.fit !== "fill") return false;
      if (p.posX !== undefined && (typeof p.posX !== "number" || !Number.isFinite(p.posX) || p.posX < 0 || p.posX > 100)) return false;
      if (p.posY !== undefined && (typeof p.posY !== "number" || !Number.isFinite(p.posY) || p.posY < 0 || p.posY > 100)) return false;
      if (p.zoom !== undefined && (typeof p.zoom !== "number" || !Number.isFinite(p.zoom) || p.zoom < 1 || p.zoom > 8)) return false;
      if (p.blurFill !== undefined && typeof p.blurFill !== "boolean") return false;
      return true;
    case "video":
      if (!isValidRenderUrl(p.url)) return false;
      if (p.fit !== undefined && p.fit !== "contain" && p.fit !== "cover" && p.fit !== "fill") return false;
      if (p.loop !== undefined && typeof p.loop !== "boolean") return false;
      if (p.muted !== undefined && typeof p.muted !== "boolean") return false;
      return true;
    default:
      return false;
  }
}

/**
 * Build a GUARANTEED wire-valid text SlidePayload from possibly-untrusted DB
 * fields. Each field is validated with the same predicates isValidSlide uses,
 * and invalid objects are DROPPED individually rather than failing the whole
 * slide — so a designed slide always projects (fail-open to the readable text
 * block), never silently no-ops on the projector. Used server-side when
 * building the projectable plan.
 */
export function projectableTextSlide(text: unknown, bgColor?: unknown, bgImageUrl?: unknown, objects?: unknown): SlidePayload {
  const out: { kind: "text"; text: string; bgColor?: string; bgImageUrl?: string; objects?: SlideObjectWire[] } = {
    kind: "text",
    text: typeof text === "string" ? text.slice(0, 5000) : "",
  };
  if (isValidColor(bgColor)) out.bgColor = bgColor as string;
  if (isValidRenderUrl(bgImageUrl)) out.bgImageUrl = bgImageUrl as string;
  if (Array.isArray(objects)) {
    const valid = objects.filter(isValidSlideObject).slice(0, MAX_SLIDE_OBJECTS);
    if (valid.length > 0) out.objects = valid;
  }
  return out;
}

/**
 * Compact signature of a designed (object) text slide's background + objects,
 * folded into the projector transition identity (live/stage/livestream) so two
 * DIFFERENT designed slides get different transition keys — they crossfade and
 * replay entrance animations instead of swapping in place. Covers position,
 * size, rotation, url, and the key colours so appearance-only edits also
 * transition. Pure + deterministic (same slide → same string) so the jitter
 * fix's heartbeat-stability invariant holds. Plain text slides (no objects, no
 * design bg) collapse to "|", leaving their identity behaviour unchanged.
 */
export function slideDesignSig(s: Extract<SlidePayload, { kind: "text" }>): string {
  let sig = `${s.bgColor ?? ""}|${s.bgImageUrl ?? ""}`;
  // Lower-third layout + band are visible design: fold them in so a layout/band
  // change updates the output identity (crossfades + defeats the already-live
  // skip). A plain (non-lower-third) slide adds nothing here → identity unchanged.
  if (s.scriptureLayout) {
    const b = s.scriptureBand;
    sig += `|lt${b ? `${b.color},${b.color2 ?? ""},${b.angle ?? ""},${b.opacity}` : "none"}`;
  }
  if (s.objects?.length) {
    sig += "|o" + s.objects.length + ":" + s.objects.map((o) => {
      const base = `${o.kind[0]}${Math.round(o.x)},${Math.round(o.y)},${Math.round(o.w)},${Math.round(o.h)}${o.rotation ? "@" + Math.round(o.rotation) : ""}`;
      // Include the visual text style so a style-only edit (font/size/weight/
      // align/uppercase) changes the identity — otherwise the already-live skip
      // in sendSlideToLive silently swallows it for callers that don't force.
      if (o.kind === "text") return base + [o.color, o.fontFamily, o.fontSize, o.fontWeight, o.align, o.italic ? "i" : "", o.uppercase ? "u" : ""].join(",");
      if (o.kind === "shape") return base + (o.fill ?? "") + (o.fill2 ?? "") + `|${o.fillAngle ?? ""}`;
      // image | video — fold fit + crop/pan/zoom so a reframe of an already-live
      // image changes the output identity (otherwise the already-live skip
      // swallows it and the projector never updates).
      return base + o.url + (o.kind === "image" ? `|${o.fit ?? ""}|${o.posX ?? 50},${o.posY ?? 50},${o.zoom ?? 1}|${o.blurFill ? "b" : ""}` : "");
    }).join(";");
  }
  return sig;
}

/**
 * Content-only identity for an output slide. The projector/stage/livestream
 * remount the TransitionWrapper (and replay the enter animation) only when this
 * changes — so it must reflect visible CONTENT and nothing volatile (no
 * fontScale, zone, appearance, timestamps). A repeat of the same slide keeps the
 * same identity and therefore never re-animates. Consolidated here (was inlined
 * identically in live/stage/livestream).
 */
export function slideOutputIdentity(s: SlidePayload): string {
  if (s.kind === "text") return `t:${s.text}|${s.reference ?? ""}|${slideDesignSig(s)}`;
  // fit is part of the identity so an operator changing the size of the
  // already-live image/video actually re-projects (the already-live SKIP in
  // sendSlideToLive compares this string). fit only changes on a deliberate
  // operator action, so it can't cause the identity-flap "pulse" that
  // appearance/transition fields would.
  if (s.kind === "image") return `i:${s.url}|${s.fit ?? ""}|${s.blurFill ? "b" : ""}`;
  if (s.kind === "video") return `v:${s.url}|${s.fit ?? ""}`;
  if (s.kind === "blank") return `b:${s.bgColor ?? ""}`;
  if (s.kind === "logo") return `l:${s.url ?? ""}`;
  return "e";
}

function isValidScriptureBand(b: unknown): boolean {
  if (!b || typeof b !== "object") return false;
  if (hasPollutionKey(b)) return false;
  const p = b as Record<string, unknown>;
  if (!isValidColor(p.color)) return false;
  if (p.color2 !== undefined && !isValidColor(p.color2)) return false;
  if (p.angle !== undefined && (typeof p.angle !== "number" || !Number.isFinite(p.angle) || p.angle < 0 || p.angle > 360)) return false;
  if (typeof p.opacity !== "number" || !Number.isFinite(p.opacity) || p.opacity < 0 || p.opacity > 1) return false;
  return true;
}

function isValidSlide(s: unknown): s is SlidePayload {
  if (!s || typeof s !== "object") return false;
  if (hasPollutionKey(s)) return false;
  const st = s as Record<string, unknown>;
  const k = st.kind;
  switch (k) {
    case "text":
      if (typeof st.text !== "string" || st.text.length > 5000) return false;
      if (st.bgColor !== undefined && !isValidColor(st.bgColor)) return false;
      if (st.bgImageUrl !== undefined && !isValidRenderUrl(st.bgImageUrl)) return false;
      if (st.objects !== undefined) {
        if (!Array.isArray(st.objects) || st.objects.length > MAX_SLIDE_OBJECTS) return false;
        if (!st.objects.every(isValidSlideObject)) return false;
      }
      if (st.scriptureLayout !== undefined && st.scriptureLayout !== "lowerThird") return false;
      if (st.scriptureBand !== undefined && !isValidScriptureBand(st.scriptureBand)) return false;
      return true;
    case "image":
    case "video":
      return isValidMediaUrl(st.url);
    case "blank":
      if (st.bgColor !== undefined && !isValidColor(st.bgColor)) return false;
      return true;
    case "logo":
      if (st.url !== undefined && !isValidMediaUrl(st.url)) return false;
      return true;
    case "empty":
      return true;
    default:
      return false;
  }
}

function isValidAnnouncement(a: unknown): a is AnnouncementPayload {
  if (!a || typeof a !== "object") return false;
  if (hasPollutionKey(a)) return false;
  const p = a as Record<string, unknown>;
  if (typeof p.line1 !== "string" || p.line1.length > 500) return false;
  if (p.line2 !== undefined && (typeof p.line2 !== "string" || p.line2.length > 500)) return false;
  if (p.logo !== undefined && p.logo !== null) {
    if (typeof p.logo !== "object" || hasPollutionKey(p.logo)) return false;
    const lg = p.logo as Record<string, unknown>;
    if (!isValidRenderUrl(lg.url)) return false;
    if (!ANNOUNCEMENT_LOGO_POSITIONS.has(lg.position as string)) return false;
    if (typeof lg.sizePct !== "number" || !Number.isFinite(lg.sizePct) || lg.sizePct < 2 || lg.sizePct > 50) return false;
    if (typeof lg.opacity !== "number" || !Number.isFinite(lg.opacity) || lg.opacity < 0 || lg.opacity > 1) return false;
  }
  return true;
}

function isValidLowerThird(lt: unknown): boolean {
  if (lt === null) return true;
  if (!lt || typeof lt !== "object") return false;
  if (hasPollutionKey(lt)) return false;
  const p = lt as Record<string, unknown>;
  if (typeof p.line1 !== "string" || p.line1.length > 500) return false;
  if (typeof p.line2 !== "string" || p.line2.length > 500) return false;
  return true;
}

const ALLOWED_ASPECT = new Set(["16:9", "4:3", "custom"]);

export function isValidOutputStateExternal(s: unknown): s is OutputState {
  return isValidOutputState(s);
}

// P5: bounds for countdown target — sanity-cap 24h into the future so a
// malformed / hostile payload can't schedule a runaway countdown target far
// enough out to overflow numeric math in the stage renderer.
const MAX_COUNTDOWN_FUTURE_MS = 24 * 60 * 60 * 1000;

function isValidNextItem(n: unknown): boolean {
  if (n === null) return true;
  if (!n || typeof n !== "object") return false;
  if (hasPollutionKey(n)) return false;
  const p = n as Record<string, unknown>;
  if (typeof p.title !== "string" || p.title.length === 0 || p.title.length > 500) return false;
  if (typeof p.type !== "string" || p.type.length === 0 || p.type.length > 64) return false;
  return true;
}

export function isValidOutputState(s: unknown): s is OutputState {
  if (!s || typeof s !== "object") return false;
  if (hasPollutionKey(s)) return false;
  const st = s as Record<string, unknown>;
  if (!isValidSlide(st.live)) return false;
  if (st.next != null && !isValidSlide(st.next)) return false;
  if (typeof st.aspectRatio !== "string" || !ALLOWED_ASPECT.has(st.aspectRatio)) return false;
  if (st.announcement != null && !isValidAnnouncement(st.announcement)) return false;
  if (st.lowerThird !== undefined && !isValidLowerThird(st.lowerThird)) return false;
  if (st.countdownEndsAt !== undefined && st.countdownEndsAt !== null) {
    const c = st.countdownEndsAt;
    if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return false;
    // Must be a plausible future epoch: no more than 24h ahead of now.
    if (c > Date.now() + MAX_COUNTDOWN_FUTURE_MS) return false;
  }
  if (st.nextItem !== undefined && !isValidNextItem(st.nextItem)) return false;
  if (st.transition !== undefined && !isValidTransitionSpec(st.transition)) return false;
  // B3 font scale — bounded, finite, positive (consumers also clamp, but keep
  // this file's hardening posture consistent).
  if (st.fontScale !== undefined) {
    const f = st.fontScale;
    if (typeof f !== "number" || !Number.isFinite(f) || f <= 0 || f > 4) return false;
  }
  if (st.referenceScale !== undefined) {
    const r = st.referenceScale;
    if (typeof r !== "number" || !Number.isFinite(r) || r <= 0 || r > 4) return false;
  }
  if (st.referenceColor !== undefined && st.referenceColor !== null && !isValidColor(st.referenceColor)) return false;
  if (st.background !== undefined && st.background !== null && !isValidBackgroundSpec(st.background)) return false;
  // Themes Phase 1 — validate the theme appearance if present (rejects a
  // malformed/hostile appearance on the cross-device path rather than letting
  // it reach the renderer's style props).
  if (st.appearance !== undefined && !isValidThemeAppearance(st.appearance)) return false;
  if (st.videoInput !== undefined && !isValidVideoInput(st.videoInput)) return false;
  if (st.zone !== undefined && st.zone !== null && !isValidZone(st.zone)) return false;
  return true;
}

/**
 * Build a Livestream output URL with optional OBS-friendly overlay mode.
 * Kept as a pure string helper so it can be exercised in tests without
 * pulling in Electron/`window`.
 */
export function livestreamUrl(
  role: string,
  appUrl: string,
  opts?: { obs?: "lowerthird" | "full" }
): string {
  const params = new URLSearchParams();
  if (opts?.obs === "lowerthird") params.set("obs", "lowerthird");
  const qs = params.toString();
  const base = `${appUrl}/livestream`;
  // `role` is currently informational — kept in the signature to match the
  // scope contract and future-proof for role→path mapping changes.
  void role;
  return qs ? `${base}?${qs}` : base;
}

const CHANNEL = "presentflow-live";

/**
 * The minimal surface the operator/output pages use on a live channel. A real
 * BroadcastChannel already satisfies this; the LiveChannel wrapper below adds an
 * Electron main-process relay ALONGSIDE it so cross-window delivery survives
 * BroadcastChannel flaking between separate Electron BrowserWindows (the
 * "Operator disconnected" / translation-not-projecting symptom on some Macs).
 */
export interface LiveChannelLike {
  onmessage: ((ev: MessageEvent) => void) | null;
  onmessageerror: ((ev: MessageEvent) => void) | null;
  postMessage: (msg: LiveMessage) => void;
  close: () => void;
}

type ElectronLive = { post: (m: unknown) => void; onMessage: (cb: (m: unknown) => void) => () => void };
function getElectronLive(): ElectronLive | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: { live?: ElectronLive } }).electronAPI;
  const live = api?.live;
  return live && typeof live.post === "function" && typeof live.onMessage === "function" ? live : null;
}

// Per-window id + monotonic counter to tag every outgoing message, so the SAME
// message arriving via BOTH BroadcastChannel and the Electron relay is applied
// once. (Renderer context — Date.now/Math.random are fine here; they only break
// inside workflow scripts.) The seen-id set is PER LiveChannel INSTANCE (not
// module-global): it must collapse the twin delivery of ONE channel, but two
// distinct receiving channels in the same window must NOT share it or the second
// would wrongly drop the first's messages.
const PF_WIN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let pfSeq = 0;
const RECENT_MID_MAX = 256;

/**
 * A live channel that multiplexes BroadcastChannel (primary, same-origin) AND
 * the Electron main-process relay (belt-and-braces, cross-BrowserWindow). Either
 * transport alone delivers; duplicates are deduped by message id. When neither
 * is available (SSR, plain browser without the relay) it degrades to whichever
 * exists — a normal browser keeps pure BroadcastChannel behaviour, and the relay
 * simply stays dormant until an Electron build exposes `electronAPI.live`.
 */
class LiveChannel implements LiveChannelLike {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  private bc: BroadcastChannel | null = null;
  private ipcOff: (() => void) | null = null;
  private closed = false;
  private readonly seen: Set<string> = new Set();

  private markSeen(mid: string): boolean {
    if (this.seen.has(mid)) return true;
    this.seen.add(mid);
    if (this.seen.size > RECENT_MID_MAX) {
      let i = 0; const drop = RECENT_MID_MAX >> 2;
      for (const k of this.seen) { this.seen.delete(k); if (++i >= drop) break; }
    }
    return false;
  }

  constructor() {
    try {
      this.bc = new BroadcastChannel(CHANNEL);
      this.bc.onmessage = (e: MessageEvent) => this.receive(e.data, e);
      this.bc.onmessageerror = (e: MessageEvent) => { try { this.onmessageerror?.(e); } catch { /* noop */ } };
    } catch (e) {
      console.warn("[broadcast] BroadcastChannel unavailable:", e instanceof Error ? e.message : String(e));
      this.bc = null;
    }
    const live = getElectronLive();
    if (live) {
      try { this.ipcOff = live.onMessage((m) => this.receive(m, { data: m } as MessageEvent)); }
      catch { this.ipcOff = null; }
    }
  }

  private receive(data: unknown, ev: MessageEvent) {
    if (this.closed) return;
    const mid = (data as { pfMid?: unknown })?.pfMid;
    if (typeof mid === "string" && this.markSeen(mid)) return; // duplicate from the other transport (same channel)
    try { this.onmessage?.(ev); } catch (e) { console.warn("[broadcast] onmessage handler threw:", e instanceof Error ? e.message : String(e)); }
  }

  postMessage(msg: LiveMessage) {
    // Tag with a dedup id (harmless extra field; validators ignore it) so the
    // twin BroadcastChannel + relay deliveries collapse to one on the receiver.
    const tagged = { ...(msg as Record<string, unknown>), pfMid: `${PF_WIN_ID}:${++pfSeq}` } as unknown as LiveMessage;
    try { this.bc?.postMessage(tagged); } catch (e) { console.warn("[broadcast] BC postMessage failed:", e instanceof Error ? e.message : String(e)); }
    try { getElectronLive()?.post(tagged); } catch { /* relay best-effort */ }
  }

  close() {
    this.closed = true;
    try { this.bc?.close(); } catch { /* noop */ }
    try { this.ipcOff?.(); } catch { /* noop */ }
    this.ipcOff = null;
    this.bc = null;
  }
}

export function openLiveChannel(): LiveChannelLike | null {
  if (typeof window === "undefined") return null;
  // Need at least one transport. BroadcastChannel is the common case; the relay
  // alone (exotic) also qualifies.
  if (typeof BroadcastChannel === "undefined" && !getElectronLive()) return null;
  try {
    return new LiveChannel();
  } catch (e) {
    console.warn("[broadcast] openLiveChannel failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export function safePost(ch: LiveChannelLike | null, msg: LiveMessage): boolean {
  if (!ch) return false;
  try {
    ch.postMessage(msg);
    return true;
  } catch (e) {
    console.warn("[broadcast] postMessage failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

export const EMPTY_OUTPUT: OutputState = {
  live: { kind: "empty" },
  next: null,
  itemTitle: "",
  slideNumber: "",
  aspectRatio: "16:9",
  fitMode: "contain",
  safeArea: false,
  operatorMessage: null,
  lowerThird: null,
  countdownEndsAt: null,
  announcement: null,
  transition: null,
  nextItem: null,
  appearance: null,
  videoInput: null,
};
