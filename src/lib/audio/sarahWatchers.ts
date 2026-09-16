/**
 * sarahWatchers — what Sarah NOTICES about the live setup (2026-09-16).
 *
 * Pure rules over a snapshot of state the renderer can already see (no DMG needed):
 * audio stream flags, the guardian, the device list, NDI sources, the speech-service
 * connection and the browser's online state. Each rule returns a plain-English
 * observation and, for problems, the fix. Sarah voices the highest-priority one.
 *
 * Positive observations matter as much as problems — "I'm receiving your NDI" is how
 * an operator learns their change worked.
 */

export type WatchSeverity = "problem" | "warn" | "good";
export interface WatchNote { id: string; severity: WatchSeverity; message: string; fix?: string }

export interface WatchSnapshot {
  listening: boolean;
  online: boolean;
  noAudioSignal?: boolean;
  clipping?: boolean;
  guardianState?: "healthy" | "silent" | "recovering" | "switched" | "needs-human";
  audioQuality?: "good" | "ok" | "low";
  reconnectAttempts?: number;
  reconnectFailed?: boolean;
  /** The input the operator picked. */
  selected?: { name: string; kind?: string; transport?: string; sampleRate?: number } | null;
  /** True when the picked input's uid/name is no longer in the device list. */
  selectedMissing?: boolean;
  /** HELD peak over the last few seconds on the picked input, dBFS — not the instantaneous
   *  level, which drops to silence in every gap between words. */
  levelDb?: number;
  /** How long the held level has stayed below the silence threshold, in seconds. */
  silentSeconds?: number;
  /** The connection route the church chose with Sarah. */
  route?: "usb-desk" | "interface" | "ndi" | "dante" | "sdi-capture" | "builtin";
  /** NDI sources currently discovered. */
  ndiSources?: string[];
  /** Seconds since NDI discovery started (to allow the finder time to see sources). */
  ndiScanSeconds?: number;
  /** Whether THIS computer can list NDI sources at all. On tiers that can't (Windows /
   *  the ffmpeg fallback) an empty list means nothing — never claim "no sources" there. */
  ndiDiscoveryAvailable?: boolean;
  /** Speech service currently connected and ready. */
  ready?: boolean;
}

const SILENT_DB = -60;
/** A single gap between words must not read as "broken gear". */
const SUSTAINED_SILENCE_S = 6;
/** Speech peaking below this is too quiet for reliable detection (matches the voice check). */
const TOO_QUIET_DB = -30;
const NDI_GRACE_SECONDS = 10;
const RANK: Record<WatchSeverity, number> = { problem: 0, warn: 1, good: 2 };

function isBlackmagic(sel: WatchSnapshot["selected"]): boolean {
  if (!sel) return false;
  return sel.kind === "sdi-capture" || /decklink|ultrastudio|blackmagic|^intensity\s+(pro|shuttle)\b/i.test(sel.name);
}
const shortName = (n: string) => { const a = Array.from(n); return a.length > 40 ? `${a.slice(0, 39).join("")}…` : n; };
function isDante(sel: WatchSnapshot["selected"]): boolean {
  return !!sel && (sel.kind === "dante" || /dante/i.test(sel.name));
}

export function evaluateWatchers(s: WatchSnapshot): WatchNote[] {
  const out: WatchNote[] = [];
  const sel = s.selected ?? null;
  // noAudioSignal only means anything while AI listening is actually running.
  const flaggedSilent = s.listening && s.noAudioSignal === true;
  const heldSilent = typeof s.levelDb === "number" && s.levelDb <= SILENT_DB && (s.silentSeconds ?? 0) >= SUSTAINED_SILENCE_S;
  const silent = flaggedSilent || heldSilent;

  if (!s.online) out.push({ id: "offline", severity: "problem", message: "This computer is offline, so I can't reach the speech service.", fix: "Reconnect to the internet — I'll pick up again straight away." });

  if (s.reconnectFailed) out.push({ id: "speech-lost", severity: "problem", message: "I've lost the connection to the speech service.", fix: "Check the internet, then switch AI listening off and on again." });
  // Only while it's actually still struggling — a session that recovered shouldn't nag forever.
  else if ((s.reconnectAttempts ?? 0) > 2 && s.ready === false) out.push({ id: "speech-flaky", severity: "warn", message: "The connection to the speech service keeps dropping.", fix: "A wired connection is steadier than Wi-Fi." });

  if (sel && s.selectedMissing) out.push({ id: "unplugged", severity: "problem", message: `${shortName(sel.name)} was just unplugged.`, fix: "Plug it back in — I'll pick it up again as soon as it's back." });

  if (s.route === "ndi") {
    const n = s.ndiSources?.length ?? 0;
    if (n > 0) {
      out.push({ id: "ndi-seen", severity: "good", message: `I can see your NDI source${n > 1 ? "s" : ""}: ${s.ndiSources!.slice(0, 3).map(shortName).join(", ")}.` });
    } else if (s.ndiDiscoveryAvailable === false) {
      out.push({ id: "ndi-unlisted", severity: "warn", message: "I can't list NDI sources on this computer.", fix: "If NDI Studio Monitor can see your source, it's reachable — pick it in the Audio panel." });
    } else if (s.ndiDiscoveryAvailable && (s.ndiScanSeconds ?? 0) >= NDI_GRACE_SECONDS) {
      out.push({ id: "ndi-none", severity: "problem", message: "I can't see any NDI sources on the network.",
        fix: "Put both computers on the same wired network and subnet (ask whoever runs the network if you use VLANs), allow NDI through the firewall, and in OBS install DistroAV and turn on NDI output." });
    }
  }

  if (s.listening && s.guardianState === "needs-human" && sel && !s.selectedMissing) {
    out.push({ id: "guardian", severity: "problem", message: "PresentFlow has stopped getting sound and couldn't recover on its own.", fix: "Check the desk and cable, then switch AI listening off and on again." });
  }

  if (sel && !s.selectedMissing && silent) {
    if (isBlackmagic(sel)) {
      out.push({ id: "blackmagic-silent", severity: "problem", message: `I can see your ${shortName(sel.name)}, but there's no sound on it.`, fix: "Sound only travels with a live picture: check the SDI/HDMI cable, that the source is actually sending video with audio, and that Desktop Video Setup has the audio input set to Embedded." });
    } else if (isDante(sel)) {
      out.push({ id: "dante-silent", severity: "problem", message: "Dante Virtual Soundcard is here, but it's silent.",
        fix: "Open Dante Controller and route the desk's channels to this computer. Also check Dante Virtual Soundcard is started and licensed, and that it's using the wired Dante network port, not Wi-Fi." });
    } else {
      out.push({ id: "no-sound", severity: "problem", message: `I'm not getting any sound from ${shortName(sel.name)}.`, fix: "Check the send on the desk is up and not muted, and that the cable is in." });
    }
  }

  if (isDante(sel) && typeof sel?.sampleRate === "number" && Number.isFinite(sel.sampleRate) && sel.sampleRate > 0 && sel.sampleRate !== 48000) {
    out.push({ id: "dante-rate", severity: "warn", message: `This computer's Dante Virtual Soundcard is at ${Math.round(sel.sampleRate / 1000)} kHz.`, fix: "Match the rate shown in Dante Controller — most Dante networks run at 48 kHz." });
  }

  // Audible but too low for the speech engine — the most common desk-feed mistake.
  if (sel && !s.selectedMissing && !silent && !s.clipping && typeof s.levelDb === "number" && s.levelDb > SILENT_DB && s.levelDb < TOO_QUIET_DB) {
    out.push({ id: "too-quiet", severity: "warn", message: `I can hear ${shortName(sel.name)}, but it's too quiet for me to follow the words.`, fix: "Turn up the send on the desk (the one feeding this computer), or the gain on your interface, until talking reaches the green part of the bar." });
  }

  if (s.clipping) out.push({ id: "clipping", severity: "warn", message: "Your sound is coming in too loud — it crackles, and that garbles the words.", fix: "Turn the send on the desk down a little." });
  if (s.audioQuality === "low" && !silent) out.push({ id: "muddy", severity: "warn", message: "I can hear you, but the sound is muddy.", fix: "A direct feed from the desk sounds far clearer than a microphone in the room." });

  // Good news only when nothing else is wrong, and only for a real level — not hum.
  const troubled = out.some((n) => n.severity !== "good");
  if (sel && !troubled && !s.selectedMissing && !silent && !s.clipping && typeof s.levelDb === "number" && s.levelDb >= TOO_QUIET_DB) {
    out.push({ id: "signal-good", severity: "good", message: `I'm receiving sound from ${shortName(sel.name)}.` });
  }

  // one note per id, most urgent first
  const seen = new Set<string>();
  return out.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** The single thing Sarah should say right now (or null when there's nothing new). */
export function topWatchNote(s: WatchSnapshot): WatchNote | null {
  return evaluateWatchers(s)[0] ?? null;
}
