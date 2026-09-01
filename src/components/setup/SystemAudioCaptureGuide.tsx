"use client";
import { useState } from "react";
import { Monitor, ChevronDown, ChevronRight, RefreshCcw } from "lucide-react";

/**
 * PROACTIVE system-audio capture guide.
 *
 * Most churches feed PresentFlow from a mixer over USB — that path is the
 * device picker itself. This collapsible panel covers the *other* case:
 * capturing what THIS computer is playing (a media player, a video, a
 * Zoom/Teams call) when there's no mixer feed. That needs a loopback route
 * the OS doesn't provide out of the box:
 *   - Windows: VB-Audio Virtual Cable (recommended) or built-in Stereo Mix.
 *   - macOS:   a loopback driver such as BlackHole.
 *
 * IMPORTANT: this component is PURELY INFORMATIONAL. It changes nothing on
 * the capture / DSP / detection path. Once the operator installs the
 * loopback route, the virtual device simply appears in the normal input
 * list and `mixerSetupGuides.ts` shows the matching per-device steps. The
 * only action here is an optional "Refresh devices" callback so the newly
 * installed device shows up without leaving the screen.
 */

type OS = "windows" | "mac" | "other";

function detectOS(): OS {
  if (typeof navigator === "undefined") return "other";
  const ua = `${navigator.userAgent} ${(navigator as Navigator).platform || ""}`.toLowerCase();
  // Check Mac/Apple FIRST: "darwin" contains the substring "win", so a naive
  // /win/ test would misclassify a Darwin UA as Windows. iPad/iPhone report
  // "mac"-like UAs but aren't relevant here; treat as mac either way.
  if (/mac|darwin|iphone|ipad|ipod/.test(ua)) return "mac";
  // Match explicit Windows tokens ("windows", "win32/64", "wow64") rather than
  // a bare "win" so no stray vendor token flips a non-Windows UA to Windows.
  if (/windows|win32|win64|wow64/.test(ua)) return "windows";
  return "other";
}

const WINDOWS_STEPS: { title: string; body: string }[] = [
  {
    title: "Recommended — VB-Audio Virtual Cable (free)",
    body:
      "Download VB-CABLE from vb-audio.com/Cable. Unzip, right-click VBCABLE_Setup_x64.exe → Run as administrator → Install Driver → reboot. Then Settings → System → Sound → set output to “CABLE Input”. To still hear it: Sound Control Panel → Recording → CABLE Output → Properties → Listen → tick “Listen to this device”. Come back here, press Refresh, and pick “CABLE Output”.",
  },
  {
    title: "No download — Stereo Mix (if your PC has it)",
    body:
      "Right-click the speaker icon → Sound settings → More sound settings → Recording tab → right-click empty space → Show Disabled Devices. If “Stereo Mix” appears, right-click → Enable. Come back here, press Refresh, and pick “Stereo Mix”. (Many USB/HDMI sound drivers don't expose Stereo Mix — use VB-CABLE if it isn't listed.)",
  },
];

const MAC_STEPS: { title: string; body: string }[] = [
  {
    title: "Install a loopback driver — BlackHole (free)",
    body:
      "Install BlackHole from existential.audio. In Audio MIDI Setup, create a Multi-Output Device containing BlackHole + your speakers so you still hear playback, and set the app you're capturing to output to it. Come back here, press Refresh, and pick “BlackHole”.",
  },
];

export function SystemAudioCaptureGuide({
  onRefresh,
  defaultOpen = false,
}: {
  /** Optional: re-enumerate inputs after the operator installs a loopback route. */
  onRefresh?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // OS is detected once on mount via lazy initial state; a manual switch lets
  // the operator flip to the other platform's steps if detection is wrong.
  const [os, setOs] = useState<OS>(detectOS);

  const steps = os === "windows" ? WINDOWS_STEPS : os === "mac" ? MAC_STEPS : [...WINDOWS_STEPS, ...MAC_STEPS];

  return (
    <div className="rounded-md border border-border bg-accent/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <Monitor className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold">Capturing this computer's audio instead of a mixer?</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Most churches connect a mixer over USB and pick it in the list above — if you've done
            that, you're set. Use this only when you want PresentFlow to hear{" "}
            <b>what this computer is playing</b> (a media player, a video, a Zoom/Teams call). That
            needs a one-time loopback route:
          </p>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Steps for:</span>
            {(["windows", "mac"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setOs(k)}
                className={`h-7 px-2.5 rounded-md border text-xs font-medium ${
                  os === k ? "bg-foreground text-background border-foreground" : "border-border"
                }`}
              >
                {k === "windows" ? "Windows" : "Mac"}
              </button>
            ))}
          </div>

          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-md border border-border/60 bg-background/50 p-2.5">
                <div className="text-xs font-semibold mb-0.5">
                  {steps.length > 1 && os !== "other" ? `Option ${String.fromCharCode(65 + i)} — ` : ""}
                  {s.title}
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">{s.body}</div>
              </li>
            ))}
          </ol>

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="h-8 px-3 inline-flex items-center gap-1.5 text-xs border border-border rounded-md font-medium"
            >
              <RefreshCcw className="w-3.5 h-3.5" /> Refresh devices
            </button>
          )}

          <p className="text-[11px] text-muted-foreground/80">
            A loopback route is a virtual audio device — latency is negligible, so it won't hurt
            live detection. Nothing about your existing audio setup changes.
          </p>
        </div>
      )}
    </div>
  );
}
