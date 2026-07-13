"use client";

export type SlidePayload =
  | { kind: "text"; text: string; bgColor?: string }
  | { kind: "image"; url: string; fit?: "contain" | "cover" }
  | { kind: "video"; url: string; fit?: "contain" | "cover" }
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
  return true;
}

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
};

/**
 * Message overlay — a lower-third bubble drawn ON TOP of the current slide
 * on the projector/live output. Auto-dismisses after `dismissAfterMs` from
 * the moment the output page receives it (client-side timer, so cross-tab
 * clock skew doesn't matter). Send `{clear:true}` to hide immediately.
 */
export type MessageOverlay =
  | { text: string; dismissAfterMs?: number | null; clear?: false }
  | { clear: true };

export type LiveMessage =
  | { type: "set"; slide: SlidePayload }              // legacy: just live surface
  | { type: "clear" }
  | { type: "ping" }
  | { type: "pong"; slide: SlidePayload }
  | { type: "output"; state: OutputState }             // new: full multi-surface state
  | { type: "message"; overlay: MessageOverlay };      // P2: transient message overlay

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
    case "set":
    case "pong":
      return isValidSlide((m as { slide?: unknown }).slide);
    case "output":
      return isValidOutputState((m as { state?: unknown }).state);
    case "message":
      return isValidMessageOverlay((m as { overlay?: unknown }).overlay);
    default:
      return false;
  }
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
};
