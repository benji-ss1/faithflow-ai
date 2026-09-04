"use client";
import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";
import { Maximize2, X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { openLiveChannel, type LiveChannelLike, isValidLiveMessage, isValidOutputStateExternal, slideOutputIdentity, type OutputState, type SlidePayload, type LiveMessage, type AnnouncementPayload, type TransitionSpec, type ThemeAppearance, type VideoInputState } from "@/lib/broadcast";
import { OutputSlide, hasVideoBackground } from "@/components/live/OutputSlide";
import { BackgroundLayer } from "@/backgrounds/components/BackgroundLayer";
import { ThemeLogoLayer } from "@/components/live/ThemeLayers";
import { openOutputChannel, isValidPairCode, type RealtimeConnStatus } from "@/lib/realtime";
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
  const [fontScale, setFontScale] = useState(1); // B3 operator manual text size
  const [background, setBackground] = useState<import("@/lib/broadcast").BackgroundSpec | null>(null);
  const [appearance, setAppearance] = useState<ThemeAppearance | null>(null); // Themes Phase 1
  const [videoInput, setVideoInput] = useState<VideoInputState | null>(null); // Phase 2a live video
  const [referenceScale, setReferenceScale] = useState(1); // scripture reference-footer size — match the projector
  const [referenceColor, setReferenceColor] = useState<string | undefined>(undefined);
  const [lowerThird, setLowerThird] = useState<{ line1: string; line2: string } | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementPayload | null>(null);
  const [transition, setTransition] = useState<TransitionSpec | null>(null);
  const [transitionsEnabled, setTransitionsEnabled] = useState(false);
  // allowWeb: operator's "Allow on web" gate — /livestream is the PUBLIC
  // surface, so allowWeb === false messages must never render here (default
  // true for old-format payloads without the field).
  const [messageOverlay, setMessageOverlay] = useState<{ text: string; allowWeb: boolean } | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Heartbeat bookkeeping — operator re-posts the message at 1Hz. Only re-arm
  // the dismiss countdown on content change; sweep stale messages after 5s.
  const lastMessageContentRef = useRef<string | null>(null);
  const lastMessageMsgAt = useRef<number>(0);
  const [timerOverlay, setTimerOverlay] = useState<{ name?: string; remainingSec: number; running: boolean; kind: "countdown" | "elapsed" } | null>(null);
  const [connected, setConnected] = useState(false);
  // Cross-device realtime connection status (pair-code overlay). Drives the
  // setup-phase indicator so an operator can SEE the OBS overlay is connected
  // before the service, even in transparent mode.
  const [connStatus, setConnStatus] = useState<RealtimeConnStatus | null>(null);
  // Once a real slide has been shown, the setup-phase status pill NEVER renders
  // again — no chrome flashes over the live stream on a mid-service reconnect.
  const [hasGoneLive, setHasGoneLive] = useState(false);
  const [pairBadge, setPairBadge] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(true);
  const lastMsgAt = useRef<number>(Date.now());
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const broadcastChRef = useRef<LiveChannelLike | null>(null);

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

  // OBS transparent-key mode: globals.css paints <html>/<body> solid black (this
  // is a dark app). OBS Browser Source composites the ENTIRE page, so an opaque
  // body would hide the camera behind black — the transparent root <div> alone is
  // not enough. Force the document chrome transparent while ?bg=transparent, and
  // restore on unmount so navigating away doesn't leave a see-through app shell.
  useEffect(() => {
    if (!transparent) return;
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const prevHtml = htmlEl.style.background;
    const prevBody = bodyEl.style.background;
    htmlEl.style.background = "transparent";
    bodyEl.style.background = "transparent";
    return () => {
      try { htmlEl.style.background = prevHtml; bodyEl.style.background = prevBody; } catch { /* ignore */ }
    };
  }, [transparent]);

  useEffect(() => {
    let ch: LiveChannelLike | null = openLiveChannel();
    broadcastChRef.current = ch;
    let reopenCount = 0;
    let tick = 0;
    // True while a REMOTE transport (LAN ws open, or cloud realtime connected) is
    // the live source. On a remote OBS PC there's no operator on BroadcastChannel,
    // and the operator only publishes on CHANGE — so a long held slide = silence,
    // which must NOT be read as "operator disconnected" or trigger pointless
    // BroadcastChannel reopens. The remote socket's own liveness is authoritative.
    let remoteAlive = false;
    // Present when OBS opened /livestream?lan=<ip>:<port> — the LAN transport.
    const lanParam = (() => {
      try {
        const raw = new URLSearchParams(window.location.search).get("lan");
        if (raw && /^[a-zA-Z0-9.\-]{1,253}:\d{2,5}$/.test(raw)) return raw;
      } catch { /* ignore */ }
      return null;
    })();
    // Dedup the slide so the projector's 3s self-heal pong (broadcast to all
    // windows) never re-renders a held static slide on the livestream output.
    let appliedSig = "";
    const slideSig = (s: SlidePayload): string => { try { return JSON.stringify(s); } catch { return String(Date.now()); } };
    const applySlide = (s: SlidePayload) => {
      if (s.kind !== "empty") setHasGoneLive(true);
      const sig = slideSig(s); if (sig === appliedSig) return; appliedSig = sig; setSlide(s);
    };
    // Non-slide-field dedup — mirrors /live (live/page.tsx). The operator answers
    // every 3s self-heal ping with a FULL OutputState snapshot; without this the
    // structured-cloned appearance/background arrive as fresh object refs each
    // second and force a needless ~1Hz re-render of the whole surface.
    let lastNonSlideSig = "";
    if (!ch) return;
    const onMessage = (e: MessageEvent) => {
      try {
        if (!isValidLiveMessage(e.data)) return;
        const msg = e.data as LiveMessage;
        lastMsgAt.current = Date.now();
        setConnected(true);
        reopenCount = 0; // healthy traffic resets the recovery budget so a long
        // (2-3 hour) service never exhausts the reopen cap and permanently desyncs.
        if (msg.type === "set") applySlide(msg.slide);
        else if (msg.type === "clear") applySlide({ kind: "empty" });
        else if (msg.type === "pong") applySlide(msg.slide);
        else if (msg.type === "output") {
          applyOutputState(msg.state);
        } else if (msg.type === "message") {
          if ("clear" in msg.overlay && msg.overlay.clear) {
            if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
            lastMessageContentRef.current = null;
            lastMessageMsgAt.current = 0;
            setMessageOverlay(null);
          } else if ("text" in msg.overlay) {
            lastMessageMsgAt.current = Date.now();
            setMessageOverlay({ text: msg.overlay.text, allowWeb: msg.overlay.allowWeb !== false });
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
          else setTimerOverlay(msg.overlay);
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
        console.warn("[livestream] message handler error:", err instanceof Error ? err.message : String(err));
      }
    };
    const attach = (c: LiveChannelLike) => {
      c.onmessage = onMessage;
      c.onmessageerror = () => console.warn("[livestream] messageerror");
    };
    attach(ch);
    ch.postMessage({ type: "ping", join: true } as LiveMessage);
    const timer = setInterval(() => {
      const stale = Date.now() - lastMsgAt.current;
      // A live remote transport keeps us "connected" even through a held-slide
      // silence; only fall back to the BroadcastChannel staleness rule otherwise.
      if (remoteAlive) setConnected(true);
      else if (stale > 3000) setConnected(false);
      // Self-heal ping every ~3s — MIRRORS /live (live/page.tsx:272-273). The
      // theme (appearance/background) rides ONLY the heavyweight, deduped
      // "output" message; live slide-fires ride the lighter "set" message which
      // carries no theme. If that one "output" frame is dropped on the flaky
      // same-machine BroadcastChannel (the 2026-08-28 "yellow lyrics on a WHITE
      // projector" field bug) OR this window joined after it was sent,
      // appearance/background stay null for the WHOLE service → default black bg
      // + white font on the stream. /live already self-heals by re-pinging; the
      // constant "set" traffic here kept the channel non-silent so the 5s-silence
      // recovery below never fired and the theme never re-arrived. The operator
      // answers every ping with the full OutputState snapshot (OperatorConsole
      // :1007-1022) which carries the theme, and our "output" handler applies it.
      tick += 1;
      if (ch && tick % 3 === 0) { try { ch.postMessage({ type: "ping" } as LiveMessage); } catch { /* ignore */ } }
      // Stale-message sweep: operator heartbeats at 1Hz while showing; 5s of
      // silence means the operator is gone — take the message down.
      if (lastMessageMsgAt.current > 0 && Date.now() - lastMessageMsgAt.current > 5000) {
        lastMessageMsgAt.current = 0;
        lastMessageContentRef.current = null;
        if (messageTimerRef.current) { clearTimeout(messageTimerRef.current); messageTimerRef.current = null; }
        setMessageOverlay(null);
      }
      // Y4: silent-channel recovery — skip entirely when a remote transport is
      // the source (no operator on BroadcastChannel to recover; reopening churns).
      if (!remoteAlive && stale > 5000 && reopenCount < 20) {
        try { ch?.close(); } catch { /* ignore */ }
        ch = openLiveChannel();
        if (ch) {
          reopenCount += 1;
          attach(ch);
          try { ch.postMessage({ type: "ping", join: true } as LiveMessage); } catch { /* ignore */ }
          lastMsgAt.current = Date.now();
        }
      }
    }, 1000);
    let realtime: ReturnType<typeof openOutputChannel> | null = null;
    let badgeTimer: ReturnType<typeof setTimeout> | null = null;
    // Shared state-apply — used by BOTH the cloud (Realtime) transport and the
    // LAN (direct WebSocket) transport so the two paths render byte-identically.
    // Every frame carries the full OutputState (appearance/background included),
    // so the theme is always current — no dropped-frame gap like the deduped
    // "output" BroadcastChannel path.
    const applyOutputState = (state: OutputState) => {
      lastMsgAt.current = Date.now();
      setConnected(true);
      applySlide(state.live); // dedups the slide + tracks hasGoneLive
      // Apply the non-slide fields only when they actually changed (dedup).
      let sig: string;
      try {
        sig = JSON.stringify([state.fontScale, state.referenceScale, state.referenceColor, state.appearance, state.background, state.videoInput, state.lowerThird, state.announcement, state.transition]);
      } catch { sig = String(Date.now()); }
      if (sig === lastNonSlideSig) return;
      lastNonSlideSig = sig;
      setFontScale(typeof state.fontScale === "number" ? state.fontScale : 1);
      setReferenceScale(typeof state.referenceScale === "number" ? state.referenceScale : 1);
      setReferenceColor(typeof state.referenceColor === "string" ? state.referenceColor : undefined);
      setAppearance(state.appearance ?? null);
      setBackground(state.background ?? null);
      setVideoInput(state.videoInput ?? null);
      setLowerThird(state.lowerThird);
      setAnnouncement(state.announcement ?? null);
      setTransition(state.transition ?? null);
    };
    // Cloud (Realtime) pair transport — SKIPPED when a LAN transport is present,
    // so the two never double-apply / fight over the same surface.
    try {
      const params = new URLSearchParams(window.location.search);
      const pair = params.get("pair");
      if (!lanParam && pair && isValidPairCode(pair)) {
        const code = pair.trim().toUpperCase();
        const church = params.get("church") || undefined;
        realtime = openOutputChannel(code, church);
        realtime.onStatus((s) => { remoteAlive = s === "connected"; setConnStatus(s); });
        let firstMsg = true;
        realtime.subscribe((state) => {
          applyOutputState(state);
          if (firstMsg) { firstMsg = false; setPairBadge(code); badgeTimer = setTimeout(() => setPairBadge(null), 5000); }
        });
      }
    } catch (e) {
      console.warn("[livestream] pair-code subscribe failed:", e instanceof Error ? e.message : String(e));
    }

    // LAN transport — OBS opens /livestream?lan=<ip>:<port>. We connect DIRECTLY
    // to the operator PC's local ws server (electron/lan/LanOverlayServer.ts).
    // No cloud/Supabase dependency; snapshot-on-connect means no blank frame.
    // Auto-reconnects with capped backoff so a brief network blip self-heals.
    let lanWs: WebSocket | null = null;
    let lanRetry: ReturnType<typeof setTimeout> | null = null;
    let lanBackoff = 1000;
    let lanClosed = false;
    const connectLan = () => {
      if (!lanParam || lanClosed) return;
      setConnStatus("connecting");
      try {
        const sock = new WebSocket(`ws://${lanParam}/ws`);
        lanWs = sock;
        sock.onopen = () => {
          lanBackoff = 1000;
          remoteAlive = true;
          setConnStatus("connected");
          try { sock.send(JSON.stringify({ type: "snapshot_request" })); } catch { /* ignore */ }
        };
        sock.onmessage = (ev) => {
          try {
            const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
            if (msg && msg.type === "output" && isValidOutputStateExternal(msg.state)) {
              applyOutputState(msg.state as OutputState);
            }
          } catch { /* ignore malformed */ }
        };
        sock.onclose = () => { remoteAlive = false; if (!lanClosed) { setConnStatus("reconnecting"); scheduleLan(); } };
        sock.onerror = () => { try { sock.close(); } catch { /* ignore */ } };
      } catch (e) {
        console.warn("[livestream] LAN connect failed:", e instanceof Error ? e.message : String(e));
        scheduleLan();
      }
    };
    const scheduleLan = () => {
      if (lanClosed || lanRetry) return;
      const wait = Math.min(lanBackoff, 15_000);
      lanRetry = setTimeout(() => { lanRetry = null; lanBackoff = Math.min(lanBackoff * 2, 15_000); connectLan(); }, wait);
    };
    if (lanParam) connectLan();

    return () => {
      try { ch?.close(); } catch { /* ignore */ }
      try { realtime?.close(); } catch { /* ignore */ }
      lanClosed = true;
      if (lanRetry) clearTimeout(lanRetry);
      try { lanWs?.close(); } catch { /* ignore */ }
      if (badgeTimer) clearTimeout(badgeTimer);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShowHelp(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const handleVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
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
          {/* Background Templates layer for the broadcast/NDI output. Never in
              transparent (OBS-key) mode. When active the slide goes transparent. */}
          {/* Live camera wins over a Background Template here too (mirrors /live). */}
          {!transparent && background && background.type !== "none" && !videoInput && <BackgroundLayer key={background.shaderPreset ?? background.type} background={background} />}
          {!transparent && hasVideoBackground(videoInput, appearance) && !(!transparent && background && background.type !== "none" && !videoInput) ? (
            <OutputSlide slide={slide} videoInput={videoInput} appearance={appearance} fontScale={fontScale} referenceScale={referenceScale} referenceColor={referenceColor} projectorFit />
          ) : transitionsEnabled ? (
            <TransitionWrapper identityKey={slideOutputIdentity(slide)} transition={transition}>
              <SlideRenderer slide={slide} projectorFit fontScale={fontScale} referenceScale={referenceScale} referenceColor={referenceColor} appearance={appearance} overVideo={!!(!transparent && background && background.type !== "none" && !videoInput)} transparentBg={transparent} videoMuted={false} onVideoRef={handleVideoRef} />
            </TransitionWrapper>
          ) : (
            <SlideRenderer slide={slide} projectorFit fontScale={fontScale} referenceScale={referenceScale} referenceColor={referenceColor} appearance={appearance} overVideo={!!(!transparent && background && background.type !== "none" && !videoInput)} transparentBg={transparent} videoMuted={false} onVideoRef={handleVideoRef} />
          )}
          {/* No theme logo in OBS transparent mode — the overlay is text-only so
              OBS composites just the lyrics/verse over the camera. */}
          {!transparent && <ThemeLogoLayer appearance={appearance} />}
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
      {/* 2026-08-16 (user request): the livestream LOWER-THIRD now shows the
          CURRENT LIVE lyrics/verse as a caption for the stream — not just an
          explicit operator lower-third. The operator chooses full vs lower-third
          via Hardware → Screens → Livestream, so this is opt-in per surface; it
          only renders what's already live on the projector (their own service). */}
      {mode === "lower_third" && (() => {
        const liveText = slide.kind === "text" && typeof slide.text === "string" && slide.text.trim() ? slide.text : null;
        if (!lowerThird && !liveText) return null;
        return (
          <div className="absolute bottom-0 left-0 right-0 p-8">
            <div className="bg-black/80 border-l-4 border-[color:var(--color-brand)] p-6 max-w-4xl">
              {lowerThird ? (
                <>
                  <div className="text-white font-semibold text-3xl leading-tight">{lowerThird.line1}</div>
                  {lowerThird.line2 && <div className="text-white/70 text-xl mt-2">{lowerThird.line2}</div>}
                </>
              ) : (
                <div className="text-white font-semibold text-3xl leading-snug whitespace-pre-wrap max-h-[42vh] overflow-hidden">{liveText}</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* allowWeb === false → operator said in-building only; never show on
          this public OBS-facing surface. */}
      {messageOverlay && messageOverlay.allowWeb && mode === "full" && (
        <div className="absolute left-[6%] right-[6%] bottom-[10%] pointer-events-none">
          <div className="bg-black/70 backdrop-blur-sm border-l-4 p-6 rounded-sm" style={{ borderColor: "var(--color-brand, #06b6d4)" }}>
            <div className="text-white text-2xl md:text-4xl font-semibold leading-tight text-left">{messageOverlay.text}</div>
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

      {/* NB: hidden in transparent (OBS-key) mode — like the pair/disconnect
          badges below — so this help pill never flashes onto the live stream
          when the livestream team refreshes the Browser Source mid-service. */}
      {showHelp && !transparent && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-3 py-2 rounded-md flex items-center gap-3 cursor-pointer pointer-events-auto"
             onClick={goFullscreen}>
          <Maximize2 className="w-4 h-4" />
          <span>Livestream mode: <span className="font-mono">{mode}</span>{transparent && " · transparent bg"}. F = fullscreen</span>
          <button onClick={(e) => { e.stopPropagation(); setShowHelp(false); }}
            className="text-white/70 hover:text-white ml-2"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Setup-phase connection status — shows even in transparent mode so the
          operator can SEE the OBS overlay connect BEFORE the service. Once a real
          slide has ever gone live it NEVER shows again, so a mid-service reconnect
          can't flash chrome over the live stream (transparent or full-look). */}
      {connStatus && !hasGoneLive && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-md shadow-lg"
          style={{
            background:
              connStatus === "connected" ? "rgba(6,95,70,0.92)"
              : connStatus === "unavailable" ? "rgba(127,29,29,0.92)"
              : "rgba(120,53,15,0.92)",
          }}>
          <span className={"w-2 h-2 rounded-full " + (connStatus === "connected" ? "bg-emerald-300" : connStatus === "unavailable" ? "bg-red-400" : "bg-amber-300 animate-pulse")} />
          {connStatus === "connected" ? "Connected ✓ — send a slide to test"
            : connStatus === "connecting" ? "Connecting to PresentFlow…"
            : connStatus === "reconnecting" ? "Reconnecting…"
            : "Cross-device sync unavailable — update PresentFlow"}
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

