"use client";
/**
 * 2026-07-26 rewrite — was a "coming soon" placeholder that operators at
 * JPD kept opening expecting to find their audio input picker. Now: the
 * essential audio controls (input device + Source Type + diagnostics)
 * live directly in the right-sidebar Settings popover so operators
 * don't have to navigate to a separate settings page mid-service.
 *
 * Full advanced controls (voice commands, auto-pause, hold-during-song,
 * mic boost slider) still live on the /settings page for anyone who
 * wants them; a "More audio settings" link at the bottom of this popover
 * jumps there.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, RefreshCcw, Stethoscope } from "lucide-react";
import { AudioDiagnosticsScan } from "@/components/operator/AudioDiagnosticsScan";

const AUDIO_INPUT_KEY = "presentflow.pro.audioInput.v1";
const AUDIO_SOURCE_TYPE_KEY = "presentflow.pro.audioSourceType.v1";

type AudioInputSel = { kind: "device"; id: string; label: string };

// Same regexes we use in the settings-page picker + diagnostics scanner so
// the visual language is consistent everywhere audio inputs are surfaced.
const isNdi = (l: string) => /ndi/i.test(l);
const isMixer = (l: string) =>
  /focusrite|scarlett|clarett|behringer|umc|u-phoria|presonus|audiobox|studio ?[12]?[46]|motu|apollo|volt|universal audio|audient|evo|steinberg|ur[0-9]|mackie|onyx|roland|rubix|rme|fireface|babyface|apogee|duet|ensemble|symphony|ssl|solid state|arturia|minifuse|tascam|zoom livetrak|zoom h[0-9]|x32|xr18|xr16|xr12|x-air|yamaha tf|mg[0-9]|allen.*heath|sq-|dlive|qu-|midas|m32|mr18|soundcraft|ui[0-9]|signature|studiolive|touchmix|qsc|dl[0-9]+s|profx|usb audio codec|usb audio device|blackhole/i.test(l);
const isBluetooth = (l: string) => /bluetooth|airpods|beats|jabra|bose|sony wh|sennheiser momentum|galaxy buds|wh-1000/i.test(l);

export function AudioTab() {
  const [selected, setSelected] = useState<AudioInputSel | null>(null);
  const [sourceType, setSourceType] = useState<"mixer" | "microphone">("mixer");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [diagOpen, setDiagOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      const rawSel = localStorage.getItem(AUDIO_INPUT_KEY);
      if (rawSel) {
        const parsed = JSON.parse(rawSel);
        if (parsed && parsed.kind === "device" && typeof parsed.id === "string") {
          setSelected({ kind: "device", id: parsed.id, label: typeof parsed.label === "string" ? parsed.label : "" });
        }
      }
      const st = localStorage.getItem(AUDIO_SOURCE_TYPE_KEY);
      setSourceType(st === "microphone" ? "microphone" : "mixer");
    } catch { /* noop */ }
    refreshDevices();
  }, []);

  function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((all) => {
      setDevices(all.filter((d) => d.kind === "audioinput"));
    }).catch(() => { /* noop */ });
  }

  function persistSelection(sel: AudioInputSel) {
    setSelected(sel);
    try { localStorage.setItem(AUDIO_INPUT_KEY, JSON.stringify(sel)); } catch { /* noop */ }
    try { window.dispatchEvent(new CustomEvent("presentflow:audio-input-changed", { detail: sel })); } catch { /* noop */ }
  }

  function persistSourceType(next: "mixer" | "microphone") {
    setSourceType(next);
    try { localStorage.setItem(AUDIO_SOURCE_TYPE_KEY, next); } catch { /* noop */ }
    try { window.dispatchEvent(new CustomEvent("presentflow:audio-input-changed", { detail: { sourceType: next } })); } catch { /* noop */ }
  }

  // Sort: NDI first, MIXER second, Bluetooth third (they work but with latency),
  // everything else last. Within each group, sorted by label.
  const sortedDevices = [...devices].sort((a, b) => {
    const rank = (d: MediaDeviceInfo) => {
      if (isNdi(d.label)) return 0;
      if (isMixer(d.label)) return 1;
      if (isBluetooth(d.label)) return 3;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (a.label || "").localeCompare(b.label || "");
  });

  const hasNdi = devices.some((d) => isNdi(d.label));
  const selectedLabel = selected?.label || (devices.length > 0 ? "Pick an input device…" : "No devices detected");

  return (
    <div className="flex flex-col gap-3 py-2 text-[12px]">
      {/* Input device */}
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] px-1">Input device</div>
        <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
          <Popover.Trigger asChild>
            <button
              className="h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] text-[11px] hover:bg-white/5 inline-flex items-center justify-between gap-2"
            >
              <span className="truncate">{selectedLabel}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={4}
              align="start"
              className="z-[80] w-[300px] max-h-[360px] overflow-y-auto rounded-md border shadow-2xl p-2"
              style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
            >
              <div className="flex items-center justify-between px-1 py-1">
                <div className="text-[9px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  {devices.length} input{devices.length === 1 ? "" : "s"}
                </div>
                <button
                  onClick={refreshDevices}
                  className="text-[9px] uppercase tracking-wider text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/5"
                  title="Rescan devices"
                >
                  <RefreshCcw className="w-2.5 h-2.5" /> Refresh
                </button>
              </div>
              {devices.length === 0 && (
                <div className="px-2 py-3 text-[11px] italic text-[var(--color-muted-foreground)]">No audio inputs detected. Plug in a USB interface, USB mic, or Bluetooth audio device.</div>
              )}
              {sortedDevices.map((d) => {
                const ndi = isNdi(d.label);
                const mixer = !ndi && isMixer(d.label);
                const bt = !ndi && !mixer && isBluetooth(d.label);
                const isSelected = selected?.id === d.deviceId;
                return (
                  <button
                    key={d.deviceId}
                    onClick={() => {
                      persistSelection({ kind: "device", id: d.deviceId, label: d.label || (ndi ? "NDI Audio" : mixer ? "USB Interface" : "Audio input") });
                      setPickerOpen(false);
                    }}
                    className={
                      "w-full text-left px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 " +
                      (isSelected ? "text-white bg-[color:rgba(249,115,22,0.15)]" : "text-[var(--color-foreground)] hover:bg-white/5")
                    }
                  >
                    {ndi && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0"
                        style={{ background: "#8b5cf6", color: "white" }}
                        title="Audio via NDI network stream"
                      >
                        NDI
                      </span>
                    )}
                    {mixer && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0"
                        style={{ background: "#10b981", color: "white" }}
                        title="USB audio interface / mixer / loopback bridge"
                      >
                        MIXER
                      </span>
                    )}
                    {bt && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0"
                        style={{ background: "#3b82f6", color: "white" }}
                        title="Bluetooth audio (100-300ms latency — verse detection slightly delayed)"
                      >
                        BT
                      </span>
                    )}
                    <span className="truncate">{d.label || "Unnamed input"}</span>
                  </button>
                );
              })}
              {/* NDI helper — only if no NDI device is present */}
              {!hasNdi && devices.length > 0 && (
                <div className="mt-1 border-t px-2 py-2 text-[10px] leading-snug text-[var(--color-muted-foreground)] space-y-0.5" style={{ borderColor: "var(--color-border)" }}>
                  <div className="font-semibold text-[var(--color-foreground)]">Using NDI at your church?</div>
                  <div>Open NDI Virtual Input from the menu bar → pick your source → click Refresh above. If NDI Tools isn't installed, grab it free from <a href="https://ndi.video/tools/" target="_blank" rel="noopener noreferrer" className="text-[#f97316] underline">ndi.video/tools</a></div>
                </div>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      {/* Source Type — mixer vs microphone (DSP off vs on) */}
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] px-1">Source type</div>
        <div className="inline-flex rounded-md p-0.5 border border-[var(--color-border)] bg-[var(--color-elevated)]">
          {(["mixer", "microphone"] as const).map((t) => (
            <button
              key={t}
              onClick={() => persistSourceType(t)}
              className={"h-6 flex-1 px-2 rounded text-[10px] font-medium capitalize " + (sourceType === t ? "text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
              style={sourceType === t ? { background: "#f97316" } : {}}
              title={t === "mixer" ? "USB interface / mixer USB-out / BlackHole / NDI — DSP OFF" : "Bare microphone in the room — DSP ON to fight room noise"}
            >
              {t === "mixer" ? "Mixer / Interface" : "Microphone"}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-[var(--color-muted-foreground)] px-1">
          {sourceType === "mixer"
            ? "Clean feed — echo cancellation, noise suppression, auto-gain are OFF"
            : "Room mic — echo cancellation, noise suppression, auto-gain are ON"}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setDiagOpen(true)}
          className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[11px] font-medium hover:bg-white/5 inline-flex items-center gap-1.5"
          title="Scan every audio input and report which have live signal"
        >
          <Stethoscope className="w-3.5 h-3.5" />
          Run diagnostics
        </button>
        <button
          onClick={() => { try { window.dispatchEvent(new CustomEvent("presentflow:restart-audio")); } catch { /* noop */ } toast.success("AI listener restarting…"); }}
          className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[11px] font-medium hover:bg-white/5"
          title="Full teardown + restart of the AI listener pipeline"
        >
          ↻ Restart
        </button>
      </div>

      <div className="text-[10px] text-[var(--color-muted-foreground)] px-1">
        Advanced settings (voice commands, mic boost, auto-pause) live in the full Settings page.
      </div>

      {diagOpen && (
        <AudioDiagnosticsScan
          onClose={() => setDiagOpen(false)}
          onSelectDevice={(id, label) => persistSelection({ kind: "device", id, label })}
        />
      )}
    </div>
  );
}
