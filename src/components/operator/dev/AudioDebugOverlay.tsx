"use client";
/**
 * Task 15 — dev-only audio pipeline status indicator.
 *
 * Floating bottom-right pill visible only when NODE_ENV === "development".
 * Displays WS state, msg/sec, last transcript latency, reconnect count,
 * avg confidence (last 30s), and RMS silence-gate state.
 */
import type { AudioStreamState } from "../useAudioStream";

export function AudioDebugOverlay({ audio }: { audio: AudioStreamState }) {
  // Y5: NODE_ENV OR runtime localStorage flag (so operators can enable in
  // packaged builds when triaging).
  const devEnv = process.env.NODE_ENV === "development";
  let runtimeOn = false;
  try {
    if (typeof localStorage !== "undefined") {
      runtimeOn = localStorage.getItem("presentflow.debugOverlay") === "1";
    }
  } catch { /* ignore */ }
  if (!devEnv && !runtimeOn) return null;
  const wsState = audio.reconnectFailed
    ? "failed"
    : audio.stage === "idle"
    ? "closed"
    : audio.ready
    ? "open"
    : audio.reconnectAttempts > 0
    ? `reconnecting (${audio.reconnectAttempts})`
    : "opening";
  return (
    <div
      data-testid="audio-debug-overlay"
      className="fixed bottom-2 right-2 z-[9999] rounded-md bg-black/85 text-green-200 text-[10px] font-mono px-2 py-1 pointer-events-none select-none leading-tight shadow-lg border border-green-500/40"
    >
      <div>ws: {wsState}</div>
      <div>msg/s: {audio.msgsPerSec}</div>
      <div>lat: {audio.lastLatencyMs ?? "-"}ms</div>
      <div>reconn: {audio.reconnectAttempts}</div>
      <div>conf: {audio.avgConfidence.toFixed(2)}</div>
      <div>rms: {audio.silenceGateClosed ? "closed" : "open"}</div>
    </div>
  );
}
