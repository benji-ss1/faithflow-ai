/**
 * sarahAnswers — curated, verified answers to the questions church volunteers actually
 * ask (2026-09-16).
 *
 * Why this exists: a live quality test showed the model, handed a large knowledge blob,
 * skipped the relevant steps and invented hardware details ("halos" on a UMC202HD, a desk
 * model the user never mentioned). For common questions an exact, hand-written answer is
 * correct every time. The model only handles questions with no matching entry, and then
 * only sees the few entries that are relevant.
 *
 * Every answer: plain English, the essential steps in order, PresentFlow framing (the desk
 * is an INPUT to this computer), no unverified menu paths.
 */

export interface SarahAnswer {
  id: string;
  /** All patterns in `all` must match; at least one in `any` must match (when given). */
  all?: RegExp[];
  any: RegExp[];
  answer: string;
}

export const SARAH_ANSWERS: SarahAnswer[] = [
  {
    id: "x32-usb",
    any: [/\bx32\b|\bm32\b|midas/i],
    all: [/usb|mac|computer|laptop|route|routing|card/i],
    answer:
      "On the X32 (or M32) with the X-USB card: 1) Plug the card's USB port straight into this computer — no hub. 2) Go to Routing → Out 1-16 and put your mix for the computer on Out 15/16 — a spare aux that follows the faders, or Main LR if you have none spare. 3) Go to Routing → Card Out and choose the block Out 9-16. That sends outputs 9-16 to USB channels 9-16, so your mix arrives on USB 15/16. 4) In PresentFlow, pick the X-USB input and channels 15 & 16. A Mac needs no driver; Windows needs Behringer's X-USB driver.",
  },
  {
    id: "wing-usb",
    any: [/\bwing\b/i],
    answer:
      "On a Behringer Wing: plug its USB-B port straight into this computer (no hub). In the Wing's routing, open the USB outputs and assign the mix you want the computer to hear — a spare aux that follows the faders, or the main mix — to a USB pair. Then pick that pair in PresentFlow. Menu names vary a little between Wing firmware versions, so if you can't see the USB output page, update the firmware or check Behringer's Wing manual.",
  },
  {
    id: "tf-usb",
    any: [/\btf\s?\d?\b|yamaha tf/i],
    answer:
      "On a Yamaha TF, channels 1-32 on USB carry each of the desk's inputs, and the Stereo (main) mix comes out on USB 33 & 34 by default. So in PresentFlow, pick the TF's USB input and choose channels 33 & 34. A Mac needs no driver; Windows needs the Yamaha Steinberg USB driver. If the main mix isn't on 33/34, check the USB output setting in TF Editor — some firmware lets you change it.",
  },
  {
    id: "sq-qu-usb",
    any: [/allen|heath|\bsq\b|sq-?\d|\bqu\b|qu-?\d/i],
    answer:
      "On an Allen & Heath SQ or Qu: connect the desk's USB-B audio port to this computer. On a Mac it works straight away; on Windows, first install the Allen & Heath USB audio driver from allen-heath.com. Then on the desk open the I/O patch screen and send the mix you want the computer to hear — a spare aux or matrix that follows the faders, or the main mix — to a USB output. In PresentFlow, pick the desk's USB input and the channels you patched.",
  },
  {
    id: "scarlett-no-signal",
    any: [/scarlett|focusrite/i],
    answer:
      "If your Focusrite Scarlett shows no signal, check in this order: 1) The cable from the desk goes into the jack part of the input (not a mic XLR), using a balanced TRS jack cable. 2) The INST button is OFF and 48V is OFF — 48V is only for condenser microphones. 3) Turn the gain up: on newer Scarletts the ring around the knob glows green with sound and red if it's too loud. 4) Plug the Scarlett straight into the computer, not a hub. 5) In PresentFlow, pick the Scarlett as the input. On a Mac, also allow PresentFlow under System Settings → Privacy & Security → Microphone.",
  },
  {
    id: "umc-setup",
    any: [/umc\s?\d*|u-?phoria/i],
    answer:
      "To set up a Behringer UMC202HD: 1) Run a balanced TRS jack cable from a spare aux output on your desk into the jack part of Input 1. 2) Set the INST switch OFF and the +48V switch OFF — 48V powers both inputs at once and isn't needed for a desk feed. 3) Plug the UMC into this computer by USB, straight in. 4) Turn up the Input 1 gain while someone talks, until the SIG light flickers but the CLIP light stays off. 5) In PresentFlow, pick the UMC202HD and Input 1. A Mac needs no driver; on Windows install Behringer's UMC ASIO driver.",
  },
  {
    id: "hum",
    any: [/\bhum\b|\bbuzz|ground loop|humming/i],
    answer:
      "A hum when the laptop is connected is almost always a ground loop, and the laptop's charger is the usual cause. Test it: unplug the laptop's charger — if the hum stops, that's it. Fixes, easiest first: run the laptop on battery during the service; plug the laptop and the desk into the same power strip; add a USB ground-loop isolator between the laptop and the interface; or use a DI box with a ground-lift switch on the audio cable. Never remove or tape over the earth pin on a power plug.",
  },
  {
    id: "ndi-obs",
    any: [/\bndi\b/i],
    answer:
      "To send NDI from OBS so another computer can see it: 1) On the OBS computer, install the DistroAV plugin (it used to be called obs-ndi) and the NDI Runtime it asks for. 2) In OBS, open Tools → DistroAV NDI Settings and switch on Main Output. 3) Put both computers on the same network and subnet — wired is far more reliable than Wi-Fi. 4) Allow NDI through the firewall on both computers rather than turning the firewall off. If it still doesn't appear, your network may block NDI discovery — ask whoever runs the network, or add the OBS computer's IP address in NDI Access Manager.",
  },
  {
    id: "dante-silent",
    any: [/dante/i],
    answer:
      "If Dante Virtual Soundcard is running but PresentFlow hears nothing: 1) Check DVS is licensed and started. 2) Make sure DVS is using the wired network port that's connected to your Dante network, not Wi-Fi. 3) In Dante Controller, route the desk's output channels to this computer's DVS inputs — nothing flows until you do. 4) Set the sample rate to match the network (usually 48 kHz). 5) In PresentFlow, pick Dante Virtual Soundcard and the channels you routed. If the sound drops out, raise DVS latency to 10 ms.",
  },
  {
    id: "blackmagic-no-audio",
    any: [/blackmagic|ultrastudio|decklink/i],
    answer:
      "If your Blackmagic UltraStudio or DeckLink shows video but no audio: 1) Open Desktop Video Setup and set the audio input to Embedded. 2) Check the camera or switcher is actually putting audio onto its SDI or HDMI output. 3) Remember embedded audio only flows while the video signal is live — no picture, no sound. 4) In PresentFlow, pick the Blackmagic device as the input.",
  },
  {
    id: "youtube-obs",
    any: [/youtube/i],
    answer:
      "To stream your service to YouTube with OBS: 1) In YouTube Studio, click Create → Go live, choose Stream, and copy the stream key (or skip this and connect your account in OBS). 2) In OBS, open Settings → Stream, set Service to YouTube, then click Connect Account or paste the stream key. 3) In Settings → Output, a good start is a video bitrate around 4500-6000 kbps, and in Settings → Video, 1080p at 30 fps. 4) Add your sound desk feed as an audio input source. 5) Click Start Streaming — and do a test stream set to Unlisted before Sunday.",
  },
  {
    id: "facebook-obs",
    any: [/facebook/i],
    answer:
      "To stream to Facebook with OBS: in Facebook, open Live Producer, choose to go live with streaming software, and copy the stream key. In OBS, open Settings → Stream, set Service to Facebook Live and paste the key. Add your sound desk feed as an audio input, then click Start Streaming. Try a private test first.",
  },
  {
    id: "main-vs-aux",
    any: [/main mix|\baux\b|matrix|which mix|what mix/i],
    answer:
      "Use a spare aux (or matrix) if you have one. An aux is an extra mix on the desk that you can send somewhere on its own — here, to this computer. Set it to follow the faders (post-fader), turn the preacher's and singers' mics up in it, keep the band a little lower, and leave out reverb and effects, so PresentFlow hears the words clearly. If there's no spare aux, the main mix works too — it's just shaped for the room, not for listening.",
  },
  {
    id: "phantom",
    any: [/phantom|48\s?v/i],
    answer:
      "Phantom power (48V) is power a desk or interface sends down a microphone cable to run condenser microphones. For PresentFlow you're usually plugging a line-level feed — like an aux output from the desk — into an interface, and for that phantom power should be OFF. Only turn it on for an input that has a condenser microphone plugged straight into it.",
  },
];

function score(entry: SarahAnswer, q: string): number {
  if (entry.all && !entry.all.every((re) => re.test(q))) return 0;
  return entry.any.reduce((n, re) => n + (re.test(q) ? 1 : 0), 0);
}

/** The single best curated answer for a question, or null when none clearly fits. */
export function curatedAnswer(question: string): SarahAnswer | null {
  let best: { e: SarahAnswer; s: number } | null = null;
  for (const e of SARAH_ANSWERS) {
    const s = score(e, question);
    if (s > 0 && (!best || s > best.s)) best = { e, s };
  }
  return best?.e ?? null;
}

/** The few entries relevant to a question, for grounding the model when no answer fits exactly. */
export function relevantAnswers(question: string, max = 3): SarahAnswer[] {
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  return SARAH_ANSWERS
    .map((e) => ({ e, s: score(e, question) * 10 + words.filter((w) => e.answer.toLowerCase().includes(w)).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.e);
}
