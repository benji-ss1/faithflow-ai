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
 *
 * 2026-07-27 — Added per-channel USB mixer picker. When a multi-channel
 * device is selected, an inline live-meter channel grid lets the operator
 * click the exact channel carrying the pastor's vocal. Preserves the
 * v0.1.77 sum-all fallback (default) so nothing regresses for users who
 * don't pick a channel. All device categorization + capability probes
 * now come from `src/lib/audio/deviceCategorization.ts` (single source
 * of truth) instead of duplicated inline regexes.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, ChevronRight, Plus, RefreshCcw, Stethoscope, Wand2 } from "lucide-react";
import { AudioDiagnosticsScan } from "@/components/operator/AudioDiagnosticsScan";
import { VocalChannelAutoDetectModal } from "@/components/operator/VocalChannelAutoDetectModal";
import {
  categorizeDevice,
  categoryRank,
  getDeviceCapabilities,
  isBluetoothDevice,
  isMixerDevice,
  isNdiDevice,
} from "@/lib/audio/deviceCategorization";
import {
  openMultiChannelCapture,
  type ChannelLevels,
  type MultiChannelCapture,
} from "@/lib/audio/multiChannelCapture";
import {
  clearDeviceChannelPref,
  migratePrefDeviceId,
  readDeviceChannelPref,
  readDeviceChannelPrefByLabel,
  writeDeviceChannelPref,
  type DeviceChannelMode,
} from "@/lib/audio/deviceChannelPrefs";
import { findGuideForDevice } from "@/lib/audio/mixerSetupGuides";
// Custom vocabulary quick-add (2026-07-27) — Deepgram keyterm boosting for
// names/song titles the AI keeps mishearing. Full management in Settings.
import { addVocabularyTerm, MAX_VOCABULARY_TERMS, readVocabulary, VOCABULARY_CHANGED_EVENT } from "@/lib/audio/customVocabulary";
// Wave 2 (2026-07-27) — capture-mode toggle + native device store.
import {
  readCaptureMode,
  writeCaptureMode,
  resolveEffectiveMode,
  CAPTURE_MODE_CHANGED_EVENT,
  type CaptureMode,
} from "@/lib/audio/captureMode";
import {
  readNativeDevicePref,
  writeNativeDevicePref,
  clearNativeDevicePref,
  type NativeDeviceMode,
} from "@/lib/audio/nativeDeviceStore";
// Unified native input system (2026-07-27) — rank/sort/auto-pick helpers.
import {
  autoPickReason,
  compareNativeDevices,
  pickBestNativeDevice,
  rankNativeDevice,
  tagForRank,
} from "@/lib/audio/inputRanking";
// "Follow Mac system input" (2026-07-27) — resolve macOS's system-default
// input by name and match it against the native ffmpeg device list.
import {
  getSystemDefaultInputName,
  matchNativeDeviceByName,
} from "@/lib/audio/systemDefaultInput";

type NativeDeviceInfo = {
  index: number;
  name: string;
  platform: "darwin" | "win32" | "linux";
  channelCount?: number;
  sampleRate?: number;
  // "ndi" for network sources received via the Swift helper's NDI receiver;
  // "usb"/"builtin"/… for CoreAudio devices. NDI sources are also named
  // "NDI: <source>", so the existing name-based categorization already badges
  // them; this field is carried through for future transport-authoritative use.
  transport?: string;
};

const AUDIO_INPUT_KEY = "presentflow.pro.audioInput.v1";
const AUDIO_SOURCE_TYPE_KEY = "presentflow.pro.audioSourceType.v1";

type AudioInputSel = { kind: "device"; id: string; label: string };

// Local channel-grid state — mode/channel/gain that mirrors the pref file
// but is held in React state so slider drags feel instant.
type GridMode = "sum-all" | "mono" | "stereo";

// Typed accessor for the native ffmpeg bridge (undefined on web / non-Electron).
type NativeAudioBridge = {
  isAvailable: () => Promise<boolean>;
  listDevices: () => Promise<NativeDeviceInfo[]>;
  startChannelProbe: (o: { deviceIndex: number; channelCount: number }) => Promise<{ ok: boolean; error?: string }>;
  stopChannelProbe: () => Promise<void>;
  onChannelLevels: (cb: (levels: Array<{ channel: number; rms: number; db: number; peak: number }>) => void) => () => void;
};

function getNativeAudioApi(): NativeAudioBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { electronAPI?: { audio?: { native?: NativeAudioBridge } } })
    .electronAPI?.audio?.native;
}

export function AudioTab() {
  const [selected, setSelected] = useState<AudioInputSel | null>(null);
  const [sourceType, setSourceType] = useState<"mixer" | "microphone">("mixer");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [diagOpen, setDiagOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Custom vocabulary quick-add — count kept in sync via the changed event
  // (the settings page may add/remove terms while this popover is mounted).
  const [vocabCount, setVocabCount] = useState(0);
  const [vocabTerm, setVocabTerm] = useState("");
  useEffect(() => {
    setVocabCount(readVocabulary().length);
    const onChanged = () => setVocabCount(readVocabulary().length);
    window.addEventListener(VOCABULARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(VOCABULARY_CHANGED_EVENT, onChanged);
  }, []);
  const addVocab = () => {
    if (!vocabTerm.trim()) return;
    const next = addVocabularyTerm(vocabTerm);
    setVocabCount(next.length);
    setVocabTerm("");
    toast.success("Added — applies when the listener restarts");
  };

  // Wave 2 — capture-mode toggle state.
  const [captureMode, setCaptureMode] = useState<CaptureMode>("auto");
  const [effectiveMode, setEffectiveMode] = useState<"native" | "browser">("browser");
  // Native-mode device list + selected pick.
  const [nativeDevices, setNativeDevices] = useState<NativeDeviceInfo[]>([]);
  const [nativeSelected, setNativeSelected] = useState<NativeDeviceInfo | null>(null);
  const [nativeGridMode, setNativeGridMode] = useState<NativeDeviceMode>("sum-all");
  const [nativeSelectedChannels, setNativeSelectedChannels] = useState<number[]>([]);
  const [nativeChannelLevels, setNativeChannelLevels] = useState<Array<{ channel: number; rms: number; db: number; peak: number }>>([]);
  // Unified native input system — auto-pick + inline channel auto-detect.
  const [autoPickedIndex, setAutoPickedIndex] = useState<number | null>(null);
  // "Follow Mac system input" — pinned mode at the top of the native list.
  const [followActive, setFollowActive] = useState(false);
  // Currently-resolved system-default device name (native-matched when
  // possible, raw system name otherwise, null when unresolvable).
  const [followResolvedName, setFollowResolvedName] = useState<string | null>(null);
  const [nativeGuideOpen, setNativeGuideOpen] = useState(false);
  const [isDesktopShell, setIsDesktopShell] = useState(false);
  const [detectState, setDetectState] = useState<"idle" | "running" | "done">("idle");
  const [detectProgress, setDetectProgress] = useState(0); // 0..1
  const [detectResult, setDetectResult] = useState<{
    winner: number | null;
    stats: Array<{ channel: number; avgRms: number; activeFrac: number }>;
  } | null>(null);
  const detectSamplesRef = useRef<Array<Array<{ channel: number; rms: number }>>>([]);
  const detectCleanupRef = useRef<(() => void) | null>(null);

  const nativeProbeUnsubRef = useRef<(() => void) | null>(null);
  // True only while THIS instance owns the running channel probe — dual
  // mounts (HardwarePanel + popover) must never stop each other's probe.
  const startedProbeRef = useRef(false);

  // Channel-grid state
  const [channelCount, setChannelCount] = useState<number>(1);
  const [capsProbed, setCapsProbed] = useState(false);
  const [gridMode, setGridMode] = useState<GridMode>("sum-all");
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [gainDb, setGainDb] = useState<number>(0);
  const [levels, setLevels] = useState<ChannelLevels[]>([]);
  const [activeMap, setActiveMap] = useState<boolean[]>([]);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [autoDetectOpen, setAutoDetectOpen] = useState(false);

  // Refs for the multi-channel capture & polling — refs (not state) so we
  // don't churn renders on capture handle changes.
  const captureRef = useRef<MultiChannelCapture | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActiveRef = useRef<number[]>([]);

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
    // Wave 2 — capture mode hydration + effective-mode resolve.
    const mode = readCaptureMode();
    setCaptureMode(mode);
    void resolveEffectiveMode(mode).then(setEffectiveMode).catch(() => setEffectiveMode("browser"));
    const onModeChanged = () => {
      const m = readCaptureMode();
      setCaptureMode(m);
      void resolveEffectiveMode(m).then(setEffectiveMode).catch(() => setEffectiveMode("browser"));
    };
    window.addEventListener(CAPTURE_MODE_CHANGED_EVENT, onModeChanged);
    // Hydrate native pref (may not exist yet).
    const np = readNativeDevicePref();
    if (np) {
      setNativeSelected({ index: np.index, name: np.name, platform: (typeof navigator !== "undefined" && /win/i.test(navigator.platform)) ? "win32" : "darwin" });
      setNativeGridMode(np.mode ?? "sum-all");
      setNativeSelectedChannels(np.selectedChannels ?? []);
      setFollowActive(!!np.followSystemDefault);
    }
    refreshDevices();
    // Fire an initial native devices probe (no-op if API missing).
    void refreshNativeDevices();
    // Desktop-shell detection (drives the "browser settings are web-only"
    // hint). Done post-mount to stay SSR-safe.
    setIsDesktopShell(!!getNativeAudioApi());
    const cleanupExtra = () => window.removeEventListener(CAPTURE_MODE_CHANGED_EVENT, onModeChanged);
    // 🔴 Stress fix — refresh the picker device list when the OS reports a
    // hardware change (USB plug/unplug, Bluetooth connect). Without this,
    // an operator with the popover open sees a stale list and has to click
    // Refresh manually.
    if (navigator.mediaDevices?.addEventListener) {
      const handler = () => refreshDevices();
      navigator.mediaDevices.addEventListener("devicechange", handler);
      return () => {
        try { navigator.mediaDevices.removeEventListener("devicechange", handler); } catch { /* noop */ }
        cleanupExtra();
      };
    }
    return cleanupExtra;
  }, []);

  // When device changes: probe capabilities + hydrate pref state.
  useEffect(() => {
    setCapsProbed(false);
    setChannelCount(1);
    setLevels([]);
    setActiveMap([]);
    // 6c — reset the activity-time ring so stale 32-channel timestamps
    // from a prior device don't leak into a fresh 2-channel device.
    lastActiveRef.current = [];
    setCaptureError(null);
    if (!selected) {
      setGridMode("sum-all");
      setSelectedChannels([]);
      setGainDb(0);
      return;
    }
    // 2026-07-27 JPD field fix — if the operator picked a device we recognize
    // as a mixer (Allen & Heath SQ, X32, Yamaha TF, StudioLive, etc.) BUT
    // Source Type is stuck on "microphone", auto-switch to "mixer". "microphone"
    // mode forces Chromium DSP ON + channelCount:1, which for a 32-ch USB
    // mixer feed = silence (channel 1 usually isn't the vocal bus) + the DSP
    // gates whatever does come through. This was the exact failure at JPD.
    if (isMixerDevice(selected.label) && sourceType === "microphone") {
      persistSourceType("mixer");
      toast.success(`${selected.label.replace(/^Default - /, "")} looks like a mixer — switched Source Type to Mixer / Interface`);
    }
    // Stale-code audit fix (2026-07-27) — do NOT open a getUserMedia probe
    // while native (ffmpeg) capture may hold the same CoreAudio device.
    // The probe grabs the device briefly and can trigger the exact
    // device-busy conflict the native path defends against. In native
    // mode the browser channel grid is hidden anyway — skip the probe.
    if (effectiveMode === "native") return;
    let cancelled = false;
    (async () => {
      const caps = await getDeviceCapabilities(selected.id);
      if (cancelled) return;
      const ch = caps?.channelCount ?? 1;
      setChannelCount(ch);
      setCapsProbed(true);
      // Hydrate stored pref: first by deviceId, then fall back to label
      // (mixer USB power-cycled → new deviceId, same friendly label).
      let pref = readDeviceChannelPref(selected.id);
      if (!pref && selected.label) {
        const byLabel = readDeviceChannelPrefByLabel(selected.label);
        if (byLabel && byLabel.deviceId !== selected.id) {
          const migrated = migratePrefDeviceId(byLabel.deviceId, selected.id);
          if (migrated) {
            pref = migrated;
            toast.success(`Restored channel pref for ${selected.label}`);
          }
        }
      }
      if (pref) {
        setGridMode(pref.mode as GridMode);
        setSelectedChannels(pref.selectedChannels);
        setGainDb(pref.gainDb);
      } else {
        setGridMode("sum-all");
        setSelectedChannels([]);
        setGainDb(0);
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id, effectiveMode]);

  // Open/close multi-channel capture based on: popover open + device selected
  // + more than 1 channel. Poll levels at 20fps (100ms).
  useEffect(() => {
    // Tear down any prior capture first
    const teardown = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (captureRef.current) {
        try { captureRef.current.close(); } catch { /* noop */ }
        captureRef.current = null;
      }
    };

    // 6d — only open the multi-channel capture when the channel grid will
    // actually render. Opening a 32-analyser graph every time the operator
    // pops open the audio menu (e.g. just to check device names) burns CPU
    // for zero UI benefit.
    // Native-mode guard (stale-code audit) — never open a browser-side
    // Web Audio capture while ffmpeg may hold the device.
    if (effectiveMode === "native" || !pickerOpen || !selected || !capsProbed || channelCount <= 1) {
      teardown();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const cap = await openMultiChannelCapture({ deviceId: selected.id, requestedChannels: Math.max(2, channelCount) });
        if (cancelled) { try { cap.close(); } catch {} return; }
        captureRef.current = cap;
        setCaptureError(null);
        pollRef.current = setInterval(() => {
          if (!captureRef.current) return;
          try {
            const l = captureRef.current.readLevels();
            setLevels(l);
            // Simple "active in last 200ms" heuristic: mark active if rms > 0.02.
            // We keep a small ring in lastActiveRef so it debounces across two 100ms polls.
            const now = Date.now();
            const active: boolean[] = new Array(l.length);
            const prev = lastActiveRef.current;
            for (let i = 0; i < l.length; i += 1) {
              const isHot = l[i]!.rms > 0.02;
              if (isHot) prev[i] = now;
              active[i] = (prev[i] ?? 0) > now - 200;
            }
            setActiveMap(active);
          } catch { /* noop */ }
        }, 100);
      } catch (err) {
        if (cancelled) return;
        setCaptureError(err instanceof Error ? err.message : "capture failed");
      }
    })();

    return () => { cancelled = true; teardown(); };
  }, [pickerOpen, selected?.id, capsProbed, channelCount, effectiveMode]);

  // Tear down on component unmount as a safety net (in case popover closes
  // via unmount rather than the open flag).
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (captureRef.current) { try { captureRef.current.close(); } catch {} }
    };
  }, []);

  function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((all) => {
      setDevices(all.filter((d) => d.kind === "audioinput"));
    }).catch(() => { /* noop */ });
  }

  async function refreshNativeDevices() {
    const list = getNativeAudioApi()?.listDevices;
    if (typeof list !== "function") return;
    try {
      const devs = await list();
      setNativeDevices(devs);
    } catch { /* noop */ }
  }

  // --- "Follow Mac system input" resolution ------------------------------
  // Resolve what macOS System Settings → Sound → Input currently points at
  // (via Chromium's "Default - <name>" enumerateDevices entry), match it
  // against the native ffmpeg list, and keep the subtitle fresh on
  // devicechange. Native mode only.
  useEffect(() => {
    if (effectiveMode !== "native") return;
    let cancelled = false;
    const resolve = async () => {
      const sys = await getSystemDefaultInputName();
      if (cancelled) return;
      if (!sys) { setFollowResolvedName(null); return; }
      const match = matchNativeDeviceByName(sys, nativeDevices);
      setFollowResolvedName(match ? match.name : sys);
    };
    void resolve();
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    const onChange = () => { void resolve(); };
    md?.addEventListener?.("devicechange", onChange);
    return () => {
      cancelled = true;
      md?.removeEventListener?.("devicechange", onChange);
    };
  }, [effectiveMode, nativeDevices]);

  async function enableFollowSystemDefault() {
    const sys = await getSystemDefaultInputName();
    const match = sys ? matchNativeDeviceByName(sys, nativeDevices) : null;
    // Cache fields: matched device when possible, else the current pick,
    // else the first listed device — the capture path re-resolves live
    // anyway; the cache is only the no-match fallback.
    const cache = match
      ?? (nativeSelected ? { index: nativeSelected.index, name: nativeSelected.name } : null)
      ?? (nativeDevices[0] ? { index: nativeDevices[0].index, name: nativeDevices[0].name } : null);
    if (!cache) {
      toast.error("No native input devices available to follow");
      return;
    }
    setFollowActive(true);
    setAutoPickedIndex(null);
    setNativeSelected(
      nativeDevices.find((d) => d.index === cache.index)
        ?? { index: cache.index, name: cache.name, platform: "darwin" },
    );
    setNativeGridMode("sum-all");
    setNativeSelectedChannels([]);
    // writeNativeDevicePref dispatches presentflow:native-audio-input-changed
    // so the pipeline rebuilds onto the resolved device.
    writeNativeDevicePref({
      followSystemDefault: true,
      index: cache.index,
      name: cache.name,
      mode: "sum-all",
      selectedChannels: [],
      gainDb: 0,
    });
    toast.success(`Following Mac system input — currently ${match?.name ?? sys ?? cache.name}`);
  }

  // --- Auto-pick on launch (unified native input system) -----------------
  // When native capture is the effective mode and the operator has NEVER
  // picked a native device (no stored pref), auto-select the best-ranked
  // device (mixer > NDI > virtual > mic > BT) so a fresh install at a
  // church lands on the SQ/X32 with zero clicks. 2026-07-27 follow-mode
  // refinement: if the Mac's OWN system-default input resolves to a
  // mixer/NDI-class native device, prefer "Follow Mac system input" so a
  // church that manages routing via System Settings stays in sync
  // automatically. If a stored pref exists but its device is absent from
  // the live list, do NOTHING here — the audio guardian owns failover and
  // we must not clobber the stored pref (the mixer may just be powered
  // off pre-service).
  useEffect(() => {
    if (effectiveMode !== "native" || nativeDevices.length === 0) return;
    if (readNativeDevicePref() !== null) return;
    let cancelled = false;
    void (async () => {
      const sys = await getSystemDefaultInputName();
      // Re-check after the await — a manual pick or another effect run may
      // have written a pref while we were resolving.
      if (cancelled || readNativeDevicePref() !== null) return;
      const sysMatch = sys ? matchNativeDeviceByName(sys, nativeDevices) : null;
      if (sysMatch && rankNativeDevice(sysMatch.name) <= 1) {
        // System default is a mixer or NDI feed → follow it.
        setFollowActive(true);
        setNativeSelected(
          nativeDevices.find((d) => d.index === sysMatch.index)
            ?? { index: sysMatch.index, name: sysMatch.name, platform: "darwin" },
        );
        setNativeGridMode("sum-all");
        setNativeSelectedChannels([]);
        writeNativeDevicePref({
          followSystemDefault: true,
          index: sysMatch.index,
          name: sysMatch.name,
          mode: "sum-all",
          selectedChannels: [],
          gainDb: 0,
          autoPickedAt: Date.now(),
        });
        toast.success(`Following Mac system input — currently ${sysMatch.name}`);
        return;
      }
      const best = pickBestNativeDevice(nativeDevices);
      if (!best) return;
      setNativeSelected(best);
      setNativeGridMode("sum-all");
      setNativeSelectedChannels([]);
      // writeNativeDevicePref dispatches presentflow:native-audio-input-changed.
      writeNativeDevicePref({
        index: best.index,
        name: best.name,
        mode: "sum-all",
        selectedChannels: [],
        gainDb: 0,
        autoPickedAt: Date.now(),
      });
      setAutoPickedIndex(best.index);
      toast.success(`Auto-selected ${best.name} (${autoPickReason(best.name)})`);
    })();
    return () => { cancelled = true; };
  }, [effectiveMode, nativeDevices]);

  // --- Native channel auto-detect (10s probe) ----------------------------
  const DETECT_DURATION_MS = 10_000;

  function stopDetectProbe() {
    if (detectCleanupRef.current) {
      try { detectCleanupRef.current(); } catch { /* noop */ }
      detectCleanupRef.current = null;
    }
  }

  function computeDetectResult() {
    const samples = detectSamplesRef.current;
    const sums = new Map<number, { total: number; count: number; active: number }>();
    for (const frame of samples) {
      for (const s of frame) {
        const agg = sums.get(s.channel) ?? { total: 0, count: 0, active: 0 };
        agg.total += s.rms;
        agg.count += 1;
        if (s.rms > 0.01) agg.active += 1;
        sums.set(s.channel, agg);
      }
    }
    const stats = [...sums.entries()]
      .map(([channel, a]) => ({
        channel,
        avgRms: a.count > 0 ? a.total / a.count : 0,
        activeFrac: a.count > 0 ? a.active / a.count : 0,
      }))
      .sort((a, b) => a.channel - b.channel);
    // Clear winner: best avgRms among channels clearing both thresholds.
    const qualifying = stats.filter((s) => s.avgRms > 0.02 && s.activeFrac > 0.2);
    const winner = qualifying.length > 0
      ? qualifying.reduce((best, s) => (s.avgRms > best.avgRms ? s : best)).channel
      : null;
    setDetectResult({ winner, stats });
    setDetectState("done");
  }

  async function runNativeAutoDetect() {
    const nb = getNativeAudioApi();
    const dev = nativeSelected;
    if (!nb || !dev || !dev.channelCount || dev.channelCount < 2) return;
    stopDetectProbe();
    detectSamplesRef.current = [];
    setDetectResult(null);
    setDetectProgress(0);
    setDetectState("running");
    try {
      const res = await nb.startChannelProbe({ deviceIndex: dev.index, channelCount: dev.channelCount });
      if (!res?.ok) {
        setDetectState("idle");
        toast.error(`Channel probe failed${res?.error ? ` — ${res.error}` : ""}`);
        return;
      }
    } catch {
      setDetectState("idle");
      toast.error("Channel probe failed to start");
      return;
    }
    const unsub = nb.onChannelLevels((lvls) => {
      detectSamplesRef.current.push(lvls.map((l) => ({ channel: l.channel, rms: l.rms })));
    });
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const p = Math.min(1, (Date.now() - startedAt) / DETECT_DURATION_MS);
      setDetectProgress(p);
      if (p >= 1) {
        // Probe + capture share the ffmpeg backend — ALWAYS stop the probe.
        clearInterval(tick);
        try { unsub(); } catch { /* noop */ }
        void nb.stopChannelProbe().catch(() => { /* noop */ });
        detectCleanupRef.current = null;
        computeDetectResult();
      }
    }, 200);
    detectCleanupRef.current = () => {
      clearInterval(tick);
      try { unsub(); } catch { /* noop */ }
      void nb.stopChannelProbe().catch(() => { /* noop */ });
    };
  }

  // Safety net: stop the detect probe on unmount (shared ffmpeg backend).
  useEffect(() => {
    return () => { stopDetectProbe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset detect flow when the selected native device changes.
  useEffect(() => {
    stopDetectProbe();
    setDetectState("idle");
    setDetectProgress(0);
    setDetectResult(null);
    detectSamplesRef.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeSelected?.index]);

  function applyDetectedChannel(ch: number) {
    setNativeGridMode("mono");
    setNativeSelectedChannels([ch]);
    // commitNativeChannelPref writes the pref + dispatches the change event.
    commitNativeChannelPref({ mode: "mono", selectedChannels: [ch] });
    toast.success(`Native capture → Ch ${ch + 1} (mono)`);
  }

  function persistNativeSelection(dev: NativeDeviceInfo) {
    setNativeSelected(dev);
    // Preserve existing mode/channels if pref for a same-index device exists.
    const existing = readNativeDevicePref();
    const carry = existing && existing.index === dev.index
      ? { mode: existing.mode, selectedChannels: existing.selectedChannels, gainDb: existing.gainDb }
      : {};
    writeNativeDevicePref({
      index: dev.index,
      name: dev.name,
      ...carry,
    });
  }

  function commitNativeChannelPref(next: { mode?: NativeDeviceMode; selectedChannels?: number[] }) {
    if (!nativeSelected) return;
    const mode = next.mode ?? nativeGridMode;
    const chs = next.selectedChannels ?? nativeSelectedChannels;
    writeNativeDevicePref({
      index: nativeSelected.index,
      name: nativeSelected.name,
      mode,
      selectedChannels: mode === "sum-all" ? [] : chs,
      // Preserve follow mode across channel/mode tweaks — only an explicit
      // device click disables it.
      ...(followActive ? { followSystemDefault: true } : {}),
    });
  }

  function handleNativeModeChange(next: NativeDeviceMode) {
    setNativeGridMode(next);
    if (next === "sum-all") {
      setNativeSelectedChannels([]);
      commitNativeChannelPref({ mode: next, selectedChannels: [] });
    } else {
      commitNativeChannelPref({ mode: next });
    }
  }

  function handleNativeChannelClick(n: number) {
    if (nativeGridMode === "sum-all" || nativeGridMode === "mono") {
      setNativeGridMode("mono");
      setNativeSelectedChannels([n]);
      commitNativeChannelPref({ mode: "mono", selectedChannels: [n] });
      return;
    }
    // stereo
    if (nativeSelectedChannels.length === 1) {
      const first = nativeSelectedChannels[0]!;
      if (n === first) return;
      const pair = [first, n].sort((a, b) => a - b);
      setNativeSelectedChannels(pair);
      commitNativeChannelPref({ mode: "stereo", selectedChannels: pair });
    } else {
      const maxCh = nativeSelected?.channelCount ?? 2;
      const neighbour = n + 1 < maxCh ? n + 1 : Math.max(0, n - 1);
      const pair = [n, neighbour].sort((a, b) => a - b);
      setNativeSelectedChannels(pair);
      commitNativeChannelPref({ mode: "stereo", selectedChannels: pair });
    }
  }

  // Native channel-probe lifecycle. Open when: popover open + native mode +
  // multi-channel device selected. Wave 1 note: probe + capture share the
  // ffmpeg backend so we must stop probe before capture ever starts; the
  // useAudioStream hook calls stopChannelProbe() defensively too.
  useEffect(() => {
    const nativeApi = (typeof window !== "undefined"
      ? (window as Window & { electronAPI?: { audio?: { native?: {
          startChannelProbe: (o: { deviceIndex: number; channelCount: number }) => Promise<{ ok: boolean; error?: string }>;
          stopChannelProbe: () => Promise<void>;
          onChannelLevels: (cb: (levels: Array<{ channel: number; rms: number; db: number; peak: number }>) => void) => () => void;
        } } } }).electronAPI
      : undefined);
    const nb = nativeApi?.audio?.native;
    const chCount = nativeSelected?.channelCount ?? 0;
    const shouldProbe = effectiveMode === "native" && pickerOpen && !!nativeSelected && chCount > 1 && !!nb;
    // AudioTab is mounted TWICE (left HardwarePanel + right popover). Only
    // the instance that actually STARTED the probe may stop it — otherwise
    // the idle instance's unconditional stopChannelProbe() kills the active
    // instance's probe on every re-run of this effect.
    if (!shouldProbe) {
      if (nativeProbeUnsubRef.current) { try { nativeProbeUnsubRef.current(); } catch {} nativeProbeUnsubRef.current = null; }
      if (startedProbeRef.current) {
        startedProbeRef.current = false;
        try { void nb?.stopChannelProbe?.(); } catch {}
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await nb!.startChannelProbe({ deviceIndex: nativeSelected!.index, channelCount: chCount });
        if (!res?.ok) return;
        startedProbeRef.current = true;
        if (cancelled) {
          // Cleanup already ran before start resolved — stop the probe we
          // just started ourselves, since cleanup couldn't see it yet.
          startedProbeRef.current = false;
          try { void nb?.stopChannelProbe?.(); } catch {}
          return;
        }
        const unsub = nb!.onChannelLevels((lvls) => {
          if (!cancelled) setNativeChannelLevels(lvls);
        });
        nativeProbeUnsubRef.current = unsub;
      } catch { /* noop */ }
    })();
    return () => {
      cancelled = true;
      if (nativeProbeUnsubRef.current) { try { nativeProbeUnsubRef.current(); } catch {} nativeProbeUnsubRef.current = null; }
      if (startedProbeRef.current) {
        startedProbeRef.current = false;
        try { void nb?.stopChannelProbe?.(); } catch {}
      }
    };
  }, [effectiveMode, pickerOpen, nativeSelected?.index, nativeSelected?.channelCount]);

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

  // Write current grid state to the device pref store.
  function commitPref(next: {
    mode?: GridMode;
    selectedChannels?: number[];
    gainDb?: number;
    autoDetected?: boolean;
  }) {
    if (!selected) return;
    const mode = next.mode ?? gridMode;
    const chs = next.selectedChannels ?? selectedChannels;
    const g = next.gainDb ?? gainDb;
    const storedMode: DeviceChannelMode = mode === "sum-all" ? "sum-all" : mode;
    writeDeviceChannelPref({
      deviceId: selected.id,
      deviceLabel: selected.label,
      mode: storedMode,
      selectedChannels: mode === "sum-all" ? [] : chs,
      gainDb: g,
      autoDetected: next.autoDetected ?? false,
      updatedAt: Date.now(),
    });
  }

  function handleModeChange(next: GridMode) {
    setGridMode(next);
    // Sum-all clears selection; mono/stereo keep any prior pick until user clicks a card.
    if (next === "sum-all") {
      setSelectedChannels([]);
      commitPref({ mode: next, selectedChannels: [] });
    } else {
      commitPref({ mode: next });
    }
  }

  function handleChannelClick(n: number) {
    if (gridMode === "sum-all") {
      // Clicking a channel implies user wants that specific one — bump to mono.
      setGridMode("mono");
      setSelectedChannels([n]);
      commitPref({ mode: "mono", selectedChannels: [n] });
      return;
    }
    if (gridMode === "mono") {
      setSelectedChannels([n]);
      commitPref({ mode: "mono", selectedChannels: [n] });
      return;
    }
    // stereo: pair as (n, n+1) unless we already have exactly one selection.
    if (selectedChannels.length === 1) {
      const first = selectedChannels[0]!;
      if (n === first) return;
      const pair = [first, n].sort((a, b) => a - b);
      setSelectedChannels(pair);
      commitPref({ mode: "stereo", selectedChannels: pair });
    } else {
      // Auto-pick neighbour (n, n+1) clamped in range
      const neighbour = n + 1 < channelCount ? n + 1 : Math.max(0, n - 1);
      const pair = [n, neighbour].sort((a, b) => a - b);
      setSelectedChannels(pair);
      commitPref({ mode: "stereo", selectedChannels: pair });
    }
  }

  // 🔴 Stress/reviewer fix — commit gain only on release, not on every drag
  // pixel. Onchange fires 50+ times per drag; each writeDeviceChannelPref
  // hits localStorage AND emits the pref-changed event that restarts the
  // capture pipeline mid-service. We keep the visual value live but only
  // persist + notify on mouseup / touchend / blur / keyup. Ref-tracked
  // pending value so we never miss the last drag position due to React
  // state batching between onChange and the release handler.
  const gainDirtyRef = useRef(false);
  const pendingGainDbRef = useRef<number>(0);
  function handleGainDrag(v: number) {
    setGainDb(v);
    pendingGainDbRef.current = v;
    gainDirtyRef.current = true;
  }
  function commitGainIfDirty() {
    if (!gainDirtyRef.current) return;
    gainDirtyRef.current = false;
    commitPref({ gainDb: pendingGainDbRef.current });
  }

  function handleClearPref() {
    if (!selected) return;
    clearDeviceChannelPref(selected.id);
    setGridMode("sum-all");
    setSelectedChannels([]);
    setGainDb(0);
  }

  // Sort: NDI first, MIXER second, others third, Bluetooth last — via categoryRank.
  const sortedDevices = [...devices].sort((a, b) => {
    const ra = categoryRank(categorizeDevice(a.label));
    const rb = categoryRank(categorizeDevice(b.label));
    if (ra !== rb) return ra - rb;
    return (a.label || "").localeCompare(b.label || "");
  });

  const hasNdi = devices.some((d) => isNdiDevice(d.label));
  const selectedLabel = selected?.label || (devices.length > 0 ? "Pick an input device…" : "No devices detected");

  const guide = selected ? findGuideForDevice(selected.label) : null;
  const showGrid = !!selected && capsProbed && channelCount > 1 && !captureError;

  // Native-mode setup guide (2026-07-27) — previously guides only rendered
  // for browser-mode selections. Match against the follow-resolved name
  // when follow mode is active, else the picked native device's name.
  const nativeGuideLabel = followActive
    ? (followResolvedName ?? nativeSelected?.name ?? "")
    : (nativeSelected?.name ?? "");
  const nativeGuide = effectiveMode === "native" && nativeGuideLabel
    ? findGuideForDevice(nativeGuideLabel)
    : null;

  return (
    <div className="flex flex-col gap-3 py-2 text-[12px]">
      {/* Wave 2 — Capture Mode toggle. Bypasses Chromium getUserMedia (which
          silently drops 32-ch USB pro-audio input, JPD field test confirmed)
          by routing through an ffmpeg subprocess in the Electron main process. */}
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] px-1 flex items-center justify-between">
          <span>Capture mode</span>
          <span className="text-[9px] normal-case tracking-normal text-[var(--color-muted-foreground)]" title="Native: ffmpeg subprocess (reliable for pro mixers). Browser: Chromium getUserMedia (may fail with 32ch USB). Auto: Native when the desktop app supports it, otherwise Browser.">
            {effectiveMode === "native" ? "🎛️ native active" : "🌐 browser active"}
          </span>
        </div>
        <div className="inline-flex rounded-md p-0.5 border border-[var(--color-border)] bg-[var(--color-elevated)]">
          {(["auto", "native", "browser"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setCaptureMode(m); writeCaptureMode(m); }}
              className={"h-6 flex-1 px-2 rounded text-[10px] font-medium capitalize " + (captureMode === m ? "text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
              style={captureMode === m ? { background: "#f97316" } : {}}
              title={m === "native" ? "Force ffmpeg subprocess capture (recommended for pro mixers)" : m === "browser" ? "Force Chromium getUserMedia (legacy)" : "Native if available, else browser"}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Native device picker — shown when effective mode is native. */}
      {effectiveMode === "native" && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] px-1 flex items-center justify-between">
            <span>Native input device</span>
            <button
              onClick={() => void refreshNativeDevices()}
              className="text-[9px] normal-case tracking-normal text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/5"
              title="Rescan native devices via ffmpeg"
            >
              <RefreshCcw className="w-2.5 h-2.5" /> Refresh
            </button>
          </div>
          {nativeDevices.length === 0 ? (
            <div className="px-2 py-2 rounded border text-[10px] italic text-[var(--color-muted-foreground)]" style={{ borderColor: "var(--color-border)" }}>
              No native devices detected. If the Electron shell was just launched, click Refresh in a second.
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 rounded border p-1" style={{ borderColor: "var(--color-border)", background: "var(--color-elevated)" }}>
              {/* Pinned: "Follow Mac system input" — capture whatever macOS
                  System Settings → Sound → Input points at, and track it
                  live when it changes. */}
              <button
                onClick={() => void enableFollowSystemDefault()}
                className={"w-full text-left px-2 py-1.5 rounded text-[11px] flex flex-col gap-0.5 border " + (followActive ? "text-white bg-[color:rgba(249,115,22,0.15)]" : "text-[var(--color-foreground)] hover:bg-white/5")}
                style={{ borderColor: followActive ? "#f97316" : "transparent" }}
                title="Capture whatever input macOS is set to (System Settings → Sound → Input) and follow it when it changes"
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0" style={{ background: "#f97316", color: "white" }}>
                    SYSTEM
                  </span>
                  <span className="truncate">🖥 Follow Mac system input</span>
                </span>
                <span className="text-[9px] text-[var(--color-muted-foreground)] pl-0.5 truncate">
                  {followResolvedName ? `Currently: ${followResolvedName}` : "System input not resolved yet"}
                </span>
              </button>
              {[...nativeDevices].sort(compareNativeDevices).map((d) => {
                const isSel = !followActive && nativeSelected?.index === d.index;
                const tag = tagForRank(rankNativeDevice(d.name));
                const tagStyle =
                  tag === "MIXER" ? { background: "#10b981", color: "white" }
                  : tag === "NDI" ? { background: "#8b5cf6", color: "white" }
                  : tag === "VIRTUAL" ? { background: "#6b7280", color: "white" }
                  : tag === "BT" ? { background: "#3b82f6", color: "white" }
                  : undefined;
                const tagTitle =
                  tag === "MIXER" ? "USB audio interface / mixer — best pick for clean vocal capture"
                  : tag === "NDI" ? "Audio via NDI network stream"
                  : tag === "VIRTUAL" ? "Virtual / loopback driver"
                  : tag === "BT" ? "Bluetooth audio (100-300ms latency — verse detection slightly delayed)"
                  : undefined;
                return (
                  <button
                    key={`${d.platform}-${d.index}-${d.name}`}
                    onClick={() => {
                      setNativeSelected(d);
                      setAutoPickedIndex(null); // manual click supersedes auto-pick
                      setFollowActive(false); // explicit device pick disables follow mode
                      writeNativeDevicePref({ index: d.index, name: d.name, mode: "sum-all", selectedChannels: [], gainDb: 0 });
                      try { window.dispatchEvent(new CustomEvent("presentflow:native-audio-input-changed", { detail: { index: d.index, name: d.name } })); } catch { /* noop */ }
                      toast.success(`Native capture → ${d.name}${d.channelCount ? ` (${d.channelCount}ch)` : ""}`);
                    }}
                    className={"w-full text-left px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 " + (isSel ? "text-white bg-[color:rgba(249,115,22,0.15)]" : "text-[var(--color-foreground)] hover:bg-white/5")}
                  >
                    {tag && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0" style={tagStyle} title={tagTitle}>
                        {tag}
                      </span>
                    )}
                    <span className="truncate">{d.name}</span>
                    {autoPickedIndex === d.index && isSel && (
                      <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0" style={{ background: "rgba(249,115,22,0.25)", color: "#f97316" }} title="Selected automatically at launch — click any device to override">
                        AUTO-PICKED
                      </span>
                    )}
                    {d.channelCount != null && (
                      <span className="text-[9px] text-[var(--color-muted-foreground)] ml-auto">{d.channelCount}ch</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {/* NDI® trademark attribution — required by the NDI SDK license
              whenever NDI is offered. Shown when a network (NDI) source is
              present in the list. */}
          {nativeDevices.some((d) => d.transport === "ndi" || /ndi/i.test(d.name)) && (
            <div className="text-[9px] text-[var(--color-muted-foreground)] px-1 pt-1">
              NDI® is a registered trademark of Vizrt NDI AB.
            </div>
          )}
          {nativeSelected && (nativeSelected.channelCount ?? 0) === 2 && (
            <div className="text-[10px] text-[var(--color-muted-foreground)] px-1">
              Stereo input — ffmpeg downmixes both channels to mono for the AI listener.
            </div>
          )}
          {/* Channel auto-detect — multi-channel native devices (>2ch) */}
          {nativeSelected && (nativeSelected.channelCount ?? 0) > 2 && (
            <div className="flex flex-col gap-1.5 border-t pt-2 mt-1" style={{ borderColor: "var(--color-border)" }}>
              <div className="flex items-center justify-between px-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Channels · {nativeSelected.channelCount}ch
                </div>
                <button
                  onClick={() => void runNativeAutoDetect()}
                  disabled={detectState === "running"}
                  className="h-6 px-2 rounded text-[10px] font-semibold text-white inline-flex items-center gap-1 disabled:opacity-60"
                  style={{ background: "#f97316" }}
                  title="Listen for 10s and suggest the channel carrying the vocal"
                >
                  <Wand2 className="w-3 h-3" /> Auto-detect vocal channel
                </button>
              </div>
              <div className="text-[10px] text-[var(--color-muted-foreground)] px-1">
                {nativeGridMode === "mono" && nativeSelectedChannels.length === 1
                  ? `Using Ch ${nativeSelectedChannels[0]! + 1} (mono)`
                  : nativeGridMode === "stereo" && nativeSelectedChannels.length === 2
                  ? `Using Ch ${nativeSelectedChannels[0]! + 1} + Ch ${nativeSelectedChannels[1]! + 1} (stereo pair)`
                  : "Currently: sum-all (all channels downmixed to mono)"}
              </div>
              {detectState === "running" && (
                <div className="flex flex-col gap-1 px-1">
                  <div className="text-[10px] text-[var(--color-muted-foreground)]">
                    Listening… have the vocal mic live for the next {Math.max(1, Math.ceil(10 - detectProgress * 10))}s
                  </div>
                  <div className="h-1.5 rounded overflow-hidden" style={{ background: "var(--color-elevated)" }}>
                    <div className="h-full" style={{ width: `${Math.round(detectProgress * 100)}%`, background: "#f97316", transition: "width 200ms linear" }} />
                  </div>
                </div>
              )}
              {detectState === "done" && detectResult && detectResult.winner != null && (
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border" style={{ borderColor: "#10b981", background: "rgba(16,185,129,0.08)" }}>
                  <div className="text-[11px] text-[var(--color-foreground)]">
                    Recommended: <span className="font-semibold">Ch {detectResult.winner + 1}</span>
                  </div>
                  <button
                    onClick={() => applyDetectedChannel(detectResult.winner!)}
                    className="h-6 px-2 rounded text-[10px] font-semibold text-white shrink-0"
                    style={{ background: "#10b981" }}
                  >
                    Use this channel
                  </button>
                </div>
              )}
              {detectState === "done" && detectResult && detectResult.winner == null && (
                <div className="px-2 py-1.5 rounded text-[10px] leading-snug border" style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}>
                  No clear signal — pick manually below.
                </div>
              )}
              {/* Manual channel grid — rendered after any completed detect run
                  (bars = avg rms from the 10s probe; click = mono select). */}
              {detectState === "done" && detectResult && (
                <div className="grid grid-cols-4 gap-1">
                  {detectResult.stats.map((s) => {
                    const isSel = nativeGridMode === "mono" && nativeSelectedChannels[0] === s.channel;
                    const pct = Math.min(100, Math.round(s.avgRms * 400)); // avg rms 0.25 → full bar
                    return (
                      <button
                        key={s.channel}
                        onClick={() => applyDetectedChannel(s.channel)}
                        className="relative h-12 rounded overflow-hidden text-left"
                        style={{
                          border: isSel ? "2px solid #f97316" : "1px solid var(--color-border)",
                          background: "var(--color-elevated)",
                        }}
                        title={`Channel ${s.channel + 1} · avg rms ${s.avgRms.toFixed(3)} · active ${(s.activeFrac * 100).toFixed(0)}%`}
                      >
                        <div
                          className="absolute left-0 right-0 bottom-0"
                          style={{ height: `${pct}%`, background: "linear-gradient(180deg, rgba(249,115,22,0.55), rgba(249,115,22,0.25))" }}
                        />
                        <div className="absolute top-0.5 left-1 text-[9px] font-semibold text-[var(--color-foreground)]">{s.channel + 1}</div>
                        {s.activeFrac > 0.2 && (
                          <div className="absolute bottom-0.5 right-1 w-1.5 h-1.5 rounded-full bg-green-400" title="Active signal during probe" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* Setup guide for the native pick (collapsible, default closed). */}
          {nativeGuide && (
            <div className="border-t pt-2 mt-1" style={{ borderColor: "var(--color-border)" }}>
              <button
                onClick={() => setNativeGuideOpen((v) => !v)}
                className="w-full flex items-center gap-1 text-left text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1"
              >
                {nativeGuideOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Setup guide: {nativeGuide.displayName}
              </button>
              {nativeGuideOpen && (
                <ol className="mt-1 px-3 py-2 rounded space-y-1 text-[10px] leading-snug text-[var(--color-muted-foreground)] list-decimal list-inside" style={{ background: "var(--color-elevated)" }}>
                  {nativeGuide.steps.map((s, i) => <li key={i}>{s}</li>)}
                  {nativeGuide.vocalChannelHint && (
                    <li className="mt-1 pt-1 border-t text-[var(--color-foreground)]" style={{ borderColor: "var(--color-border)" }}>
                      <span className="font-semibold">Vocal hint: </span>{nativeGuide.vocalChannelHint}
                    </li>
                  )}
                </ol>
              )}
            </div>
          )}
        </div>
      )}

      {/* Browser-mode Input device (existing) — hidden when native is active. */}
      <div className={"flex flex-col gap-1 " + (effectiveMode === "native" ? "hidden" : "")}>
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
                const ndi = isNdiDevice(d.label);
                const mixer = !ndi && isMixerDevice(d.label);
                const bt = !ndi && !mixer && isBluetoothDevice(d.label);
                const isSelected = selected?.id === d.deviceId;
                return (
                  <button
                    key={d.deviceId}
                    onClick={() => {
                      persistSelection({ kind: "device", id: d.deviceId, label: d.label || (ndi ? "NDI Audio" : mixer ? "USB Interface" : "Audio input") });
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
        {isDesktopShell && (
          <div className="text-[10px] italic text-[var(--color-muted-foreground)] px-1">
            Browser input settings apply to the web app only — the desktop app uses Native capture.
          </div>
        )}
      </div>

      {/* --- Channel Grid (multi-channel devices only) ------------------- */}
      {selected && capsProbed && channelCount > 1 && (
        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center justify-between px-1">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">Channels</div>
            <button
              onClick={() => setAutoDetectOpen(true)}
              className="h-6 px-2 rounded text-[10px] font-semibold text-white inline-flex items-center gap-1"
              style={{ background: "#f97316" }}
              title="Listen for 5s and suggest the loudest vocal-band channel"
            >
              <Wand2 className="w-3 h-3" /> Auto-detect vocal
            </button>
          </div>

          {captureError && (
            <div className="px-2 py-1.5 rounded text-[10px] leading-snug border" style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}>
              Multi-channel scan failed — using sum-all mode. ({captureError})
            </div>
          )}

          {!captureError && (
            <>
              <div className="flex items-center justify-between px-1">
                <div className="text-[10px] text-[var(--color-muted-foreground)]">
                  {channelCount} channels · Mode: {gridMode === "sum-all" ? "Sum all" : gridMode === "mono" ? "Mono" : "Stereo"}
                </div>
              </div>

              {/* Mode segmented toggle */}
              <div className="inline-flex rounded-md p-0.5 border border-[var(--color-border)] bg-[var(--color-elevated)] w-full">
                {(["sum-all", "mono", "stereo"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleModeChange(m)}
                    className={"h-6 flex-1 px-2 rounded text-[10px] font-medium capitalize " + (gridMode === m ? "text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}
                    style={gridMode === m ? { background: "#f97316" } : {}}
                  >
                    {m === "sum-all" ? "Sum all" : m}
                  </button>
                ))}
              </div>

              {gridMode === "sum-all" && (
                <div className="text-[10px] leading-snug text-[var(--color-muted-foreground)] px-1">
                  All channels summed to mono. Pick a specific channel for cleaner vocal capture.
                </div>
              )}
              {gridMode === "stereo" && selectedChannels.length === 1 && (
                <div className="text-[10px] leading-snug text-[var(--color-muted-foreground)] px-1">
                  Click a second channel to pair, or a single channel to auto-pair with its neighbour.
                </div>
              )}

              {/* Grid: 2 per row in the sidebar (space-constrained) */}
              <div className="grid grid-cols-2 gap-1.5">
                {levels.length === 0 && Array.from({ length: Math.min(channelCount, 4) }).map((_, i) => (
                  <div key={`ph-${i}`} className="h-16 rounded border animate-pulse" style={{ borderColor: "var(--color-border)", background: "var(--color-elevated)" }} />
                ))}
                {levels.map((lv, n) => {
                  const isSel = selectedChannels.includes(n);
                  const isActive = activeMap[n] === true;
                  const rmsPct = Math.min(100, Math.round(lv.rms * 100));
                  const vocalPct = Math.min(100, Math.round(lv.vocalBandEnergy * 100));
                  return (
                    <button
                      key={n}
                      onClick={() => handleChannelClick(n)}
                      className="relative h-16 rounded overflow-hidden text-left"
                      style={{
                        border: isSel ? "2px solid #f97316" : "1px solid var(--color-border)",
                        background: "var(--color-elevated)",
                      }}
                      title={`Channel ${n + 1} · rms ${lv.rms.toFixed(2)} · vocal ${lv.vocalBandEnergy.toFixed(2)}`}
                    >
                      {/* Meter fill from bottom */}
                      <div
                        className="absolute left-0 right-0 bottom-0"
                        style={{ height: `${rmsPct}%`, background: "linear-gradient(180deg, rgba(249,115,22,0.55), rgba(249,115,22,0.25))" }}
                      />
                      {/* Vocal band overlay (yellow) */}
                      <div
                        className="absolute left-0 right-0 bottom-0"
                        style={{ height: `${vocalPct}%`, background: "rgba(250,204,21,0.35)" }}
                      />
                      <div className="absolute top-1 left-1.5 text-[10px] font-semibold text-[var(--color-foreground)]">Ch {n + 1}</div>
                      {isActive && (
                        <div className="absolute top-1 right-1.5 inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-green-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Active
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Gain slider */}
              <div className="flex flex-col gap-1 px-1 pt-1">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">Gain</div>
                  <div className="text-[10px] text-[var(--color-foreground)] font-mono">{gainDb > 0 ? "+" : ""}{gainDb} dB</div>
                </div>
                <input
                  type="range"
                  min={-24}
                  max={24}
                  step={1}
                  value={gainDb}
                  onChange={(e) => handleGainDrag(Number(e.target.value) || 0)}
                  onMouseUp={commitGainIfDirty}
                  onTouchEnd={commitGainIfDirty}
                  onKeyUp={commitGainIfDirty}
                  onBlur={commitGainIfDirty}
                  className="w-full accent-orange-500"
                  aria-label="Channel gain"
                />
              </div>

              {/* Setup guide (collapsible, default closed in the sidebar) */}
              {guide && (
                <div className="border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
                  <button
                    onClick={() => setGuideOpen((v) => !v)}
                    className="w-full flex items-center gap-1 text-left text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1"
                  >
                    {guideOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    Setup guide: {guide.displayName}
                  </button>
                  {guideOpen && (
                    <ol className="mt-1 px-3 py-2 rounded space-y-1 text-[10px] leading-snug text-[var(--color-muted-foreground)] list-decimal list-inside" style={{ background: "var(--color-elevated)" }}>
                      {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
                      {guide.vocalChannelHint && (
                        <li className="mt-1 pt-1 border-t text-[var(--color-foreground)]" style={{ borderColor: "var(--color-border)" }}>
                          <span className="font-semibold">Vocal hint: </span>{guide.vocalChannelHint}
                        </li>
                      )}
                    </ol>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

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

      {/* Custom vocabulary quick-add — full management lives in Settings → Audio */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between px-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">Vocabulary</div>
          <div className="text-[10px] text-[var(--color-muted-foreground)]">{vocabCount} / {MAX_VOCABULARY_TERMS}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={vocabTerm}
            onChange={(e) => setVocabTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addVocab(); }}
            placeholder="Name the AI mishears…"
            className="flex-1 h-7 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] text-[10px] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]"
          />
          <button
            onClick={addVocab}
            disabled={vocabCount >= MAX_VOCABULARY_TERMS}
            className="h-7 px-2 rounded-md text-[10px] font-semibold text-white inline-flex items-center gap-1 disabled:opacity-50"
            style={{ background: "#f97316" }}
            title="Boost recognition of a name / song title Deepgram keeps mishearing"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      <div className="text-[10px] text-[var(--color-muted-foreground)] px-1">
        Advanced settings (voice commands, mic boost, auto-pause, full vocabulary list) live in the full Settings page.
      </div>

      {diagOpen && (
        <AudioDiagnosticsScan
          onClose={() => setDiagOpen(false)}
          onSelectDevice={(id, label) => persistSelection({ kind: "device", id, label })}
        />
      )}

      {autoDetectOpen && selected && (
        <VocalChannelAutoDetectModal
          deviceId={selected.id}
          deviceLabel={selected.label}
          onClose={() => setAutoDetectOpen(false)}
          onSelectChannel={(ch, mode, chs) => {
            setGridMode(mode as GridMode);
            setSelectedChannels(chs);
            commitPref({ mode: mode as GridMode, selectedChannels: chs, autoDetected: true });
            setAutoDetectOpen(false);
          }}
        />
      )}

      {/* Show captureError below so a probe failure doesn't hide silently. */}
      {selected && captureError && !showGrid && (
        <div className="px-2 py-1.5 rounded text-[10px] leading-snug border" style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}>
          Multi-channel scan failed — using sum-all mode.
        </div>
      )}
    </div>
  );
}
