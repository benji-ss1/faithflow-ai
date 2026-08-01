/**
 * Static setup guides for USB mixers we've verified in the field.
 *
 * The Pro Operator audio picker uses `findGuideForDevice(label)` to show
 * mixer-specific setup steps in a collapsible section when the operator
 * selects a device whose label matches one of the known patterns.
 *
 * Patterns are intentionally loose (case-insensitive) so we catch the
 * many variations vendors ship in the WebAudio device label
 * ("SQ-6 USB", "X32 Rack", "XR18", "TF3 USB Audio", etc.).
 *
 * Data-only: no React, no side effects, no imports beyond browser types.
 */

export interface MixerSetupGuide {
  /** Stable slug, safe for keys and analytics. */
  id: string;
  /** Human-facing name shown in the picker header. */
  displayName: string;
  /** Any regex hit against the device label counts as a match. */
  matchPatterns: RegExp[];
  /** Typical USB channel count the operator will see. */
  channelCount: number;
  /** Ordered, one-line-ish setup steps. Plain text, no emojis. */
  steps: string[];
  /** Optional gotchas / extra tips. */
  tips?: string[];
  /** Suggested vocal-mic routing target for this mixer. */
  vocalChannelHint?: string;
}

export const MIXER_SETUP_GUIDES: MixerSetupGuide[] = [
  {
    id: "allen-heath-sq",
    displayName: "Allen & Heath SQ Series",
    matchPatterns: [
      /sq-?[567]\b/i,
      /\bsq\s*series\b/i,
      /allen[\s-]*heath.*\bsq\b/i,
      /\bsq\b.*usb/i,
    ],
    channelCount: 32,
    steps: [
      "1. Connect the SQ to your Mac via USB-B (rear panel USB-B, not the USB-A ports).",
      "2. Install Allen & Heath's SQ USB driver from allen-heath.com/hardware/sq.",
      "3. On the SQ: Setup -> I/O -> USB, and patch your vocal mic input to a USB Send channel (e.g. USB Send 1).",
      "4. Save the routing to a Scene so it survives a power cycle.",
      "5. In PresentFlow's audio picker, select the SQ from the device dropdown, then pick the channel matching the USB send you routed.",
    ],
    tips: [
      "A fresh SQ has NOTHING patched on USB sends by default — you must explicitly route the vocal channel or PresentFlow will see silence.",
      "For redundancy, patch both the vocal mic and the LR mix (usually USB 31/32) so you can switch inside PresentFlow if the mic channel goes down.",
      "RECOMMENDED (Direct Out for cleanest AI detection): Route the pastor's mic as a DIRECT OUTPUT (post-EQ, pre-fader) to USB Send 1. This gives PresentFlow a clean vocal signal with no instruments, background noise, or reverb — dramatically improving verse detection accuracy. Setup: I/O -> USB -> USB Sends -> Source = Direct Out of the pastor's input channel. Takes 2 minutes to configure.",
      "If multiple speakers use different mics (e.g. pastor on Ch 1, guest on Ch 3), route each as a separate USB Send (e.g. Send 1 = pastor, Send 3 = guest). PresentFlow's channel strip lets the operator switch between them with one click during the service.",
    ],
    vocalChannelHint:
      "Route the pastor's mic as a Direct Out to USB Send 1. For multiple speakers, route each mic to its own USB Send so the operator can switch channels mid-service.",
  },
  {
    id: "behringer-x32-midas-m32",
    displayName: "Behringer X32 / Midas M32",
    matchPatterns: [
      /\bx32\b/i,
      /\bm32\b/i,
      /midas.*m32/i,
      /behringer.*x32/i,
      /x-usb/i,
      /m-usb/i,
    ],
    channelCount: 32,
    steps: [
      "1. Connect the X32/M32 to your Mac via USB-B on the X-USB (X32) or M-USB (M32) expansion card.",
      "2. Install the X-USB / M-USB driver from behringer.com or midasconsoles.com.",
      "3. On the console: Routing -> Card, set USB Sends source to 'Ch 1-32' for direct channel sends, or 'AUX 1-6 + Main LR' for bus sends.",
      "4. Save to a Scene / Show so routing persists across power cycles.",
      "5. In PresentFlow's audio picker, select the X32/M32 and pick the channel carrying the vocal mic.",
    ],
    tips: [
      "X32 sends channels PRE or POST fader depending on Setup -> Card config. POST fader is safest: mute or fader-down = silence in PresentFlow.",
      "The X32 Core, X32 Rack, X32 Producer, X32 Compact, and X32 Full all use the same X-USB card and driver.",
    ],
    vocalChannelHint:
      "Route the pastor's mic to USB channel 1 (post-fader). Bus 15/16 is a common convention for a dedicated 'record' send if you want the mic + light music bed.",
  },
  {
    id: "behringer-xr18-xair",
    displayName: "Behringer XR18 / X-Air",
    matchPatterns: [
      /\bxr\s*-?\s*(12|16|18)\b/i,
      /\bx-?air\b/i,
      /behringer.*xr/i,
    ],
    channelCount: 18,
    steps: [
      "1. Connect the XR18 to your Mac via USB-B on the top panel.",
      "2. Install the X-Air USB driver from behringer.com.",
      "3. Open X-Air Edit, go to Routing -> USB Sends, and set the source to 'Ch 1-16' (or 'AUX 1-2 + Main LR' for a mix).",
      "4. Save to a Snapshot so routing survives a power cycle.",
      "5. In PresentFlow's audio picker, select the XR18 and pick the channel with the vocal mic.",
    ],
    tips: [
      "The XR18 also does WiFi control but audio streams over USB only. For live services stick to a wired USB connection — WiFi is for mixing from an iPad, not for PresentFlow's audio path.",
      "XR12/XR16 have 2ch USB only. XR18 is the one with full 18ch multitrack.",
    ],
    vocalChannelHint:
      "Route the pastor's mic to USB channel 1 for a clean single-channel pickup.",
  },
  {
    id: "yamaha-tf",
    displayName: "Yamaha TF Series",
    matchPatterns: [
      /\btf-?[135]\b/i,
      /\btf\s*series\b/i,
      /yamaha.*\btf\b/i,
    ],
    channelCount: 34,
    steps: [
      "1. Connect the TF to your Mac via USB-B on the rear panel.",
      "2. Install the Yamaha Steinberg USB driver from yamaha.com (search 'Yamaha Steinberg USB Driver').",
      "3. On the TF console: Setup -> Recording -> USB, choose per-channel routing (Input Direct Out or Main LR).",
      "4. Save to a Scene so routing persists.",
      "5. In PresentFlow's audio picker, select the TF and pick the channel with the vocal mic.",
    ],
    tips: [
      "TF defaults to a stereo Main LR pair on USB channels 33/34. If you want per-channel isolation you must switch the routing off of 'Main LR Only'.",
      "The TF-Rack shows up with the same driver but a different device name.",
    ],
    vocalChannelHint:
      "For a single vocal, route to USB 1 as a direct out. For a full mix, use the default USB 33/34 stereo Main LR pair.",
  },
  {
    id: "soundcraft-ui",
    displayName: "Soundcraft Ui Series",
    matchPatterns: [
      /\bui\s*-?\s*(12|16|24r?)\b/i,
      /soundcraft.*\bui\b/i,
    ],
    channelCount: 2,
    steps: [
      "1. Connect the Ui24R to your Mac via USB. IMPORTANT: Ui12 and Ui16 do NOT have multi-channel USB — only the Ui24R does (2ch stereo).",
      "2. In the Ui web interface (usually http://ui-mixer.local), open Settings -> USB and set the USB Send source to Main LR.",
      "3. In PresentFlow's audio picker, select 'Soundcraft Ui24R' and set the mode to stereo.",
    ],
    tips: [
      "Ui24R USB is stereo Main LR only — you cannot isolate a single vocal channel over USB on any Ui-series mixer.",
      "If you need vocal isolation, route the vocal mic to a spare aux, then patch that aux to the Main LR pre-USB, or use a hardware direct out into a separate USB interface.",
    ],
    vocalChannelHint:
      "Stereo Main LR only. Ensure the pastor's mic is present in the main mix (it will be unless you've soloed it out).",
  },
  {
    id: "presonus-studiolive-iii",
    displayName: "PreSonus StudioLive Series III",
    matchPatterns: [
      /studiolive/i,
      /\bs(16|24|32)r\b/i,
      /\b32sc\b/i,
      /\b32sx\b/i,
      /presonus.*(16r|24r|32r|32sc|32sx)/i,
    ],
    channelCount: 34,
    steps: [
      "1. Connect the StudioLive to your Mac via USB-B on the rear panel.",
      "2. Install PreSonus Universal Control from presonus.com — this bundles the driver and the mixer surface.",
      "3. In Universal Control (or on the console): per channel, set USB Send Source to Pre-Fader, Post-Fader, or Main.",
      "4. Save to a Scene so routing persists across power cycles.",
      "5. In PresentFlow's audio picker, select the StudioLive and pick the channel with the vocal mic.",
    ],
    tips: [
      "Post-Fader is safest for PresentFlow: fader down or mute means silence, matching what the FOH engineer hears.",
      "The Series III consoles all use the same 34ch USB routing (32 channel sends + stereo main).",
    ],
    vocalChannelHint:
      "Route the pastor's mic to USB channel 1 post-fader for a clean isolated feed.",
  },
  {
    id: "qsc-touchmix",
    displayName: "QSC TouchMix",
    matchPatterns: [
      /touchmix/i,
      /qsc.*(tm|touchmix)/i,
      /\btm-?(16|30)\b/i,
    ],
    channelCount: 32,
    steps: [
      "1. Connect the TouchMix to your Mac via USB-B on the rear panel.",
      "2. Install the TouchMix USB driver from qsc.com (search 'TouchMix Multitrack Driver').",
      "3. On the TouchMix: Menu -> Setup -> USB Recording, and enable Multitrack.",
      "4. Save to a Scene so multitrack stays enabled after power cycles.",
      "5. In PresentFlow's audio picker, select the TouchMix and pick the channel with the vocal mic.",
    ],
    tips: [
      "TouchMix multitrack sends channels PRE fader by default — check the setup screen if you want post-fader instead.",
      "TouchMix-8 / TouchMix-16 / TouchMix-30 all use the same multitrack driver but expose different channel counts.",
    ],
    vocalChannelHint:
      "Route the pastor's mic to USB channel 1 for isolated vocal capture.",
  },
  {
    id: "mackie-dl-onyx",
    displayName: "Mackie DL / Onyx",
    matchPatterns: [
      /\bdl(16|32)s?\b/i,
      /mackie.*(dl|onyx)/i,
      /\bonyx\b/i,
    ],
    channelCount: 32,
    steps: [
      "1. Connect the mixer to your Mac via USB (DL16S/DL32S: USB-B; Onyx: USB-C).",
      "2. Install the Mackie USB driver from mackie.com if required (macOS often uses Core Audio class-compliant mode).",
      "3. On the mixer / Master Fader app, set USB Send source per channel.",
      "4. In PresentFlow's audio picker, select the mixer and pick the channel with the vocal mic.",
    ],
    tips: [
      "Onyx-series is class-compliant on macOS and usually works with no driver install.",
      "DL-series requires the Master Fader iPad app to configure USB routing — there's no physical console UI.",
    ],
    vocalChannelHint:
      "Route the pastor's mic to USB channel 1 for a single-channel capture.",
  },
  {
    // Placed BEFORE the generic "blackhole" entry: findGuideForDevice
    // returns the FIRST match, and this playback-apps guide is the richer,
    // more actionable one for the common "capture Logic/Spotify/QLab"
    // use-case that BlackHole selection almost always means.
    id: "playback-apps-blackhole",
    displayName: "Playback apps (Logic Pro, Spotify, QLab…)",
    matchPatterns: [/blackhole/i],
    channelCount: 2,
    steps: [
      "1. Install BlackHole (free) from existential.audio.",
      "2. In Audio MIDI Setup, create a Multi-Output Device containing BlackHole + your speakers so you still hear playback.",
      "3. In Logic (or the playback app), set the output device to that Multi-Output Device.",
      "4. In PresentFlow's input list, pick 'BlackHole' (VIRTUAL tag) — or set BlackHole as the Mac's input in System Settings → Sound and use 'Follow Mac system input'.",
      "5. Play audio — the meter should move.",
    ],
    vocalChannelHint: "BlackHole is stereo — sum-all mode captures both channels.",
  },
  {
    id: "blackmagic",
    displayName: "Blackmagic (ATEM / capture)",
    matchPatterns: [/blackmagic/i],
    channelCount: 2,
    steps: [
      "1. Connect the ATEM (or Blackmagic capture device) to your Mac via USB — program audio arrives as a standard 2ch input.",
      "2. On the ATEM, make sure the program mix includes the vocal mic (check the Audio page in ATEM Software Control).",
      "3. In PresentFlow's input list, pick the Blackmagic device — sum-all mode captures the stereo program feed.",
    ],
    vocalChannelHint:
      "The ATEM program mix decides what audio arrives — confirm the pastor's mic is unmuted on the ATEM Audio page.",
  },
  {
    id: "blackhole",
    displayName: "BlackHole (Loopback)",
    matchPatterns: [
      /blackhole/i,
      /\bbh[_\s-]?(2|16|64)ch\b/i,
    ],
    channelCount: 2,
    steps: [
      "1. Install BlackHole from existential.audio (choose 2ch for most cases, or 16ch/64ch if you need more).",
      "2. Open Audio MIDI Setup and create a Multi-Output Device that includes both your speakers AND BlackHole — this lets you hear your audio while also routing it into PresentFlow.",
      "3. Set your DAW, media player, or streaming app's output to that Multi-Output Device (or directly to BlackHole).",
      "4. In PresentFlow's audio picker, select 'BlackHole' as the input device.",
    ],
    tips: [
      "BlackHole is a fallback for when a direct USB mixer connection isn't available — for example a laptop streaming a Zoom feed or a rehearsal from a media player.",
      "Latency is essentially zero (it's an in-memory virtual driver), so it won't hurt live detection timing.",
    ],
    vocalChannelHint:
      "Whatever is routed into BlackHole comes through as stereo. Ensure the vocal is loud enough in that source mix.",
  },
  {
    id: "ndi-virtual-input",
    displayName: "NDI Virtual Input",
    matchPatterns: [
      /\bndi\b.*virtual/i,
      /ndi.*scan.*converter/i,
      /virtual.*ndi/i,
    ],
    channelCount: 2,
    steps: [
      "1. Install NDI Tools from ndi.video/tools (free for personal and church use).",
      "2. Open 'NDI Virtual Input' from the menu bar (menu bar icon after install).",
      "3. Pick the NDI source that carries your service audio (usually the FOH desk NDI feed or a ProPresenter Stage NDI output).",
      "4. In PresentFlow's audio picker, select 'NDI Virtual Input (Scan Converter)' from the device dropdown.",
    ],
    tips: [
      "NDI Virtual Input appears to macOS as a standard 2ch audio input — no extra channel picker is needed inside PresentFlow.",
      "If you don't see NDI Virtual Input in the picker, quit and reopen the NDI Virtual Input menu-bar app, then reopen PresentFlow.",
    ],
    vocalChannelHint:
      "The NDI source itself decides what audio arrives. Confirm the source mix carries the pastor's mic before troubleshooting inside PresentFlow.",
  },
];

/**
 * Return the first guide whose regex list matches the device label, or null.
 * Labels come from `MediaDeviceInfo.label` and are user-visible strings like
 * "SQ-6 USB Audio" or "BlackHole 2ch".
 */
export function findGuideForDevice(label: string): MixerSetupGuide | null {
  if (!label || typeof label !== "string") return null;
  for (const guide of MIXER_SETUP_GUIDES) {
    for (const pattern of guide.matchPatterns) {
      if (pattern.test(label)) return guide;
    }
  }
  return null;
}
