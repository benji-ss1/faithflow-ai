"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { openLiveChannel, safePost, isValidLiveMessage, type SlidePayload, type LiveMessage, type AnnouncementPayload, type TransitionSpec, type OverlayPosition, type ThemeAppearance, type VideoInputState } from "@/lib/broadcast";
import { OutputSlide } from "@/components/live/OutputSlide";
import { openOutputChannel, isValidPairCode } from "@/lib/realtime";
import { AnnouncementLayer } from "@/components/live/AnnouncementLayer";
import { TransitionWrapper } from "@/components/live/TransitionWrapper";

// Module-scope, capture-phase suppressor. Runs before React/Next dev-overlay
// listeners so a stray DOM Event rejection (autoplay block, fullscreen deny,
// messageerror, etc.) never surfaces as "[object Event]" on the projector.
if (typeof window !== "undefined" && !(window as unknown as { __ffLiveGuarded?: boolean }).__ffLiveGuarded) {
  (window as unknown as { __ffLiveGuarded: boolean }).__ffLiveGuarded = true;
  const suppress = (e: PromiseRejectionEvent) => {
    if (e.reason instanceof Event || (e.reason && typeof e.reason === "object" && "isTrusted" in (e.reason as object))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      console.warn("[live] suppressed non-Error rejection:", (e.reason as Event)?.type || String(e.reason));
    }
  };
  window.addEventListener("unhandledrejection", suppress, true);
}

/**
 * Projector output window.
 *
 * Deliberate isolation:
 *  - Lives at /live, OUTSIDE the (app) route group, so the operator's
 *    sidebar layout does NOT wrap it.
 *  - Renders only <SlideRenderer> full-bleed. No chrome. No toaster.
 *  - Content is aspect-preserving via SlideRenderer's object-contain path.
 *  - No path from AI code touches this file — only ever the operator's
 *    explicit BroadcastChannel `set`/`clear` messages update state.
 *
 * Robust to:
 *  - BroadcastChannel unavailable (cross-origin / old browser)
 *  - Malformed messages (messageerror handler)
 *  - fullscreen API rejections
 *  - Any raw DOM event that could otherwise become "[object Event]"
 */
/** Map an overlay position to absolute placement classes inside the slide canvas. */
function overlayPosClass(pos: OverlayPosition): string {
  switch (pos) {
    case "top-left": return "absolute top-[6%] left-[6%]";
    case "top-right": return "absolute top-[6%] right-[6%]";
    case "bottom-left": return "absolute bottom-[6%] left-[6%]";
    case "bottom-right": return "absolute bottom-[6%] right-[6%]";
    case "center": return "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";
    case "lower-third":
    default:
      return "absolute left-[6%] right-[6%] bottom-[10%]";
  }
}

export default function LivePage() {
  const [slide, setSlide] = useState<SlidePayload>({ kind: "empty" });
  // 2026-07-30 translation-swap fade (Change 1 to-100). Belt-and-braces on
  // top of the TransitionSpec-driven cross-fade already sent by the operator
  // via BroadcastChannel — this listener only fires in same-window scenarios
  // (Electron in-process dev, single-tab preview) where a window-scoped
  // CustomEvent can reach the projector. Briefly dims the container so the
  // text swap reads as a smooth fade even when the operator has "none" as
  // their default transition (the one-shot TransitionSpec covers the
  // separate-window case).
  const [translationSwapFading, setTranslationSwapFading] = useState(false);
  const [announcement, setAnnouncement] = useState<AnnouncementPayload | null>(null);
  const [transition, setTransition] = useState<TransitionSpec | null>(null);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "4:3" | "custom">("16:9");
  const [fontScale, setFontScale] = useState(1); // B3 operator manual text size
  const [appearance, setAppearance] = useState<ThemeAppearance | null>(null); // Themes Phase 1
  const [videoInput, setVideoInput] = useState<VideoInputState | null>(null); // Phase 2a live video
  const [messageOverlay, setMessageOverlay] = useState<{ text: string; position: OverlayPosition } | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Content key (text|dismissAfterMs) of the currently shown message — the
  // operator heartbeats the same overlay at 1Hz, and we must only (re)arm the
  // client-side dismiss countdown when the CONTENT changes, not per heartbeat.
  const lastMessageContentRef = useRef<string | null>(null);
  // Operator heartbeats the message overlay at 1Hz while showing — sweep a
  // stale message (incl. dismiss:manual) off screen if the beats stop.
  const lastMessageMsgAt = useRef<number>(0);
  const [timerOverlay, setTimerOverlay] = useState<{ name?: string; remainingSec: number; running: boolean; kind: "countdown" | "elapsed"; position?: OverlayPosition } | null>(null);
  // Operator heartbeats the timer overlay at 1Hz while shown — if the beats
  // stop (operator window closed/crashed) we sweep the stale timer off screen.
  const lastTimerMsgAt = useRef<number>(0);
  const [connected, setConnected] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [pairBadge, setPairBadge] = useState<string | null>(null);
  const lastMsgAt = useRef<number>(Date.now());
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const broadcastChRef = useRef<BroadcastChannel | null>(null);

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
    // Y4: BroadcastChannel can silently die (tab throttled, service-worker
    // reset, GC of stale channel). If we go >5s with no message we close and
    // re-open. Uses a local mutable holder so both the message handler and
    // the reconnect timer see the current instance.
    let ch: BroadcastChannel | null = openLiveChannel();
    broadcastChRef.current = ch;
    let reopenCount = 0;
    if (!ch) {
      setWarning("This browser doesn't support BroadcastChannel — projector cannot sync with the operator window.");
      return;
    }
    // Wrap the handler so a bad message NEVER throws up into React's
    // unhandled rejection tracker (which is what surfaces as
    // "[object Event]" in the Next dev overlay).
    const onMessage = (e: MessageEvent) => {
      try {
        const raw = e.data;
        if (!isValidLiveMessage(raw)) return;      // reject malformed / unknown-kind
        const msg = raw as LiveMessage;
        lastMsgAt.current = Date.now();
        setConnected(true);
        if (msg.type === "set") {
          if (msg.transition !== undefined) setTransition(msg.transition);
          setSlide(msg.slide);
        }
        else if (msg.type === "clear") setSlide({ kind: "empty" });
        else if (msg.type === "pong") setSlide(msg.slide);
        else if (msg.type === "output") {
          setSlide(msg.state.live);
          setAnnouncement(msg.state.announcement ?? null);
          setTransition(msg.state.transition ?? null);
          setAspectRatio(msg.state.aspectRatio);
          setFontScale(typeof msg.state.fontScale === "number" ? msg.state.fontScale : 1);
          setAppearance(msg.state.appearance ?? null);
          setVideoInput(msg.state.videoInput ?? null);
        } else if (msg.type === "message") {
          // Auto-dismiss timer is client-side, so multiple output windows
          // stay in sync without needing a shared wall-clock deadline.
          if ("clear" in msg.overlay && msg.overlay.clear) {
            if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
            lastMessageContentRef.current = null;
            lastMessageMsgAt.current = 0;
            setMessageOverlay(null);
          } else if ("text" in msg.overlay) {
            lastMessageMsgAt.current = Date.now();
            setMessageOverlay({ text: msg.overlay.text, position: msg.overlay.position ?? "lower-third" });
            // Operator re-posts the same message at 1Hz (heartbeat). Only
            // (re)arm the dismiss countdown when content actually changes —
            // otherwise the countdown would restart every second and a timed
            // message would never dismiss.
            const ms = msg.overlay.dismissAfterMs;
            const contentKey = `${msg.overlay.text}|${typeof ms === "number" ? ms : "manual"}`;
            if (contentKey !== lastMessageContentRef.current) {
              lastMessageContentRef.current = contentKey;
              if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
              if (typeof ms === "number" && ms > 0) {
                messageTimerRef.current = setTimeout(() => setMessageOverlay(null), ms);
              }
            }
          }
        } else if (msg.type === "timer") {
          if ("clear" in msg.overlay && msg.overlay.clear) setTimerOverlay(null);
          else { setTimerOverlay(msg.overlay); lastTimerMsgAt.current = Date.now(); }
        } else if (msg.type === "media-control") {
          const el = videoElRef.current;
          if (!el) return;
          switch (msg.command) {
            case "play": el.play().catch(() => {}); break;
            case "pause": el.pause(); break;
            case "seek": if (typeof msg.value === "number") el.currentTime = msg.value; break;
            case "volume": if (typeof msg.value === "number") el.volume = Math.max(0, Math.min(1, msg.value)); break;
            case "mute": el.muted = true; break;
            case "unmute": el.muted = false; break;
            case "restart": el.currentTime = 0; el.play().catch(() => {}); break;
            case "loop": el.loop = true; break;
            case "unloop": el.loop = false; break;
          }
        }
      } catch (err) {
        console.warn("[live] message handler error:", err instanceof Error ? err.message : String(err));
      }
    };
    const attachHandlers = (channel: BroadcastChannel) => {
      channel.onmessage = onMessage;
      channel.onmessageerror = () => console.warn("[live] messageerror — malformed message received, ignoring");
    };
    attachHandlers(ch);
    safePost(ch, { type: "ping" });

    const timer = setInterval(() => {
      const stale = Date.now() - lastMsgAt.current;
      if (stale > 3000) setConnected(false);
      // Stale-timer sweep: operator posts every second while a timer is
      // shown. 5s of silence means the operator is gone — take it down.
      if (lastTimerMsgAt.current > 0 && Date.now() - lastTimerMsgAt.current > 5000) {
        lastTimerMsgAt.current = 0;
        setTimerOverlay(null);
      }
      // Stale-message sweep: same contract as timers — operator heartbeats at
      // 1Hz while a message is showing; 5s of silence means the operator is
      // gone, so even a `dismiss: manual` message comes down.
      if (lastMessageMsgAt.current > 0 && Date.now() - lastMessageMsgAt.current > 5000) {
        lastMessageMsgAt.current = 0;
        lastMessageContentRef.current = null;
        if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
        setMessageOverlay(null);
      }
      // Y4: silent-channel recovery. If we've received nothing for >5s AND
      // the channel is still nominally open, close and re-open. Bounded
      // to avoid a hot reopen loop when the whole tab has been backgrounded.
      if (stale > 5000 && reopenCount < 20) {
        try { ch?.close(); } catch { /* ignore */ }
        ch = openLiveChannel();
        broadcastChRef.current = ch;
        if (ch) {
          reopenCount += 1;
          attachHandlers(ch);
          safePost(ch, { type: "ping" });
          lastMsgAt.current = Date.now(); // avoid immediate re-trigger
        }
      }
    }, 1000);

    // Cross-device sync via Supabase Realtime, if ?pair=CODE is present.
    // Never blocks or replaces BroadcastChannel — purely additive.
    let realtime: ReturnType<typeof openOutputChannel> | null = null;
    let badgeTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const pair = params.get("pair");
      if (pair && isValidPairCode(pair)) {
        const code = pair.trim().toUpperCase();
        // Y8: honour the optional church scope so we join the same
        // church-scoped channel the operator publishes to.
        const church = params.get("church") || undefined;
        realtime = openOutputChannel(code, church);
        let firstMsg = true;
        realtime.subscribe((state) => {
          lastMsgAt.current = Date.now();
          setConnected(true);
          setSlide(state.live);
          setAnnouncement(state.announcement ?? null);
          setTransition(state.transition ?? null);
          setFontScale(typeof state.fontScale === "number" ? state.fontScale : 1);
          setAppearance(state.appearance ?? null);
          setVideoInput(state.videoInput ?? null);
          if (firstMsg) {
            firstMsg = false;
            setPairBadge(code);
            badgeTimer = setTimeout(() => setPairBadge(null), 5000);
          }
        });
      }
    } catch (e) {
      console.warn("[live] pair-code subscribe failed:", e instanceof Error ? e.message : String(e));
    }

    return () => {
      try { ch?.close(); } catch { /* ignore */ }
      try { realtime?.close(); } catch { /* ignore */ }
      if (badgeTimer) clearTimeout(badgeTimer);
      if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
      clearInterval(timer);
    };
  }, []);

  // Auto-hide the fullscreen hint after 5 s
  useEffect(() => {
    const t = setTimeout(() => setShowHelp(false), 5000);
    return () => clearTimeout(t);
  }, []);

  // 2026-07-30 translation-swap fade listener. Same-window only. Sets a
  // brief opacity dim (200ms) around the moment the slide swaps to a new
  // translation. Cross-window (normal projector-in-separate-window path)
  // is handled by the one-shot fade TransitionSpec that the operator posts
  // via BroadcastChannel — see applyTranslationSwitch in ProOperatorShell.
  useEffect(() => {
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    function onSwap() {
      setTranslationSwapFading(true);
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => setTranslationSwapFading(false), 220);
    }
    window.addEventListener("presentflow:live-translation-swap", onSwap);
    return () => {
      window.removeEventListener("presentflow:live-translation-swap", onSwap);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, []);

  // Media-status reporting: when a video is live, report playback state
  // back to the operator console at ~2Hz so the VideoControlBar stays in sync.
  useEffect(() => {
    if (slide.kind !== "video") return;
    const iv = setInterval(() => {
      const el = videoElRef.current;
      const ch = broadcastChRef.current;
      if (!el || !ch) return;
      try {
        ch.postMessage({
          type: "media-status",
          currentTime: el.currentTime,
          duration: Number.isFinite(el.duration) ? el.duration : 0,
          paused: el.paused,
          volume: el.volume,
          muted: el.muted,
          loop: el.loop,
        } as LiveMessage);
      } catch {}
    }, 500);
    return () => clearInterval(iv);
  }, [slide.kind]);

  // Callback to capture the video element ref from SlideRenderer
  const handleVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
  }, []);

  const goFullscreen = useCallback(async () => {
    // Fullscreen API rejects with DOMException. Wrap so nothing bubbles up
    // as an unhandled promise rejection (which some browsers stringify as
    // "[object Event]" in dev tooling).
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (err) {
      console.warn("[live] fullscreen request denied or unsupported:", err instanceof Error ? err.message : String(err));
    }
    setShowHelp(false);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      try {
        if (e.key === "f" || e.key === "F") { e.preventDefault(); goFullscreen(); }
        if (e.key === "Escape") setShowHelp(false);
      } catch (err) {
        console.warn("[live] key handler error:", err instanceof Error ? err.message : String(err));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goFullscreen]);

  // Global safety net: catch any raw Event/DOMException that would
  // otherwise reach Next's overlay as "[object Event]".
  useEffect(() => {
    function onUnhandled(e: PromiseRejectionEvent) {
      const reason = e.reason;
      const asError = reason instanceof Error
        ? reason
        : new Error(reason instanceof Event ? `DOM ${reason.type} event` : String(reason));
      console.warn("[live] swallowed unhandled rejection:", asError.message);
      e.preventDefault();
    }
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden cursor-none"
      style={{ margin: 0, padding: 0 }}
      onDoubleClick={goFullscreen}
    >
      {/*
        Aspect-ratio-aware canvas. When operator picks 4:3, we letterbox
        the slide inside a centered 4:3 box. 16:9 & custom fill.
      */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={
            aspectRatio === "4:3"
              ? "relative bg-black h-full max-w-full aspect-[4/3]"
              : "relative w-full h-full"
          }
        >
          <div
            style={{
              opacity: translationSwapFading ? 0.2 : 1,
              transition: "opacity 200ms ease-in-out",
              width: "100%",
              height: "100%",
            }}
          >
            {videoInput ? (
              // Video active: no slide-keyed transition wrapper (keeps the camera
              // stream persistent across slide changes — only the overlay updates).
              <OutputSlide slide={slide} videoInput={videoInput} appearance={appearance} fontScale={fontScale} projectorFit />
            ) : (
              <TransitionWrapper identityKey={slideIdentity(slide)} transition={transition}>
                <SlideRenderer slide={slide} projectorFit fontScale={fontScale} appearance={appearance} videoMuted={false} onVideoRef={handleVideoRef} />
              </TransitionWrapper>
            )}
          </div>
          <AnnouncementLayer ann={announcement} />
          {/* z-order: slide < timer (z-20) < message (z-30). Corner/lower-third
              placement keeps overlays off the slide text unless the operator
              explicitly picks "center". */}
          {timerOverlay && (
            <div className={`${overlayPosClass(timerOverlay.position ?? "top-right")} pointer-events-none z-20`}>
              <div
                className="inline-block bg-black/70 backdrop-blur-sm px-6 py-3 rounded-md border"
                style={{ borderColor: timerOverlay.remainingSec < 0 ? "#ef4444" : "var(--color-brand, #06b6d4)" }}
              >
                {timerOverlay.name && (
                  <div className="text-white/70 text-xs uppercase tracking-wider mb-1">{timerOverlay.name}</div>
                )}
                <div
                  className={`text-white text-3xl md:text-5xl font-mono font-bold tabular-nums leading-none ${timerOverlay.remainingSec < 0 ? "text-red-400" : ""}`}
                >
                  {formatTimerMMSS(timerOverlay.remainingSec)}
                </div>
              </div>
            </div>
          )}
          {messageOverlay && (
            /* Message overlay — rendered on top of the current slide (and any
               timer). Semi-transparent panel, auto-hides via the client-side
               dismiss timer. Position is operator-chosen; lower-third default. */
            <div className={`${overlayPosClass(messageOverlay.position)} pointer-events-none z-30`}>
              <div
                className={`bg-black/70 backdrop-blur-sm border-l-4 p-6 rounded-sm ${messageOverlay.position !== "lower-third" ? "inline-block max-w-[60vw]" : ""}`}
                style={{ borderColor: "var(--color-brand, #06b6d4)" }}
              >
                <div className="text-white text-2xl md:text-4xl font-semibold leading-tight text-left">
                  {messageOverlay.text}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showHelp && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-3 py-2 rounded-md flex items-center gap-3 cursor-pointer pointer-events-auto"
             onClick={goFullscreen}>
          <Maximize2 className="w-4 h-4" />
          <span>Press <kbd className="font-mono bg-white/10 px-1.5 py-0.5 rounded-sm">F</kbd> or double-click for fullscreen</span>
          <button onClick={(e) => { e.stopPropagation(); setShowHelp(false); }}
            className="text-white/70 hover:text-white ml-2">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {warning && (
        <div className="absolute top-4 left-4 right-4 max-w-md mx-auto bg-red-900/80 text-white text-xs px-3 py-2 rounded-md">
          {warning}
        </div>
      )}

      {pairBadge && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-emerald-900/80 text-white text-[10px] font-semibold px-2 py-1 rounded-sm pointer-events-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" /> CONNECTED VIA CODE {pairBadge}
        </div>
      )}

      {!connected && !warning && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-black/70 text-white text-[10px] font-semibold px-2 py-1 rounded-sm pointer-events-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> Operator disconnected
        </div>
      )}
    </div>
  );
}

function formatTimerMMSS(sec: number): string {
  const negative = sec < 0;
  const abs = Math.abs(Math.round(sec));
  const mm = Math.floor(abs / 60);
  const ss = abs % 60;
  return `${negative ? "-" : ""}${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function slideIdentity(s: SlidePayload): string {
  if (s.kind === "text") return `t:${s.text}`;
  if (s.kind === "image") return `i:${s.url}`;
  if (s.kind === "video") return `v:${s.url}`;
  if (s.kind === "blank") return `b:${s.bgColor ?? ""}`;
  if (s.kind === "logo") return `l:${s.url ?? ""}`;
  return "e";
}
