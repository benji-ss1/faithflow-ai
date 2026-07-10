"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { openLiveChannel, type SlidePayload, type LiveMessage, type AnnouncementPayload, type TransitionSpec } from "@/lib/broadcast";
import { AnnouncementLayer } from "@/components/live/AnnouncementLayer";
import { TransitionWrapper } from "@/components/live/TransitionWrapper";

if (typeof window !== "undefined" && !(window as unknown as { __ffStageGuarded?: boolean }).__ffStageGuarded) {
  (window as unknown as { __ffStageGuarded: boolean }).__ffStageGuarded = true;
  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason instanceof Event || (e.reason && typeof e.reason === "object" && "isTrusted" in (e.reason as object))) {
      e.preventDefault(); e.stopImmediatePropagation();
      console.warn("[stage] suppressed non-Error rejection:", (e.reason as Event)?.type || String(e.reason));
    }
  }, true);
}

/**
 * Stage Display route.
 *
 * Deliberate isolation identical to /live:
 *   - Outside the (app) group → no operator sidebar
 *   - Renders only stage output — never operator chrome
 *   - Consumes the same BroadcastChannel state, but shows a "confidence
 *     monitor" view: current slide (small) + next slide (small) + clock
 *     + countdown + operator message + notes area.
 *
 * Behind the platform: cyan accent = current, muted grey = next. Big
 * clock so the pastor can see time-of-day at a glance.
 */
export default function StagePage() {
  const [current, setCurrent] = useState<SlidePayload>({ kind: "empty" });
  const [next, setNext] = useState<SlidePayload | null>(null);
  const [operatorMessage, setOperatorMessage] = useState<string | null>(null);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementPayload | null>(null);
  const [transition, setTransition] = useState<TransitionSpec | null>(null);
  const [connected, setConnected] = useState(false);
  // null on server + first client render to avoid hydration mismatch on the clock.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const [showHelp, setShowHelp] = useState(true);
  const lastMsgAt = useRef<number>(Date.now());

  // Body chrome hide (same trick as /live)
  useEffect(() => {
    try {
      document.body.style.overflow = "hidden";
      const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement | null;
      if (toaster) toaster.style.display = "none";
      return () => {
        try { document.body.style.overflow = ""; if (toaster) toaster.style.display = ""; } catch { /* ignore */ }
      };
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const ch = openLiveChannel();
    if (!ch) return;
    ch.postMessage({ type: "ping" } as LiveMessage);
    ch.onmessage = (e: MessageEvent) => {
      try {
        const msg = e.data as LiveMessage;
        if (!msg || typeof msg !== "object" || !("type" in msg)) return;
        lastMsgAt.current = Date.now();
        setConnected(true);
        if (msg.type === "set") setCurrent(msg.slide);
        else if (msg.type === "clear") setCurrent({ kind: "empty" });
        else if (msg.type === "pong") setCurrent(msg.slide);
        else if (msg.type === "output") {
          setCurrent(msg.state.live);
          setNext(msg.state.next);
          setOperatorMessage(msg.state.operatorMessage);
          setCountdownEndsAt(msg.state.countdownEndsAt);
          setAnnouncement(msg.state.announcement ?? null);
          setTransition(msg.state.transition ?? null);
        }
      } catch (err) {
        console.warn("[stage] message handler error:", err instanceof Error ? err.message : String(err));
      }
    };
    ch.onmessageerror = () => console.warn("[stage] messageerror");
    const timer = setInterval(() => {
      if (Date.now() - lastMsgAt.current > 3000) setConnected(false);
    }, 1000);
    return () => { try { ch.close(); } catch { /* ignore */ } clearInterval(timer); };
  }, []);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-hide help
  useEffect(() => {
    const t = setTimeout(() => setShowHelp(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const goFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (err) {
      console.warn("[stage] fullscreen denied:", err instanceof Error ? err.message : String(err));
    }
    setShowHelp(false);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "f" || e.key === "F") { e.preventDefault(); goFullscreen(); }
      if (e.key === "Escape") setShowHelp(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goFullscreen]);

  // Global unhandled-rejection swallower — same safety net as /live
  useEffect(() => {
    function onUnhandled(e: PromiseRejectionEvent) {
      console.warn("[stage] swallowed unhandled rejection:", String(e.reason));
      e.preventDefault();
    }
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);

  const countdownStr = countdownEndsAt && now ? formatCountdown(countdownEndsAt - now.getTime()) : null;

  return (
    <div
      className="fixed inset-0 overflow-hidden cursor-none flex flex-col"
      style={{ margin: 0, padding: 0, background: "#000", color: "#e9edee" }}
      onDoubleClick={goFullscreen}
    >
      {/* Header row: clock + countdown + connection status */}
      <div className="h-24 shrink-0 border-b border-white/10 flex items-stretch">
        <div className="flex-1 flex items-center justify-center border-r border-white/10">
          <div className="text-6xl font-mono font-light tracking-tight" style={{ color: "var(--color-brand)" }}>
            {now ? now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "--:--:--"}
          </div>
        </div>
        {countdownStr ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/50">Countdown</div>
            <div className="text-5xl font-mono font-light">{countdownStr}</div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">No countdown</div>
          </div>
        )}
      </div>

      {/* Middle row: current + next slide */}
      <div className="flex-1 grid grid-cols-2 min-h-0">
        <div className="border-r border-white/10 relative">
          <div className="absolute top-3 left-4 text-[10px] font-mono uppercase tracking-widest text-white/60 z-10">Current</div>
          <TransitionWrapper identityKey={stageIdentity(current)} transition={transition}>
            <SlideRenderer slide={current} />
          </TransitionWrapper>
          <AnnouncementLayer ann={announcement} />
        </div>
        <div className="relative">
          <div className="absolute top-3 left-4 text-[10px] font-mono uppercase tracking-widest text-white/40 z-10">Next</div>
          {next && next.kind !== "empty" ? (
            <div className="opacity-50 w-full h-full"><SlideRenderer slide={next} /></div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">— end of item —</div>
          )}
        </div>
      </div>

      {/* Bottom row: operator message + notes */}
      <div className="h-32 shrink-0 border-t border-white/10 flex items-stretch">
        <div className="flex-1 flex flex-col justify-center px-6 border-r border-white/10">
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1">Operator message</div>
          <div className="text-lg leading-tight text-white/90">
            {operatorMessage || <span className="text-white/30 italic">no message</span>}
          </div>
        </div>
        <div className="flex-1 flex flex-col justify-center px-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1">Sermon notes / confidence lyrics</div>
          <div className="text-sm text-white/40 italic">Content coming when the operator populates the notes/lyrics tabs.</div>
        </div>
      </div>

      {showHelp && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-3 py-2 rounded-md flex items-center gap-3 cursor-pointer pointer-events-auto"
             onClick={goFullscreen}>
          <Maximize2 className="w-4 h-4" />
          <span>Press <kbd className="font-mono bg-white/10 px-1.5 py-0.5 rounded-sm">F</kbd> or double-click for fullscreen</span>
          <button onClick={(e) => { e.stopPropagation(); setShowHelp(false); }}
            className="text-white/70 hover:text-white ml-2"><X className="w-3 h-3" /></button>
        </div>
      )}

      {!connected && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-black/70 text-white text-[10px] font-semibold px-2 py-1 rounded-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> Operator disconnected
        </div>
      )}
    </div>
  );
}

function stageIdentity(s: SlidePayload): string {
  if (s.kind === "text") return `t:${s.text}`;
  if (s.kind === "image") return `i:${s.url}`;
  if (s.kind === "video") return `v:${s.url}`;
  if (s.kind === "blank") return `b:${s.bgColor ?? ""}`;
  if (s.kind === "logo") return `l:${s.url ?? ""}`;
  return "e";
}

function formatCountdown(ms: number): string {
  if (ms < 0) return "00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
