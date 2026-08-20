"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { PresentationCanvas } from "@/components/live/PresentationCanvas";
import { ThemeLogoLayer } from "@/components/live/ThemeLayers";
import { openLiveChannel, type LiveChannelLike, isValidLiveMessage, slideOutputIdentity, type SlidePayload, type LiveMessage, type AnnouncementPayload, type TransitionSpec, type ThemeAppearance } from "@/lib/broadcast";
import type { ProjectionZone } from "@/lib/projection-zone";
import { openOutputChannel, isValidPairCode } from "@/lib/realtime";
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
  const [fontScale, setFontScale] = useState(1); // B3 operator manual text size
  const [referenceScale, setReferenceScale] = useState(1);
  const [referenceColor, setReferenceColor] = useState<string | undefined>(undefined);
  const [background, setBackground] = useState<import("@/lib/broadcast").BackgroundSpec | null>(null);
  const [appearance, setAppearance] = useState<ThemeAppearance | null>(null); // Themes Phase 1
  const [zone, setZone] = useState<ProjectionZone | null>(null); // Projection Zone geometry
  const [nextItem, setNextItem] = useState<{ title: string; type: string } | null>(null);
  const [operatorMessage, setOperatorMessage] = useState<string | null>(null);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementPayload | null>(null);
  const [transition, setTransition] = useState<TransitionSpec | null>(null);
  const [messageOverlay, setMessageOverlay] = useState<string | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Heartbeat bookkeeping — operator re-posts the message at 1Hz. Only re-arm
  // the dismiss countdown on content change; sweep stale messages after 5s.
  const lastMessageContentRef = useRef<string | null>(null);
  const lastMessageMsgAt = useRef<number>(0);
  const [timerOverlay, setTimerOverlay] = useState<{ name?: string; remainingSec: number; running: boolean; kind: "countdown" | "elapsed" } | null>(null);
  const [connected, setConnected] = useState(false);
  const [pairBadge, setPairBadge] = useState<string | null>(null);
  // null on server + first client render to avoid hydration mismatch on the clock.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const [showHelp, setShowHelp] = useState(true);
  const lastMsgAt = useRef<number>(Date.now());
  // Operator heartbeats the timer overlay at 1Hz while shown — sweep it off
  // if the beats stop (operator window closed/crashed).
  const lastTimerMsgAt = useRef<number>(0);

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
    let ch: LiveChannelLike | null = openLiveChannel();
    let reopenCount = 0;
    // Dedup the current slide so the projector's 3s self-heal pong (broadcast to
    // all windows) never re-renders a held static slide on the stage display.
    let appliedCurSig = "";
    const curSig = (s: SlidePayload): string => { try { return JSON.stringify(s); } catch { return String(Date.now()); } };
    const applyCurrent = (s: SlidePayload) => { const sig = curSig(s); if (sig === appliedCurSig) return; appliedCurSig = sig; setCurrent(s); };
    if (!ch) return;
    const onMessage = (e: MessageEvent) => {
      try {
        if (!isValidLiveMessage(e.data)) return;
        const msg = e.data as LiveMessage;
        lastMsgAt.current = Date.now();
        setConnected(true);
        reopenCount = 0; // healthy traffic resets the recovery budget so a long
        // (2-3 hour) service never exhausts the reopen cap and permanently desyncs.
        if (msg.type === "set") applyCurrent(msg.slide);
        else if (msg.type === "clear") applyCurrent({ kind: "empty" });
        else if (msg.type === "pong") applyCurrent(msg.slide);
        else if (msg.type === "output") {
          applyCurrent(msg.state.live);
          setNext(msg.state.next);
          setFontScale(typeof msg.state.fontScale === "number" ? msg.state.fontScale : 1);
          setReferenceScale(typeof msg.state.referenceScale === "number" ? msg.state.referenceScale : 1);
          setReferenceColor(typeof msg.state.referenceColor === "string" ? msg.state.referenceColor : undefined);
          setBackground(msg.state.background ?? null);
          setAppearance(msg.state.appearance ?? null);
          setZone(msg.state.zone ?? null);
          setNextItem(msg.state.nextItem ?? null);
          setOperatorMessage(msg.state.operatorMessage);
          setCountdownEndsAt(msg.state.countdownEndsAt);
          setAnnouncement(msg.state.announcement ?? null);
          setTransition(msg.state.transition ?? null);
        } else if (msg.type === "message") {
          if ("clear" in msg.overlay && msg.overlay.clear) {
            if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
            lastMessageContentRef.current = null;
            lastMessageMsgAt.current = 0;
            setMessageOverlay(null);
          } else if ("text" in msg.overlay) {
            lastMessageMsgAt.current = Date.now();
            setMessageOverlay(msg.overlay.text);
            // 1Hz heartbeat re-posts must not restart the dismiss countdown.
            const ms = msg.overlay.dismissAfterMs;
            const contentKey = `${msg.overlay.text}|${typeof ms === "number" ? ms : "manual"}`;
            if (contentKey !== lastMessageContentRef.current) {
              lastMessageContentRef.current = contentKey;
              if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
              if (typeof ms === "number" && ms > 0) messageTimerRef.current = setTimeout(() => setMessageOverlay(null), ms);
            }
          }
        } else if (msg.type === "timer") {
          if ("clear" in msg.overlay && msg.overlay.clear) setTimerOverlay(null);
          else { setTimerOverlay(msg.overlay); lastTimerMsgAt.current = Date.now(); }
        }
      } catch (err) {
        console.warn("[stage] message handler error:", err instanceof Error ? err.message : String(err));
      }
    };
    const attach = (c: LiveChannelLike) => {
      c.onmessage = onMessage;
      c.onmessageerror = () => console.warn("[stage] messageerror");
    };
    attach(ch);
    ch.postMessage({ type: "ping" } as LiveMessage);
    const timer = setInterval(() => {
      const stale = Date.now() - lastMsgAt.current;
      if (stale > 3000) setConnected(false);
      if (lastTimerMsgAt.current > 0 && Date.now() - lastTimerMsgAt.current > 5000) {
        lastTimerMsgAt.current = 0;
        setTimerOverlay(null);
      }
      // Stale-message sweep: 5s without a heartbeat → operator is gone, take
      // the message (incl. dismiss:manual) down.
      if (lastMessageMsgAt.current > 0 && Date.now() - lastMessageMsgAt.current > 5000) {
        lastMessageMsgAt.current = 0;
        lastMessageContentRef.current = null;
        if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
        setMessageOverlay(null);
      }
      // Y4: reopen the BroadcastChannel if we've heard nothing for >5s.
      if (stale > 5000 && reopenCount < 20) {
        try { ch?.close(); } catch { /* ignore */ }
        ch = openLiveChannel();
        if (ch) {
          reopenCount += 1;
          attach(ch);
          try { ch.postMessage({ type: "ping" } as LiveMessage); } catch { /* ignore */ }
          lastMsgAt.current = Date.now();
        }
      }
    }, 1000);
    // Cross-device: subscribe to Supabase Realtime channel when ?pair=CODE present.
    let realtime: ReturnType<typeof openOutputChannel> | null = null;
    let badgeTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const pair = params.get("pair");
      if (pair && isValidPairCode(pair)) {
        const code = pair.trim().toUpperCase();
        const church = params.get("church") || undefined;
        realtime = openOutputChannel(code, church);
        let firstMsg = true;
        realtime.subscribe((state) => {
          setFontScale(typeof state.fontScale === "number" ? state.fontScale : 1);
          setAppearance(state.appearance ?? null);
          setZone(state.zone ?? null);
          lastMsgAt.current = Date.now();
          setConnected(true);
          setCurrent(state.live);
          setNext(state.next);
          setNextItem(state.nextItem ?? null);
          setOperatorMessage(state.operatorMessage);
          setCountdownEndsAt(state.countdownEndsAt);
          setAnnouncement(state.announcement ?? null);
          setTransition(state.transition ?? null);
          if (firstMsg) { firstMsg = false; setPairBadge(code); badgeTimer = setTimeout(() => setPairBadge(null), 5000); }
        });
      }
    } catch (e) {
      console.warn("[stage] pair-code subscribe failed:", e instanceof Error ? e.message : String(e));
    }
    return () => {
      try { ch?.close(); } catch { /* ignore */ }
      try { realtime?.close(); } catch { /* ignore */ }
      if (badgeTimer) clearTimeout(badgeTimer);
      clearInterval(timer);
    };
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

  // Y3: If the operator forgets to clear a countdown, treat it as null
  // once it's been past for >60s so Stage doesn't display 00:00 forever.
  const effectiveCountdownEndsAt = countdownEndsAt && now && countdownEndsAt < now.getTime() - 60_000
    ? null
    : countdownEndsAt;
  const countdownStr = effectiveCountdownEndsAt && now ? formatCountdown(effectiveCountdownEndsAt - now.getTime()) : null;

  return (
    <div
      className="fixed inset-0 overflow-hidden cursor-none flex flex-col"
      style={{ margin: 0, padding: 0, background: "#000", color: "#e9edee" }}
      onDoubleClick={goFullscreen}
    >
      {/* 2026-08-16 stage redesign (JPD): the time-of-day clock and the
          placeholder notes row are GONE. The screen is now dedicated to what the
          platform actually needs — the CURRENT lyrics/verse BIG, with the NEXT
          slide as a smaller strip below so singers see what's coming. A sermon
          timer/countdown only appears as a small corner chip when one is set. */}

      {/* CURRENT — dominant, full width so text is as large as possible */}
      <div className="relative flex-1 min-h-0">
        <div className="absolute top-3 left-4 text-[11px] font-mono uppercase tracking-widest text-white/45 z-10">Current</div>
        {(timerOverlay || countdownStr) && (
          <div className="absolute top-3 right-4 z-10 flex items-center gap-2 bg-white/[0.06] border border-white/10 rounded-xl px-3 py-1.5 backdrop-blur-sm">
            <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">
              {timerOverlay ? (timerOverlay.name || "Timer") : "Countdown"}{timerOverlay && !timerOverlay.running ? " (paused)" : ""}
            </span>
            <span className={`text-3xl font-mono font-light tabular-nums ${timerOverlay && timerOverlay.remainingSec < 0 ? "text-red-400" : "text-white/85"}`}>
              {timerOverlay ? formatStageTimer(timerOverlay.remainingSec) : countdownStr}
            </span>
          </div>
        )}
        <PresentationCanvas zone={zone}>
          {background && background.type !== "none" && <BackgroundLayer background={background} />}
          <TransitionWrapper identityKey={slideOutputIdentity(current)} transition={transition}>
            <SlideRenderer slide={current} projectorFit fontScale={fontScale} referenceScale={referenceScale} referenceColor={referenceColor} appearance={appearance} overVideo={!!(background && background.type !== "none")} />
          </TransitionWrapper>
          <ThemeLogoLayer appearance={appearance} />
        </PresentationCanvas>
        <AnnouncementLayer ann={announcement} />
        {/* Operator message — a slim bar over the bottom of the current area, only
            when the operator actually sends one (no dead placeholder). */}
        {operatorMessage && (
          <div className="absolute left-0 right-0 bottom-0 z-20 bg-black/70 backdrop-blur-sm border-t-2 px-6 py-2.5" style={{ borderColor: "var(--color-brand, #e8501a)" }}>
            <div className="text-white text-2xl font-semibold leading-tight">{operatorMessage}</div>
          </div>
        )}
      </div>

      {/* NEXT — smaller strip so the platform sees what's coming up */}
      <div className="relative shrink-0 h-[28%] border-t-2 border-white/10 bg-white/[0.02]">
        <div className="absolute top-2 left-4 z-10 flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">Next</span>
          {nextItem && (
            <span className="text-sm font-semibold text-white/70 max-w-[70vw] truncate">
              <span className="text-[9px] font-mono uppercase tracking-widest text-white/30 mr-2">{nextItem.type}</span>
              {nextItem.title}
            </span>
          )}
        </div>
        {next && next.kind !== "empty" ? (
          <div className="opacity-75 w-full h-full"><PresentationCanvas><SlideRenderer slide={next} projectorFit appearance={appearance} /></PresentationCanvas></div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">— end of item —</div>
        )}
      </div>

      {/* Spoken message overlay (operator "message" broadcast) — kept. */}
      {messageOverlay && (
        <div className="absolute left-[6%] right-[6%] top-[8%] pointer-events-none z-30">
          <div className="bg-black/75 backdrop-blur-sm border-l-4 p-4 rounded-sm" style={{ borderColor: "var(--color-brand, #e8501a)" }}>
            <div className="text-white text-2xl md:text-4xl font-semibold leading-tight text-left">{messageOverlay}</div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-3 py-2 rounded-md flex items-center gap-3 cursor-pointer pointer-events-auto"
             onClick={goFullscreen}>
          <Maximize2 className="w-4 h-4" />
          <span>Press <kbd className="font-mono bg-white/10 px-1.5 py-0.5 rounded-sm">F</kbd> or double-click for fullscreen</span>
          <button onClick={(e) => { e.stopPropagation(); setShowHelp(false); }}
            className="text-white/70 hover:text-white ml-2"><X className="w-3 h-3" /></button>
        </div>
      )}

      {pairBadge && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-emerald-900/80 text-white text-[10px] font-semibold px-2 py-1 rounded-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" /> CONNECTED VIA CODE {pairBadge}
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

function formatStageTimer(sec: number): string {
  const negative = sec < 0;
  const abs = Math.abs(Math.round(sec));
  const mm = Math.floor(abs / 60);
  const ss = abs % 60;
  return `${negative ? "-" : ""}${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
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
