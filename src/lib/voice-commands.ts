/**
 * Runtime matcher for user-added custom voice commands.
 *
 * The Settings > Audio tab persists custom voice-command entries to
 * localStorage under `presentflow.pro.voiceCommands.v1` in the shape
 * `[{ id, phrase, action }]`. This module is called from useAudioStream
 * on every final transcript to check whether the pastor said one of
 * those custom phrases and, if so, produce a matched action so the
 * shell can dispatch it.
 *
 * Matching rules:
 *   - Case-insensitive.
 *   - Whole-word: a phrase must be surrounded by word boundaries so
 *     "next" doesn't accidentally match "nexttime".
 *   - Longest matching phrase wins (so a custom "next slide please"
 *     beats a plain "next").
 *   - Debounce: the same action can't fire twice within DEBOUNCE_MS
 *     (default 5s) — prevents a stuck / re-heard phrase from spamming.
 */

export type CustomCommand = { id: string; phrase: string; action: string };
export type VoiceCommandMatch = { action: string; phrase: string };

const DEBOUNCE_MS = 5000;

// Per-action last-fire timestamps; shared across calls. Callers can pass
// their own `now` to make tests deterministic and can call
// `resetVoiceCommandDebounce()` for isolation.
const lastFired = new Map<string, number>();

export function resetVoiceCommandDebounce() {
  lastFired.clear();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Try to match `transcript` against any of the user-added custom
 * commands. Returns the matched action + phrase or null. Applies the
 * whole-word rule + 5s per-action debounce.
 */
export function matchCustomCommand(
  transcript: string,
  customs: CustomCommand[],
  opts: { now?: number } = {},
): VoiceCommandMatch | null {
  if (!transcript || !customs || customs.length === 0) return null;
  const text = transcript.toLowerCase();
  const now = opts.now ?? Date.now();

  // Sort by phrase length desc so the most specific match wins.
  const sorted = [...customs].sort((a, b) => b.phrase.length - a.phrase.length);
  for (const c of sorted) {
    const phrase = (c.phrase || "").trim().toLowerCase();
    if (!phrase) continue;
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`);
    if (!re.test(text)) continue;
    const last = lastFired.get(c.action) ?? 0;
    if (now - last < DEBOUNCE_MS) return null;
    lastFired.set(c.action, now);
    return { action: c.action, phrase: c.phrase };
  }
  return null;
}

/**
 * Read the current custom command list from localStorage. Safe to call
 * from any client-side context; returns [] on SSR or parse failure.
 */
export function readCustomCommands(): CustomCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("presentflow.pro.voiceCommands.v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x.phrase === "string" && typeof x.action === "string");
  } catch {
    return [];
  }
}

/**
 * Read the current preferred audio input selection. Shape mirrors what
 * Settings > Audio writes to `presentflow.pro.audioInput.v1`. Extracted
 * as a pure function so useAudioStream can call it and tests can too.
 */
export type AudioInputPref = { kind: "device" | "ndi"; id: string; label: string };
export function readAudioInputPref(storage?: {
  getItem: (k: string) => string | null;
}): AudioInputPref | null {
  const s = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!s) return null;
  try {
    const raw = s.getItem("presentflow.pro.audioInput.v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.kind !== "device" && parsed.kind !== "ndi") return null;
    if (typeof parsed.id !== "string") return null;
    return { kind: parsed.kind, id: parsed.id, label: typeof parsed.label === "string" ? parsed.label : "" };
  } catch {
    return null;
  }
}

/**
 * Audio source type — determines whether Chromium's built-in DSP
 * (echo cancellation, noise suppression, auto gain control) is
 * ENABLED or DISABLED for the capture.
 *
 * - `mixer`  → all three OFF. This is the correct setting for a feed
 *   from a mixer or USB audio interface (Focusrite / Behringer /
 *   PreSonus / mixer built-in USB / any line-in). The signal is
 *   already clean and the DSP will actively degrade it (gate speech,
 *   pump the level, smear consonants). This is the default because
 *   churches almost always feed PresentFlow from a mixer.
 * - `microphone` → all three ON. Correct for a laptop built-in mic
 *   or a bare USB mic sitting in the room, where you WANT echo
 *   cancellation of monitor speakers + noise suppression of HVAC +
 *   auto gain because the speaker's distance to the mic varies.
 */
export type AudioSourceType = "mixer" | "microphone";
export const AUDIO_SOURCE_TYPE_KEY = "presentflow.pro.audioSourceType.v1";

export function readAudioSourceType(storage?: {
  getItem: (k: string) => string | null;
}): AudioSourceType {
  const s = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!s) return "mixer";
  try {
    const raw = s.getItem(AUDIO_SOURCE_TYPE_KEY);
    return raw === "microphone" ? "microphone" : "mixer";
  } catch {
    return "mixer";
  }
}

/**
 * Given an audio input preference AND source type, produce the
 * getUserMedia constraints to use. Returns default constraints when
 * no preference / NDI (NDI capture not yet implemented — fall back to
 * default device).
 *
 * `sourceType` defaults to reading from localStorage so existing
 * callers that don't pass it still get the operator's choice applied.
 */
export function audioConstraintsFor(
  pref: AudioInputPref | null,
  sourceType?: AudioSourceType,
): MediaStreamConstraints {
  const type = sourceType ?? readAudioSourceType();
  const dspOn = type === "microphone";
  const base = {
    echoCancellation: dspOn,
    noiseSuppression: dspOn,
    autoGainControl: dspOn,
    sampleRate: 16000,
  } as MediaTrackConstraints;
  if (pref?.kind === "device" && pref.id && pref.id !== "default") {
    return { audio: { ...base, deviceId: { exact: pref.id } as ConstrainDOMString } };
  }
  return { audio: base };
}
