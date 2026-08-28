"use client";
/**
 * NDI output render surface (Phase 1 of the native NDI sender).
 *
 * This is the "NDI output renderer" from the spec (§3): a clean, chrome-free,
 * FIXED 1920×1080 surface that renders ONLY the current LIVE output — no editor,
 * menus, thumbnails, cursor, badges or preview. A hidden offscreen BrowserWindow
 * (Phase 3) loads this URL, and its `paint` frames are handed to the native NDI
 * sender (Phase 4). It reuses the SAME SlideRenderer/OutputSlide pipeline as the
 * projector, so what NDI sends matches the live output (§16, §24 — no second
 * renderer).
 *
 * Query params:
 *   ?mode=transparent  (default) — Transparent Graphics: alpha bg + graphics only,
 *                                   for camera+lyrics compositing in OBS (§6,§7A).
 *   ?mode=full                    — Full Canvas: the complete rendered 16:9 output
 *                                   with theme background (§7B).
 *   ?test=1                       — Alpha test pattern (§6,§18): lets the church
 *                                   media team confirm OBS is receiving PresentFlow
 *                                   and that alpha is preserved, before a service.
 *
 * LIVE-ONLY (§4): subscribes to the same live channel as /live. Preview never
 * reaches here. CLEAR (§5) → empty slide → fully transparent frame (camera shows
 * through in OBS); the surface is never torn down, it just goes transparent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { OutputSlide, hasVideoBackground } from "@/components/live/OutputSlide";
import { BackgroundLayer } from "@/backgrounds/components/BackgroundLayer";
import { ThemeLogoLayer } from "@/components/live/ThemeLayers";
import { PresentationCanvas } from "@/components/live/PresentationCanvas";
import {
  openLiveChannel, type LiveChannelLike, isValidLiveMessage, type SlidePayload,
  type LiveMessage, type TransitionSpec, type ThemeAppearance, type VideoInputState, type BackgroundSpec,
} from "@/lib/broadcast";

// Prevent noisy non-Error unhandledrejections from an offscreen renderer.
if (typeof window !== "undefined" && !(window as unknown as { __ffNdiGuarded?: boolean }).__ffNdiGuarded) {
  (window as unknown as { __ffNdiGuarded: boolean }).__ffNdiGuarded = true;
  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason instanceof Event || (e.reason && typeof e.reason === "object" && "isTrusted" in (e.reason as object))) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
}

export default function NdiOutputPage() {
  const [mode, setMode] = useState<"transparent" | "full">("transparent");
  const [test, setTest] = useState(false);
  const [slide, setSlide] = useState<SlidePayload>({ kind: "empty" });
  const [fontScale, setFontScale] = useState(1);
  const [appearance, setAppearance] = useState<ThemeAppearance | null>(null);
  const [background, setBackground] = useState<BackgroundSpec | null>(null);
  const [videoInput, setVideoInput] = useState<VideoInputState | null>(null);
  const [transition, setTransition] = useState<TransitionSpec | null>(null);
  const lastMsgAt = useRef<number>(Date.now());

  // Params (read once).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("mode") === "full") setMode("full");
    if (p.get("test") === "1") setTest(true);
  }, []);

  const transparent = mode === "transparent";

  // Chrome-free body: no scrollbars, no cursor, black-or-transparent ground.
  useEffect(() => {
    const html = document.documentElement, body = document.body;
    const prevH = html.style.background, prevB = body.style.background, prevO = body.style.overflow;
    body.style.overflow = "hidden";
    // Transparent Graphics → transparent ground so the offscreen paint carries
    // real alpha (§6). Full Canvas → black ground.
    html.style.background = transparent ? "transparent" : "#000";
    body.style.background = transparent ? "transparent" : "#000";
    return () => { html.style.background = prevH; body.style.background = prevB; body.style.overflow = prevO; };
  }, [transparent]);

  // LIVE-state subscription (same channel as /live). Deduped so a repeated
  // self-heal pong can't re-render a held slide.
  useEffect(() => {
    if (test) return; // test pattern ignores live state
    let ch: LiveChannelLike | null = openLiveChannel();
    if (!ch) return;
    let appliedSig = "";
    const applySlide = (s: SlidePayload) => {
      let sig = ""; try { sig = JSON.stringify(s); } catch { sig = String(Date.now()); }
      if (sig === appliedSig) return; appliedSig = sig; setSlide(s);
    };
    const onMessage = (e: MessageEvent) => {
      try {
        if (!isValidLiveMessage(e.data)) return;
        const msg = e.data as LiveMessage;
        lastMsgAt.current = Date.now();
        if (msg.type === "set") applySlide(msg.slide);
        else if (msg.type === "clear") applySlide({ kind: "empty" }); // §5
        else if (msg.type === "pong") applySlide(msg.slide);
        else if (msg.type === "output") {
          applySlide(msg.state.live);
          setFontScale(typeof msg.state.fontScale === "number" ? msg.state.fontScale : 1);
          setAppearance(msg.state.appearance ?? null);
          setBackground(msg.state.background ?? null);
          setVideoInput(msg.state.videoInput ?? null);
          setTransition(msg.state.transition ?? null);
        }
      } catch { /* ignore */ }
    };
    ch.onmessage = onMessage;
    ch.postMessage({ type: "ping", join: true } as LiveMessage);
    // Silent-channel recovery: reopen if we go quiet (a long service must never
    // permanently desync).
    const timer = setInterval(() => {
      if (Date.now() - lastMsgAt.current > 5000) {
        try { ch?.close(); } catch { /* ignore */ }
        ch = openLiveChannel();
        if (ch) { ch.onmessage = onMessage; try { ch.postMessage({ type: "ping", join: true } as LiveMessage); } catch { /* ignore */ } lastMsgAt.current = Date.now(); }
      }
    }, 1000);
    return () => { try { ch?.close(); } catch { /* ignore */ } clearInterval(timer); };
  }, [test]);

  if (test) return <NdiTestPattern transparent={transparent} />;

  const hasBg = !!(background && background.type !== "none");
  const overVideo = !transparent && hasBg && !videoInput;

  return (
    <div className="fixed inset-0 overflow-hidden cursor-none" style={{ background: transparent ? "transparent" : "#000" }}>
      <PresentationCanvas canvasW={1920} canvasH={1080}>
        {/* Full Canvas mode: theme Background Template behind the text. Never in
            Transparent Graphics mode (that keys through to the camera). */}
        {!transparent && hasBg && !videoInput && (
          <BackgroundLayer key={background!.shaderPreset ?? background!.type} background={background!} />
        )}
        {!transparent && hasVideoBackground(videoInput, appearance) && !(hasBg && !videoInput) ? (
          <OutputSlide slide={slide} videoInput={videoInput} appearance={appearance} fontScale={fontScale} projectorFit />
        ) : (
          <SlideRenderer
            slide={slide}
            projectorFit
            fontScale={fontScale}
            appearance={appearance}
            overVideo={overVideo}
            transparentBg={transparent}
            videoMuted
          />
        )}
        {!transparent && <ThemeLogoLayer appearance={appearance} />}
      </PresentationCanvas>
    </div>
  );
}

/**
 * Alpha test pattern (§6, §18). Renders known regions so the church media team
 * can confirm — through the real NDI → DistroAV → OBS pipeline — that alpha is
 * preserved: fully-transparent background, an opaque white rect, a 50% rect,
 * white text, 50% text, a gradient, a 1920×1080 border, and a live timestamp.
 */
function NdiTestPattern({ transparent }: { transparent: boolean }) {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().replace("T", " ").replace("Z", " UTC"));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="fixed inset-0 overflow-hidden cursor-none" style={{ background: transparent ? "transparent" : "#000" }}>
      <PresentationCanvas canvasW={1920} canvasH={1080}>
        <div style={{ position: "absolute", inset: 0, boxSizing: "border-box", border: "6px solid #ffffff" }}>
          {/* opaque white rectangle */}
          <div style={{ position: "absolute", left: 120, top: 120, width: 360, height: 220, background: "rgba(255,255,255,1)" }} />
          {/* 50% white rectangle */}
          <div style={{ position: "absolute", left: 540, top: 120, width: 360, height: 220, background: "rgba(255,255,255,0.5)" }} />
          {/* gradient (opaque → transparent) */}
          <div style={{ position: "absolute", left: 960, top: 120, width: 800, height: 220, background: "linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0))" }} />
          {/* white text */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 460, textAlign: "center", color: "rgba(255,255,255,1)", fontFamily: "sans-serif", fontWeight: 800, fontSize: 120 }}>
            PRESENTFLOW NDI TEST
          </div>
          {/* 50% text */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 640, textAlign: "center", color: "rgba(255,255,255,0.5)", fontFamily: "sans-serif", fontWeight: 800, fontSize: 64 }}>
            50% alpha text — background must show through
          </div>
          {/* geometry + timestamp */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 120, textAlign: "center", color: "#ffffff", fontFamily: "monospace", fontWeight: 700, fontSize: 40 }}>
            1920 × 1080 · {transparent ? "TRANSPARENT" : "FULL"} · {now}
          </div>
        </div>
      </PresentationCanvas>
    </div>
  );
}
