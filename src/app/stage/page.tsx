"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { PresentationCanvas } from "@/components/live/PresentationCanvas";
import { OutputCompositor } from "@/components/live/OutputCompositor";
import { openLiveChannel, type LiveChannelLike, coerceLiveMessage, type SlidePayload, type LiveMessage, type AnnouncementPayload, type TransitionSpec, type ThemeAppearance, type LayerWire } from "@/lib/broadcast";
import { LAYERS_V2, applyLayerPatchBounded, rebuildOverridesFromSnapshot, isStaleLayersSnapshot } from "@/lib/output-layers";
import type { ProjectionZone } from "@/lib/projection-zone";
import { openOutputChannel, isValidPairCode } from "@/lib/realtime";
import { AnnouncementLayer } from "@/components/live/AnnouncementLayer";

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
  // Wave 7: named (keyed) timers — the confidence-monitor use case (worship /
  // sermon countdowns visible to the platform). Ride alongside the legacy slot.
  type StageTimer = { id: string; name?: string; remainingSec: number; running: boolean; overrun?: boolean };
  const [namedTimers, setNamedTimers] = useState<Record<string, StageTimer>>({});
  const namedTimerAtRef = useRef<Record<string, number>>({});
  const [connected, setConnected] = useState(false);
  const [pairBadge, setPairBadge] = useState<string | null>(null);
  // null on server + first client render to avoid hydration mismatch on the clock.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const [showHelp, setShowHelp] = useState(true);
  const lastMsgAt = useRef<number>(Date.now());
  // Decoupling Phase 2 (DORMANT): per-layer override store for incoming
  // layer-patch messages. Nothing reads it yet (Phase 3, NEXT_PUBLIC_LAYERS_V2).
  const layerOverridesRef = useRef<Map<string, LayerWire>>(new Map());
  // Y1b: the origin epoch last folded from a snapshot (fresh-tab authority).
  const layerEpochRef = useRef<number | undefined>(undefined);
  // Phase 3: re-render-triggering snapshot of the override map (see /live).
  const [layerOverridesArr, setLayerOverridesArr] = useState<LayerWire[]>([]);
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
    let tick = 0;
    // Dedup the current slide so the projector's 3s self-heal pong (broadcast to
    // all windows) never re-renders a held static slide on the stage display.
    let appliedCurSig = "";
    const curSig = (s: SlidePayload): string => { try { return JSON.stringify(s); } catch { return String(Date.now()); } };
    const applyCurrent = (s: SlidePayload) => { const sig = curSig(s); if (sig === appliedCurSig) return; appliedCurSig = sig; setCurrent(s); };
    // Non-slide-field dedup — the operator answers every 3s self-heal ping with a
    // full OutputState snapshot; without this, structured-cloned appearance/etc
    // arrive as fresh refs each second and force a needless ~1Hz re-render.
    let appliedRestSig = "";
    if (!ch) return;
    const onMessage = (e: MessageEvent) => {
      try {
        // Salvage a projection-critical set/output/pong that fails strict
        // validation (parity with /live) so a bad neighbour field can't blank the
        // stage display; non-critical/unknown kinds → null → rejected as before.
        const msg = coerceLiveMessage(e.data);
        if (!msg) return;
        lastMsgAt.current = Date.now();
        setConnected(true);
        reopenCount = 0; // healthy traffic resets the recovery budget so a long
        // (2-3 hour) service never exhausts the reopen cap and permanently desyncs.
        if (msg.type === "set") applyCurrent(msg.slide);
        else if (msg.type === "clear") applyCurrent({ kind: "empty" });
        else if (msg.type === "pong") applyCurrent(msg.slide);
        else if (msg.type === "output") {
          // Ghost-operator guard (field wave 6B) — ignore a strictly-older
          // operator tab's snapshot so it can't blank this surface. Inert when
          // LAYERS_V2 is off or single-operator. See isStaleLayersSnapshot.
          if (LAYERS_V2 && isStaleLayersSnapshot(msg.state.layersEpoch, layerEpochRef.current)) return;
          applyCurrent(msg.state.live);
          // Apply the non-slide fields only when they actually changed (dedup).
          let restSig: string;
          try {
            restSig = JSON.stringify([msg.state.next, msg.state.fontScale, msg.state.referenceScale, msg.state.referenceColor, msg.state.background, msg.state.appearance, msg.state.zone, msg.state.nextItem, msg.state.operatorMessage, msg.state.countdownEndsAt, msg.state.announcement, msg.state.transition, LAYERS_V2 ? (msg.state.layers ?? null) : null, LAYERS_V2 ? (msg.state.layersEpoch ?? null) : null]);
          } catch { restSig = String(Date.now()); }
          if (restSig !== appliedRestSig) {
            appliedRestSig = restSig;
            if (LAYERS_V2) {
              setLayerOverridesArr(rebuildOverridesFromSnapshot(layerOverridesRef.current, msg.state.layers, { snapEpoch: msg.state.layersEpoch, epochRef: layerEpochRef }));
            }
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
          }
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
          const ov = msg.overlay;
          const oid = (ov as { id?: string }).id;
          if (oid) {
            if ("clear" in ov && ov.clear) {
              setNamedTimers((m) => { const n = { ...m }; delete n[oid]; return n; });
              delete namedTimerAtRef.current[oid];
            } else if ("remainingSec" in ov) {
              setNamedTimers((m) => ({ ...m, [oid]: { id: oid, name: ov.name, remainingSec: ov.remainingSec, running: ov.running, overrun: ov.overrun } }));
              namedTimerAtRef.current[oid] = Date.now();
            }
          } else if ("clear" in ov && ov.clear) setTimerOverlay(null);
          else { setTimerOverlay(ov); lastTimerMsgAt.current = Date.now(); }
        } else if (msg.type === "layer-patch") {
          // Decoupling Phase 2 (DORMANT): store the override; nothing renders from
          // it yet — Phase 3 gates consumption behind NEXT_PUBLIC_LAYERS_V2.
          // Bounded: existing ids update; a new id is dropped once full (MAX_LAYERS).
          {
            applyLayerPatchBounded(layerOverridesRef.current, msg.layer);
            if (LAYERS_V2) setLayerOverridesArr(Array.from(layerOverridesRef.current.values()));
          }
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
    ch.postMessage({ type: "ping", join: true } as LiveMessage);
    const timer = setInterval(() => {
      const stale = Date.now() - lastMsgAt.current;
      if (stale > 3000) setConnected(false);
      // Self-heal ping every ~3s — MIRRORS /live and /livestream. Theme
      // (appearance/background) rides only the deduped "output" frame; if it's
      // dropped or this window joined late, re-pinging pulls a fresh full
      // snapshot from the operator so the theme re-arrives within seconds.
      tick += 1;
      if (ch && tick % 3 === 0) { try { ch.postMessage({ type: "ping" } as LiveMessage); } catch { /* ignore */ } }
      if (lastTimerMsgAt.current > 0 && Date.now() - lastTimerMsgAt.current > 5000) {
        lastTimerMsgAt.current = 0;
        setTimerOverlay(null);
      }
      // Wave 7: sweep named timers whose per-id heartbeat has stopped for 5s.
      {
        const now = Date.now();
        const staleIds = Object.keys(namedTimerAtRef.current).filter((id) => now - namedTimerAtRef.current[id] > 5000);
        if (staleIds.length) {
          for (const id of staleIds) delete namedTimerAtRef.current[id];
          setNamedTimers((m) => { const n = { ...m }; for (const id of staleIds) delete n[id]; return n; });
        }
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
          try { ch.postMessage({ type: "ping", join: true } as LiveMessage); } catch { /* ignore */ }
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
          // 2026-09-01 fix ("stage should mirror the projector"): the cross-device
          // (pair-code) path was missing the theme background + reference sizing/
          // colour that the same-machine path already applies (lines ~105-107), so
          // a stage monitor connected over the network showed no background and
          // default reference styling. Mirror all three here too.
          setReferenceScale(typeof state.referenceScale === "number" ? state.referenceScale : 1);
          setReferenceColor(typeof state.referenceColor === "string" ? state.referenceColor : undefined);
          setBackground(state.background ?? null);
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
        {(timerOverlay || countdownStr || Object.keys(namedTimers).length > 0) && (
          <div className="absolute top-3 right-4 z-10 flex flex-col items-end gap-1.5">
            {(timerOverlay || countdownStr) && (
              <div className="flex items-center gap-2 bg-white/[0.06] border border-white/10 rounded-xl px-3 py-1.5 backdrop-blur-sm">
                <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">
                  {timerOverlay ? (timerOverlay.name || "Timer") : "Countdown"}{timerOverlay && !timerOverlay.running ? " (paused)" : ""}
                </span>
                <span className={`text-3xl font-mono font-light tabular-nums ${timerOverlay && timerOverlay.remainingSec < 0 ? "text-red-400" : "text-white/85"}`}>
                  {timerOverlay ? formatStageTimer(timerOverlay.remainingSec) : countdownStr}
                </span>
              </div>
            )}
            {/* Wave 7: named timers — each its own chip (worship / sermon). */}
            {Object.values(namedTimers).map((t) => (
              <div key={t.id} className="flex items-center gap-2 bg-white/[0.06] border border-white/10 rounded-xl px-3 py-1.5 backdrop-blur-sm">
                <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">
                  {t.name || "Timer"}{!t.running ? " (paused)" : ""}
                </span>
                <span className={`text-3xl font-mono font-light tabular-nums ${t.remainingSec < 0 ? "text-red-400" : "text-white/85"}`}>
                  {formatStageTimer(t.remainingSec)}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Decoupling Phase 1: shared OutputCompositor. mode="stage" encodes the
            confidence-monitor specifics — never a live camera, default canvas
            dims, always-transition, muted media. The "Next" preview strip below
            stays route-owned (it is stage-unique, not duplicated). */}
        <OutputCompositor
          mode="stage"
          slide={current}
          appearance={appearance}
          background={background}
          transition={transition}
          fontScale={fontScale}
          referenceScale={referenceScale}
          referenceColor={referenceColor}
          zone={zone}
          videoMuted
          layersEnabled={LAYERS_V2}
          layerOverrides={LAYERS_V2 ? layerOverridesArr : undefined}
        />
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
