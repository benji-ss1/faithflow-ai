"use client";
// Phase 2a — Live Video Input configuration, mounted in the Hardware panel
// (bottom-left) next to Audio and Screens. Enumerates UVC video devices
// (webcams, USB-HDMI capture cards) via getUserMedia/enumerateDevices, previews
// the selected device, and activates it as the output background. The selection
// is persisted (localStorage) and broadcast same-machine via
// `presentflow:video-input-changed` — OperatorConsole listens and emits it on
// OutputState so the projector/livestream open the feed. Professional
// SDI/NDI/Syphon sources are a later native increment behind the same wire.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Video, RefreshCw, Play, Square, FlipHorizontal2 } from "lucide-react";
import type { VideoInputState } from "@/lib/broadcast";
import { DropdownDisclosure } from "../DropdownDisclosure";
import { shellSupportsCamera } from "@/lib/electron-version";

const LS_KEY = "presentflow.videoInput.v1";
// One-time flag: correct the old "lower-third" overlay default (which hid lyrics
// in the bottom 38% over a camera) to full-screen, ONCE, for operators who
// already have lower-third persisted. Set after the migration runs so a later
// deliberate re-pick of lower-third is respected.
const OVERLAY_MIGRATED_KEY = "presentflow.videoInput.overlayMigrated";
type Persisted = VideoInputState & { active?: boolean };

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    return p && typeof p.deviceId === "string" ? p : null;
  } catch { return null; }
}
function savePersisted(p: Persisted | null) {
  try { p ? localStorage.setItem(LS_KEY, JSON.stringify(p)) : localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
function emit(state: VideoInputState | null) {
  window.dispatchEvent(new CustomEvent("presentflow:video-input-changed", { detail: { videoInput: state } }));
}

export function VideoInputPanel() {
  // Gate on shell support: on an older shell (no camera entitlement/usage
  // string) calling getUserMedia would crash the app, so we never enumerate or
  // preview there — show an update prompt instead. null = still checking.
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => { let m = true; void shellSupportsCamera().then((s) => { if (m) setSupported(s); }); return () => { m = false; }; }, []);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [fit, setFit] = useState<NonNullable<VideoInputState["fit"]>>("cover");
  const [mirror, setMirror] = useState(false);
  // Default to FULL-screen lyrics over the camera (sanctuary projection). The
  // old "lower-third" default confined verses/lyrics to the bottom 38% band, which
  // churches projecting words over a camera read as "lyrics not showing". Operators
  // who want a broadcast lower-third can still pick it from the Overlay dropdown.
  const [overlay, setOverlay] = useState<NonNullable<VideoInputState["overlay"]>>("full");
  // Vertical placement of the lyrics over the camera (full-screen overlay only).
  const [lyricsPos, setLyricsPos] = useState<NonNullable<VideoInputState["lyricsPos"]>>("center");
  const [active, setActive] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "on" | "error">("idle");
  const [showObsHelp, setShowObsHelp] = useState(false);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) { setNeedsPermission(false); setDevices([]); return; }
      const all = await navigator.mediaDevices.enumerateDevices();
      const vids = all.filter((d) => d.kind === "videoinput");
      setDevices(vids);
      // Labels are empty until camera permission is granted at least once.
      setNeedsPermission(vids.length > 0 && vids.every((d) => !d.label));
    } catch { /* ignore */ }
  }, []);

  // Restore persisted selection + config; enumerate; watch for hot-plug.
  useEffect(() => {
    const p = loadPersisted();
    if (p) {
      setSelectedId(p.deviceId);
      if (p.fit) setFit(p.fit);
      if (typeof p.mirror === "boolean") setMirror(p.mirror);
      // One-time overlay migration (see OVERLAY_MIGRATED_KEY): flip a persisted
      // "lower-third" to full-screen once and re-persist so it sticks; respect a
      // deliberate lower-third afterwards.
      let overlayToUse = p.overlay;
      try {
        if (overlayToUse === "lower-third" && !localStorage.getItem(OVERLAY_MIGRATED_KEY)) {
          overlayToUse = "full";
          localStorage.setItem(OVERLAY_MIGRATED_KEY, "1");
          savePersisted({ ...p, overlay: "full" });
        }
      } catch { /* ignore */ }
      if (overlayToUse) setOverlay(overlayToUse);
      if (p.lyricsPos) setLyricsPos(p.lyricsPos);
      setActive(!!p.active);
    }
    void refresh();
    const onChange = () => void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, [refresh]);

  // Default the selection to the first device once we have labels.
  useEffect(() => {
    if (!selectedId && devices.length > 0) setSelectedId(devices[0].deviceId);
  }, [devices, selectedId]);

  // Operator preview of the selected device. Paused while LIVE so the projector
  // gets exclusive access to the device — many USB-HDMI capture cards are
  // single-reader and a second open would make the projector fail.
  useEffect(() => {
    let cancelled = false;
    const stop = () => { previewStreamRef.current?.getTracks().forEach((t) => t.stop()); previewStreamRef.current = null; };
    if (supported !== true) { stop(); return; } // never touch the camera on an unsupported shell
    if (active) { stop(); setPreviewStatus("idle"); return; } // live → projector owns the device
    if (!selectedId) { stop(); setPreviewStatus("idle"); return; }
    setPreviewStatus("loading");
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { ideal: selectedId } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        stop();
        previewStreamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
        setPreviewStatus("on");
        void refresh(); // labels are available now
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") setNeedsPermission(true);
        setPreviewStatus("error");
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [selectedId, active, refresh, supported]);

  const selectedLabel = devices.find((d) => d.deviceId === selectedId)?.label || "Camera";

  const persistAndMaybeEmit = useCallback((nextActive: boolean) => {
    const state: VideoInputState = { deviceId: selectedId, label: selectedLabel, fit, mirror, overlay, lyricsPos };
    savePersisted({ ...state, active: nextActive });
    emit(nextActive ? state : null);
  }, [selectedId, selectedLabel, fit, mirror, overlay, lyricsPos]);

  // Re-emit live when the device OR a config knob changes WHILE active, so
  // switching camera mid-service actually updates the projector (not just the
  // preview). `selectedId` MUST be a dep — without it, a device switch was
  // silently dropped and the projector kept the old camera.
  useEffect(() => {
    if (active && selectedId) {
      const state: VideoInputState = { deviceId: selectedId, label: selectedLabel, fit, mirror, overlay, lyricsPos };
      savePersisted({ ...state, active: true });
      emit(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, fit, mirror, overlay, lyricsPos]);

  const activate = () => {
    if (!selectedId) { toast.error("Select a camera first"); return; }
    setActive(true);
    persistAndMaybeEmit(true);
    toast.success(`Video input live — ${selectedLabel}`);
  };
  const clear = () => {
    setActive(false);
    persistAndMaybeEmit(false);
    toast.success("Video input cleared");
  };

  if (supported !== true) {
    return (
      <div className="flex flex-col gap-4">
        <div className="eyebrow flex items-center gap-1.5"><Video className="w-3 h-3" /> Video Input</div>
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--color-brand)]/12 text-[var(--color-brand)] shadow-[var(--edge-top)]">
            <Video className="w-6 h-6" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-foreground)]">
            {supported === null ? "Checking video support…" : "Update required"}
          </div>
          <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed max-w-[260px]">
            {supported === null
              ? "Confirming this build can access cameras and capture cards."
              : "Live Video Input needs the latest PresentFlow update. It'll install automatically the next time you relaunch the app — then reopen this panel to pick a camera."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="eyebrow flex items-center gap-1.5"><Video className="w-3 h-3" /> Video Input</div>
        <button onClick={() => void refresh()} title="Refresh devices" className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] p-1">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {needsPermission && (
        <button
          onClick={() => { setSelectedId((id) => id || devices[0]?.deviceId || ""); void refresh(); }}
          className="text-[11px] rounded-md border border-[var(--color-border)] px-2 py-1.5 text-left hover:bg-white/5"
        >
          Camera access needed — click a camera to grant it, or enable it in System Settings › Privacy & Security › Camera.
        </button>
      )}

      {/* Device list */}
      {devices.length === 0 ? (
        <div className="text-[11px] text-[var(--color-muted-foreground)] italic py-2">No video devices detected. Connect a camera or capture card, then Refresh.</div>
      ) : (
        <DropdownDisclosure
          selectedId={selectedId}
          onSelect={setSelectedId}
          triggerClassName="w-full justify-between"
          panelWidth={280}
          items={devices.map((d, i) => ({ id: d.deviceId, name: d.label || `Camera ${i + 1}` }))}
        />
      )}

      {/* Preview */}
      <div className="relative w-full rounded-md overflow-hidden border border-[var(--color-border)] bg-black" style={{ aspectRatio: "16 / 9" }}>
        <video ref={previewRef} autoPlay playsInline muted
          style={{ width: "100%", height: "100%", objectFit: fit === "contain" ? "contain" : fit === "fill" ? "fill" : "cover", transform: mirror ? "scaleX(-1)" : undefined, display: previewStatus === "on" ? "block" : "none" }} />
        {previewStatus !== "on" && (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-white/50 text-[11px]">
            {active ? "Live on the projector — preview paused to free the camera."
              : previewStatus === "loading" ? "Starting preview…"
              : previewStatus === "error" ? "No signal / access denied"
              : "Select a camera"}
          </div>
        )}
        {active && <span className="absolute top-1.5 left-1.5 text-[9px] font-bold uppercase tracking-wider text-red-100 bg-red-600/80 px-1.5 py-0.5 rounded-sm">● Live</span>}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 text-[11px]">
        <label className="text-[var(--color-muted-foreground)]">Overlay</label>
        <div className="flex-1">
          <DropdownDisclosure
            selectedId={overlay}
            onSelect={(v) => setOverlay(v as typeof overlay)}
            triggerClassName="w-full justify-between"
            panelWidth={200}
            items={[{ id: "lower-third", name: "Lower third" }, { id: "full", name: "Full screen" }]}
          />
        </div>
      </div>
      {overlay === "full" && (
        <div className="flex items-center gap-2 text-[11px]">
          <label className="text-[var(--color-muted-foreground)]">Position</label>
          <div className="flex-1">
            <DropdownDisclosure
              selectedId={lyricsPos}
              onSelect={(v) => setLyricsPos(v as typeof lyricsPos)}
              triggerClassName="w-full justify-between"
              panelWidth={200}
              items={[{ id: "top", name: "Top" }, { id: "center", name: "Centre" }, { id: "bottom", name: "Bottom" }]}
            />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        <label className="text-[var(--color-muted-foreground)]">Fit</label>
        <div className="flex-1">
          <DropdownDisclosure
            selectedId={fit}
            onSelect={(v) => setFit(v as typeof fit)}
            triggerClassName="w-full justify-between"
            panelWidth={210}
            items={[{ id: "cover", name: "Fill frame (crop)" }, { id: "contain", name: "Fit (letterbox)" }, { id: "fill", name: "Stretch" }]}
          />
        </div>
        <button onClick={() => setMirror((m) => !m)} title="Mirror" className={`h-7 w-7 rounded-md border inline-flex items-center justify-center ${mirror ? "border-[var(--color-brand)] text-[var(--color-brand)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"}`}>
          <FlipHorizontal2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Activate / Clear */}
      <div className="flex items-center gap-2">
        {!active ? (
          <button onClick={activate} disabled={!selectedId} className="flex-1 h-8 rounded-md bg-[var(--color-brand)] text-black text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40">
            <Play className="w-3.5 h-3.5" /> Activate
          </button>
        ) : (
          <button onClick={clear} className="flex-1 h-8 rounded-md border border-red-500/60 text-red-300 text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-red-500/10">
            <Square className="w-3.5 h-3.5" /> Clear video
          </button>
        )}
      </div>
      <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed">
        The live feed appears behind lyrics/Bible on the projector &amp; livestream. It stays running while you change slides. Clear removes the video without touching the current slide.
      </p>

      {/* In-app OBS guidance (both paths). Desktop couldn't previously find any
          OBS setup help; this puts it in the Video Input panel where operators
          working with a camera actually are. Full runbook: docs/OBS_OVERLAY_SETUP.md. */}
      <button
        type="button"
        onClick={() => setShowObsHelp((v) => !v)}
        className="w-full text-left text-[10px] font-semibold text-[var(--color-foreground)] hover:text-[var(--color-brand)] flex items-center gap-1"
        aria-expanded={showObsHelp}
      >
        <span className="inline-block w-2 text-[var(--color-muted-foreground)]">{showObsHelp ? "▾" : "▸"}</span>
        Stream this to OBS?
      </button>
      {showObsHelp && (
        <div className="space-y-2 text-[10px] text-[var(--color-muted-foreground)] leading-relaxed pl-1">
          <div>
            <div className="font-semibold text-[var(--color-foreground)]">Camera in PresentFlow (simplest)</div>
            Pick your camera above and Activate. In OBS: Sources &rarr; add <span className="text-[var(--color-foreground)]">macOS Screen Capture</span> (or Window Capture) &rarr; choose the PresentFlow output window. The camera and lyrics are already combined &mdash; nothing else to set up.
          </div>
          <div>
            <div className="font-semibold text-[var(--color-foreground)]">Camera in OBS instead</div>
            Keep the camera in OBS and let PresentFlow send just the words: go to <span className="text-[var(--color-foreground)]">Hardware &rarr; Screens</span>, set a screen&#39;s role to <span className="text-[var(--color-foreground)]">Livestream</span> (OBS mode), spawn it, and add that window in OBS above your camera. For a second computer, use the OBS overlay link from Sync&nbsp;devices.
          </div>
          <div className="text-[var(--color-brand)]">Tip: test before the service &mdash; project a slide and confirm it shows in OBS.</div>
        </div>
      )}
    </div>
  );
}
