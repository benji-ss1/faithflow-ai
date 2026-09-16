/**
 * deviceClassifier — Audio Lock-In (2026-09-15)
 * -------------------------------------------------------------------------
 * Richer, operator-facing classification of ANY audio input the OS exposes
 * (USB interface, 32/64-ch desk, Blackmagic DeckLink/UltraStudio/ATEM, HDMI/SDI
 * capture, Dante VSC, aggregate, NDI, built-in). Used by the setup wizard + AI
 * guide + saved devices for labels and setup hints.
 *
 * ADDITIVE: this does NOT replace `categorizeDevice` / `categoryRank` in
 * deviceCategorization.ts — the picker ranking and launch auto-pick keep using
 * those, byte-identical. Pure, no browser APIs, safe to unit-test.
 *
 * Signal precedence: helper `transport` (CoreAudio) + `manufacturer` when present,
 * then name patterns. Bluetooth is only recognised (to warn), never specially handled.
 */

import { isMixerDevice } from "./deviceCategorization";

export type InputKind =
  | "ndi"
  | "sdi-capture"      // Blackmagic DeckLink / UltraStudio / Intensity, AJA
  | "usb-switcher"     // ATEM Mini / Web Presenter (UVC/UAC)
  | "hdmi-capture"     // USB capture dongles, HDMI/DisplayPort transport
  | "dante"            // Dante Virtual Soundcard / Dante Via
  | "desk"             // digital mixing desk over USB (X32/Wing/SQ/TF/...)
  | "interface"        // USB/Thunderbolt audio interface
  | "aggregate"        // macOS aggregate / virtual loopback
  | "builtin"          // MacBook mic / system input
  | "bluetooth"
  | "other";

export interface ClassifiableInput {
  name: string;
  manufacturer?: string;
  /** Swift helper transport: builtin|usb|aggregate|virtual|bluetooth|bluetooth-le|hdmi|displayport|airplay|thunderbolt|firewire|pci|avb|ndi|unknown */
  transport?: string;
  channelCount?: number;
}

export interface InputClassification {
  kind: InputKind;
  /** Short human label for chips/lists. */
  label: string;
  /** One-line setup hint the wizard/guide can show verbatim (grounded, no menu paths for unverified gear). */
  hint: string;
  /** Driver/software the church may need installed, if any. */
  driver?: string;
  /** True when this is a sensible primary source for a live service. */
  recommended: boolean;
}

const BMD_CAPTURE_RE = /decklink|ultrastudio|intensity/i;
const BMD_SWITCHER_RE = /\batem\b|web presenter/i;
const AJA_RE = /\baja\b|\bkona\b|u-tap|t-tap|\bio 4k\b|\bio x3\b/i;
const CAPTURE_DONGLE_RE = /usb capture|magewell|cam link|\bhd60\b|game capture|ms2109|usb3 video|usb video|capture card|hdmi/i;
const DANTE_RE = /dante|\bdvs\b/i;
const DESK_RE = /x-usb|\bx32\b|\bwing\b|\bm32\b|\bdn32\b|x-live|\bxr1[268]\b|\bmr18\b|yamaha tf|\btf[135]\b|\bdm[37]\b|\bql[15]\b|\bcl[135]\b|rivage|\bsq\b|\bqu\b|dlive|avantis|\bcq\b|allen.*heath|ui24|\bui1[26]\b|soundcraft|signature|studiolive|\bdl32s\b|\bdl16s\b|touchmix|\(22f0:|\(1397:|\(0499:|\(194f:|\(05fc:/i;
const AGG_RE = /aggregate|blackhole|loopback|soundflower|multi-output/i;
const BUILTIN_RE = /macbook|built-in|internal microphone|imac microphone/i;
const BT_RE = /bluetooth|airpods|beats|jabra|bose|galaxy buds|wh-1000/i;

function t(v?: string): string { return (v ?? "").toLowerCase(); }

export function classifyInput(input: ClassifiableInput): InputClassification {
  const name = input.name ?? "";
  const mfr = t(input.manufacturer);
  const tr = t(input.transport);
  const hay = `${name} ${input.manufacturer ?? ""}`;

  if (tr === "ndi" || /^ndi\b|\bndi\b/i.test(name)) {
    return { kind: "ndi", label: "NDI network source", recommended: true,
      hint: "Network audio from another computer or device. Keep it on wired Ethernet, never Wi-Fi." };
  }
  if (tr === "bluetooth" || tr === "bluetooth-le" || BT_RE.test(name)) {
    return { kind: "bluetooth", label: "Bluetooth", recommended: false,
      hint: "Bluetooth mics drop to low-quality call audio. Use a wired feed from the sound desk instead." };
  }
  if (BMD_CAPTURE_RE.test(hay) || (mfr.includes("blackmagic") && (tr === "pci" || tr === "thunderbolt"))) {
    return { kind: "sdi-capture", label: "Blackmagic SDI/HDMI capture", recommended: true, driver: "Blackmagic Desktop Video",
      hint: "Embedded audio only flows while a live video signal is locked. In Desktop Video Setup set the audio input to Embedded." };
  }
  if (AJA_RE.test(hay) || mfr.includes("aja")) {
    return { kind: "sdi-capture", label: "AJA capture", recommended: true, driver: "AJA Desktop Software",
      hint: "Embedded audio needs a locked video signal on the selected input." };
  }
  if (BMD_SWITCHER_RE.test(hay)) {
    return { kind: "usb-switcher", label: "Blackmagic ATEM / Web Presenter", recommended: true,
      hint: "Sends the switcher's program audio mix over USB. Make sure the desk feed is on in the ATEM audio mixer." };
  }
  if (DANTE_RE.test(name)) {
    return { kind: "dante", label: "Dante network audio", recommended: true, driver: "Audinate Dante Virtual Soundcard / Via",
      hint: "Route the channels to this computer in Dante Controller, match the sample rate, and use wired Ethernet." };
  }
  if (DESK_RE.test(hay)) {
    return { kind: "desk", label: "Digital mixing desk (USB)", recommended: true,
      hint: "Send a post-fader full mix (pulpit mics AND band) to a USB channel pair on the desk, then pick that pair here." };
  }
  if (tr === "aggregate" || tr === "virtual" || AGG_RE.test(name)) {
    return { kind: "aggregate", label: "Aggregate / virtual device", recommended: false,
      hint: "Combined or loopback device. Turn on drift correction for non-master devices in Audio MIDI Setup." };
  }
  if (tr === "hdmi" || tr === "displayport" || CAPTURE_DONGLE_RE.test(name)) {
    return { kind: "hdmi-capture", label: "HDMI capture", recommended: true,
      hint: "Audio comes from the HDMI source. Confirm the source is actually sending audio." };
  }
  if (tr === "builtin" || BUILTIN_RE.test(name)) {
    return { kind: "builtin", label: "Built-in microphone", recommended: false,
      hint: "Picks up the room and echo — detection will be less accurate. Use a feed from the sound desk if you can." };
  }
  if (isMixerDevice(name) || tr === "usb" || tr === "thunderbolt" || tr === "firewire") {
    return { kind: "interface", label: "Audio interface", recommended: true,
      hint: "Plug the desk's aux or matrix out into a LINE input (48V off, pad on if it clips)." };
  }
  return { kind: "other", label: "Audio input", recommended: false,
    hint: "Unrecognised input. It will still work if it carries the service audio." };
}
