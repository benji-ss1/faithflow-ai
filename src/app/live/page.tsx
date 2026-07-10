"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { openLiveChannel, safePost, type SlidePayload, type LiveMessage, type AnnouncementPayload, type TransitionSpec } from "@/lib/broadcast";
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
export default function LivePage() {
  const [slide, setSlide] = useState<SlidePayload>({ kind: "empty" });
  const [announcement, setAnnouncement] = useState<AnnouncementPayload | null>(null);
  const [transition, setTransition] = useState<TransitionSpec | null>(null);
  const [connected, setConnected] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const lastMsgAt = useRef<number>(Date.now());

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
    if (!ch) {
      setWarning("This browser doesn't support BroadcastChannel — projector cannot sync with the operator window.");
      return;
    }
    safePost(ch, { type: "ping" });

    // Wrap the handler so a bad message NEVER throws up into React's
    // unhandled rejection tracker (which is what surfaces as
    // "[object Event]" in the Next dev overlay).
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
          setAnnouncement(msg.state.announcement ?? null);
          setTransition(msg.state.transition ?? null);
        }
      } catch (err) {
        console.warn("[live] message handler error:", err instanceof Error ? err.message : String(err));
      }
    };
    ch.onmessageerror = (e: MessageEvent) => {
      // messageerror fires when a message can't be deserialized. Log a real
      // Error object, not the raw event.
      console.warn("[live] messageerror — malformed message received, ignoring");
      void e;
    };

    const timer = setInterval(() => {
      if (Date.now() - lastMsgAt.current > 3000) setConnected(false);
    }, 1000);

    return () => {
      try { ch.close(); } catch { /* ignore */ }
      clearInterval(timer);
    };
  }, []);

  // Auto-hide the fullscreen hint after 5 s
  useEffect(() => {
    const t = setTimeout(() => setShowHelp(false), 5000);
    return () => clearTimeout(t);
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
      <TransitionWrapper identityKey={slideIdentity(slide)} transition={transition}>
        <SlideRenderer slide={slide} />
      </TransitionWrapper>
      <AnnouncementLayer ann={announcement} />

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

      {!connected && !warning && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-black/70 text-white text-[10px] font-semibold px-2 py-1 rounded-sm pointer-events-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> Operator disconnected
        </div>
      )}
    </div>
  );
}

function slideIdentity(s: SlidePayload): string {
  if (s.kind === "text") return `t:${s.text}`;
  if (s.kind === "image") return `i:${s.url}`;
  if (s.kind === "video") return `v:${s.url}`;
  if (s.kind === "blank") return `b:${s.bgColor ?? ""}`;
  if (s.kind === "logo") return `l:${s.url ?? ""}`;
  return "e";
}
