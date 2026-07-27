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
import { ChevronDown, ChevronRight, RefreshCcw, Stethoscope, Wand2 } from "lucide-react";
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

const AUDIO_INPUT_KEY = "presentflow.pro.audioInput.v1";
const AUDIO_SOURCE_TYPE_KEY = "presentflow.pro.audioSourceType.v1";

type AudioInputSel = { kind: "device"; id: string; label: string };

// Local channel-grid state — mode/channel/gain that mirrors the pref file
// but is held in React state so slider drags feel instant.
type GridMode = "sum-all" | "mono" | "stereo";

export function AudioTab() {
  const [selected, setSelected] = useState<AudioInputSel | null>(null);
  const [sourceType, setSourceType] = useState<"mixer" | "microphone">("mixer");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [diagOpen, setDiagOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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
    refreshDevices();
    // 🔴 Stress fix — refresh the picker device list when the OS reports a
    // hardware change (USB plug/unplug, Bluetooth connect). Without this,
    // an operator with the popover open sees a stale list and has to click
    // Refresh manually.
    if (navigator.mediaDevices?.addEventListener) {
      const handler = () => refreshDevices();
      navigator.mediaDevices.addEventListener("devicechange", handler);
      return () => {
        try { navigator.mediaDevices.removeEventListener("devicechange", handler); } catch { /* noop */ }
      };
    }
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
  }, [selected?.id]);

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
    if (!pickerOpen || !selected || !capsProbed || channelCount <= 1) {
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
  }, [pickerOpen, selected?.id, capsProbed, channelCount]);

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

      <div className="text-[10px] text-[var(--color-muted-foreground)] px-1">
        Advanced settings (voice commands, mic boost, auto-pause) live in the full Settings page.
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
