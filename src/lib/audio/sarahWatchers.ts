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
  /** Recent peak level on the picked input, dBFS (from the meter). */
  levelDb?: number;
  /** The connection route the church chose with Sarah. */
  route?: "usb-desk" | "interface" | "ndi" | "dante" | "sdi-capture" | "builtin";
  /** NDI sources currently discovered. */
  ndiSources?: string[];
  /** Seconds since NDI discovery started (to allow the finder time to see sources). */
  ndiScanSeconds?: number;
}

const SILENT_DB = -60;
const NDI_GRACE_SECONDS = 10;
const RANK: Record<WatchSeverity, number> = { problem: 0, warn: 1, good: 2 };

function isBlackmagic(sel: WatchSnapshot["selected"]): boolean {
  if (!sel) return false;
  return sel.kind === "sdi-capture" || /decklink|ultrastudio|intensity|blackmagic/i.test(sel.name);
}
function isDante(sel: WatchSnapshot["selected"]): boolean {
  return !!sel && (sel.kind === "dante" || /dante/i.test(sel.name));
}

export function evaluateWatchers(s: WatchSnapshot): WatchNote[] {
  const out: WatchNote[] = [];
  const sel = s.selected ?? null;
  const silent = s.noAudioSignal === true || (typeof s.levelDb === "number" && s.levelDb <= SILENT_DB);

  if (!s.online) out.push({ id: "offline", severity: "problem", message: "This computer is offline, so I can't reach the speech service.", fix: "Reconnect to the internet — I'll pick up again straight away." });

  if (s.reconnectFailed) out.push({ id: "speech-lost", severity: "problem", message: "I've lost the connection to the speech service.", fix: "Check the internet, then switch AI listening off and on again." });
  else if ((s.reconnectAttempts ?? 0) > 2) out.push({ id: "speech-flaky", severity: "warn", message: "The connection to the speech service keeps dropping.", fix: "A wired connection is steadier than Wi-Fi." });

  if (sel && s.selectedMissing) out.push({ id: "unplugged", severity: "problem", message: `${sel.name} was just unplugged.`, fix: "Plug it back in — I'll pick it up again as soon as it's back." });

  if (s.route === "ndi") {
    const n = s.ndiSources?.length ?? 0;
    if (n === 0 && (s.ndiScanSeconds ?? 0) >= NDI_GRACE_SECONDS) {
      out.push({ id: "ndi-none", severity: "problem", message: "I can't see any NDI sources on the network.", fix: "That usually means this computer and your streaming computer aren't on the same network — or one of them is on Wi-Fi. Put both on the same wired network, and check NDI output is switched on in OBS." });
    } else if (n > 0) {
      out.push({ id: "ndi-seen", severity: "good", message: `I can see your NDI source${n > 1 ? "s" : ""}: ${s.ndiSources!.slice(0, 3).join(", ")}.` });
    }
  }

  if (sel && !s.selectedMissing && silent && (s.listening || typeof s.levelDb === "number")) {
    if (isBlackmagic(sel)) {
      out.push({ id: "blackmagic-silent", severity: "problem", message: `I can see your ${sel.name}, but there's no sound on it.`, fix: "Sound only travels with a live picture: check the SDI/HDMI cable, that the source is actually sending video with audio, and that Desktop Video Setup has the audio input set to Embedded." });
    } else if (isDante(sel)) {
      out.push({ id: "dante-silent", severity: "problem", message: "Dante Virtual Soundcard is here, but it's silent.", fix: "Open Dante Controller and route the desk's channels to this computer." });
    } else if (s.guardianState === "needs-human" || s.noAudioSignal) {
      out.push({ id: "no-sound", severity: "problem", message: `I'm not getting any sound from ${sel.name}.`, fix: "Check the send on the desk is up and not muted, and that the cable is in." });
    }
  }

  if (isDante(sel) && typeof sel?.sampleRate === "number" && sel.sampleRate !== 48000) {
    out.push({ id: "dante-rate", severity: "warn", message: `Dante is running at ${Math.round(sel.sampleRate / 1000)} kHz.`, fix: "Most Dante networks run at 48 kHz — set the same rate in Dante Controller." });
  }

  if (s.clipping) out.push({ id: "clipping", severity: "warn", message: "Your sound is coming in too loud — it crackles, and that garbles the words.", fix: "Turn the send on the desk down a little." });
  if (s.audioQuality === "low" && !silent) out.push({ id: "muddy", severity: "warn", message: "I can hear you, but the sound is muddy.", fix: "A direct feed from the desk sounds far clearer than a microphone in the room." });

  if (sel && !s.selectedMissing && !silent && !s.clipping && typeof s.levelDb === "number" && s.levelDb > SILENT_DB) {
    out.push({ id: "signal-good", severity: "good", message: `I'm receiving sound from ${sel.name}.` });
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
