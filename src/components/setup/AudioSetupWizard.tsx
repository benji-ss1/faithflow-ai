"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, CheckCircle2, AlertCircle, ArrowRight, Volume2, Play } from "lucide-react";
import { toast } from "sonner";

/**
 * 5-step gated audio wizard.
 * Detects common mixer/USB interfaces (Focusrite, PreSonus, RME, Behringer,
 * Zoom, Rode) and pins them to the top of the device list.
 * Persists selected device label to localStorage — the operator's
 * useAudioStream reads this the same way.
 */
type StepKey = "permission" | "pickDevice" | "meter" | "testRecord" | "save";
type Device = { deviceId: string; label: string; isMixer: boolean };

const MIXER_HINTS = [
  "focusrite", "presonus", "rme", "behringer", "zoom", "rode",
  "motu", "yamaha", "mackie", "allen & heath", "midas", "tascam",
  "scarlett", "clarett", "audiobox", "goxlr", "loopback",
];

function isLikelyMixer(label: string): boolean {
  const l = label.toLowerCase();
  return MIXER_HINTS.some((h) => l.includes(h));
}

export function AudioSetupWizard() {
  const [step, setStep] = useState<StepKey>("permission");
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [level, setLevel] = useState<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [recordUrl, setRecordUrl] = useState<string | null>(null);

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // We only need permission — release the stream, we'll pick device next
      stream.getTracks().forEach((t) => t.stop());
      setPermission("granted");
      const devs = await navigator.mediaDevices.enumerateDevices();
      const inputs: Device[] = devs
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "Unnamed input", isMixer: isLikelyMixer(d.label || "") }))
        .sort((a, b) => (b.isMixer ? 1 : 0) - (a.isMixer ? 1 : 0));
      setDevices(inputs);
      if (inputs[0]) setSelectedId(inputs[0].deviceId);
      setStep("pickDevice");
    } catch {
      setPermission("denied");
    }
  }, []);

  const startMeter = useCallback(async (deviceId: string) => {
    stopMeter();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined },
      });
      streamRef.current = stream;
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        // RMS in dB-ish 0..100
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        setLevel(Math.min(100, Math.round((avg / 255) * 200)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      toast.error(`Couldn't open device: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }, []);

  const stopMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => { /* ignore */ });
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => () => {
    stopMeter();
    // Revoke any pending object URLs to prevent memory leak
    if (recordUrl) { try { URL.revokeObjectURL(recordUrl); } catch { /* noop */ } }
  }, [stopMeter, recordUrl]);

  const testRecord = useCallback(async () => {
    stopMeter();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: selectedId ? { exact: selectedId } : undefined },
      });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        setRecordUrl(URL.createObjectURL(blob));
      };
      rec.start();
      toast.info("Recording 3 seconds — speak now.");
      setTimeout(() => rec.stop(), 3000);
    } catch (e) {
      toast.error(`Couldn't record: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }, [selectedId, stopMeter]);

  return (
    <div className="max-w-3xl space-y-4">
      <Progress step={step} />

      {/* Step 1 — Permission */}
      <BubbleCard
        active={step === "permission"}
        done={step !== "permission"}
        icon={Mic}
        what="Grant microphone permission"
        why="Your browser needs one-time permission before PresentFlow can list your USB mixer, audio interface, or built-in mic. Without permission, all inputs show up as 'Unnamed input' and can't be tested."
      >
        {step === "permission" && (
          <>
            {permission === "denied" ? (
              <div className="flex items-start gap-2 text-warning">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <div className="text-sm">
                  Permission denied. Click the mic icon in the browser address bar → Allow.
                  Then press Try again.
                </div>
              </div>
            ) : (
              <p className="text-sm">
                Chrome / Safari / Edge will pop a permission dialog. Click <strong>Allow</strong>.
              </p>
            )}
            <button onClick={requestPermission}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold mt-3 inline-flex items-center gap-1">
              {permission === "denied" ? "Try again" : "Grant permission"} <ArrowRight className="w-3 h-3" />
            </button>
          </>
        )}
      </BubbleCard>

      {/* Step 2 — Pick device */}
      <BubbleCard
        active={step === "pickDevice"}
        done={["meter", "testRecord", "save"].includes(step)}
        icon={Volume2}
        what="Choose the audio source"
        why="If your church runs a mixer feeding a USB interface (Focusrite, PreSonus, etc.), that's what you want — not your Mac's built-in mic. We pinned likely mixers to the top of the list."
      >
        {step === "pickDevice" && (
          <>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {devices.map((d) => (
                <label key={d.deviceId} className="flex items-start gap-2 p-2 border border-border rounded-md cursor-pointer hover:bg-accent">
                  <input type="radio" name="dev" checked={selectedId === d.deviceId}
                    onChange={() => setSelectedId(d.deviceId)}
                    className="mt-1" />
                  <div>
                    <div className="text-sm font-medium">
                      {d.label}
                      {d.isMixer && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-success">Mixer</span>}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{d.deviceId.slice(0, 8)}…</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setStep("meter")} disabled={!selectedId}
                className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold disabled:opacity-50">
                Continue
              </button>
            </div>
          </>
        )}
      </BubbleCard>

      {/* Step 3 — Meter */}
      <BubbleCard
        active={step === "meter"}
        done={["testRecord", "save"].includes(step)}
        icon={Volume2}
        what="Speak into the mic — watch the meter"
        why="The green bar moves when audio hits the selected device. If nothing moves while you speak, either the mixer channel is muted, the gain is at zero, or the wrong device is selected."
      >
        {step === "meter" && (
          <>
            <button onClick={() => startMeter(selectedId)}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold">
              Start meter
            </button>
            <div className="mt-3">
              <div className="h-4 border border-border rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${level > 80 ? "bg-destructive" : level > 40 ? "bg-success" : "bg-brand"}`}
                  style={{ width: `${level}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground font-mono">
                Level: {level}%
                {level < 5 && <span className="ml-2 text-warning">— check gain / mute</span>}
                {level > 90 && <span className="ml-2 text-destructive">— reduce gain, clipping</span>}
                {level >= 5 && level <= 90 && <span className="ml-2 text-success">— good signal</span>}
              </div>
            </div>
            <button onClick={() => { stopMeter(); setStep("testRecord"); }}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold mt-3">
              Meter looks good — continue
            </button>
          </>
        )}
      </BubbleCard>

      {/* Step 4 — Test record */}
      <BubbleCard
        active={step === "testRecord"}
        done={step === "save"}
        icon={Play}
        what="Record 3 seconds and play it back"
        why="Live meter proves signal exists, but only playback proves the audio is clean and intelligible — no distortion, no lag, no dropouts."
      >
        {step === "testRecord" && (
          <>
            <button onClick={testRecord}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold">
              Record 3 sec
            </button>
            {recordUrl && (
              <div className="mt-3 space-y-2">
                <audio controls src={recordUrl} className="w-full" />
                <div className="flex gap-2">
                  <button onClick={() => setStep("save")}
                    className="h-9 px-3 text-xs bg-success/10 border border-success text-success rounded-md font-semibold">
                    Sounds clean
                  </button>
                  <button onClick={() => {
                    if (recordUrl) { try { URL.revokeObjectURL(recordUrl); } catch { /* noop */ } }
                    setRecordUrl(null);
                  }}
                    className="h-9 px-3 text-xs border border-border rounded-md">
                    Try again
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </BubbleCard>

      {/* Step 5 — Save */}
      <BubbleCard
        active={step === "save"}
        done={false}
        icon={MicOff}
        what="Save this device as your default"
        why="Next time you open AI Listening, we'll pre-select this device. Volunteers switching devices can override with one click."
      >
        {step === "save" && (
          <>
            <button
              onClick={() => {
                const dev = devices.find((d) => d.deviceId === selectedId);
                if (!dev) return;
                try {
                  localStorage.setItem("ff.audio.preferredLabel", dev.label);
                  localStorage.setItem("ff.audio.preferredDeviceId", dev.deviceId);
                  const saved = JSON.parse(localStorage.getItem("ff.audio.presets") || "[]");
                  saved.push({ label: dev.label, deviceId: dev.deviceId, savedAt: new Date().toISOString() });
                  localStorage.setItem("ff.audio.presets", JSON.stringify(saved));
                } catch { /* ignore */ }
                toast.success(`Saved “${dev.label}”. Setup complete.`);
              }}
              className="h-9 px-3 text-xs bg-foreground text-background rounded-md font-semibold">
              Save & finish
            </button>
          </>
        )}
      </BubbleCard>
    </div>
  );
}

// Reuse the same BubbleCard + Progress pattern
function BubbleCard({ active, done, icon: Icon, what, why, children }: {
  active: boolean; done: boolean; icon: typeof Mic;
  what: string; why: string; children?: React.ReactNode;
}) {
  return (
    <div className={`border rounded-lg p-4 transition-opacity ${done ? "opacity-60" : ""} ${active ? "border-brand shadow-sm" : "border-border"}`}
      style={{ background: active ? "var(--color-card)" : "transparent" }}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-8 h-8 rounded-md border flex items-center justify-center ${active ? "border-brand text-brand" : "border-border text-muted-foreground"}`}>
          {done ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Icon className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{what}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{why}</div>
          {active && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function Progress({ step }: { step: StepKey }) {
  const order: StepKey[] = ["permission", "pickDevice", "meter", "testRecord", "save"];
  const idx = order.indexOf(step);
  return (
    <div className="flex items-center gap-1">
      {order.map((k, i) => (
        <div key={k}
          className={`h-1 flex-1 rounded-full ${i < idx ? "bg-success" : i === idx ? "bg-brand" : "bg-border"}`} />
      ))}
    </div>
  );
}
