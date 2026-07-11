"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { X, Mic, RefreshCw, Play, Square, AlertTriangle, Check, HelpCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStage, AudioStreamState } from "./useAudioStream";

/**
 * Audio Setup + Diagnostics modal.
 *
 * Real device enumeration via navigator.mediaDevices, live level meter,
 * 5-second test recording, and a visible 10-stage pipeline diagnostic
 * that tells the operator EXACTLY where AI Listening breaks — not a
 * silent spinner. Also includes setup guidance for USB mixer / interface
 * / headphone-jack limitations.
 */

type Device = { deviceId: string; label: string; kind: MediaDeviceKind; groupId: string };

const STAGE_LABEL: Record<PipelineStage, string> = {
  idle: "idle",
  requesting_ticket: "1. AI listening clicked · ticket requested",
  ticket_ok: "2. Ticket received",
  opening_ws: "3. Opening WebSocket",
  ws_open: "4. WebSocket open",
  requesting_mic: "5. getUserMedia called",
  mic_granted: "6. Permission granted · stream created",
  audioctx_ready: "7. AudioContext ready",
  worklet_loaded: "8. Audio worklet loaded",
  worklet_connected: "9. Audio frames flowing",
  first_chunk_sent: "10. First frame → server",
  deepgram_ready: "11. Transcription provider connected",
  receiving_interim: "12. Transcript received",
  receiving_final: "13. Transcript rendered in UI",
};

const STAGE_ORDER: PipelineStage[] = [
  "requesting_ticket", "ticket_ok", "opening_ws", "ws_open",
  "requesting_mic", "mic_granted", "audioctx_ready",
  "worklet_loaded", "worklet_connected", "first_chunk_sent",
  "deepgram_ready", "receiving_interim", "receiving_final",
];

export function AudioSetupModal({ open, onClose, audio, listening, onStartListening, onStopListening }: {
  open: boolean;
  onClose: () => void;
  audio: AudioStreamState;
  listening: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [permission, setPermission] = useState<"unknown" | "prompt" | "granted" | "denied">("unknown");
  const [selectedId, setSelectedId] = useState<string>("");
  const [level, setLevel] = useState(0);
  const [clipping, setClipping] = useState(false);
  const [silent, setSilent] = useState(true);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const [testRecording, setTestRecording] = useState<null | Blob>(null);
  const [testRecUrl, setTestRecUrl] = useState<string | null>(null);
  const [recPhase, setRecPhase] = useState<"idle" | "recording" | "done">("idle");
  const [recSeconds, setRecSeconds] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enumerate devices + permission — safe to call even without permission
  const refresh = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) { setPermission("denied"); return; }
      // Query permission where supported
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const status = await (navigator.permissions as any)?.query?.({ name: "microphone" });
        if (status?.state) setPermission(status.state);
      } catch { /* ignore */ }
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter((d) => d.kind === "audioinput");
      setDevices(inputs.map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind, groupId: d.groupId })));
      if (!selectedId && inputs[0]) setSelectedId(inputs[0].deviceId);
    } catch (e) {
      console.warn("[audio-setup] enumerate failed:", e instanceof Error ? e.message : e);
    }
  }, [selectedId]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  // Open the selected device + drive the meter
  const startMeter = useCallback(async () => {
    stopMeter();
    if (!selectedId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedId } as ConstrainDOMString, echoCancellation: false, noiseSuppression: false },
      });
      streamRef.current = stream;
      setPermission("granted");
      // After grant, labels populate — refresh so the picker shows names
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput").map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind, groupId: d.groupId })));

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyserRef.current = analyser;
      src.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        // RMS + peak
        let sumSq = 0, peak = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSq += v * v;
          if (Math.abs(v) > peak) peak = Math.abs(v);
        }
        const rms = Math.sqrt(sumSq / data.length);
        const lvl = Math.min(1, rms * 3);
        setLevel(lvl);
        setClipping(peak > 0.98);
        setSilent(lvl < 0.02);
        if (lvl > 0.02) setLastFrameAt(Date.now());
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      setPermission("denied");
      console.warn("[audio-setup] getUserMedia failed:", e instanceof Error ? e.message : e);
    }
  }, [selectedId]);

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => { /* ignore */ });
    audioCtxRef.current = null;
    setLevel(0); setClipping(false); setSilent(true);
  }, []);

  useEffect(() => {
    if (open && selectedId) startMeter();
    return () => stopMeter();
  }, [open, selectedId, startMeter, stopMeter]);

  // 5-second test recorder
  const startTest = useCallback(() => {
    if (!streamRef.current) return;
    recChunksRef.current = [];
    setTestRecording(null); setTestRecUrl(null); setRecSeconds(0);
    const mr = new MediaRecorder(streamRef.current);
    mediaRecorderRef.current = mr;
    mr.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(recChunksRef.current, { type: "audio/webm" });
      setTestRecording(blob);
      setTestRecUrl(URL.createObjectURL(blob));
      setRecPhase("done");
    };
    mr.start();
    setRecPhase("recording");
    recTimerRef.current = setInterval(() => {
      setRecSeconds((s) => {
        if (s + 1 >= 5) { mr.stop(); if (recTimerRef.current) clearInterval(recTimerRef.current); return 5; }
        return s + 1;
      });
    }, 1000);
  }, []);

  const stopTest = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (recTimerRef.current) clearInterval(recTimerRef.current);
  }, []);

  if (!open) return null;

  const selectedDevice = devices.find((d) => d.deviceId === selectedId);
  const deviceKindGuess = guessDeviceKind(selectedDevice?.label || "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-md overflow-hidden border shadow-2xl"
        style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="h-12 shrink-0 border-b flex items-center justify-between px-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-raised-shell)" }}>
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-[color:var(--color-brand)]" />
            <div className="text-sm font-semibold">Audio Setup &amp; Diagnostics</div>
          </div>
          <button onClick={onClose} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {/* Device selection */}
          <section>
            <SectionHeader label="1 · Input device" />
            <div className="flex items-center gap-2 mb-2">
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
                className="flex-1 h-9 px-3 rounded-md border text-sm bg-[color:var(--color-panel)]"
                style={{ borderColor: "var(--color-border)" }}>
                {devices.length === 0 && <option value="">— no devices — click Refresh —</option>}
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Input · ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
              <button onClick={refresh}
                className="h-9 px-3 rounded-md text-xs font-semibold border inline-flex items-center gap-1.5"
                style={{ borderColor: "var(--color-border)" }}>
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
              <PermissionChip permission={permission} />
            </div>
            {selectedDevice && (
              <div className="text-[10px] text-[color:var(--color-muted-foreground)] font-mono">
                Selected: <span className="text-[color:var(--color-foreground)]">{selectedDevice.label}</span> · type: <span className="text-[color:var(--color-brand)]">{deviceKindGuess}</span>
              </div>
            )}
          </section>

          {/* Meter */}
          <section>
            <SectionHeader label="2 · Live audio meter" />
            <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-raised-shell)" }}>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-3 rounded-sm overflow-hidden border" style={{ borderColor: "var(--color-border)", background: "#0b0b0b" }}>
                  <div className="h-full transition-[width] duration-100"
                    style={{
                      width: `${Math.round(level * 100)}%`,
                      background: clipping ? "var(--color-destructive)" : level > 0.6 ? "var(--color-warning)" : "var(--color-brand)",
                    }} />
                </div>
                <div className="font-mono text-[11px] w-16 text-right">
                  {Math.round(level * 100)}%
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-[color:var(--color-muted-foreground)]">
                <StatusPip label="Signal" ok={!silent} />
                <StatusPip label="Clipping" ok={!clipping} okLabel="clean" alertLabel="clipping" />
                <span className="ml-auto">
                  Last frame: {lastFrameAt ? `${Math.round((Date.now() - lastFrameAt) / 1000)}s ago` : "—"}
                </span>
              </div>
            </div>
          </section>

          {/* Test recording */}
          <section>
            <SectionHeader label="3 · Test tools" />
            <div className="flex items-center gap-2">
              <button onClick={startTest} disabled={recPhase === "recording" || !streamRef.current}
                className="h-9 px-3 rounded-md text-xs font-semibold border inline-flex items-center gap-1.5 disabled:opacity-40"
                style={{ borderColor: "var(--color-border)" }}>
                <Mic className="w-3 h-3" /> Record 5-second test
              </button>
              {recPhase === "recording" && (
                <>
                  <button onClick={stopTest} className="h-9 px-2.5 rounded-md text-xs font-semibold border border-[color:var(--color-destructive)] text-[color:var(--color-destructive)] inline-flex items-center gap-1">
                    <Square className="w-3 h-3" /> Stop
                  </button>
                  <span className="font-mono text-[11px] text-[color:var(--color-warning)]">Recording · {recSeconds}s / 5s</span>
                </>
              )}
              {recPhase === "done" && testRecUrl && (
                <>
                  <audio src={testRecUrl} controls className="h-8" />
                  <button onClick={() => { setRecPhase("idle"); setTestRecording(null); setTestRecUrl(null); }}
                    className="text-[10px] text-[color:var(--color-muted-foreground)] underline">
                    Discard
                  </button>
                </>
              )}
            </div>
            <div className="text-[10px] text-[color:var(--color-muted-foreground)] mt-2">
              Speak: <em>"Testing PresentFlow audio input, one two three."</em> Then play it back to confirm the mic is capturing.
            </div>
          </section>

          {/* Pipeline diagnostics */}
          <section>
            <SectionHeader label="4 · Pipeline diagnostics" />
            <div className="rounded-md border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
              <div className="px-3 py-2 border-b flex items-center gap-2"
                style={{ borderColor: "var(--color-border)", background: "var(--color-raised-shell)" }}>
                <span className="text-xs font-semibold">AI Listening pipeline</span>
                <span className="text-[10px] font-mono text-[color:var(--color-muted-foreground)]">
                  · chunks sent {audio.chunksSent} · DG msgs {audio.dgMessagesReceived}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {audio.error && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[color:var(--color-destructive)]">
                      <AlertTriangle className="w-3 h-3" /> {audio.error}
                    </span>
                  )}
                  <button
                    onClick={listening ? onStopListening : onStartListening}
                    className={cn(
                      "h-7 px-2.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors",
                      listening
                        ? "border border-[color:var(--color-destructive)] text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive)]/10"
                        : "bg-[color:var(--color-brand)] text-[color:var(--color-app-bg)] hover:opacity-90",
                    )}>
                    {listening ? "Stop listening" : "Start listening"}
                  </button>
                </div>
              </div>
              <ul className="p-3 space-y-1 font-mono text-[11px]">
                {STAGE_ORDER.map((stage) => {
                  const idx = STAGE_ORDER.indexOf(audio.stage);
                  const stageIdx = STAGE_ORDER.indexOf(stage);
                  const reached = stageIdx <= idx && idx >= 0;
                  const isCurrent = stage === audio.stage;
                  return (
                    <li key={stage} className={cn(
                      "flex items-center gap-2 transition-colors",
                      reached ? "text-[color:var(--color-success)]" : "text-[color:var(--color-muted-foreground)]",
                      isCurrent && "font-bold",
                    )}>
                      {reached ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border" style={{ borderColor: "currentColor" }} />}
                      {STAGE_LABEL[stage]}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* Setup guidance */}
          <section>
            <SectionHeader label="5 · Setup guidance" />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <GuidanceCard title="Laptop microphone" body="Built-in mic captures room noise + PA reverb. Good enough for a small setting; expect lower accuracy in a large sanctuary." />
              <GuidanceCard title="USB microphone" body="A dedicated USB mic pointed at the pastor gives the biggest accuracy jump. Blue Yeti / Samson Q2U class works well." />
              <GuidanceCard title="USB audio interface" body="Focusrite Scarlett / Behringer UM2 etc. — take a mixer send into the interface, then select the interface as input here." />
              <GuidanceCard title="Mixer USB output" body="Most modern mixers (Behringer XR-series, Yamaha MG-U, Allen &amp; Heath ZED) expose a stereo USB out. Feed that in — cleanest option for a live house sound." />
              <GuidanceCard title="Capture card audio" body="If your sound goes through a video capture card (Elgato etc.), select its virtual input here." />
              <GuidanceCard title="Virtual audio device" body="BlackHole / Loopback / VB-Audio bridge audio between apps. Route your program mix into one of these, select it here." />
              <GuidanceCard title="Headphone jack ≠ line in" body="Most modern laptop headphone jacks are output-only (or TRRS combo, mic-only). If nothing appears in the picker after granting permission, use one of the USB paths above." />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function guessDeviceKind(label: string): string {
  const s = label.toLowerCase();
  if (/mixer|xr\d|xr\s|q\s?ub|scarlett|behringer|yamaha mg|allen.*heath|zed|mg-u/i.test(s)) return "USB mixer / interface";
  if (/loopback|blackhole|vb.*audio|voicemeeter|virtual/i.test(s)) return "Virtual audio device";
  if (/capture|elgato|hd60|magewell/i.test(s)) return "Capture card";
  if (/usb|yeti|q2u|samson|blue|snowball|rode/i.test(s)) return "USB microphone";
  if (/built.?in|internal|macbook|imac/i.test(s)) return "Built-in microphone";
  return "Unknown";
}

function SectionHeader({ label }: { label: string }) {
  return <div className="eyebrow mb-2 text-[color:var(--color-brand)]">{label}</div>;
}

function PermissionChip({ permission }: { permission: string }) {
  const isGranted = permission === "granted";
  const isDenied = permission === "denied";
  return (
    <span className={cn(
      "text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border",
      isGranted && "border-[color:var(--color-success)]/50 text-[color:var(--color-success)] bg-[color:var(--color-success)]/10",
      isDenied && "border-[color:var(--color-destructive)]/50 text-[color:var(--color-destructive)] bg-[color:var(--color-destructive)]/10",
      !isGranted && !isDenied && "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]",
    )}>
      Mic: {permission}
    </span>
  );
}

function StatusPip({ label, ok, okLabel = "ok", alertLabel = "silent" }: { label: string; ok: boolean; okLabel?: string; alertLabel?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ok ? "var(--color-success)" : "var(--color-warning)" }} />
      {label}: <span className="text-[color:var(--color-foreground)] uppercase">{ok ? okLabel : alertLabel}</span>
    </span>
  );
}

function GuidanceCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border p-2.5" style={{ borderColor: "var(--color-border)" }}>
      <div className="text-xs font-semibold flex items-center gap-1.5 mb-0.5">
        <Info className="w-3 h-3 text-[color:var(--color-brand)]" /> {title}
      </div>
      <p className="text-[11px] text-[color:var(--color-muted-foreground)] leading-relaxed">{body}</p>
    </div>
  );
}
