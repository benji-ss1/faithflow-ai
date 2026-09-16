/**
 * sarahKnowledge — the grounded knowledge Sarah may use, per wizard step.
 * Lives server-trusted: /api/ai/audio-guide looks it up by `step` and NEVER
 * accepts knowledge text from the client. Source: docs/audio/AUDIO_SETUP_KNOWLEDGE_BASE.md.
 * Menu paths here use "A → B" and are the ONLY paths Sarah may repeat.
 */

export const SARAH_STEPS = ["context", "os", "desk", "connection", "steps", "input", "quiet", "speak", "save"] as const;
export type SarahStep = (typeof SARAH_STEPS)[number];

export const GOLDEN_RULE =
  "Send the computer its own mix: preacher and vocal mics clear and up front, band underneath, no reverb or effects. Use a spare aux or matrix that follows the faders. If there is no spare, the main mix works too.";

const ROUTING = [
  GOLDEN_RULE,
  "PresentFlow LISTENS: the desk, interface, Dante or capture device is an INPUT on the computer (never an output).",
  "Never suggest the computer's built-in microphone — it hears the room and the PA, which makes detection much worse.",
  "Behringer X32 / Midas M32 with X-USB card: Routing → Out 1-16, put the aux/matrix (or Main LR) on Out 15/16. Then Routing → Card Out → choose the block Out 9-16 — that sends outputs 9-16 to USB channels 9-16, so whatever is on Out 15/16 arrives on USB 15/16.",
  "Behringer Wing: plug USB straight in (no hub); in the Routing USB output page assign the mix to a USB pair. Menu names vary by firmware.",
  "Yamaha TF: by default the Stereo mix comes out on USB 33/34 (channels 1-32 carry the individual inputs). If it isn't there, check the USB output setting in TF Editor / the desk's setup — some firmware lets you change it.",
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

/** Gear-specific troubleshooting — the questions volunteers actually ask. */
const GEAR = [
  "Focusrite Scarlett with no signal: the ring (gain halo) around the gain knob should flash green when sound arrives. Use a LINE-level cable from the desk into the jack part of the combo input with the INST button OFF, and 48V OFF (48V is only for condenser microphones). Plug the Scarlett straight into the computer, not a hub. Set 48 kHz in Focusrite Control if you use it. On a Mac, allow PresentFlow under System Settings → Privacy & Security → Microphone.",
  "Behringer UMC202HD / UMC-series: use a balanced TRS jack cable from the desk's aux output into the jack part of a combo input, INST switch OFF, +48V switch OFF (it powers both inputs at once). Turn the input gain up until talking lights the signal LED but not the clip LED. A Mac needs no driver; on Windows install Behringer's UMC ASIO driver for the most reliable connection.",
  "Allen & Heath SQ / Qu over USB: use the desk's USB-B audio port. A Mac needs no driver; Windows needs the Allen & Heath USB audio driver from allen-heath.com. Patch the aux or matrix you want to a USB output in the desk's I/O patch screen.",
  "NDI from OBS to another computer: install the DistroAV plugin (formerly obs-ndi) and the NDI Runtime on the OBS computer, then in OBS open Tools → DistroAV NDI Settings and switch on Main Output. Both computers must be on the same network and subnet, ideally wired. Allow NDI through each computer's firewall (don't just turn the firewall off). If sources still don't appear, the network may block discovery — ask whoever runs it, or use NDI Access Manager to add the other computer's IP address.",
  "Hum or buzz when the laptop is plugged into the desk: first unplug the laptop's charger — if the hum stops, it's a ground loop through the charger. Fixes: run the laptop on battery for the service, use a USB ground-loop isolator, or put a DI box with a ground-lift switch on the audio cable. Plug the laptop and the desk into the same power strip. Never remove the earth pin from a power plug.",
  "Dante Virtual Soundcard silent: check it's started and licensed, that it's using the wired network port connected to the Dante network (not Wi-Fi), then in Dante Controller route the desk's output channels to this computer's DVS inputs. Match the sample rate (usually 48 kHz) and try 10 ms latency if audio drops out.",
  "Blackmagic UltraStudio / DeckLink with video but no audio: in Desktop Video Setup set the audio input to Embedded, check the source (camera or switcher) is actually putting audio on the SDI/HDMI signal, and remember embedded audio only flows while the video signal is live.",
].join("\n");

/** Streaming basics — enough to give safe first steps and point to the official guide. */
const STREAMING = [
  "Streaming a service to YouTube with OBS: in YouTube Studio click Create → Go live → Stream, and copy the stream key. In OBS open Settings → Stream, choose YouTube (or connect your account) and paste the key. A good starting point is 1080p at 30 fps with a video bitrate around 4500-6000 kbps. Add your sound desk feed as an audio input in OBS. Do a test stream set to Unlisted before Sunday. YouTube's official help centre has the full Live Streaming guide.",
  "Facebook Live works the same way: get the stream key from Facebook's Live Producer and paste it into OBS Settings → Stream with the Facebook Live service.",
].join("\n");

/** Plain-language glossary Sarah uses the first time a term comes up. */
const GLOSSARY = [
  "aux = an extra mix on the sound desk you can send somewhere separately (here: to the computer).",
  "post-fader = the mix follows the faders, so muting someone on the desk mutes them for the computer too.",
  "matrix = a mix made from other mixes, often used for streams and recordings.",
  "phantom power (48V) = power a desk sends down a mic cable for condenser microphones. Keep it OFF for line-level connections like an aux output.",
  "line level = the stronger signal that comes out of a desk output, as opposed to a microphone signal.",
].join("\n");

/** Everything Sarah may use to answer a free-text question. */
export const SARAH_ASK_KNOWLEDGE = [GOLDEN_RULE, ROUTING, TROUBLE, GEAR, STREAMING, GLOSSARY].join("\n");

/**
 * True when the question is about gear or a topic the curated knowledge covers — those
 * answers come from verified knowledge, not web search (the one search answer in the
 * quality test contradicted the knowledge base and was wrong).
 */
export function knowledgeCovers(question: string): boolean {
  return /x32|m32|wing|midas|behringer|yamaha|\btf\s?\d?\b|allen|heath|\bsq\b|\bqu\b|focusrite|scarlett|umc|dante|blackmagic|ultrastudio|decklink|\bndi\b|obs|youtube|facebook live|stream|hum|buzz|phantom|48v|aux|post-fader|matrix|main mix|line level/i.test(question);
}

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
