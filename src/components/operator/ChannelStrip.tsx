"use client";
/**
 * ChannelStrip — compact per-channel level meter strip for the operator sidebar.
 *
 * Shows live per-channel levels from the active MultiChannelCapture. Clicking a
 * channel switches the audio pipeline to that channel via hot-swap (no restart).
 * The currently-selected channel is highlighted. Channels can be labelled by the
 * operator (right-click → rename).
 *
 * Only renders when a multi-channel device is active; returns null otherwise.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { MultiChannelCapture, ChannelLevels } from "@/lib/audio/multiChannelCapture";
import {
  readDeviceChannelPref,
  writeDeviceChannelPref,
  type DeviceChannelPref,
} from "@/lib/audio/deviceChannelPrefs";

interface ChannelStripProps {
  /** The active multi-channel capture instance (null when not multi-channel). */
  capture: MultiChannelCapture | null;
  /** The deviceId of the currently active device. */
  deviceId: string | null;
}

const METER_FPS = 15; // ~67ms per frame — enough for visual meters, low CPU

export function ChannelStrip({ capture, deviceId }: ChannelStripProps) {
  const [levels, setLevels] = useState<ChannelLevels[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [channelLabels, setChannelLabels] = useState<Record<number, string>>({});
  const [editingChannel, setEditingChannel] = useState<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  // ── Phase 1: auto-follow the dominant voice channel ────────────────────────
  // Opt-in. When on, the mic that carries the strongest SUSTAINED voice becomes
  // the transcription source (so the preacher's mic wins even while the choir
  // sings on other channels). Anti-flap: a candidate must lead by a margin for a
  // dwell window before it switches, and there's a min-hold between switches so
  // it never bounces mid-sentence. Reuses the exact same hot-swap path as a
  // manual channel click — the transcription/detection core is untouched.
  const AUTO_FOLLOW_KEY = "presentflow.audio.autoFollow.v1";
  const [autoFollow, setAutoFollow] = useState(false);
  useEffect(() => { try { setAutoFollow(localStorage.getItem(AUTO_FOLLOW_KEY) === "1"); } catch { /* noop */ } }, []);
  const autoFollowRef = useRef(false);
  autoFollowRef.current = autoFollow;
  const selectedChannelRef = useRef<number | null>(null);
  selectedChannelRef.current = selectedChannel;
  const smoothedRef = useRef<number[]>([]);         // EMA of per-channel vocal energy
  const candidateRef = useRef<{ ch: number; since: number } | null>(null);
  const lastSwitchAtRef = useRef(0);

  // Reassigned every render so the interval below always runs the freshest
  // closure (deviceId etc.) — no stale-closure re-subscription needed.
  const evaluateRef = useRef<(lv: ChannelLevels[]) => void>(() => {});
  evaluateRef.current = (lv: ChannelLevels[]) => {
    if (!autoFollowRef.current || !deviceId || lv.length < 2) return;
    const now = Date.now();
    const EMA = 0.3, MIN_VOCAL = 0.02, MARGIN = 1.4, DWELL_MS = 1200, HOLD_MS = 2500;
    const sm = smoothedRef.current;
    for (let i = 0; i < lv.length; i++) {
      const v = lv[i]?.vocalBandEnergy ?? 0;
      sm[i] = sm[i] === undefined ? v : sm[i] * (1 - EMA) + v * EMA;
    }
    smoothedRef.current = sm.slice(0, lv.length);
    // Leader + runner-up by smoothed vocal energy.
    let leader = -1, leaderV = 0, secondV = 0;
    for (let i = 0; i < sm.length; i++) {
      if (sm[i] > leaderV) { secondV = leaderV; leaderV = sm[i]; leader = i; }
      else if (sm[i] > secondV) { secondV = sm[i]; }
    }
    const cur = selectedChannelRef.current;
    if (leader < 0 || leaderV < MIN_VOCAL) { candidateRef.current = null; return; }  // silence
    if (leader === cur) { candidateRef.current = null; return; }                     // already on it
    // Leader must clearly beat the CURRENT channel (or 2nd place if none selected).
    const compareV = cur != null && sm[cur] !== undefined ? sm[cur] : secondV;
    if (leaderV < Math.max(MIN_VOCAL, compareV * MARGIN)) { candidateRef.current = null; return; }
    // Dwell: candidate must hold the lead continuously.
    const c = candidateRef.current;
    if (!c || c.ch !== leader) { candidateRef.current = { ch: leader, since: now }; return; }
    if (now - c.since < DWELL_MS) return;
    if (now - lastSwitchAtRef.current < HOLD_MS) return;  // min-hold between switches
    // Switch — SAME hot-swap path as a manual channel click.
    const pref = readDeviceChannelPref(deviceId);
    if (!pref) return;
    writeDeviceChannelPref({ ...pref, mode: "mono", selectedChannels: [leader] });
    setSelectedChannel(leader);
    lastSwitchAtRef.current = now;
    candidateRef.current = null;
  };

  // Load selected channel and labels from prefs
  useEffect(() => {
    if (!deviceId) return;
    const pref = readDeviceChannelPref(deviceId);
    if (pref) {
      setSelectedChannel(pref.selectedChannels[0] ?? null);
      setChannelLabels(pref.channelLabels ?? {});
    }
  }, [deviceId]);

  // Poll levels from capture
  useEffect(() => {
    if (!capture) { setLevels([]); return; }
    const id = window.setInterval(() => {
      try {
        const lv = capture.readLevels();
        setLevels(lv);
        evaluateRef.current(lv); // auto-follow (no-op unless enabled)
      } catch { /* capture may be closed */ }
    }, 1000 / METER_FPS);
    intervalRef.current = id;
    return () => { window.clearInterval(id); intervalRef.current = null; };
  }, [capture]);

  const handleChannelClick = useCallback((ch: number) => {
    if (!deviceId) return;
    const pref = readDeviceChannelPref(deviceId);
    if (!pref) return;
    writeDeviceChannelPref({
      ...pref,
      mode: "mono",
      selectedChannels: [ch],
    });
    setSelectedChannel(ch);
    // Manual pick pins the channel — stop auto-follow so it can't switch away.
    setAutoFollow(false);
    try { localStorage.setItem(AUTO_FOLLOW_KEY, "0"); } catch { /* noop */ }
  }, [deviceId]);

  const handleLabelSave = useCallback((ch: number, label: string) => {
    if (!deviceId) return;
    const pref = readDeviceChannelPref(deviceId);
    if (!pref) return;
    const labels = { ...(pref.channelLabels ?? {}), [ch]: label.trim() };
    if (!label.trim()) delete labels[ch];
    writeDeviceChannelPref({ ...pref, channelLabels: labels });
    setChannelLabels(labels);
    setEditingChannel(null);
  }, [deviceId]);

  if (!capture || levels.length === 0) return null;

  return (
    <div className="px-2 py-1.5 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-0.5 mb-1">
        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Channels
        </span>
        <button
          type="button"
          onClick={() => { const n = !autoFollow; setAutoFollow(n); try { localStorage.setItem(AUTO_FOLLOW_KEY, n ? "1" : "0"); } catch { /* noop */ } if (n) candidateRef.current = null; }}
          title="Auto-follow the speaking mic — switches transcription to whichever channel carries the strongest sustained voice (the preacher's mic wins even while the choir sings). Click a channel to pin manually."
          className={cn(
            "ml-auto h-4 px-1.5 rounded text-[8px] font-bold uppercase tracking-wider border transition-colors",
            autoFollow
              ? "border-[var(--color-brand)] bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
              : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
          )}
        >
          Auto-follow{autoFollow ? " ●" : ""}
        </button>
      </div>
      <div
        className="grid gap-px"
        style={{
          gridTemplateColumns: `repeat(${levels.length}, minmax(16px, 1fr))`,
        }}
      >
        {levels.map((level, i) => {
          const isSelected = selectedChannel === i;
          const vocalPct = Math.min(100, Math.round((level.vocalBandEnergy / 0.3) * 100));
          const label = channelLabels[i];
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleChannelClick(i)}
              onContextMenu={(e) => { e.preventDefault(); setEditingChannel(i); }}
              title={label ? `Ch ${i + 1}: ${label}` : `Channel ${i + 1}`}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-sm cursor-pointer transition-colors",
                "hover:bg-white/5",
                isSelected && "ring-1 ring-[var(--color-brand)]",
              )}
            >
              <div
                className={cn(
                  "relative w-full h-8 rounded-sm overflow-hidden",
                  isSelected ? "bg-[var(--color-brand)]/20" : "bg-black/30",
                )}
              >
                <div
                  className="absolute bottom-0 inset-x-0 transition-[height] duration-75"
                  style={{
                    height: `${Math.max(2, vocalPct)}%`,
                    background: isSelected ? "var(--color-brand)" : "#10b981",
                    opacity: Math.min(1, Math.max(0.3, level.rms * 4 + 0.2)),
                  }}
                />
              </div>
              <span className={cn(
                "text-[8px] font-mono leading-none truncate max-w-full",
                isSelected ? "text-[var(--color-brand)] font-semibold" : "text-[var(--color-muted-foreground)]",
              )}>
                {label || (i + 1)}
              </span>
            </button>
          );
        })}
      </div>
      {editingChannel !== null && (
        <ChannelLabelEditor
          channel={editingChannel}
          currentLabel={channelLabels[editingChannel] ?? ""}
          onSave={(label) => handleLabelSave(editingChannel, label)}
          onCancel={() => setEditingChannel(null)}
        />
      )}
    </div>
  );
}

function ChannelLabelEditor({
  channel, currentLabel, onSave, onCancel,
}: {
  channel: number;
  currentLabel: string;
  onSave: (label: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(currentLabel);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className="flex items-center gap-1 mt-1">
      <span className="text-[9px] text-[var(--color-muted-foreground)] whitespace-nowrap">
        Ch {channel + 1}:
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(value);
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onSave(value)}
        placeholder="e.g. Pastor"
        maxLength={20}
        className="flex-1 h-5 px-1 text-[10px] bg-black/20 border border-[var(--color-border)] rounded text-[var(--color-foreground)] outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
      />
    </div>
  );
}
