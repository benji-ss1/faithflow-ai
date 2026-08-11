"use client";

export type SlidePayload =
  | { kind: "text"; text: string; bgColor?: string }
  | { kind: "image"; url: string; fit?: "contain" | "cover" }
  | { kind: "video"; url: string; fit?: "contain" | "cover"; loop?: boolean; volume?: number }
  | { kind: "blank"; bgColor?: string }
  | { kind: "logo"; url?: string }
  | { kind: "empty" };

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

export type AnnouncementPayload = {
  line1: string;
  line2?: string;
  position: AnnouncementPosition;
  style: AnnouncementStyle;
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
  // Themes Phase 1: active theme's render appearance (background/text styling).
  // Undefined/null ⇒ built-in defaults. Applies to text/blank slides.
  appearance?: ThemeAppearance | null;
  // Phase 2a: active live video input composited behind the slide. Null ⇒ off.
  videoInput?: VideoInputState | null;
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
  | { text: string; dismissAfterMs?: number | null; position?: OverlayPosition; allowWeb?: boolean; clear?: false }
  | { clear: true };

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
  | { type: "ping" }
  | { type: "pong"; slide: SlidePayload }
  | { type: "output"; state: OutputState }             // new: full multi-surface state
  | { type: "message"; overlay: MessageOverlay }       // P2: transient message overlay
  | { type: "timer"; overlay: TimerOverlay }            // F1: timer overlay on outputs
  | { type: "media-control"; command: "play" | "pause" | "seek" | "volume" | "mute" | "unmute" | "restart" | "loop" | "unloop"; value?: number }
  | { type: "media-status"; currentTime: number; duration: number; paused: boolean; volume: number; muted: boolean; loop: boolean };

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
function isValidRenderUrl(u: unknown): boolean {
  if (typeof u !== "string" || u.length === 0 || u.length > 2048) return false;
  if (/["'\s<>\\]/.test(u)) return false;
  try { return new URL(u).protocol === "https:"; } catch { return false; }
}
const LOGO_POSITIONS = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right", "none",
]);

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
  // Themes Phase 1 — validate the theme appearance if present (rejects a
  // malformed/hostile appearance on the cross-device path rather than letting
  // it reach the renderer's style props).
  if (st.appearance !== undefined && !isValidThemeAppearance(st.appearance)) return false;
  if (st.videoInput !== undefined && !isValidVideoInput(st.videoInput)) return false;
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

export function openLiveChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL);
  } catch (e) {
    console.warn("[broadcast] BroadcastChannel unavailable:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export function safePost(ch: BroadcastChannel | null, msg: LiveMessage): boolean {
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
