"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Repeat } from "lucide-react";
import { openLiveChannel, isValidLiveMessage, type LiveMessage } from "@/lib/broadcast";

/**
 * Compact video control bar for the operator console. Shown when a video
 * slide is live. Sends media-control commands via BroadcastChannel and
 * receives media-status updates from the projector to keep UI in sync.
 */
export function VideoControlBar() {
  const [paused, setPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const chRef = useRef<BroadcastChannel | null>(null);
  const seekingRef = useRef(false);

  useEffect(() => {
    const ch = openLiveChannel();
    chRef.current = ch;
    if (!ch) return;
    const onMsg = (e: MessageEvent) => {
      if (!isValidLiveMessage(e.data)) return;
      const msg = e.data as LiveMessage;
      if (msg.type !== "media-status") return;
      setPaused(msg.paused);
      if (!seekingRef.current) setCurrentTime(msg.currentTime);
      setDuration(msg.duration);
      setVolume(msg.volume);
      setMuted(msg.muted);
      setLoop(msg.loop);
    };
    ch.onmessage = onMsg;
    return () => { try { ch.close(); } catch {} };
  }, []);

  const send = (command: string, value?: number) => {
    const ch = chRef.current;
    if (!ch) return;
    try { ch.postMessage({ type: "media-control", command, value } as LiveMessage); } catch {}
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-elevated)] border-t border-[var(--color-border)] text-[var(--color-foreground)]">
      {/* Play / Pause */}
      <button type="button" onClick={() => send(paused ? "play" : "pause")} className="p-1 hover:text-[var(--color-brand)] transition-colors" title={paused ? "Play" : "Pause"}>
        {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
      </button>
      {/* Restart */}
      <button type="button" onClick={() => send("restart")} className="p-1 hover:text-[var(--color-brand)] transition-colors" title="Restart">
        <RotateCcw className="w-3.5 h-3.5" />
      </button>

      {/* Time + Seek */}
      <span className="text-[10px] font-mono tabular-nums text-[var(--color-muted-foreground)] min-w-[40px]">{fmt(currentTime)}</span>
      <input
        type="range" min={0} max={duration || 1} step={0.1} value={currentTime}
        onPointerDown={() => { seekingRef.current = true; }}
        onPointerUp={() => { seekingRef.current = false; }}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          setCurrentTime(v);
          send("seek", v);
        }}
        className="flex-1 h-1 accent-[var(--color-brand)] cursor-pointer"
        title="Seek"
      />
      <span className="text-[10px] font-mono tabular-nums text-[var(--color-muted-foreground)] min-w-[40px]">{fmt(duration)}</span>

      {/* Volume */}
      <button type="button" onClick={() => send(muted ? "unmute" : "mute")} className="p-1 hover:text-[var(--color-brand)] transition-colors" title={muted ? "Unmute" : "Mute"}>
        {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>
      <input
        type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          setVolume(v);
          send("volume", v);
          if (muted && v > 0) send("unmute");
        }}
        className="w-16 h-1 accent-[var(--color-brand)] cursor-pointer"
        title="Volume"
      />

      {/* Loop */}
      <button
        type="button"
        onClick={() => {
          send(loop ? "unloop" : "loop");
          setLoop(!loop);
        }}
        className={`p-1 transition-colors ${loop ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
        title={loop ? "Loop on" : "Loop off"}
      >
        <Repeat className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
