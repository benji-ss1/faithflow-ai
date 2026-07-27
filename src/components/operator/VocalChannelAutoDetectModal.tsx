"use client";
/**
 * VocalChannelAutoDetectModal
 * -------------------------------------------------------------------------
 * Runs a 10-second per-channel FFT scan of a multi-channel USB mixer and
 * recommends which channel carries the pastor's vocal mic. Operator sees
 * live per-channel meters while the scan runs, then a "Recommended: Ch N"
 * result they can accept, override, or retry.
 *
 * Owns the MultiChannelCapture lifecycle for its entire life — opens on
 * mount, tears down on unmount. Detection scans run inside an AbortController
 * so Cancel and re-scan are cooperative.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Loader2, Mic, RefreshCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  openMultiChannelCapture,
  type MultiChannelCapture,
} from "@/lib/audio/multiChannelCapture";
import {
  runVocalChannelDetection,
  type ChannelScore,
  type VocalDetectionResult,
} from "@/lib/audio/vocalChannelDetector";

interface Props {
  deviceId: string;
  deviceLabel: string;
  onClose: () => void;
  onSelectChannel: (
    channel: number,
    mode: "mono" | "stereo",
    channels: number[],
  ) => void;
}

type Phase = "opening" | "scanning" | "result" | "error";

const SCAN_DURATION_MS = 10_000;
const METER_FRAME_MS = 50;

/**
 * Map a browser MediaDevices exception to friendly operator-facing copy.
 * Whitelist known error names; anything unknown gets a generic hardware
 * message rather than exposing raw `err.message` (which can include SDP
 * fragments, driver GUIDs, or other debug noise the operator can't act on).
 */
function friendlyErrorMessage(err: unknown): string {
  const name = typeof err === "object" && err !== null
    ? (err as { name?: string }).name
    : undefined;
  switch (name) {
    case "NotReadableError":
      return "Device is locked by another app (ASIO exclusive / driver). Close other audio apps and retry.";
    case "NotAllowedError":
      return "Microphone permission denied — grant access in System Settings › Privacy & Security › Microphone.";
    case "NotFoundError":
      return "Audio device not found — check the USB cable and retry.";
    case "OverconstrainedError":
      return "Device rejected the requested channel layout — try a different USB port or driver mode.";
    default:
      return "Could not open device — check the mixer USB connection.";
  }
}

export function VocalChannelAutoDetectModal({
  deviceId,
  deviceLabel,
  onClose,
  onSelectChannel,
}: Props) {
  const [phase, setPhase] = useState<Phase>("opening");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [channelCount, setChannelCount] = useState(0);
  const [liveScores, setLiveScores] = useState<ChannelScore[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<VocalDetectionResult | null>(null);
  const [showAlternates, setShowAlternates] = useState(false);

  const captureRef = useRef<MultiChannelCapture | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  // Meter polling — decoupled from the detection loop so the UI stays
  // silky even if the caller's onProgress fires irregularly. Reads
  // straight off the capture at a fixed 20fps.
  const startMeterPoll = useCallback(() => {
    stopMeterPoll();
    const tick = () => {
      const cap = captureRef.current;
      if (!cap || unmountedRef.current) return;
      const levels = cap.readLevels();
      const scores: ChannelScore[] = levels.map((lvl, i) => ({
        channel: i,
        vocalBandEnergy: lvl.vocalBandEnergy,
        totalEnergy: lvl.rms,
        vocalRatio:
          lvl.vocalBandEnergy / Math.max(lvl.rms, 0.001),
        activeFraction: 0,
        score: 0,
      }));
      setLiveScores(scores);
    };
    tick();
    meterTimerRef.current = window.setInterval(tick, METER_FRAME_MS);
  }, []);

  const stopMeterPoll = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
  }, []);

  const startScan = useCallback(async () => {
    const cap = captureRef.current;
    if (!cap) return;

    // Abort any previous scan so back-to-back Retry clicks don't race.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("scanning");
    setResult(null);
    setShowAlternates(false);
    setElapsedMs(0);
    startMeterPoll();

    try {
      const res = await runVocalChannelDetection(cap, {
        durationMs: SCAN_DURATION_MS,
        signal: controller.signal,
        onProgress: (elapsed, currentLevels) => {
          if (unmountedRef.current) return;
          setElapsedMs(elapsed);
          // Merge score data (from detection) with the meter's live
          // instantaneous readings so the leader highlight is stable.
          setLiveScores((prev) => {
            const byChannel = new Map(prev.map((s) => [s.channel, s]));
            return currentLevels.map((s) => {
              const live = byChannel.get(s.channel);
              return {
                ...s,
                // Prefer the meter's instantaneous readings for the bar
                // fill so users see "now" not "average".
                vocalBandEnergy: live?.vocalBandEnergy ?? s.vocalBandEnergy,
                totalEnergy: live?.totalEnergy ?? s.totalEnergy,
              };
            });
          });
        },
      });
      if (unmountedRef.current || controller.signal.aborted) return;
      setResult(res);
      setPhase("result");
    } catch (err) {
      if (unmountedRef.current) return;
      const name = (err as { name?: string })?.name;
      if (name === "AbortError") {
        // Cancelled — silently stay wherever the caller navigates to next.
        return;
      }
      setErrorMessage(friendlyErrorMessage(err));
      setPhase("error");
    } finally {
      stopMeterPoll();
    }
  }, [startMeterPoll, stopMeterPoll]);

  // Mount: open capture, then kick off the first scan.
  useEffect(() => {
    unmountedRef.current = false;
    let cancelled = false;

    (async () => {
      try {
        const cap = await openMultiChannelCapture({ deviceId });
        if (cancelled) {
          cap.close();
          return;
        }
        captureRef.current = cap;
        setChannelCount(cap.channelCount);
        if (cap.channelCount === 0) {
          setErrorMessage("Device reported zero channels.");
          setPhase("error");
          return;
        }
        void startScan();
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(friendlyErrorMessage(err));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      unmountedRef.current = true;
      abortRef.current?.abort();
      stopMeterPoll();
      try {
        captureRef.current?.close();
      } catch {
        /* noop */
      }
      captureRef.current = null;
    };
    // deviceId is a stable prop for the lifetime of the modal; we
    // intentionally don't re-open on prop change (the parent unmounts
    // + remounts to switch devices).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  const handleRetry = useCallback(() => {
    void startScan();
  }, [startScan]);

  const handleAccept = useCallback(
    (channel: number) => {
      onSelectChannel(channel, "mono", [channel]);
      toast.success(`Vocal channel set to Ch ${channel + 1}`);
      onClose();
    },
    [onClose, onSelectChannel],
  );

  const leaderChannel = useMemo(() => {
    if (phase === "result" && result?.bestChannel !== null && result?.bestChannel !== undefined) {
      return result.bestChannel;
    }
    // During scan, use rolling scores' current leader as a soft hint.
    if (phase === "scanning" && liveScores.length > 0) {
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (const s of liveScores) {
        const rolling = s.score || s.vocalBandEnergy;
        if (rolling > bestScore) {
          bestScore = rolling;
          bestIdx = s.channel;
        }
      }
      return bestIdx >= 0 ? bestIdx : null;
    }
    return null;
  }, [phase, result, liveScores]);

  const secondsRemaining = Math.max(
    0,
    Math.ceil((SCAN_DURATION_MS - elapsedMs) / 1000),
  );
  const progressPct = Math.min(
    100,
    Math.round((elapsedMs / SCAN_DURATION_MS) * 100),
  );

  return (
    <div
      role="dialog"
      aria-label="Auto-detect vocal channel"
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border shadow-2xl flex flex-col bg-[var(--color-panel)] border-[var(--color-border)]"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
              Auto-detect vocal channel
            </div>
            <div className="text-[13px] font-semibold text-zinc-100 truncate">
              {deviceLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close"
            className="h-8 w-8 rounded-md hover:bg-white/5 text-zinc-400 hover:text-zinc-100 inline-flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {phase === "opening" && (
            <div className="py-10 flex flex-col items-center gap-3 text-zinc-400 text-[12px]">
              <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
              Opening {channelCount || "multi-channel"} capture…
            </div>
          )}

          {phase === "error" && (
            <div className="py-4 space-y-3">
              <div className="flex items-start gap-2 text-[12px] text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  {errorMessage ?? "Could not open device."}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[11px] font-medium text-zinc-100 hover:bg-white/5"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {phase === "scanning" && (
            <>
              <div className="flex items-center gap-2 text-[13px] text-zinc-100">
                <Mic className="w-4 h-4 text-amber-400" />
                <span className="font-semibold">Speak into your vocal mic now</span>
              </div>
              <div className="text-[11px] text-zinc-500">
                Scanning {channelCount} channel{channelCount === 1 ? "" : "s"} —{" "}
                {secondsRemaining}s remaining. The leader is highlighted in orange.
              </div>

              <ChannelMeterRow
                scores={liveScores}
                leaderChannel={leaderChannel}
                channelCount={channelCount}
              />

              {/* Progress bar */}
              <div className="pt-1">
                <div className="relative w-full h-1 rounded-full overflow-hidden bg-black/40">
                  <div
                    className="absolute inset-y-0 left-0 transition-[width] duration-100 ease-linear"
                    style={{
                      width: `${progressPct}%`,
                      background: "#f97316",
                    }}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[11px] font-medium text-zinc-100 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {phase === "result" && result && (
            <>
              {result.bestChannel !== null ? (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                    Recommended
                  </div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-[22px] font-bold text-zinc-100">
                      Ch {result.bestChannel + 1}
                    </div>
                    {(() => {
                      const s = result.rankedChannels.find(
                        (r) => r.channel === result.bestChannel,
                      );
                      if (!s) return null;
                      return (
                        <div className="text-[11px] text-zinc-500 font-mono">
                          vocal {(s.vocalBandEnergy * 100).toFixed(1)}% ·{" "}
                          active {(s.activeFraction * 100).toFixed(0)}%
                        </div>
                      );
                    })()}
                  </div>

                  <ChannelMeterRow
                    scores={result.rankedChannels
                      .slice()
                      .sort((a, b) => a.channel - b.channel)}
                    leaderChannel={result.bestChannel}
                    channelCount={channelCount}
                    useAverages
                  />

                  {showAlternates && (
                    <div className="space-y-1 pt-1">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                        Ranked channels
                      </div>
                      <div className="max-h-48 overflow-y-auto rounded border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                        {result.rankedChannels.map((s, idx) => (
                          <button
                            key={s.channel}
                            type="button"
                            onClick={() => handleAccept(s.channel)}
                            className={cn(
                              "w-full flex items-center gap-3 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors",
                              s.channel === result.bestChannel &&
                                "bg-amber-500/5",
                            )}
                          >
                            <div className="text-[10px] font-mono text-zinc-500 w-4">
                              {idx + 1}
                            </div>
                            <div className="text-[12px] text-zinc-100 font-medium w-12">
                              Ch {s.channel + 1}
                            </div>
                            <div className="flex-1 h-1 rounded-full overflow-hidden bg-black/40">
                              <div
                                className="h-full"
                                style={{
                                  width: `${Math.min(100, Math.round(s.score * 200))}%`,
                                  background:
                                    s.channel === result.bestChannel
                                      ? "#f97316"
                                      : "#10b981",
                                }}
                              />
                            </div>
                            <div className="text-[10px] font-mono text-zinc-500 w-16 text-right">
                              {(s.score * 100).toFixed(1)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="h-8 px-3 rounded-md text-[11px] font-medium text-zinc-400 hover:text-zinc-100 hover:bg-white/5 inline-flex items-center gap-1.5"
                    >
                      <RefreshCcw className="w-3 h-3" /> Try again
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAlternates((v) => !v)}
                      className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[11px] font-medium text-zinc-100 hover:bg-white/5"
                    >
                      {showAlternates ? "Hide" : "Pick a different channel"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAccept(result.bestChannel!)}
                      className="h-8 px-3 rounded-md text-[11px] font-semibold text-white"
                      style={{ background: "#f97316" }}
                    >
                      Use Ch {result.bestChannel + 1}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-[12px] text-zinc-100">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <div>
                      <div className="font-semibold">No vocal signal detected</div>
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Make sure someone is speaking into the mic, then try
                        again.
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onClose}
                      className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[11px] font-medium text-zinc-100 hover:bg-white/5"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="h-8 px-3 rounded-md text-[11px] font-semibold text-white inline-flex items-center gap-1.5"
                      style={{ background: "#f97316" }}
                    >
                      <RefreshCcw className="w-3 h-3" /> Retry
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Meter row -------------------------------------------------------------

interface ChannelMeterRowProps {
  scores: ChannelScore[];
  leaderChannel: number | null;
  channelCount: number;
  /**
   * When true, use `vocalBandEnergy` (the averaged value) as the bar fill
   * for the final result view. During scanning we already pass live
   * instantaneous values in scores[i].vocalBandEnergy so the flag is
   * cosmetic there — kept for clarity.
   */
  useAverages?: boolean;
}

function ChannelMeterRow({
  scores,
  leaderChannel,
  channelCount,
}: ChannelMeterRowProps) {
  // Fill with placeholders if scores haven't populated yet so the
  // layout doesn't jump when the first sample lands.
  const rows: (ChannelScore | null)[] =
    scores.length > 0
      ? scores
      : new Array(channelCount).fill(null);

  return (
    <div
      className="grid gap-1 overflow-x-auto pb-1"
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, rows.length)}, minmax(20px, 1fr))`,
      }}
    >
      {rows.map((s, i) => {
        const channel = s?.channel ?? i;
        const isLeader = leaderChannel === channel;
        const vocal = s?.vocalBandEnergy ?? 0;
        const rms = s?.totalEnergy ?? 0;
        // Amplify a bit for visibility — real mic signals rarely exceed
        // 0.3 in normalized vocalBandEnergy but 0.05 already means clear
        // speech. Scale so 0.3 fills the bar.
        const heightPct = Math.min(100, Math.round((vocal / 0.3) * 100));
        // Opacity from rms — silent channels dim, active channels bright.
        const opacity = Math.min(1, Math.max(0.15, rms * 4 + 0.15));
        return (
          <div key={channel} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "relative w-full h-16 rounded overflow-hidden bg-black/40 border",
                isLeader ? "border-[#f97316]" : "border-[var(--color-border)]",
              )}
            >
              <div
                className="absolute bottom-0 inset-x-0 transition-[height] duration-75 ease-out"
                style={{
                  height: `${Math.max(2, heightPct)}%`,
                  background: isLeader ? "#f97316" : "#10b981",
                  opacity,
                }}
              />
            </div>
            <div
              className={cn(
                "text-[9px] font-mono",
                isLeader ? "text-[#f97316] font-semibold" : "text-zinc-500",
              )}
            >
              {channel + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}
