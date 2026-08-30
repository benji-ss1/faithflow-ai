"use client";
import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, ChevronRight, X, Plus, Stethoscope, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { SectionHeader, Row, Toggle } from "./DisplayTab";
import { AudioDiagnosticsScan } from "@/components/operator/AudioDiagnosticsScan";
import { MIC_BOOST_KEY, MIC_HIGHPASS_KEY } from "@/components/operator/useAudioStream";
import { VocalChannelAutoDetectModal } from "@/components/operator/VocalChannelAutoDetectModal";
import {
  categorizeDevice,
  categoryRank,
  getDeviceCapabilities,
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
import { addVocabularyTerm, MAX_VOCABULARY_TERMS, readVocabulary, removeVocabularyTerm } from "@/lib/audio/customVocabulary";

const AUDIO_INPUT_KEY = "presentflow.pro.audioInput.v1";
const AUDIO_SOURCE_TYPE_KEY = "presentflow.pro.audioSourceType.v1";
const TRANSCRIPTION_MODE_KEY = "presentflow.pro.transcriptionMode.v1";
const VOICE_COMMANDS_KEY = "presentflow.pro.voiceCommandsEnabled.v1";
const CUSTOM_COMMANDS_KEY = "presentflow.pro.voiceCommands.v1";
const AUTO_PAUSE_KEY = "presentflow.pro.autoPause.enabled";
const AUTO_ADVANCE_KEY = "presentflow.pro.autoAdvanceSec.v1";
// Y8: hold Bible auto-approve while a song is currently on live output.
const HOLD_DURING_SONG_KEY = "presentflow.pro.holdAutoApproveDuringSong.v1";
const CONTEXT_ENGINE_KEY = "presentflow.pro.contextEngine.v1";

type AudioInputSel = { kind: "device" | "ndi"; id: string; label: string };

// Y4: validate shapes read from localStorage. Untrusted input (older builds,
// manual edits, extensions) can otherwise crash the pipeline downstream.
function isAudioInputSel(v: unknown): v is AudioInputSel {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (o.kind === "device" || o.kind === "ndi")
    && typeof o.id === "string"
    && typeof o.label === "string";
}
function parseAudioInput(raw: string | null): AudioInputSel | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return isAudioInputSel(v) ? v : null;
  } catch { return null; }
}
function isCustomCommand(v: unknown): v is CustomCommand {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.phrase === "string" && typeof o.action === "string";
}
function parseCustomCommands(raw: string | null): CustomCommand[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(isCustomCommand);
  } catch { return []; }
}

// 2026-07-26 — NDI_PLACEHOLDERS + ndiSources state removed. See picker
// rewrite below: real NDI devices are surfaced through enumerateDevices()
// (labels containing "NDI" when NDI Virtual Input is installed on the Mac).
// Old hardcoded placeholders were UI theater that routed to the default
// mic when selected — actively misleading operators.

const BUILT_IN_COMMANDS = ["next verse", "previous verse", "give me NIV", "show blank", "kill live", "go back"];
const ACTIONS = [
  { value: "next_verse", label: "Next verse" },
  { value: "prev_verse", label: "Previous verse" },
  { value: "give_me_niv", label: "Give me NIV" },
  { value: "blank_screen", label: "Show blank" },
  { value: "kill_live", label: "Kill live" },
];

type CustomCommand = { id: string; phrase: string; action: string };

export function AudioTab() {
  const [mode, setMode] = useState<"online" | "offline">("online");
  const [voiceOn, setVoiceOn] = useState(true);
  // JPD Fix 4: default OFF — AI stays on until the operator turns it off.
  const [autoPause, setAutoPause] = useState(false);
  const [autoAdvanceSec, setAutoAdvanceSec] = useState(0);
  const [holdDuringSong, setHoldDuringSong] = useState(false);
  const [contextEngineOn, setContextEngineOn] = useState(false);
  const [selected, setSelected] = useState<AudioInputSel>({ kind: "ndi", id: "ndi:default", label: "NDI Audio (Routed)" });
  const [sourceType, setSourceType] = useState<"mixer" | "microphone">("mixer");
  // 2026-07-25 distant-mic improvements. null = "auto" (follow Source Type:
  // microphone → 1.5x + high-pass ON, mixer → 1.0x + OFF) — mirrors the
  // defaulting in useAudioStream's pipeline build.
  const [micBoost, setMicBoost] = useState<number | null>(null);
  const [highpassOn, setHighpassOn] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [customs, setCustoms] = useState<CustomCommand[]>([]);
  const [newPhrase, setNewPhrase] = useState("");
  const [newAction, setNewAction] = useState(ACTIONS[0].value);
  const [vocab, setVocab] = useState<string[]>([]);
  const [newVocabTerm, setNewVocabTerm] = useState("");

  // --- Channel-grid state (multi-channel USB mixer picker) ---------------
  // Only rendered when the selected device has > 1 channel. Preserves the
  // v0.1.77 sum-all fallback when no explicit channel is picked.
  type GridMode = "sum-all" | "mono" | "stereo";
  const [channelCount, setChannelCount] = useState<number>(1);
  const [capsProbed, setCapsProbed] = useState(false);
  const [gridMode, setGridMode] = useState<GridMode>("sum-all");
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [gainDb, setGainDb] = useState<number>(0);
  const [levels, setLevels] = useState<ChannelLevels[]>([]);
  const [activeMap, setActiveMap] = useState<boolean[]>([]);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(true); // Default OPEN in settings
  const [autoDetectOpen, setAutoDetectOpen] = useState(false);
  const captureRef = useRef<MultiChannelCapture | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActiveRef = useRef<number[]>([]);

  useEffect(() => {
    try {
      const m = localStorage.getItem(TRANSCRIPTION_MODE_KEY);
      if (m === "offline" || m === "online") setMode(m);
      const v = localStorage.getItem(VOICE_COMMANDS_KEY);
      setVoiceOn(v !== "0");
      // JPD Fix 4: strict opt-in ("1" only) — matches isAutoPauseEnabled()
      // in useAudioStream.ts. Machines that never touched the key get OFF.
      const ap = localStorage.getItem(AUTO_PAUSE_KEY);
      setAutoPause(ap === "1");
      const aa = Number(localStorage.getItem(AUTO_ADVANCE_KEY));
      if (!Number.isNaN(aa) && aa >= 0) setAutoAdvanceSec(aa);
      const hs = localStorage.getItem(HOLD_DURING_SONG_KEY);
      setHoldDuringSong(hs === "1");
      setContextEngineOn(localStorage.getItem(CONTEXT_ENGINE_KEY) === "1");
      const parsedSel = parseAudioInput(localStorage.getItem(AUDIO_INPUT_KEY));
      if (parsedSel) setSelected(parsedSel);
      const st = localStorage.getItem(AUDIO_SOURCE_TYPE_KEY);
      setSourceType(st === "microphone" ? "microphone" : "mixer");
      const mb = parseFloat(localStorage.getItem(MIC_BOOST_KEY) ?? "");
      if (Number.isFinite(mb)) setMicBoost(Math.min(3, Math.max(1, mb)));
      const hp = localStorage.getItem(MIC_HIGHPASS_KEY);
      if (hp === "1" || hp === "0") setHighpassOn(hp === "1");
      setCustoms(parseCustomCommands(localStorage.getItem(CUSTOM_COMMANDS_KEY)));
      setVocab(readVocabulary());
    } catch {}
    // enumerate devices
    const enumerate = () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      navigator.mediaDevices.enumerateDevices().then((all) => {
        setDevices(all.filter((d) => d.kind === "audioinput"));
      }).catch(() => {});
    };
    enumerate();
    // 2026-07-26 — the IPC-based NDI source probe (listNdiSources) was
    // removed. Electron main never actually implemented that bridge, and
    // the fallback populated fake JPD-flavoured placeholders that routed
    // to the default mic when selected. Real NDI devices now show up
    // through enumerateDevices() when NDI Virtual Input is installed.

    // 🔴 Stress fix — refresh the device list on OS hardware change so
    // the picker isn't stale when an operator plugs in a mixer mid-setup.
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", enumerate);
      return () => {
        try { navigator.mediaDevices.removeEventListener("devicechange", enumerate); } catch { /* noop */ }
      };
    }
  }, []);

  // --- Channel-grid effects & handlers ----------------------------------
  // Probe capabilities + hydrate stored pref when the device changes.
  useEffect(() => {
    setCapsProbed(false);
    setChannelCount(1);
    setLevels([]);
    setActiveMap([]);
    // 6c — clear stale activity timestamps so a prior 32-channel device
    // can't leak "active" state into a fresh 2-channel one.
    lastActiveRef.current = [];
    setCaptureError(null);
    if (!selected || selected.kind !== "device") {
      setGridMode("sum-all");
      setSelectedChannels([]);
      setGainDb(0);
      return;
    }
    // 2026-07-27 JPD field fix — auto-switch Source Type to "mixer" when the
    // selected device is recognized as a mixer (SQ, X32, TF, StudioLive, etc.)
    // but the user is stuck in "microphone" mode. That combination silently
    // yields no signal on a 32-ch USB mixer (channelCount:1 grabs the wrong
    // channel + Chromium DSP degrades a clean feed). The operator shouldn't
    // have to know they need to change TWO settings.
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
      // First lookup by deviceId; if empty, fall back to label so a USB
      // power-cycle doesn't silently wipe the operator's channel pick.
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
  }, [selected?.kind, selected?.id]);

  // Open capture whenever the settings tab is visible AND there's a
  // multi-channel device. Poll at 20fps (100ms).
  useEffect(() => {
    const teardown = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (captureRef.current) {
        try { captureRef.current.close(); } catch { /* noop */ }
        captureRef.current = null;
      }
    };
    if (!selected || selected.kind !== "device" || !capsProbed || channelCount <= 1) {
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
            const now = Date.now();
            const active: boolean[] = new Array(l.length);
            const prev = lastActiveRef.current;
            for (let i = 0; i < l.length; i += 1) {
              if (l[i]!.rms > 0.02) prev[i] = now;
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
  }, [selected?.kind, selected?.id, capsProbed, channelCount]);

  // Unmount safety
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (captureRef.current) { try { captureRef.current.close(); } catch {} }
    };
  }, []);

  function commitPref(next: {
    mode?: GridMode;
    selectedChannels?: number[];
    gainDb?: number;
    autoDetected?: boolean;
  }) {
    if (!selected || selected.kind !== "device") return;
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
  function handleGridModeChange(next: GridMode) {
    setGridMode(next);
    if (next === "sum-all") {
      setSelectedChannels([]);
      commitPref({ mode: next, selectedChannels: [] });
    } else {
      commitPref({ mode: next });
    }
  }
  function handleChannelClick(n: number) {
    if (gridMode === "sum-all") {
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
    if (selectedChannels.length === 1) {
      const first = selectedChannels[0]!;
      if (n === first) return;
      const pair = [first, n].sort((a, b) => a - b);
      setSelectedChannels(pair);
      commitPref({ mode: "stereo", selectedChannels: pair });
    } else {
      const neighbour = n + 1 < channelCount ? n + 1 : Math.max(0, n - 1);
      const pair = [n, neighbour].sort((a, b) => a - b);
      setSelectedChannels(pair);
      commitPref({ mode: "stereo", selectedChannels: pair });
    }
  }
  // 🔴 Stress/reviewer fix — mirror the MIC_BOOST_KEY pattern below: keep
  // the slider visual live in local state during drag, only write the pref
  // (which fires pref-changed → pipeline restart) on release. Prevents a
  // 50-writes-per-drag localStorage storm mid-service.
  const gainDirtyRef = useRef(false);
  const pendingGainDbRef = useRef<number>(0);
  function handleChannelGainDrag(v: number) {
    setGainDb(v);
    pendingGainDbRef.current = v;
    gainDirtyRef.current = true;
  }
  function commitChannelGainIfDirty() {
    if (!gainDirtyRef.current) return;
    gainDirtyRef.current = false;
    commitPref({ gainDb: pendingGainDbRef.current });
  }
  function handleClearChannelPref() {
    if (!selected || selected.kind !== "device") return;
    clearDeviceChannelPref(selected.id);
    setGridMode("sum-all");
    setSelectedChannels([]);
    setGainDb(0);
    toast.success("Channel preference cleared — back to sum-all mode");
  }

  function persistSelection(sel: AudioInputSel) {
    setSelected(sel);
    try { localStorage.setItem(AUDIO_INPUT_KEY, JSON.stringify(sel)); } catch {}
    // Notify useAudioStream so it restarts the pipeline with the new device.
    try { window.dispatchEvent(new CustomEvent("presentflow:audio-input-changed", { detail: sel })); } catch {}
  }
  function persistSourceType(next: "mixer" | "microphone") {
    setSourceType(next);
    try { localStorage.setItem(AUDIO_SOURCE_TYPE_KEY, next); } catch {}
    // Piggyback on the same audio-input-changed event so useAudioStream
    // fully restarts capture with the new DSP constraints applied.
    try { window.dispatchEvent(new CustomEvent("presentflow:audio-input-changed", { detail: { sourceType: next } })); } catch {}
  }
  function persistCustoms(next: CustomCommand[]) {
    setCustoms(next);
    try { localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(next)); } catch {}
  }
  function addCustom() {
    if (!newPhrase.trim()) return;
    persistCustoms([...customs, { id: crypto.randomUUID(), phrase: newPhrase.trim(), action: newAction }]);
    setNewPhrase("");
  }

  const [diagOpen, setDiagOpen] = useState(false);

  return (
    <div className="space-y-6">
      <SectionHeader title="Audio" description="Transcription mode, input device, mic boost, and voice commands." />

      {/* Task 6 — manual "Restart AI listener" recovery control. Dispatches
          a window event that ProOperatorShell handles by calling
          ctx.onRestartAudio (full teardown + fresh ticket + start). */}
      <Row label="AI Listener">
        <div className="flex items-center gap-2">
          <button
            data-testid="settings-restart-ai-btn"
            onClick={() => { try { window.dispatchEvent(new CustomEvent("presentflow:restart-audio")); } catch {} }}
            className="h-8 px-3 rounded-md border text-[11px] font-medium text-zinc-100 hover:bg-white/5"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}
          >
            ↻ Restart AI listener
          </button>
          {/* 2026-07-25 — Diagnostics scanner: tests every audio input in
              turn, shows which have live signal. Use when you're not sure
              which USB device is carrying the mixer's feed. */}
          <button
            onClick={() => setDiagOpen(true)}
            className="h-8 px-3 rounded-md border text-[11px] font-medium text-zinc-100 hover:bg-white/5 inline-flex items-center gap-1.5"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}
            title="Scan every audio input and report which have live signal"
          >
            <Stethoscope className="w-3.5 h-3.5" />
            Run diagnostics
          </button>
        </div>
      </Row>
      {diagOpen && (
        <AudioDiagnosticsScan
          onClose={() => setDiagOpen(false)}
          onSelectDevice={(id, label) => persistSelection({ kind: "device", id, label })}
        />
      )}

      <Row label="Transcription Mode">
        <div className="inline-flex rounded-md p-0.5" style={{ background: "#1a2020", border: "1px solid #2a3232" }}>
          {(["online", "offline"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); try { localStorage.setItem(TRANSCRIPTION_MODE_KEY, m); } catch {} }}
              className={"h-6 px-3 rounded text-[11px] font-medium capitalize " + (mode === m ? "text-white" : "text-zinc-400 hover:text-zinc-200")}
              style={mode === m ? { background: "#f97316" } : {}}
            >
              {m}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Audio Input">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              className="h-8 min-w-[260px] px-3 rounded-md border text-[11px] text-zinc-100 hover:bg-white/5 inline-flex items-center justify-between gap-2"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}
            >
              <span className="truncate">{selected.label}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={4}
              align="end"
              className="z-[70] w-[320px] max-h-[380px] overflow-y-auto rounded-md border shadow-2xl p-2"
              style={{ borderColor: "#2a3232", background: "#1e2525" }}
            >
              {/* 2026-07-26 NDI rewrite. Old design: showed hardcoded NDI
                  placeholder entries + a "kind: ndi" pref shape that
                  audioConstraintsFor didn't actually implement — selecting
                  one silently captured the DEFAULT mic instead of NDI.
                  New design: NDI devices are real audio inputs created by
                  NDI Virtual Input (nditools.tv). If installed, they show
                  up in the standard device list with "NDI" in the label,
                  ranked first + tagged with a NETWORK label so operators
                  know which entry to pick. No entries below? → show the
                  install prompt at the bottom of the popover. */}
              <Group label="Audio inputs">
                {devices.length === 0 && <Empty>No microphones detected</Empty>}
                {(() => {
                  // 2026-07-27 — device categorization now imported from
                  // src/lib/audio/deviceCategorization.ts (single source of
                  // truth shared with the sidebar popover + diagnostics
                  // scanner). The old inline regexes were duplicated in 3
                  // files and prone to drift.
                  const sorted = [...devices].sort((a, b) => {
                    const ra = categoryRank(categorizeDevice(a.label));
                    const rb = categoryRank(categorizeDevice(b.label));
                    if (ra !== rb) return ra - rb;
                    return (a.label || "").localeCompare(b.label || "");
                  });
                  return sorted.map((d) => {
                    const ndi = isNdiDevice(d.label);
                    const mixer = !ndi && isMixerDevice(d.label);
                    return (
                      <Item
                        key={d.deviceId}
                        selected={selected.kind === "device" && selected.id === d.deviceId}
                        onClick={() => persistSelection({ kind: "device", id: d.deviceId, label: d.label || (ndi ? "NDI Audio" : "Microphone") })}
                      >
                        <span className="inline-flex items-center gap-1.5">
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
                              title="USB audio interface / mixer / loopback bridge — best signal quality, Source Type should be Mixer / Interface"
                            >
                              MIXER
                            </span>
                          )}
                          <span className="truncate">{d.label || "Microphone"}</span>
                        </span>
                      </Item>
                    );
                  });
                })()}
              </Group>
              {/* NDI helper — only shows if NO NDI-labeled device is present.
                  Common at JPD when NDI Tools isn't installed on the Mac. */}
              {!devices.some((d) => isNdiDevice(d.label)) && (
                <div className="px-2 py-2 mt-1 border-t text-[10px] leading-snug text-zinc-400 space-y-1" style={{ borderColor: "#2a3232" }}>
                  <div className="font-semibold text-zinc-300">Using NDI at your church?</div>
                  <div>No NDI device is showing up here yet. Three things to check, in order:</div>
                  <ol className="list-decimal pl-4 space-y-0.5">
                    <li>Is <span className="font-mono text-zinc-300">NDI Virtual Input.app</span> actually <strong>open</strong>? Check your macOS menu bar for the NDI icon. If not there, open it from Applications → NDI Tools folder</li>
                    <li>Click that NDI menu-bar icon → pick your church's NDI source (checkmark = active)</li>
                    <li>macOS System Settings → Sound → Input should list "NDI Video" or similar. Then this picker refreshes on the next open</li>
                  </ol>
                  <div className="pt-1">Don't have NDI Tools installed? Grab it free from <a href="https://ndi.video/tools/" target="_blank" rel="noopener noreferrer" className="text-[#f97316] underline">ndi.video/tools</a></div>
                </div>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </Row>

      {/* --- Channel Grid (multi-channel USB mixer picker) ---------------- */}
      {selected.kind === "device" && capsProbed && channelCount > 1 && (() => {
        const guide = findGuideForDevice(selected.label);
        return (
          <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: "#2a3232", background: "#171c1c" }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-zinc-100 uppercase tracking-wider">Channels</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {channelCount} channels · Mode: {gridMode === "sum-all" ? "Sum all" : gridMode === "mono" ? "Mono" : "Stereo"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAutoDetectOpen(true)}
                  className="h-8 px-3 rounded-md text-[11px] font-semibold text-white inline-flex items-center gap-1.5"
                  style={{ background: "#f97316" }}
                  title="Listen for 5s and suggest the loudest vocal-band channel"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Auto-detect vocal
                </button>
                <button
                  onClick={handleClearChannelPref}
                  className="h-8 px-3 rounded-md border text-[11px] font-medium text-zinc-300 hover:bg-white/5"
                  style={{ borderColor: "#2a3232", background: "#1a2020" }}
                  title="Reset to default sum-all mode for this device"
                >
                  Clear channel preference
                </button>
              </div>
            </div>

            {captureError && (
              <div className="px-3 py-2 rounded text-[11px] leading-snug border" style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}>
                Multi-channel scan failed — using sum-all mode. ({captureError})
              </div>
            )}

            {!captureError && (
              <>
                {/* Mode toggle */}
                <div className="inline-flex rounded-md p-0.5" style={{ background: "#1a2020", border: "1px solid #2a3232" }}>
                  {(["sum-all", "mono", "stereo"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => handleGridModeChange(m)}
                      className={"h-7 px-3 rounded text-[11px] font-medium capitalize " + (gridMode === m ? "text-white" : "text-zinc-400 hover:text-zinc-200")}
                      style={gridMode === m ? { background: "#f97316" } : {}}
                    >
                      {m === "sum-all" ? "Sum all" : m}
                    </button>
                  ))}
                </div>

                {gridMode === "sum-all" && (
                  <div className="text-[11px] leading-snug text-zinc-500">
                    All channels summed to mono. Pick a specific channel for cleaner vocal capture.
                  </div>
                )}
                {gridMode === "stereo" && selectedChannels.length === 1 && (
                  <div className="text-[11px] leading-snug text-zinc-500">
                    Click a second channel to pair, or a single channel to auto-pair with its neighbour.
                  </div>
                )}

                {/* Grid: 4 per row in settings (bigger cards) */}
                <div className="grid grid-cols-4 gap-2">
                  {levels.length === 0 && Array.from({ length: Math.min(channelCount, 8) }).map((_, i) => (
                    <div key={`ph-${i}`} className="h-24 rounded border animate-pulse" style={{ borderColor: "#2a3232", background: "#1a2020" }} />
                  ))}
                  {levels.map((lv, n) => {
                    const isSel = selectedChannels.includes(n);
                    const isActive = activeMap[n] === true;
                    const rmsPct = Math.min(100, Math.round(lv.rms * 100));
                    const vocalPct = Math.min(100, Math.round(lv.vocalBandEnergy * 100));
                    const ratio = lv.vocalBandEnergy / Math.max(lv.rms, 0.001);
                    return (
                      <button
                        key={n}
                        onClick={() => handleChannelClick(n)}
                        className="relative h-24 rounded overflow-hidden text-left"
                        style={{
                          border: isSel ? "2px solid #f97316" : "1px solid #2a3232",
                          background: "#1a2020",
                        }}
                        title={`Channel ${n + 1}`}
                      >
                        {/* RMS meter fill (orange) */}
                        <div
                          className="absolute left-0 right-0 bottom-0"
                          style={{ height: `${rmsPct}%`, background: "linear-gradient(180deg, rgba(249,115,22,0.55), rgba(249,115,22,0.25))" }}
                        />
                        {/* Vocal band overlay (yellow) */}
                        <div
                          className="absolute left-0 right-0 bottom-0"
                          style={{ height: `${vocalPct}%`, background: "rgba(250,204,21,0.35)" }}
                        />
                        <div className="absolute top-1.5 left-2 text-[11px] font-semibold text-zinc-100">Ch {n + 1}</div>
                        {isActive && (
                          <div className="absolute top-1.5 right-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-green-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Active
                          </div>
                        )}
                        <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-[9px] font-mono text-zinc-300">
                          <span>Peak {lv.peak.toFixed(2)}</span>
                          <span>Ratio {ratio.toFixed(2)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Gain slider */}
                <div className="flex items-center gap-3">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 shrink-0">Gain</div>
                  <input
                    type="range"
                    min={-24}
                    max={24}
                    step={1}
                    value={gainDb}
                    onChange={(e) => handleChannelGainDrag(Number(e.target.value) || 0)}
                    onMouseUp={commitChannelGainIfDirty}
                    onTouchEnd={commitChannelGainIfDirty}
                    onKeyUp={commitChannelGainIfDirty}
                    onBlur={commitChannelGainIfDirty}
                    className="flex-1 accent-orange-500"
                    aria-label="Channel gain"
                  />
                  <div className="text-[11px] text-zinc-100 font-mono w-16 text-right">{gainDb > 0 ? "+" : ""}{gainDb} dB</div>
                </div>

                {/* Setup guide (default OPEN in settings) */}
                {guide && (
                  <div className="border-t pt-3" style={{ borderColor: "#2a3232" }}>
                    <button
                      onClick={() => setGuideOpen((v) => !v)}
                      className="w-full flex items-center gap-1 text-left text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
                    >
                      {guideOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      Setup guide: {guide.displayName}
                    </button>
                    {guideOpen && (
                      <ol className="mt-2 px-4 py-3 rounded space-y-1.5 text-[11px] leading-snug text-zinc-300 list-decimal list-inside" style={{ background: "#1a2020" }}>
                        {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
                        {guide.tips && guide.tips.length > 0 && (
                          <div className="mt-2 pt-2 border-t space-y-1" style={{ borderColor: "#2a3232" }}>
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Tips</div>
                            {guide.tips.map((t, i) => <div key={i} className="text-zinc-400">• {t}</div>)}
                          </div>
                        )}
                        {guide.vocalChannelHint && (
                          <div className="mt-2 pt-2 border-t text-zinc-100" style={{ borderColor: "#2a3232" }}>
                            <span className="font-semibold">Vocal hint: </span>{guide.vocalChannelHint}
                          </div>
                        )}
                      </ol>
                    )}
                  </div>
                )}
              </>
            )}

            {autoDetectOpen && (
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
          </div>
        );
      })()}

      {/* Source type — decides whether Chromium's echo cancellation, noise
          suppression, and auto-gain-control are ON or OFF for capture.
          Church mixer feed → OFF (default, don't degrade a clean signal).
          Bare microphone in the room → ON (want the DSP fighting HVAC + echo). */}
      <Row label="Source Type">
        <div className="inline-flex rounded-md p-0.5" style={{ background: "#1a2020", border: "1px solid #2a3232" }}>
          {(["mixer", "microphone"] as const).map((t) => (
            <button
              key={t}
              onClick={() => persistSourceType(t)}
              className={"h-6 px-3 rounded text-[11px] font-medium capitalize " + (sourceType === t ? "text-white" : "text-zinc-400 hover:text-zinc-200")}
              style={sourceType === t ? { background: "#f97316" } : {}}
              title={t === "mixer"
                ? "Mixer / audio interface — DSP OFF, keep the clean signal untouched"
                : "Bare microphone — DSP ON to fight room noise + echo"}
            >
              {t === "mixer" ? "Mixer / Interface" : "Microphone"}
            </button>
          ))}
        </div>
      </Row>
      <div className="text-[11px] text-zinc-500 -mt-2 pl-2">
        {sourceType === "mixer"
          ? "Echo cancellation, noise suppression, and auto-gain are OFF — sending the mixer's raw feed straight to the AI."
          : "Echo cancellation, noise suppression, and auto-gain are ON — good for a bare mic in a noisy room."}
      </div>

      {/* 2026-07-25 distant-mic improvements — mic boost + rumble filter feed
          the REAL capture pipeline (useAudioStream inserts a GainNode +
          100 Hz high-pass before the worklet). Changes restart the listener
          via the same audio-input-changed event device switches use. */}
      {(() => {
        // Mixer feeds cap at 2x (line-level signal clips at 3x — see the
        // matching clamp in useAudioStream's pipeline build); mics get 3x.
        const maxBoost = sourceType === "microphone" ? 3 : 2;
        const effectiveBoost = Math.min(maxBoost, micBoost ?? (sourceType === "microphone" ? 1.5 : 1));
        const effectiveHp = highpassOn ?? (sourceType === "microphone");
        const restartPipeline = () => {
          try { window.dispatchEvent(new CustomEvent("presentflow:audio-input-changed", { detail: { reason: "mic-preprocessing" } })); } catch {}
        };
        return (
          <>
            <Row label={`Mic Boost — ${effectiveBoost.toFixed(1)}x${micBoost === null ? " (auto)" : ""}`}>
              <input
                type="range"
                min={1}
                max={maxBoost}
                step={0.1}
                value={effectiveBoost}
                onChange={(e) => {
                  const v = Math.min(maxBoost, Math.max(1, Number(e.target.value) || 1));
                  setMicBoost(v);
                  try { localStorage.setItem(MIC_BOOST_KEY, String(v)); } catch {}
                }}
                onMouseUp={restartPipeline}
                onTouchEnd={restartPipeline}
                onKeyUp={restartPipeline}
                onBlur={restartPipeline}
                className="w-[220px] accent-orange-500"
                aria-label="Microphone boost multiplier"
              />
            </Row>
            <div className="text-[11px] text-zinc-500 -mt-2 pl-2">
              Amplifies quiet audio before transcription. Use 1.5–2x for a room mic picking up a distant preacher; leave at 1x for a mixer feed.
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-zinc-100">Reduce low-frequency rumble</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Cuts audio below 100 Hz (HVAC, traffic, stage bass) before it reaches the AI. Recommended for room microphones.</div>
              </div>
              <Toggle
                on={effectiveHp}
                onChange={(v) => {
                  setHighpassOn(v);
                  try { localStorage.setItem(MIC_HIGHPASS_KEY, v ? "1" : "0"); } catch {}
                  restartPipeline();
                }}
              />
            </div>
          </>
        );
      })()}

      {/* The old "Input Gain" slider was removed 2026-07-25 (reviewer 🟡):
          it persisted INPUT_GAIN_KEY but nothing in the capture pipeline
          ever read it — a decorative control sitting next to the real
          Mic Boost slider above was actively misleading. */}

      <div className="pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-zinc-100">Auto-pause capture during long silence — not recommended for live services</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">Off by default: once AI is ON it stays ON until you turn it off. Turning this on closes the transcription connection after 30 min without speech to save cost — you&apos;ll have to restart AI by hand if the service goes quiet that long.</div>
          </div>
          <Toggle
            on={autoPause}
            onChange={(v) => { setAutoPause(v); try { localStorage.setItem(AUTO_PAUSE_KEY, v ? "1" : "0"); } catch {} }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-zinc-100">Auto-advance verses (seconds)</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">When AutoApprove is ON and a multi-verse range is detected, advance every N seconds. 0 = manual (default).</div>
          </div>
          <input
            type="number"
            min={0}
            max={120}
            step={1}
            value={autoAdvanceSec}
            onChange={(e) => {
              const n = Math.max(0, Math.min(120, Number(e.target.value) || 0));
              setAutoAdvanceSec(n);
              try { localStorage.setItem(AUTO_ADVANCE_KEY, String(n)); } catch {}
            }}
            className="w-20 h-8 px-2 rounded-md text-[12px] text-zinc-100 text-right"
            style={{ background: "#1a2020", border: "1px solid #2a3232" }}
            aria-label="Auto-advance seconds"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-zinc-100">Hold Bible auto-approve during active song</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">When ON, a Bible detection won't cut over the projector while a song is currently live. Operator advances past the song first.</div>
          </div>
          <Toggle
            on={holdDuringSong}
            onChange={(v) => { setHoldDuringSong(v); try { localStorage.setItem(HOLD_DURING_SONG_KEY, v ? "1" : "0"); } catch {} }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-zinc-100">Voice Commands</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">Scan speech for command phrases like "next verse".</div>
          </div>
          <Toggle
            on={voiceOn}
            onChange={(v) => { setVoiceOn(v); try { localStorage.setItem(VOICE_COMMANDS_KEY, v ? "1" : "0"); } catch {} }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-zinc-100">Contextual awareness <span className="text-[9px] uppercase tracking-wide text-amber-400/80 ml-1">beta</span></div>
            <div className="text-[11px] text-zinc-500 mt-0.5">Understands the moment — holds a song when a prayer/sermon just uses worship words (“in the mighty name of Jesus”), and won’t step a verse on an ambiguous “continue” mid-story. Takes effect on the next detection.</div>
          </div>
          <Toggle
            on={contextEngineOn}
            onChange={(v) => { setContextEngineOn(v); try { localStorage.setItem(CONTEXT_ENGINE_KEY, v ? "1" : "0"); } catch {} }}
          />
        </div>

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Add custom voice command</div>
          <div className="flex items-center gap-2">
            <input
              value={newPhrase}
              onChange={(e) => setNewPhrase(e.target.value)}
              placeholder="e.g. go forward"
              className="flex-1 h-8 px-2 rounded-md border text-[11px] text-zinc-100 placeholder:text-zinc-500"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}
            />
            <select
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              className="h-8 px-2 rounded-md border text-[11px] text-zinc-100"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}
            >
              {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <button
              onClick={addCustom}
              className="h-8 px-3 rounded-md text-[11px] font-semibold text-white inline-flex items-center gap-1"
              style={{ background: "#f97316" }}
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>

        {customs.length > 0 && (
          <div className="space-y-1">
            {customs.map((c) => (
              <div key={c.id} className="flex items-center justify-between h-8 px-2 rounded border" style={{ borderColor: "#2a3232", background: "#171c1c" }}>
                <div className="text-[11px] text-zinc-200">
                  <span className="font-mono">{c.phrase}</span>
                  <span className="text-zinc-500 ml-2">→ {ACTIONS.find((a) => a.value === c.action)?.label || c.action}</span>
                </div>
                <button
                  onClick={() => persistCustoms(customs.filter((x) => x.id !== c.id))}
                  className="text-zinc-500 hover:text-zinc-200"
                  aria-label="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-2">Built-in</div>
          <div className="flex flex-wrap gap-1.5">
            {BUILT_IN_COMMANDS.map((p) => (
              <span key={p} className="text-[10px] px-2 py-0.5 rounded-full font-mono" style={{ background: "#1a2020", color: "#a3a3a3", border: "1px solid #2a3232" }}>{p}</span>
            ))}
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t" style={{ borderColor: "#2a3232" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-semibold text-zinc-100">Custom Vocabulary</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                Names, places, and song titles the AI keeps mishearing — e.g. pastor names, Nigerian names, your church's name. Applied next time the listener (re)starts.
              </div>
            </div>
            <div className="text-[10px] text-zinc-500 whitespace-nowrap ml-3">{vocab.length} / {MAX_VOCABULARY_TERMS} terms</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={newVocabTerm}
              onChange={(e) => setNewVocabTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newVocabTerm.trim()) {
                  setVocab(addVocabularyTerm(newVocabTerm));
                  setNewVocabTerm("");
                }
              }}
              placeholder="e.g. Pastor Adeboye"
              className="flex-1 h-8 px-2 rounded-md border text-[11px] text-zinc-100 placeholder:text-zinc-500"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}
            />
            <button
              onClick={() => {
                if (!newVocabTerm.trim()) return;
                setVocab(addVocabularyTerm(newVocabTerm));
                setNewVocabTerm("");
              }}
              disabled={vocab.length >= MAX_VOCABULARY_TERMS}
              className="h-8 px-3 rounded-md text-[11px] font-semibold text-white inline-flex items-center gap-1 disabled:opacity-50"
              style={{ background: "#f97316" }}
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
          {vocab.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {vocab.map((t) => (
                <span
                  key={t.toLowerCase()}
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: "#1a2020", color: "#d4d4d4", border: "1px solid #2a3232" }}
                >
                  {t}
                  <button
                    onClick={() => setVocab(removeVocabularyTerm(t))}
                    className="text-zinc-500 hover:text-zinc-200"
                    aria-label={`Remove ${t}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 px-2 py-1">{label}</div>
      {children}
    </div>
  );
}
function Item({ children, selected, onClick }: { children: React.ReactNode; selected?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={"w-full text-left px-2 py-1.5 rounded text-[11px] " + (selected ? "text-white" : "text-zinc-200 hover:bg-white/5")}
      style={selected ? { background: "rgba(249,115,22,0.15)" } : {}}
    >
      {children}
    </button>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1.5 text-[11px] text-zinc-500 italic">{children}</div>;
}
