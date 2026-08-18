"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Repeat } from "lucide-react";
import { openLiveChannel, type LiveChannelLike, type LiveMessage } from "@/lib/broadcast";

/**
 * Compact video control bar for the operator console. Controls the local
 * preview video element directly AND broadcasts media-control commands
 * via BroadcastChannel so the projector stays in sync.
 */
export function VideoControlBar({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const [paused, setPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const chRef = useRef<LiveChannelLike | null>(null);
  const seekingRef = useRef(false);
  const rafRef = useRef<number>(0);

  // Open a BroadcastChannel to relay commands to projector
  useEffect(() => {
    const ch = openLiveChannel();
    chRef.current = ch;
    return () => { try { ch?.close(); } catch {} };
  }, []);

  // Playback-clock heartbeat: this operator preview video is the MASTER. Every
  // second, broadcast our position + play state so the projector reconciles any
  // drift and starts/stays aligned with what the operator sees — instead of
  // both <video>s free-running from independent buffer-ready moments. Cheap on
  // the same machine (BroadcastChannel) and still corrective across devices.
  useEffect(() => {
    const beat = () => {
      const el = videoRef.current;
      const ch = chRef.current;
      if (!el || !ch) return;
      try { ch.postMessage({ type: "media-sync", currentTime: el.currentTime, paused: el.paused } as LiveMessage); } catch {}
    };
    beat(); // align immediately when the bar mounts (video just went live)
    const iv = setInterval(beat, 1000);
    return () => clearInterval(iv);
  }, [videoRef]);

  // Poll the video element for playback state at ~15fps
  useEffect(() => {
    const tick = () => {
      const el = videoRef.current;
      if (el) {
        setPaused(el.paused);
        if (!seekingRef.current) setCurrentTime(el.currentTime);
        setDuration(Number.isFinite(el.duration) ? el.duration : 0);
        setVolume(el.volume);
        setMuted(el.muted);
        setLoop(el.loop);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef]);

  // Apply command to local video AND broadcast to projector
  const exec = (command: string, value?: number) => {
    const el = videoRef.current;
    if (el) {
      switch (command) {
        case "play": el.play().catch(() => {}); break;
        case "pause": el.pause(); break;
        case "seek": if (typeof value === "number") el.currentTime = value; break;
        case "volume": if (typeof value === "number") el.volume = Math.max(0, Math.min(1, value)); break;
        case "mute": el.muted = true; break;
        case "unmute": el.muted = false; break;
        case "restart": el.currentTime = 0; el.play().catch(() => {}); break;
        case "loop": el.loop = true; break;
        case "unloop": el.loop = false; break;
      }
    }
    // Also broadcast to projector/livestream windows
    const ch = chRef.current;
    if (ch) {
      try { ch.postMessage({ type: "media-control", command, value } as LiveMessage); } catch {}
    }
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md mx-2 text-[var(--color-foreground)]">
      {/* Play / Pause */}
      <button type="button" onClick={() => exec(paused ? "play" : "pause")} className="p-1 hover:text-[var(--color-brand)] transition-colors shrink-0" title={paused ? "Play" : "Pause"}>
        {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
      </button>
      {/* Restart */}
      <button type="button" onClick={() => exec("restart")} className="p-1 hover:text-[var(--color-brand)] transition-colors shrink-0" title="Restart">
        <RotateCcw className="w-3 h-3" />
      </button>

      {/* Time + Seek */}
      <span className="text-[9px] font-mono tabular-nums text-[var(--color-muted-foreground)] shrink-0">{fmt(currentTime)}</span>
      <input
        type="range" min={0} max={duration || 1} step={0.1} value={currentTime}
        onPointerDown={() => { seekingRef.current = true; }}
        onPointerUp={() => { seekingRef.current = false; }}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          setCurrentTime(v);
          exec("seek", v);
        }}
        className="flex-1 min-w-0 h-1 accent-[var(--color-brand)] cursor-pointer"
        title="Seek"
      />
      <span className="text-[9px] font-mono tabular-nums text-[var(--color-muted-foreground)] shrink-0">{fmt(duration)}</span>

      {/* Volume */}
      <button type="button" onClick={() => exec(muted ? "unmute" : "mute")} className="p-1 hover:text-[var(--color-brand)] transition-colors shrink-0" title={muted ? "Unmute" : "Mute"}>
        {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>
      <input
        type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          exec("volume", v);
          if (muted && v > 0) exec("unmute");
        }}
        className="w-12 h-1 accent-[var(--color-brand)] cursor-pointer shrink-0"
        title="Volume"
      />

      {/* Loop */}
      <button
        type="button"
        onClick={() => exec(loop ? "unloop" : "loop")}
        className={`p-1 transition-colors shrink-0 ${loop ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
        title={loop ? "Loop on" : "Loop off"}
      >
        <Repeat className="w-3 h-3" />
      </button>
    </div>
  );
}
