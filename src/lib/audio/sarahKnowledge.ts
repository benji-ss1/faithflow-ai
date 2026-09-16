/**
 * sarahKnowledge — the grounded knowledge Sarah may use, per wizard step.
 * Lives server-trusted: /api/ai/audio-guide looks it up by `step` and NEVER
 * accepts knowledge text from the client. Source: docs/audio/AUDIO_SETUP_KNOWLEDGE_BASE.md.
 * Menu paths here use "A → B" and are the ONLY paths Sarah may repeat.
 */

export const SARAH_STEPS = ["context", "os", "desk", "connection", "steps", "input", "quiet", "speak", "save"] as const;
export type SarahStep = (typeof SARAH_STEPS)[number];

export const GOLDEN_RULE =
  "Send a dedicated post-fader aux or matrix to the computer: pulpit and vocal mics forward, band tucked underneath, no reverb or effects. Use the Main L/R mix only if there's no spare aux.";

const ROUTING = [
  GOLDEN_RULE,
  "PresentFlow LISTENS: the desk, interface, Dante or capture device is an INPUT on the computer (never an output).",
  "Behringer X32 / Midas M32 with X-USB card: Routing → Out 1-16, put the aux/matrix (or Main LR) on Out 15/16, then Routing → Card Out → block Out 9-16; the computer hears it on USB 15/16.",
  "Behringer Wing: plug USB straight in (no hub); in the Routing USB output page assign the mix to a USB pair. Menu names vary by firmware.",
  "Yamaha TF: the Stereo mix is fixed on USB 33/34 (Stereo only — use it if no aux is spare).",
  "Allen & Heath SQ / Qu, Soundcraft, PreSonus StudioLive, other desks: patch the aux/matrix to a USB output pair in the desk's I/O or USB patch page; exact names vary — check the desk's manual.",
  "Small analog desks: take a post-fader aux into a LINE input on a USB interface, 48V phantom power OFF on that input.",
  "Dante Virtual Soundcard: route the channels to this computer in Dante Controller, same sample rate as the Dante network (usually 48 kHz), latency 4, 6 or 10 ms, wired Ethernet only.",
  "Blackmagic DeckLink/UltraStudio: install Desktop Video, Desktop Video Setup → audio input Embedded; embedded audio only flows while a live video signal is present.",
  "NDI: send the audio from another computer as an NDI source on the same wired network.",
].join("\n");

const TROUBLE = [
  "Silent: wrong input or channel picked; desk USB/aux send down or muted; cable/port; macOS microphone permission for PresentFlow. Ask: do the desk's USB output meters move when someone talks?",
  "Wrong channel: the app listens to one pair while the desk sends on another (e.g. TF uses 33/34, X32 example uses 15/16).",
  "Too quiet: raise the aux/USB send or interface gain. A consumer -10 dBV source into pro +4 dBu gear is about 12 dB quiet.",
  "Too hot / distorting: lower the send, use the interface pad, or use a line input instead of a mic input.",
  "Hum or buzz: balanced cables, computer on the same power as the desk, DI box with ground lift on the audio path. Never remove a power earth.",
  "Dropouts / crackle: no USB hub, 48 kHz everywhere, Dante latency up to 10 ms.",
  "Device disappears: direct USB port, stop the computer sleeping, try another cable.",
].join("\n");

export const SARAH_KNOWLEDGE: Record<SarahStep, string> = {
  context: GOLDEN_RULE,
  os: GOLDEN_RULE,
  desk: ROUTING,
  connection: ROUTING,
  steps: `${ROUTING}\n${TROUBLE}`,
  input: `Pick the device that matches the connection. On multichannel desks the channel pair that moves is the send. The built-in mic is a last resort (it hears room echo).\n${TROUBLE}`,
  quiet: "Quiet check measures the AVERAGE level with nobody talking. Above about -45 dBFS average suggests hum, music still playing, or an open mic.\n" + TROUBLE,
  speak: "Voice check: talking should peak around -18 to -12 dBFS; below -24 is too quiet for reliable detection; near 0 dBFS distorts.\n" + TROUBLE,
  save: "The working input is remembered on this computer and the church's setup is saved so Sarah remembers it next time.",
};

export const CHECK_IDS = ["signal", "noise-floor", "speech-level", "clipping", "channel"] as const;

/** One arrow class, used by BOTH the detector and the sentence filter — a path the
 *  detector notices must also be removable, and unicode arrows must not slip past. */
const ARROW = "(?:->|=>|\\u2192|\\u27F6|\\u279C|\\u2794|\\u00BB|\\u25B8|\\u25B6|>)";

/** Replace any "A → B" menu path Sarah wasn't given with a safe pointer to the manual. */
export function stripUngroundedPaths(reply: string, knowledge: string): { text: string; stripped: boolean } {
  const known = knowledge.toLowerCase().replace(/\s+/g, " ").replace(new RegExp(ARROW, "g"), "\u2192");
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let stripped = false;
  const re = new RegExp(`([\\p{L}\\p{N}][\\p{L}\\p{N} &/+-]{0,40})\\s*${ARROW}\\s*([\\p{L}\\p{N}][\\p{L}\\p{N} &/+-]{0,40})`, "gu");
  for (const m of reply.matchAll(re)) {
    const a = m[1].trim().split(/\s+/).slice(-1)[0].toLowerCase();
    const b = m[2].trim().split(/\s+/)[0].toLowerCase();
    if (!new RegExp(`${esc(a)}\\s*\\u2192\\s*${esc(b)}`).test(known)) { stripped = true; break; }
  }
  if (!stripped) return { text: reply, stripped };
  const hasArrow = new RegExp(ARROW, "u");
  const safe = reply.split(/(?<=[.!?])\s+/).filter((s) => !hasArrow.test(s)).join(" ").trim();
  return { text: `${safe ? `${safe} ` : ""}The exact menu names depend on your desk model \u2014 check your desk's manual for its USB or output patch page.`, stripped };
}
