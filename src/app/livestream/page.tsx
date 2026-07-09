"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { openLiveChannel, type SlidePayload, type LiveMessage } from "@/lib/broadcast";

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
  const [connected, setConnected] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const lastMsgAt = useRef<number>(Date.now());

  // ?bg=transparent → strip our own bg so OBS chroma / alpha keys directly
  const [transparent, setTransparent] = useState(false);
  const [mode, setMode] = useState<"full" | "lower_third">("full");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setTransparent(p.get("bg") === "transparent");
    if (p.get("mode") === "lower_third") setMode("lower_third");
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
    const ch = openLiveChannel();
    if (!ch) return;
    ch.postMessage({ type: "ping" } as LiveMessage);
    ch.onmessage = (e: MessageEvent) => {
      try {
        const msg = e.data as LiveMessage;
        if (!msg || typeof msg !== "object" || !("type" in msg)) return;
        lastMsgAt.current = Date.now();
        setConnected(true);
        if (msg.type === "set") setSlide(msg.slide);
        else if (msg.type === "clear") setSlide({ kind: "empty" });
        else if (msg.type === "pong") setSlide(msg.slide);
        else if (msg.type === "output") {
          setSlide(msg.state.live);
          setLowerThird(msg.state.lowerThird);
        }
      } catch (err) {
        console.warn("[livestream] message handler error:", err instanceof Error ? err.message : String(err));
      }
    };
    ch.onmessageerror = () => console.warn("[livestream] messageerror");
    const timer = setInterval(() => {
      if (Date.now() - lastMsgAt.current > 3000) setConnected(false);
    }, 1000);
    return () => { try { ch.close(); } catch { /* ignore */ } clearInterval(timer); };
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
          <SlideRenderer slide={slide} />
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

      {showHelp && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-3 py-2 rounded-md flex items-center gap-3 cursor-pointer pointer-events-auto"
             onClick={goFullscreen}>
          <Maximize2 className="w-4 h-4" />
          <span>Livestream mode: <span className="font-mono">{mode}</span>{transparent && " · transparent bg"}. F = fullscreen</span>
          <button onClick={(e) => { e.stopPropagation(); setShowHelp(false); }}
            className="text-white/70 hover:text-white ml-2"><X className="w-3 h-3" /></button>
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
