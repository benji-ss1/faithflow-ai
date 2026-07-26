"use client";
/**
 * Audio Diagnostics Scanner — enumerates EVERY audio input, attempts to
 * open each one with a fallback ladder of constraints, and measures 3
 * seconds of RMS to tell the operator which devices actually have signal.
 *
 * Purpose: at a real church (Mac Studio + mixer + Logic Pro + maybe Dante
 * + maybe a spare USB mic), there may be 4–10 candidate audio devices.
 * The volunteer needs to know AT A GLANCE which one is carrying the
 * preacher's mic BEFORE trying to talk. This scanner is that shortcut.
 *
 * Runs entirely client-side (no bridge / no server). Devices are opened
 * one at a time (never in parallel) so we don't fight the OS driver for
 * shared exclusive access. Streams are torn down as soon as measurement
 * completes, so the scan doesn't leave any devices "hot" behind us.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, RefreshCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ScanResult = {
  deviceId: string;
  label: string;
  tested: boolean;
  hasSignal: boolean;
  averageLevel: number;
  peakLevel: number;
  sampleRate: number | null;
  channels: number | null;
  error: string | null;
};

// Constraints fallback ladder — each attempt is more lenient than the last.
// Some devices (Bluetooth HFP, old FireWire interfaces) reject the strict
// 16kHz mono request but accept the same open at their native rate; some
// devices only open if we also enable Chromium's DSP (built-in mics).
// The ladder tries the closest-to-Deepgram config first so a successful
// open on step 1 gives us the audio format we actually want to stream.
async function openWithFallback(deviceId: string): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { audio: { deviceId: { exact: deviceId }, channelCount: 1, sampleRate: 16000, echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
    { audio: { deviceId: { exact: deviceId }, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
    { audio: { deviceId: { exact: deviceId }, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
    { audio: { deviceId: { exact: deviceId } } },
  ];
  let lastErr: unknown = null;
  for (const c of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not open device");
}

// Measure 3 seconds of the given stream's RMS — returns peak and average
// normalized to 0..1. Uses AnalyserNode's byte-frequency data at ~30 Hz.
async function measureLevel(stream: MediaStream): Promise<{ avg: number; peak: number }> {
  const audioCtx = new AudioContext();
  let source: MediaStreamAudioSourceNode | null = null;
  try {
    source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let maxAvg = 0;
    let maxPeak = 0;
    const ticks = 90; // 90 * 33ms ≈ 3s
    for (let i = 0; i < ticks; i++) {
      await new Promise<void>((r) => setTimeout(r, 33));
      analyser.getByteFrequencyData(buf);
      let sum = 0;
      let peak = 0;
      for (let j = 0; j < buf.length; j++) {
        const v = buf[j];
        sum += v;
        if (v > peak) peak = v;
      }
      const avg = sum / buf.length / 255;
      const peakN = peak / 255;
      if (avg > maxAvg) maxAvg = avg;
      if (peakN > maxPeak) maxPeak = peakN;
    }
    return { avg: maxAvg, peak: maxPeak };
  } finally {
    try { source?.disconnect(); } catch { /* ignore */ }
    try { await audioCtx.close(); } catch { /* ignore */ }
  }
}

export function AudioDiagnosticsScan({ onClose, onSelectDevice }: {
  onClose: () => void;
  onSelectDevice: (deviceId: string, label: string) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [currentDevice, setCurrentDevice] = useState<string | null>(null);
  const abortRef = useRef(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setResults([]);
    abortRef.current = false;
    try {
      // Permission-priming call so device labels aren't empty on the second
      // enumerateDevices() below. Some browsers hide labels until at least
      // one getUserMedia has resolved successfully.
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch { /* if this fails the user denied — devices will be nameless but the scan still runs */ }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      if (inputs.length === 0) {
        toast.info("No audio input devices found — connect a USB interface, mic, or mixer.");
        setResults([]);
        return;
      }

      // Test devices one at a time — parallel opens race the driver.
      const scanned: ScanResult[] = [];
      for (const dev of inputs) {
        if (abortRef.current) break;
        setCurrentDevice(dev.deviceId);
        const label = dev.label || "Unnamed audio input";
        const r: ScanResult = {
          deviceId: dev.deviceId,
          label,
          tested: false,
          hasSignal: false,
          averageLevel: 0,
          peakLevel: 0,
          sampleRate: null,
          channels: null,
          error: null,
        };
        try {
          const stream = await openWithFallback(dev.deviceId);
          try {
            const track = stream.getAudioTracks()[0];
            const settings = track?.getSettings?.() ?? {};
            r.sampleRate = typeof settings.sampleRate === "number" ? settings.sampleRate : null;
            r.channels = typeof settings.channelCount === "number" ? settings.channelCount : null;
            r.tested = true;
            const { avg, peak } = await measureLevel(stream);
            r.averageLevel = avg;
            r.peakLevel = peak;
            r.hasSignal = avg > 0.005;
          } finally {
            try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
          }
        } catch (e) {
          const name = (e as { name?: string })?.name || "";
          const msg = (e as { message?: string })?.message || String(e);
          r.error = name === "NotReadableError"
            ? "Locked by another app (ASIO exclusive / driver)"
            : name === "NotAllowedError"
              ? "Permission denied"
              : msg.slice(0, 80);
        }
        scanned.push(r);
        setResults([...scanned]);
      }
      setCurrentDevice(null);
      const withSignal = scanned.filter((r) => r.hasSignal).length;
      toast.success(`Scanned ${scanned.length} device${scanned.length === 1 ? "" : "s"}. ${withSignal} with signal.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Diagnostics failed");
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    // Auto-run once when the panel opens
    void scan();
    return () => {
      abortRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signalLabel = (r: ScanResult) => {
    if (!r.tested) return { text: r.error ?? "Not testable", color: "text-red-400" };
    if (r.hasSignal) {
      if (r.averageLevel > 0.20) return { text: "Loud", color: "text-amber-400" };
      if (r.averageLevel > 0.05) return { text: "Good", color: "text-emerald-400" };
      return { text: "Quiet", color: "text-emerald-300" };
    }
    return { text: "No signal", color: "text-zinc-500" };
  };

  return (
    <div
      role="dialog"
      aria-label="Audio Diagnostics"
      className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[720px] max-w-full max-h-[80vh] rounded-lg border shadow-2xl flex flex-col"
        style={{ background: "#0f1414", borderColor: "#2a3232" }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "#2a3232" }}>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-zinc-100">Audio Diagnostics</div>
            <div className="text-[11px] text-zinc-500">
              {scanning ? "Testing each audio input for 3 seconds…" : "Scan complete — pick the device carrying your mixer's feed."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning}
            className="h-8 px-3 rounded-md border text-[11px] font-medium text-zinc-100 hover:bg-white/5 inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}
          >
            <RefreshCcw className="w-3 h-3" /> Rescan
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close diagnostics"
            className="h-8 w-8 rounded-md hover:bg-white/5 text-zinc-400 hover:text-zinc-100 inline-flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {results.length === 0 && !scanning && (
            <div className="py-8 text-center text-[12px] text-zinc-500">
              No results yet — click Rescan.
            </div>
          )}
          {results.length === 0 && scanning && (
            <div className="py-8 text-center text-[12px] text-zinc-400 inline-flex items-center gap-2 w-full justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Enumerating devices…
            </div>
          )}
          {results.length > 0 && (
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="text-left font-medium px-2 py-1.5">Device</th>
                  <th className="text-left font-medium px-2 py-1.5 w-20">Signal</th>
                  <th className="text-left font-medium px-2 py-1.5 w-28">Level</th>
                  <th className="text-left font-medium px-2 py-1.5 w-20">Rate</th>
                  <th className="text-left font-medium px-2 py-1.5 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const sig = signalLabel(r);
                  const being = currentDevice === r.deviceId && scanning;
                  return (
                    <tr
                      key={r.deviceId}
                      className={cn(
                        "border-t align-middle",
                        being && "bg-amber-500/5",
                      )}
                      style={{ borderColor: "#1a2020" }}
                    >
                      <td className="px-2 py-2 text-zinc-100">
                        <div className="flex items-center gap-2">
                          {being ? (
                            <Loader2 className="w-3 h-3 animate-spin text-amber-400 shrink-0" />
                          ) : r.hasSignal ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                          ) : (
                            <Circle className="w-3 h-3 text-zinc-600 shrink-0" />
                          )}
                          {/* 2026-07-26 — NDI tag when the device label looks
                              like NDI Virtual Input. Signals to the operator
                              that this is the church's network audio feed. */}
                          {/ndi/i.test(r.label) && (
                            <span
                              className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0"
                              style={{ background: "#8b5cf6", color: "white" }}
                              title="Audio via NDI network stream (NDI Virtual Input)"
                            >
                              NDI
                            </span>
                          )}
                          <div className="truncate">{r.label}</div>
                        </div>
                      </td>
                      <td className={cn("px-2 py-2 text-[11px] font-medium", sig.color)}>{sig.text}</td>
                      <td className="px-2 py-2">
                        <div className="relative w-full h-1.5 rounded-full overflow-hidden bg-black/40">
                          <div
                            className="absolute inset-y-0 left-0"
                            style={{
                              width: `${Math.max(2, Math.round(r.averageLevel * 100))}%`,
                              background: r.peakLevel > 0.9 ? "#e11d48" : r.averageLevel > 0.05 ? "#10b981" : "#6b7280",
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2 text-[10px] font-mono text-zinc-500">
                        {r.sampleRate ? `${Math.round(r.sampleRate / 1000)}k` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          disabled={!r.tested && !r.hasSignal}
                          onClick={() => { onSelectDevice(r.deviceId, r.label); toast.success(`Selected: ${r.label}`); onClose(); }}
                          className="h-6 px-2 rounded text-[10px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: "#f97316" }}
                        >
                          Use
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-2 border-t text-[10px] text-zinc-500 space-y-1" style={{ borderColor: "#2a3232" }}>
          <div>Locked devices (ASIO exclusive mode, driver crash) show a red status — close the other app or pick a different input.</div>
          {/* 2026-07-26 — NDI helper: shown when the scan found devices but
              none of them look like an NDI Virtual Input source. Common at
              churches that use NDI for audio transport but haven't installed
              NDI Tools on the Mac running PresentFlow. */}
          {results.length > 0 && !results.some((r) => /ndi/i.test(r.label)) && (
            <div className="pt-1 space-y-0.5">
              <div><span className="font-semibold text-zinc-400">No NDI device showing up?</span> If NDI Tools is installed:</div>
              <ol className="list-decimal pl-4 text-zinc-500">
                <li>Open <span className="font-mono">NDI Virtual Input.app</span> from Applications (or check the menu bar for the NDI icon)</li>
                <li>Click the NDI menu-bar icon → select your church's NDI source (checkmark on the active one)</li>
                <li>Click Rescan above</li>
              </ol>
              <div className="pt-0.5">Don't have NDI Tools installed? <a href="https://ndi.video/tools/" target="_blank" rel="noopener noreferrer" className="text-[#f97316] underline">Free download</a></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
