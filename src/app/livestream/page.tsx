"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { openLiveChannel, isValidLiveMessage, type SlidePayload, type LiveMessage, type AnnouncementPayload, type TransitionSpec } from "@/lib/broadcast";
import { openOutputChannel, isValidPairCode } from "@/lib/realtime";
import { AnnouncementLayer } from "@/components/live/AnnouncementLayer";
import { TransitionWrapper } from "@/components/live/TransitionWrapper";

if (typeof window !== "undefined" && !(window as unknown as { __ffLivestreamGuarded?: boolean }).__ffLivestreamGuarded) {
  (window as unknown as { __ffLivestreamGuarded: boolean }).__ffLivestreamGuarded = true;
  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason instanceof Event || (e.reason && typeof e.reason === "object" && "isTrusted" in (e.reason as object))) {
      e.preventDefault(); e.stopImmediatePropagation();
      console.warn("[livestream] suppressed non-Error rejection:", (e.reason as Event)?.type || String(e.reason));
    }
  }, true);
}

/**
 * Livestream output route.
 *
 * Full-bleed slide with optional lower-third overlay. Designed to be
 * captured by OBS / vMix / etc via a browser source. Same isolation
 * pattern as /live and /stage — no operator chrome.
 *
 * Layout modes:
 *   full           — full-slide (default)
 *   lower_third    — lower third strip only (transparent background
 *                    when ?bg=transparent is set, so OBS can key)
 */
export default function LivestreamPage() {
  const [slide, setSlide] = useState<SlidePayload>({ kind: "empty" });
  const [lowerThird, setLowerThird] = useState<{ line1: string; line2: string } | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementPayload | null>(null);
  const [transition, setTransition] = useState<TransitionSpec | null>(null);
  const [transitionsEnabled, setTransitionsEnabled] = useState(false);
  const [messageOverlay, setMessageOverlay] = useState<string | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [timerOverlay, setTimerOverlay] = useState<{ name?: string; remainingSec: number; running: boolean; kind: "countdown" | "elapsed" } | null>(null);
  const [connected, setConnected] = useState(false);
  const [pairBadge, setPairBadge] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(true);
  const lastMsgAt = useRef<number>(Date.now());

  // ?bg=transparent → strip our own bg so OBS chroma / alpha keys directly
  const [transparent, setTransparent] = useState(false);
  const [mode, setMode] = useState<"full" | "lower_third">("full");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setTransparent(p.get("bg") === "transparent");
    if (p.get("mode") === "lower_third") setMode("lower_third");
    // P5: OBS-friendly `?obs=lowerthird` is an alias for the lower-third
    // capture mode; it also implies a transparent background so OBS can key.
    if (p.get("obs") === "lowerthird") { setMode("lower_third"); setTransparent(true); }
    if (p.get("transitions") === "1") setTransitionsEnabled(true);
  }, []);

  useEffect(() => {
    try {
      document.body.style.overflow = "hidden";
      const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement | null;
      if (toaster) toaster.style.display = "none";
      return () => { try { document.body.style.overflow = ""; if (toaster) toaster.style.display = ""; } catch { /* ignore */ } };
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let ch: BroadcastChannel | null = openLiveChannel();
    let reopenCount = 0;
    if (!ch) return;
    const onMessage = (e: MessageEvent) => {
      try {
        if (!isValidLiveMessage(e.data)) return;
        const msg = e.data as LiveMessage;
        lastMsgAt.current = Date.now();
        setConnected(true);
        if (msg.type === "set") setSlide(msg.slide);
        else if (msg.type === "clear") setSlide({ kind: "empty" });
        else if (msg.type === "pong") setSlide(msg.slide);
        else if (msg.type === "output") {
          setSlide(msg.state.live);
          setLowerThird(msg.state.lowerThird);
          setAnnouncement(msg.state.announcement ?? null);
          setTransition(msg.state.transition ?? null);
        } else if (msg.type === "message") {
          if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
          if ("clear" in msg.overlay && msg.overlay.clear) setMessageOverlay(null);
          else if ("text" in msg.overlay) {
            setMessageOverlay(msg.overlay.text);
            const ms = msg.overlay.dismissAfterMs;
            if (typeof ms === "number" && ms > 0) messageTimerRef.current = setTimeout(() => setMessageOverlay(null), ms);
          }
        } else if (msg.type === "timer") {
          if ("clear" in msg.overlay && msg.overlay.clear) setTimerOverlay(null);
          else setTimerOverlay(msg.overlay);
        }
      } catch (err) {
        console.warn("[livestream] message handler error:", err instanceof Error ? err.message : String(err));
      }
    };
    const attach = (c: BroadcastChannel) => {
      c.onmessage = onMessage;
      c.onmessageerror = () => console.warn("[livestream] messageerror");
    };
    attach(ch);
    ch.postMessage({ type: "ping" } as LiveMessage);
    const timer = setInterval(() => {
      const stale = Date.now() - lastMsgAt.current;
      if (stale > 3000) setConnected(false);
      // Y4: silent-channel recovery.
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
          lastMsgAt.current = Date.now();
          setConnected(true);
          setSlide(state.live);
          setLowerThird(state.lowerThird);
          setAnnouncement(state.announcement ?? null);
          setTransition(state.transition ?? null);
          if (firstMsg) { firstMsg = false; setPairBadge(code); badgeTimer = setTimeout(() => setPairBadge(null), 5000); }
        });
      }
    } catch (e) {
      console.warn("[livestream] pair-code subscribe failed:", e instanceof Error ? e.message : String(e));
    }
    return () => {
      try { ch?.close(); } catch { /* ignore */ }
      try { realtime?.close(); } catch { /* ignore */ }
      if (badgeTimer) clearTimeout(badgeTimer);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShowHelp(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const goFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (err) {
      console.warn("[livestream] fullscreen denied:", err instanceof Error ? err.message : String(err));
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

  useEffect(() => {
    function onUnhandled(e: PromiseRejectionEvent) {
      console.warn("[livestream] swallowed unhandled rejection:", String(e.reason));
      e.preventDefault();
    }
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);

  return (
    <div
      className="fixed inset-0 overflow-hidden cursor-none"
      style={{ margin: 0, padding: 0, background: transparent ? "transparent" : "#000" }}
      onDoubleClick={goFullscreen}
    >
      {mode === "full" && (
        <>
          {transitionsEnabled ? (
            <TransitionWrapper identityKey={liveIdentity(slide)} transition={transition}>
              <SlideRenderer slide={slide} />
            </TransitionWrapper>
          ) : (
            <SlideRenderer slide={slide} />
          )}
          <AnnouncementLayer ann={announcement} />
          {lowerThird && (
            <div className="absolute bottom-16 left-16 right-16 max-w-[70%]">
              <div className="bg-black/70 backdrop-blur-sm border-l-4 border-[color:var(--color-brand)] p-5">
                <div className="text-white font-semibold text-2xl leading-tight">{lowerThird.line1}</div>
                {lowerThird.line2 && <div className="text-white/70 text-lg mt-1">{lowerThird.line2}</div>}
              </div>
            </div>
          )}
        </>
      )}
      {mode === "lower_third" && lowerThird && (
        <div className="absolute bottom-0 left-0 right-0 p-8">
          <div className="bg-black/80 border-l-4 border-[color:var(--color-brand)] p-6 max-w-2xl">
            <div className="text-white font-semibold text-3xl leading-tight">{lowerThird.line1}</div>
            {lowerThird.line2 && <div className="text-white/70 text-xl mt-2">{lowerThird.line2}</div>}
          </div>
        </div>
      )}
      {/* Y2: In lower_third OBS mode we require an EXPLICIT `lowerThird`
          payload. The previous fallback of rendering any text-kind slide
          leaked song lyrics into the OBS overlay. Cleaner boundary: only
          the operator's explicit lower-third string ever renders here. */}

      {messageOverlay && mode === "full" && (
        <div className="absolute left-[6%] right-[6%] bottom-[10%] pointer-events-none">
          <div className="bg-black/70 backdrop-blur-sm border-l-4 p-6 rounded-sm" style={{ borderColor: "var(--color-brand, #06b6d4)" }}>
            <div className="text-white text-2xl md:text-4xl font-semibold leading-tight text-left">{messageOverlay}</div>
          </div>
        </div>
      )}
      {timerOverlay && mode === "full" && (
        <div className="absolute top-[6%] right-[6%] pointer-events-none">
          <div className="bg-black/70 backdrop-blur-sm px-6 py-3 rounded-md border" style={{ borderColor: timerOverlay.remainingSec < 0 ? "#ef4444" : "var(--color-brand, #06b6d4)" }}>
            {timerOverlay.name && <div className="text-white/70 text-xs uppercase tracking-wider mb-1">{timerOverlay.name}</div>}
            <div className={`text-white text-3xl md:text-5xl font-mono font-bold tabular-nums leading-none ${timerOverlay.remainingSec < 0 ? "text-red-400" : ""}`}>
              {(() => { const n = timerOverlay.remainingSec < 0; const a = Math.abs(Math.round(timerOverlay.remainingSec)); const m = Math.floor(a / 60); const s = a % 60; return `${n ? "-" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; })()}
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-3 py-2 rounded-md flex items-center gap-3 cursor-pointer pointer-events-auto"
             onClick={goFullscreen}>
          <Maximize2 className="w-4 h-4" />
          <span>Livestream mode: <span className="font-mono">{mode}</span>{transparent && " · transparent bg"}. F = fullscreen</span>
          <button onClick={(e) => { e.stopPropagation(); setShowHelp(false); }}
            className="text-white/70 hover:text-white ml-2"><X className="w-3 h-3" /></button>
        </div>
      )}

      {pairBadge && !transparent && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-emerald-900/80 text-white text-[10px] font-semibold px-2 py-1 rounded-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" /> CONNECTED VIA CODE {pairBadge}
        </div>
      )}

      {!connected && !transparent && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-black/70 text-white text-[10px] font-semibold px-2 py-1 rounded-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> Operator disconnected
        </div>
      )}
    </div>
  );
}

function liveIdentity(s: SlidePayload): string {
  if (s.kind === "text") return `t:${s.text}`;
  if (s.kind === "image") return `i:${s.url}`;
  if (s.kind === "video") return `v:${s.url}`;
  if (s.kind === "blank") return `b:${s.bgColor ?? ""}`;
  if (s.kind === "logo") return `l:${s.url ?? ""}`;
  return "e";
}
