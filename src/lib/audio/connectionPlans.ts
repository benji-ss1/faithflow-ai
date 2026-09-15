/**
 * connectionPlans — Sarah audio setup (2026-09-15, hardened after review)
 * -------------------------------------------------------------------------
 * Deterministic "your best ways to connect" ranking + step-by-step instructions,
 * grounded in docs/audio/AUDIO_SETUP_KNOWLEDGE_BASE.md. Exact desk menu paths
 * are only given (verified: true) where the KB marks them verified; everything
 * else gets the general method + "check your desk's manual". Previously FAILED
 * routes for this church are ranked last and flagged.
 */

import { GOLDEN_RULE } from "./sarahKnowledge";

export type Os = "mac" | "windows";
export type Connection = "usb-desk" | "interface" | "ndi" | "dante" | "sdi-capture" | "builtin";
export type DeskFamily = "behringer" | "yamaha" | "allen-heath" | "soundcraft" | "presonus" | "analog" | "none" | "other";

export interface ConnectionOption {
  connection: Connection;
  title: string;
  subtitle: string;
  steps: string[];
  verified: boolean;
  previouslyFailed?: string;
  recommended: boolean;
}

export function deskFamilyOf(desk: string | undefined | null): DeskFamily {
  const d = (desk ?? "").toLowerCase();
  if (!d.trim()) return "none";
  // Analog models first — "Behringer Xenyx" / "Yamaha MG" / "A&H ZED" share a digital brand name.
  if (/xenyx|profx|\bmg\s?\d|zed-?\d|\bzed\b|analog/.test(d)) return "analog";
  if (/behringer|midas|x32|m32|wing|x-?air|xr1[268]/.test(d)) return "behringer";
  if (/yamaha|\btf\b|tf[135]|dm3|dm7|\bql|\bcl[135]?\b|rivage/.test(d)) return "yamaha";
  if (/allen|heath|\bsq\b|sq-?\d|\bqu\b|qu-?\d|dlive|avantis|\bcq\b/.test(d)) return "allen-heath";
  if (/soundcraft|ui24|ui1[26]|\bsi\b|signature|\bvi\d/.test(d)) return "soundcraft";
  if (/presonus|studiolive/.test(d)) return "presonus";
  if (/mackie/.test(d)) return "analog";
  if (/none|no desk|not sure|don.?t know/.test(d)) return "none";
  return "other";
}

const CHECK_MANUAL = "Menu names vary by model and firmware — check your desk's manual for its USB or output patch page.";

function usbDeskSteps(fam: DeskFamily, desk: string): { steps: string[]; verified: boolean } {
  switch (fam) {
    case "behringer":
      if (/wing/i.test(desk)) return { verified: false, steps: [
        "Plug the Wing's USB-B port straight into this computer (no hub).",
        "In the Wing's Routing, open the USB output page and assign your aux/matrix (or Main) to a USB pair.",
        GOLDEN_RULE, CHECK_MANUAL, "Tell Sarah which USB pair you used." ] };
      return { verified: true, steps: [
        "Plug the X-USB card on the back of the desk into this computer (no hub).",
        "On the desk: Routing → Out 1-16, put a spare aux or matrix (or Main LR if none is spare) on Out 15/16.",
        "Routing → Card Out → choose the block “Out 9-16”. The computer now hears it on USB 15/16.",
        GOLDEN_RULE ] };
    case "yamaha":
      if (/\btf/i.test(desk)) return { verified: true, steps: [
        "Plug the TF's USB port into this computer.",
        "The Stereo mix is always on USB 33/34 — no routing needed on a Mac.",
        "That pair only carries the Stereo mix. If you want a dedicated aux instead, patch it to a USB output in the desk's patch page.",
        GOLDEN_RULE ] };
      return { verified: false, steps: [
        "Connect the desk to this computer by USB (or Dante, on QL/CL/Rivage).",
        "In the desk's output patch, send a spare aux or matrix (or the Stereo mix) to a USB/Dante output pair.",
        GOLDEN_RULE, CHECK_MANUAL ] };
    case "allen-heath":
      return { verified: false, steps: [
        "Plug the desk's USB-B port into this computer.",
        "In the desk's I/O / USB patch page, send a spare aux or matrix (or Main LR) to a USB output pair.",
        GOLDEN_RULE, CHECK_MANUAL ] };
    case "presonus":
      return { verified: false, steps: [
        "Plug the StudioLive's USB into this computer and open Universal Control.",
        "In its USB send / digital patching, send a spare aux (or Main L/R) to USB sends 1/2.",
        GOLDEN_RULE, CHECK_MANUAL ] };
    case "soundcraft":
      return { verified: false, steps: [
        "Connect the desk's USB to this computer (the Ui24R is a 32-channel USB interface).",
        "Route a spare aux (or the LR mix) to a USB channel pair in the desk's routing page.",
        GOLDEN_RULE, CHECK_MANUAL ] };
    default:
      return { verified: false, steps: [
        "If your desk has a USB audio port, plug it straight into this computer.",
        "In the desk's routing/patch page, send a spare aux or matrix (or the Main mix) to a USB output pair.",
        GOLDEN_RULE, CHECK_MANUAL ] };
  }
}

function build(connection: Connection, fam: DeskFamily, desk: string, os: Os | undefined): ConnectionOption {
  switch (connection) {
    case "usb-desk": {
      const { steps, verified } = usbDeskSteps(fam, desk);
      return { connection, title: `USB cable from the ${desk || "desk"}`, subtitle: "Best · no extra gear", steps, verified, recommended: true };
    }
    case "interface":
      return { connection, title: "Audio interface", subtitle: "Focusrite, Behringer UMC…", verified: false, recommended: true, steps: [
        "Take a spare post-fader aux (or matrix) output from the desk.",
        "Cable it into a LINE input on the interface. Turn 48V phantom power OFF on that input.",
        "Plug the interface into this computer by USB.",
        "Set the interface gain so talking lands in the green “Good” part of Sarah's meter. If it distorts, use the pad.",
        fam === "analog" ? "Small desks: a post-fader aux is safer than the record/tape out (often quieter and pre-fader)." : "If you hear hum, use a DI box with ground lift on the audio cable — never remove a power earth.",
        GOLDEN_RULE,
      ] };
    case "ndi":
      return { connection, title: "NDI over the network", subtitle: "Another computer sends the audio", verified: false, recommended: true, steps: [
        "On the computer that has the desk audio, send it as an NDI source (e.g. OBS with NDI, or NDI Tools).",
        "Put both computers on the same WIRED network — never Wi-Fi.",
        "The NDI source will appear in Sarah's input list — pick it.",
      ] };
    case "dante":
      return { connection, title: "Dante network audio", subtitle: "Dante Virtual Soundcard", verified: true, recommended: true, steps: [
        `Install and license Dante Virtual Soundcard on this ${os === "windows" ? "PC" : "Mac"}.`,
        "In Dante Controller, route the desk's aux/matrix channels to this computer.",
        "Use the same sample rate as your Dante network (usually 48 kHz), and latency 4, 6 or 10 ms (use 10 if you hear dropouts).",
        "Use wired Ethernet, then pick “Dante Virtual Soundcard” in Sarah's list.",
      ] };
    case "sdi-capture":
      return { connection, title: "Blackmagic / capture card", subtitle: "Audio embedded in SDI or HDMI", verified: true, recommended: true, steps: [
        "Install Blackmagic Desktop Video and approve it in System Settings → Privacy & Security (Mac), then restart.",
        "In Desktop Video Setup, set the input to SDI or HDMI and the audio input to Embedded.",
        "Make sure a live video signal WITH audio is plugged in — embedded audio stops when the video stops.",
        "Pick the Blackmagic device in Sarah's list.",
      ] };
    case "builtin":
      return { connection, title: "This computer's microphone", subtitle: "Backup only — less accurate", verified: true, recommended: false, steps: [
        "Place the computer near a speaker, away from the stage monitors.",
        "Expect lower accuracy: it hears the room and the echo. Use a desk feed when you can.",
      ] };
  }
}

/** Top ways to connect for this church (max 3 recommended + built-in as a last resort). */
export function rankConnections(input: {
  desk?: string; os?: Os; hasNdi?: boolean; hasDante?: boolean; hasCapture?: boolean;
  failedRoutes?: { connection: string; reason: string }[];
}): ConnectionOption[] {
  const fam = deskFamilyOf(input.desk);
  const desk = (input.desk ?? "").trim();
  let order: Connection[];
  if (fam === "analog" || fam === "none") order = ["interface", "ndi", "builtin"];
  else order = ["usb-desk", "interface", "ndi", "builtin"];
  if (input.hasDante) order = ["dante", ...order.filter((c) => c !== "dante")];
  if (input.hasCapture) order.splice(1, 0, "sdi-capture");
  if (input.hasNdi) order = ["ndi", ...order.filter((c) => c !== "ndi")];

  const failed = new Map((input.failedRoutes ?? []).map((f) => [f.connection, f.reason]));
  const opts = [...new Set(order)].map((c) => {
    const o = build(c, fam, desk, input.os);
    const why = failed.get(c);
    return why ? { ...o, previouslyFailed: why } : o;
  });
  const main = opts.filter((o) => o.connection !== "builtin");
  const ranked = [...main.filter((o) => !o.previouslyFailed), ...main.filter((o) => o.previouslyFailed)].slice(0, 3);
  return [...ranked, ...opts.filter((o) => o.connection === "builtin")];
}
