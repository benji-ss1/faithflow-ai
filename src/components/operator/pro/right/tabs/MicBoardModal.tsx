"use client";
/**
 * MicBoardModal — the multi-mic "board" (increment 2b).
 *
 * Presents every channel of a multi-channel USB mixer (X32 / XR18 / A&H SQ / …)
 * as a LABELED strip with a live VU meter, per-strip Mute / Duck / trim, and a
 * LEAD selector that chooses which single channel the AI (Deepgram) listens to.
 *
 * Built ON TOP of the existing capture engine — it never changes how audio is
 * captured. It opens its own preview `MultiChannelCapture` for live metering and
 * to apply mute/trim in the preview, and persists everything to the shared
 * `deviceChannelPrefs` store. Choosing a LEAD writes `aiListenChannel` AND sets
 * `mode:"mono", selectedChannels:[lead]`, which the live `useAudioStream` hook
 * already honours (it routes that channel to Deepgram) — so the lead pick flows
 * to the AI through the proven existing wiring, with no changes to the hook.
 *
 * Colours use the app reskin tokens (--color-brand, --color-success, …).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Crown, VolumeX, ChevronDown, Mic } from "lucide-react";
import {
  openMultiChannelCapture,
  type MultiChannelCapture,
  type ChannelLevels,
} from "@/lib/audio/multiChannelCapture";
import {
  readDeviceChannelPref,
  writeDeviceChannelPref,
  type DeviceChannelPref,
} from "@/lib/audio/deviceChannelPrefs";

// Ducking attenuates a channel without silencing it — enough to push background
// singers under the lead while still hearing them in the monitor.
const DUCK_DB = -14;
// Speech-vs-singing badge thresholds, re-calibrated 2026-08-20 against a real
// 30-min CHOIR recording. Choir singing is BURSTIER than sustained solo worship
// (per-frame speechiness mean 0.36 / median 0.30 / p90 0.63 vs a solo worship
// clip's ~0.24), so at the old 0.45/0.32 thresholds ~22% of choir frames wrongly
// read as PREACHER. Fix: SMOOTH the per-channel signal (SPEECH_EMA) so brief
// syllable bursts don't flicker the badge, and lift the thresholds so smoothed
// choir (~0.36) reads 🎶 while smoothed preaching (~0.54) reads 🎤.
const PREACHER_SPEECHY = 0.50;
const SINGING_SPEECHY = 0.40;
const SPEECH_EMA = 0.12; // per-channel exponential smoothing on speechiness

interface MicBoardModalProps {
  open: boolean;
  onClose: () => void;
  deviceId: string;
  deviceLabel: string;
  /** Best-known channel count for the device (the capture may report its own). */
  channelCount: number;
}

export function MicBoardModal({ open, onClose, deviceId, deviceLabel, channelCount }: MicBoardModalProps) {
  const captureRef = useRef<MultiChannelCapture | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeSinceRef = useRef<number[]>([]);
  const speechEmaRef = useRef<number[]>([]); // per-channel smoothed speechiness
  const gainsRef = useRef<Record<number, number>>({}); // latest gains for commit-on-release

  const [chCount, setChCount] = useState(Math.max(1, channelCount));
  const [levels, setLevels] = useState<ChannelLevels[]>([]);
  const [active, setActive] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Board state (mirrors the persisted pref).
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [ducked, setDucked] = useState<Set<number>>(new Set());
  const [gains, setGains] = useState<Record<number, number>>({});
  const [lead, setLead] = useState<number | null>(null);

  // Load persisted board state whenever the device changes / the modal opens.
  useEffect(() => {
    if (!open) return;
    const pref = readDeviceChannelPref(deviceId);
    setLabels(pref?.channelLabels ?? {});
    setMuted(new Set(pref?.mutedChannels ?? []));
    setDucked(new Set(pref?.duckedChannels ?? []));
    const g0 = pref?.channelGainDb ?? {};
    setGains(g0);
    gainsRef.current = g0;
    // Derive the displayed lead from what actually ROUTES to the AI: a mono
    // single-channel selection IS the lead (useAudioStream routes off
    // selectedChannels). Fall back to the stored aiListenChannel otherwise.
    setLead(
      pref?.mode === "mono" && pref.selectedChannels?.length === 1
        ? pref.selectedChannels[0]!
        : typeof pref?.aiListenChannel === "number"
          ? pref.aiListenChannel
          : null,
    );
  }, [open, deviceId]);

  // Open the preview capture + poll levels at ~20fps while the modal is open.
  useEffect(() => {
    if (!open || !deviceId) return;
    let cancelled = false;
    const teardown = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (captureRef.current) { try { captureRef.current.close(); } catch { /* noop */ } captureRef.current = null; }
    };
    (async () => {
      try {
        const cap = await openMultiChannelCapture({ deviceId, requestedChannels: Math.max(2, channelCount) });
        if (cancelled) { try { cap.close(); } catch { /* noop */ } return; }
        captureRef.current = cap;
        setChCount(cap.channelCount);
        setError(null);
        // Re-apply persisted mute/trim to the freshly opened preview capture.
        const pref = readDeviceChannelPref(deviceId);
        for (let i = 0; i < cap.channelCount; i += 1) {
          const g = pref?.channelGainDb?.[i] ?? 0;
          const isDuck = (pref?.duckedChannels ?? []).includes(i);
          cap.setChannelGain(i, g + (isDuck ? DUCK_DB : 0));
          cap.setChannelMuted(i, (pref?.mutedChannels ?? []).includes(i));
        }
        pollRef.current = setInterval(() => {
          const c = captureRef.current;
          if (!c) return;
          try {
            const l = c.readLevels();
            const now = Date.now();
            const since = activeSinceRef.current;
            const ema = speechEmaRef.current;
            const act: boolean[] = new Array(l.length);
            for (let i = 0; i < l.length; i += 1) {
              if (l[i]!.rms > 0.02) since[i] = now;
              act[i] = (since[i] ?? 0) > now - 250;
              // Smooth speechiness per channel so a burst of choir syllables can't
              // flicker the 🎤/🎶 badge (choir singing is bursty — calibration above).
              const prev = ema[i];
              const sm = prev === undefined ? l[i]!.speechiness : prev + SPEECH_EMA * (l[i]!.speechiness - prev);
              ema[i] = sm;
              l[i]!.speechiness = sm;
            }
            setLevels(l);
            setActive(act);
          } catch { /* noop */ }
        }, 100);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't open the mixer for metering");
      }
    })();
    return () => { cancelled = true; teardown(); };
  }, [open, deviceId, channelCount]);

  // Persist the current board state to the shared pref. Choosing a lead also
  // routes that channel to the live AI feed via the existing selectedChannels
  // wiring (mode "mono", selectedChannels [lead]).
  // Persist the changed field over the LAST-PERSISTED pref (source of truth),
  // never over possibly-stale closure state — so two board edits before a React
  // flush can't clobber each other's fields. Only the field present in `next` is
  // overwritten; everything else is carried from `existing`.
  const persist = useCallback((next: {
    labels?: Record<number, string>;
    muted?: Set<number>;
    ducked?: Set<number>;
    gains?: Record<number, number>;
    lead?: number | null;
  }) => {
    const existing = readDeviceChannelPref(deviceId);
    const L = next.labels ?? existing?.channelLabels ?? {};
    const M = next.muted ? Array.from(next.muted) : (existing?.mutedChannels ?? []);
    const D = next.ducked ? Array.from(next.ducked) : (existing?.duckedChannels ?? []);
    const G = next.gains ?? existing?.channelGainDb ?? {};
    const LEAD = next.lead !== undefined
      ? next.lead
      : (typeof existing?.aiListenChannel === "number" ? existing.aiListenChannel : null);
    const pref: DeviceChannelPref = {
      deviceId,
      deviceLabel,
      // A chosen lead routes the AI to that single channel; otherwise keep
      // whatever routing was already stored (default sum-all).
      mode: LEAD != null ? "mono" : (existing?.mode ?? "sum-all"),
      selectedChannels: LEAD != null ? [LEAD] : (existing?.selectedChannels ?? []),
      gainDb: existing?.gainDb ?? 0,
      autoDetected: existing?.autoDetected ?? false,
      updatedAt: Date.now(),
      channelLabels: L,
      mutedChannels: M,
      duckedChannels: D,
      channelGainDb: G,
      aiListenChannel: LEAD,
    };
    writeDeviceChannelPref(pref);
  }, [deviceId, deviceLabel]);

  const effectiveGain = (ch: number, g: Record<number, number>, d: Set<number>) =>
    (g[ch] ?? 0) + (d.has(ch) ? DUCK_DB : 0);

  const setLabel = (ch: number, value: string) => {
    const next = { ...labels };
    if (value.trim()) next[ch] = value.slice(0, 40); else delete next[ch];
    setLabels(next);
    persist({ labels: next });
  };

  const toggleMuted = (ch: number) => {
    const next = new Set(muted);
    if (next.has(ch)) next.delete(ch); else next.add(ch);
    setMuted(next);
    captureRef.current?.setChannelMuted(ch, next.has(ch));
    persist({ muted: next });
  };

  const toggleDucked = (ch: number) => {
    const next = new Set(ducked);
    if (next.has(ch)) next.delete(ch); else next.add(ch);
    setDucked(next);
    captureRef.current?.setChannelGain(ch, effectiveGain(ch, gains, next));
    persist({ ducked: next });
  };

  // Gain drag: apply to the PREVIEW capture live (cheap, local) on every change,
  // but PERSIST only on release. Per-pixel persistence would storm localStorage
  // (full parse+serialize each pixel) and fire the pref-changed event repeatedly
  // — mirrors AudioTab's own commit-on-release gain slider.
  const applyGain = (ch: number, db: number) => {
    const next = { ...gainsRef.current, [ch]: db };
    gainsRef.current = next;
    setGains(next);
    captureRef.current?.setChannelGain(ch, effectiveGain(ch, next, ducked));
  };
  const commitGain = () => {
    persist({ gains: gainsRef.current });
  };

  const chooseLead = (ch: number) => {
    const next = lead === ch ? null : ch;
    setLead(next);
    persist({ lead: next });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(1100px,94vw)] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-xl border shadow-2xl overflow-hidden"
          style={{ background: "var(--color-panel)", borderColor: "var(--color-border)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Mic className="w-4 h-4 shrink-0" style={{ color: "var(--color-brand)" }} />
              <div className="min-w-0">
                <Dialog.Title className="text-[13px] font-semibold text-[var(--color-foreground)] truncate">Mic Board</Dialog.Title>
                <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">{deviceLabel} · {chCount} channels</div>
              </div>
            </div>
            <Dialog.Close asChild>
              <button aria-label="Close" className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Hint bar */}
          <div className="px-5 py-2 text-[11px] text-[var(--color-muted-foreground)] border-b" style={{ borderColor: "var(--color-border)" }}>
            Label each mic, then set the <span className="font-semibold" style={{ color: "var(--color-brand)" }}>Lead</span> — the one mic the AI listens to. Mute or duck background singers so the preacher stays clear. 🎤 = speech · 🎶 = singing.
          </div>

          {error && (
            <div className="px-5 py-2 text-[11px] border-b" style={{ borderColor: "var(--color-border)", color: "var(--color-warning)", background: "color-mix(in oklab, var(--color-warning) 8%, transparent)" }}>
              {error}
            </div>
          )}

          {/* Strips */}
          <div className="overflow-auto p-4">
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
              {Array.from({ length: chCount }).map((_, ch) => {
                const lv = levels[ch];
                const rmsPct = lv ? Math.min(100, Math.round(lv.rms * 140)) : 0;
                const vocalPct = lv ? Math.min(100, Math.round(lv.vocalBandEnergy * 140)) : 0;
                const isLead = lead === ch;
                const isMuted = muted.has(ch);
                const isDucked = ducked.has(ch);
                const isActive = active[ch] === true;
                const speechy = lv?.speechiness ?? 0;
                const badge = isActive && speechy >= PREACHER_SPEECHY ? "🎤" : isActive && speechy > 0 && speechy < SINGING_SPEECHY ? "🎶" : "";
                const gainDb = gains[ch] ?? 0;
                return (
                  <div
                    key={ch}
                    className="flex flex-col rounded-lg border overflow-hidden transition-colors"
                    style={{
                      borderColor: isLead ? "var(--color-brand)" : "var(--color-border)",
                      background: "var(--color-elevated)",
                      boxShadow: isLead ? "0 0 0 1px var(--color-brand)" : "none",
                      opacity: isMuted ? 0.72 : 1,
                    }}
                  >
                    {/* Label row */}
                    <div className="flex items-center gap-1 px-2 pt-2">
                      <input
                        value={labels[ch] ?? ""}
                        placeholder={`Ch ${ch + 1}`}
                        onChange={(e) => setLabel(ch, e.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none"
                      />
                      {badge && <span className="text-[12px] leading-none" title={speechy >= PREACHER_SPEECHY ? "Sounds like speech" : "Sounds like singing"}>{badge}</span>}
                    </div>
                    <div className="px-2 text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">Ch {ch + 1}</div>

                    {/* VU meter */}
                    <div className="mx-2 mt-1.5 mb-2 relative rounded-md overflow-hidden" style={{ height: 96, background: "rgba(0,0,0,0.35)" }}>
                      <div className="absolute inset-x-0 bottom-0" style={{
                        height: `${rmsPct}%`,
                        background: isMuted
                          ? "color-mix(in oklab, var(--color-muted-foreground) 35%, transparent)"
                          : "linear-gradient(180deg, var(--color-success), color-mix(in oklab, var(--color-success) 55%, transparent))",
                      }} />
                      <div className="absolute inset-x-0 bottom-0" style={{ height: `${vocalPct}%`, background: "color-mix(in oklab, var(--color-warning) 25%, transparent)" }} />
                      {isActive && !isMuted && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-success)" }} />
                      )}
                      {isDucked && (
                        <span className="absolute top-1 left-1 text-[8px] font-bold uppercase tracking-wider" style={{ color: "var(--color-warning)" }}>Duck</span>
                      )}
                    </div>

                    {/* Gain */}
                    <div className="px-2 flex items-center gap-1.5">
                      <input
                        type="range" min={-24} max={24} step={1} value={gainDb}
                        onChange={(e) => applyGain(ch, Number(e.target.value) || 0)}
                        onMouseUp={commitGain}
                        onTouchEnd={commitGain}
                        onKeyUp={commitGain}
                        onBlur={commitGain}
                        className="flex-1 accent-[var(--color-brand)]"
                        aria-label={`Channel ${ch + 1} gain`}
                      />
                      <span className="w-9 text-right text-[10px] font-mono text-[var(--color-muted-foreground)]">{gainDb > 0 ? "+" : ""}{gainDb}</span>
                    </div>

                    {/* Controls */}
                    <div className="flex items-stretch gap-1 p-2 pt-1.5">
                      <button
                        onClick={() => chooseLead(ch)}
                        title="Set as the mic the AI listens to"
                        className="flex-1 h-7 inline-flex items-center justify-center gap-1 rounded-md text-[10px] font-semibold transition-colors"
                        style={isLead
                          ? { background: "var(--color-brand)", color: "var(--color-primary-foreground)" }
                          : { background: "var(--color-panel)", color: "var(--color-muted-foreground)", border: "1px solid var(--color-border)" }}
                      >
                        <Crown className="w-3 h-3" /> {isLead ? "Lead" : "Lead"}
                      </button>
                      <button
                        onClick={() => toggleDucked(ch)}
                        title="Duck — lower this mic under the lead"
                        className="h-7 px-2 inline-flex items-center justify-center rounded-md text-[10px] font-semibold transition-colors"
                        style={isDucked
                          ? { background: "var(--color-warning)", color: "var(--color-primary-foreground)" }
                          : { background: "var(--color-panel)", color: "var(--color-muted-foreground)", border: "1px solid var(--color-border)" }}
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => toggleMuted(ch)}
                        title={isMuted ? "Un-mute" : "Mute"}
                        className="h-7 px-2 inline-flex items-center justify-center rounded-md text-[10px] font-semibold transition-colors"
                        style={isMuted
                          ? { background: "var(--color-destructive)", color: "var(--color-primary-foreground)" }
                          : { background: "var(--color-panel)", color: "var(--color-muted-foreground)", border: "1px solid var(--color-border)" }}
                      >
                        <VolumeX className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: "var(--color-border)" }}>
            <div className="text-[11px] text-[var(--color-muted-foreground)]">
              {lead != null
                ? <>AI is listening to <span className="font-semibold" style={{ color: "var(--color-brand)" }}>{labels[lead] || `Ch ${lead + 1}`}</span>.</>
                : <>No lead set — the AI hears the summed mix. Pick a Lead for cleaner detection.</>}
            </div>
            <button onClick={onClose} className="h-8 px-4 rounded-md text-[12px] font-semibold" style={{ background: "var(--color-brand)", color: "var(--color-primary-foreground)" }}>
              Done
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
