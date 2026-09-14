"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward, SkipBack, HelpCircle, ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { OperatorShellCtx } from "../shell/types";
import { TransitionChooser } from "./BottomBar/TransitionChooser";
import { cn } from "@/lib/utils";
import { dispatchInternal } from "@/lib/internal-events";
import { openLiveChannel, safePost, type LiveChannelLike, type LiveMessage } from "@/lib/broadcast";

export const TRANSITION_KEY = "presentflow.pro.transition.v1";
// Centralized so the bottom-bar chooser, the centre Transitions panel, and the
// live-monitor preview can't silently desync on a mistyped event name.
export const TRANSITION_UPDATED_EVENT = "presentflow:transition-updated";
export const TRANSITION_PREVIEW_EVENT = "presentflow:transition-preview";

export type SlideViewMode = "grid" | "list" | "text";

// 2026-07-25 Fix 4 — the TransitionChooser exposes display names
// ("Cut", "Fade", "Slide (L→R)") but the projector's TransitionWrapper
// expects effect IDs from src/lib/effects.ts ("fade_in", "slide_right").
// Before this mapping, every picked transition passed through as an
// unknown effectId and TransitionWrapper silently fell back to no
// animation. This is why the transition picker "did nothing".
// "Cut" is deliberately null so no animation applies.
// Effects we don't have real implementations for (Amoeba, Color Burn,
// Iris) fall back to the closest visible substitute rather than doing
// nothing — the operator picked SOMETHING, they should see SOMETHING.
export const TRANSITION_NAME_TO_EFFECT_ID: Record<string, string | null> = {
  "Cut": null,
  "Fade": "fade_in",
  "Dissolve": "cross_fade",
  "Slide (L→R)": "slide_right",
  "Slide (R→L)": "slide_left",
  "Wipe": "wipe_right",
  "Amoeba": "dissolve",       // best available substitute
  "Dispersion Blur": "blur_in",
  "Color Burn": "dissolve",   // best available substitute
  "Iris": "zoom_in",
  "Push": "slide_right",
};

export function BottomBar({
  ctx, onOpenShortcutsHelp, centerMode, videoRef,
}: {
  ctx: OperatorShellCtx;
  onOpenShortcutsHelp?: () => void;
  centerMode?: "slides" | "bible" | "songs" | "media" | "openflow" | "transitions";
  /** The operator's live preview <video> — the master clock element. K1 drives
   *  pause/resume through THIS element so the projector heartbeat can't override it. */
  videoRef?: RefObject<HTMLVideoElement | null>;
}) {
  const [transitionName, setTransitionName] = useState("Amoeba");
  const [transitionDuration, setTransitionDuration] = useState(0.6);

  // ── Video transport (K1) ────────────────────────────────────────────────────
  // When a VIDEO is live, the leftmost transport button must PAUSE/RESUME the
  // video (freeze the frame, keep it on the projector) — NOT blank the output to
  // black. CRITICAL: the operator's local preview <video> (videoRef) is the
  // MASTER clock — VideoControlBar broadcasts a 1s `media-sync {paused}` heartbeat
  // from it, and the projector reconciles play/pause to that. So this button must
  // pause the MASTER ELEMENT itself (not just post to the projector), else the
  // heartbeat re-asserts play within ~1s and the pause doesn't hold. Driving the
  // element is also the single source of truth, so this button and VideoControlBar
  // never disagree. For non-video slides it stays the Blank toggle (unchanged).
  const isVideoLive = ctx.liveSlide?.kind === "video";
  const liveVideoUrl = isVideoLive ? (ctx.liveSlide as { url?: string }).url : undefined;
  const [videoPaused, setVideoPaused] = useState(false);
  const mediaChRef = useRef<LiveChannelLike | null>(null);
  useEffect(() => {
    const ch = openLiveChannel();
    mediaChRef.current = ch;
    return () => { try { ch?.close(); } catch { /* noop */ } };
  }, []);
  // Reflect the ACTUAL element paused-state (shared source of truth with
  // VideoControlBar) so the icon is always right — even when the operator uses the
  // other pause control. Poll lightly, only while a video is live.
  useEffect(() => {
    if (!isVideoLive) { setVideoPaused(false); return; }
    const read = () => { const el = videoRef?.current; if (el) setVideoPaused(el.paused); };
    read();
    const iv = setInterval(read, 250);
    return () => clearInterval(iv);
  }, [isVideoLive, liveVideoUrl, videoRef]);
  const toggleVideoPause = () => {
    const el = videoRef?.current;
    // The master element IS the source of truth. If it isn't mounted yet (the
    // sub-second cold-start window right after a clip goes live), do NOTHING —
    // posting a projector pause we can't hold on the master would just get
    // re-asserted to play by the media-sync heartbeat ~1s later. A no-op click
    // for that brief window is safe; the button works the instant the video is up.
    if (!el) return;
    const shouldPlay = el.paused;
    if (shouldPlay) el.play().catch(() => {}); else el.pause();
    // .play()/.pause() flip el.paused synchronously → read the real state (no
    // optimistic guess that could disagree if play() is later rejected).
    setVideoPaused(el.paused);
    // Broadcast for INSTANT projector response (the heartbeat would follow within
    // ~1s anyway, but operators expect an immediate freeze).
    safePost(mediaChRef.current, { type: "media-control", command: shouldPlay ? "play" : "pause" } as LiveMessage);
  };
  // Master OFF switch — when on, NO transition is ever published (hard cut on
  // every send) regardless of the selected effect. Persisted with the rest.
  const [transitionsOff, setTransitionsOff] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TRANSITION_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.name) setTransitionName(p.name);
        // Accept new durationMs or legacy duration (seconds)
        if (typeof p.durationMs === "number") setTransitionDuration(p.durationMs / 1000);
        else if (typeof p.duration === "number") setTransitionDuration(p.duration);
        if (typeof p.off === "boolean") setTransitionsOff(p.off);
      }
    } catch { /* noop */ }
  }, []);

  // F1: the full-screen Transitions panel (centre) shares this selection. When it
  // changes the transition, mirror it here so the bottom-bar picker matches AND
  // the persist/apply effect below re-fires (pushing it to the live output).
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const d = (e as CustomEvent<{ name?: string; durationMs?: number; off?: boolean }>).detail;
      if (!d) return;
      if (typeof d.name === "string") setTransitionName(d.name);
      if (typeof d.durationMs === "number") setTransitionDuration(d.durationMs / 1000);
      if (typeof d.off === "boolean") setTransitionsOff(d.off);
    };
    window.addEventListener(TRANSITION_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(TRANSITION_UPDATED_EVENT, onUpdate);
  }, []);

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  useEffect(() => {
    const durationMs = Math.max(0, Math.min(5000, Math.round(transitionDuration * 1000)));
    try {
      window.localStorage.setItem(TRANSITION_KEY, JSON.stringify({ name: transitionName, durationMs, off: transitionsOff }));
      // F1 reverse-sync: notify an open centre Transitions panel so it mirrors a
      // change made HERE (same-tab localStorage writes don't fire `storage`).
      // Safe from loops: the panel's listener only setState(readState()) and never
      // re-dispatches, and our own listener re-setting identical values is a no-op.
      window.dispatchEvent(new CustomEvent(TRANSITION_UPDATED_EVENT, { detail: { name: transitionName, durationMs, off: transitionsOff } }));
    } catch { /* noop */ }
    // Push into the live TransitionSpec so the OutputState effect picks it up.
    // ctxRef avoids re-running this on every OperatorConsole re-render (would cause infinite loop).
    // Map display name → concrete effect ID before publishing (see
    // TRANSITION_NAME_TO_EFFECT_ID above for why). null effectId means
    // "no animation" (Cut) — pass null so TransitionWrapper renders
    // children with no animation instead of a bogus effect.
    try {
      // Master OFF → always publish null (no transition anywhere).
      if (transitionsOff) { ctxRef.current.onSetTransitionSpec?.(null); return; }
      const effectId = TRANSITION_NAME_TO_EFFECT_ID[transitionName];
      if (effectId === null) {
        ctxRef.current.onSetTransitionSpec?.(null);
      } else if (effectId) {
        ctxRef.current.onSetTransitionSpec?.({ effectId, durationMs, easing: "ease-in-out", name: transitionName });
      }
    } catch { /* noop */ }
  }, [transitionName, transitionDuration, transitionsOff]);

  const item = ctx.plan.items[ctx.previewItemIdx];
  const hasPrev = ctx.previewSlideIdx > 0;
  const hasNext = item ? ctx.previewSlideIdx < item.slides.length - 1 : false;

  // 2026-07-25 field bug fix — previously called ctx.onJumpSlide only,
  // which just moves the preview cursor. Users pressing < Verse / Verse >
  // in the transport bar expect the NEW slide to also appear on live.
  // Now: jump preview AND explicitly fire the target slide via
  // onSendSlideToLive, matching the click-a-card behavior in SlideGrid.
  const prev = () => {
    if (!hasPrev) return;
    const targetIdx = ctx.previewSlideIdx - 1;
    ctx.onJumpSlide(ctx.previewItemIdx, targetIdx);
    const targetSlide = item?.slides?.[targetIdx];
    if (targetSlide) {
      try { ctx.onSendSlideToLive(targetSlide, undefined, item?.type === "song" ? { origin: { kind: "song", songId: (item as { songId?: string }).songId } } : undefined); }
      catch (e) { console.warn("[bottom-bar] prev sendSlideToLive failed", e); }
    }
  };
  const next = () => {
    if (!hasNext) return;
    const targetIdx = ctx.previewSlideIdx + 1;
    ctx.onJumpSlide(ctx.previewItemIdx, targetIdx);
    const targetSlide = item?.slides?.[targetIdx];
    if (targetSlide) {
      try { ctx.onSendSlideToLive(targetSlide, undefined, item?.type === "song" ? { origin: { kind: "song", songId: (item as { songId?: string }).songId } } : undefined); }
      catch (e) { console.warn("[bottom-bar] next sendSlideToLive failed", e); }
    }
  };

  // Bible-mode verse buttons navigate the bible session (via events), not
  // playlist slides. Falls back to slide prev/next in every other mode.
  // 2026-07-25 field fix — added visible feedback so pressing Verse >
  // when no reference is loaded shows a helpful toast instead of silently
  // no-op'ing (which reads as "the button is broken"). Also console.log
  // so a click that DOESN'T show a toast is greppable in DevTools.
  const versePrev = () => {
    try { console.log("[bottom-bar] Verse< clicked", { centerMode }); } catch { /* ignore */ }
    if (centerMode === "bible") {
      dispatchInternal("presentflow:bible-prev");
      return;
    }
    if (!hasPrev) {
      toast.info("Already on the first slide.");
      return;
    }
    prev();
  };
  const verseNext = () => {
    try { console.log("[bottom-bar] Verse> clicked", { centerMode }); } catch { /* ignore */ }
    if (centerMode === "bible") {
      dispatchInternal("presentflow:bible-next");
      return;
    }
    if (!hasNext) {
      toast.info("Already on the last slide of this item.");
      return;
    }
    next();
  };

  const isBlank = ctx.liveSlide?.kind === "empty" || ctx.liveSlide?.kind === "blank";
  // Transport icon button inside the segmented cluster.
  const tBtn =
    "w-8 h-[28px] grid place-items-center rounded-md text-[var(--color-muted-foreground)] transition-[background,color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10 active:scale-90 disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div className="h-11 shrink-0 border-t border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-app-bg),var(--color-panel))] shadow-[var(--edge-top)] flex items-center px-2.5 gap-2">
      {/* Left — transport cluster (segmented, with depth) */}
      <div className="flex items-center gap-0.5 h-[34px] rounded-xl border border-[var(--color-border)] bg-[var(--color-app-bg)] p-[3px] shadow-[var(--edge-top),inset_0_1px_2px_rgba(0,0,0,0.28)]">
        {isVideoLive ? (
          <button
            title={videoPaused ? "Resume video" : "Pause video"}
            aria-pressed={videoPaused}
            onClick={toggleVideoPause}
            className={cn(tBtn, videoPaused && "text-[var(--color-brand)] bg-[var(--color-brand)]/12 hover:bg-[var(--color-brand)]/16")}
          >{videoPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" strokeWidth={2.2} />}</button>
        ) : (
          <button
            title={isBlank ? "Unblank live output" : "Blank live output"}
            aria-pressed={isBlank}
            onClick={ctx.onBlank}
            className={cn(tBtn, isBlank && "text-[var(--color-brand)] bg-[var(--color-brand)]/12 hover:bg-[var(--color-brand)]/16")}
          ><Pause className="w-4 h-4" strokeWidth={2.2} /></button>
        )}
        <button title="Send to live" onClick={ctx.onSendToLive} className={cn(tBtn, "text-[var(--color-brand)] hover:text-[var(--color-brand)]")}><Play className="w-4 h-4 fill-current" /></button>
        <span className="w-px h-4 bg-[var(--color-border)] mx-0.5" aria-hidden />
        <button title="Previous slide" onClick={prev} disabled={!hasPrev} className={tBtn}><SkipBack className="w-4 h-4" strokeWidth={2.2} /></button>
        <button title="Next slide" onClick={next} disabled={!hasNext} className={tBtn}><SkipForward className="w-4 h-4" strokeWidth={2.2} /></button>
      </div>

      {/* Center — verse-nav is Bible-mode only; other modes just show
          the transition selector so the space isn't dead. */}
      <div className="flex-1 flex items-center justify-center gap-3 text-[11px] text-[var(--color-muted-foreground)]">
        {centerMode === "bible" && (
          // Segmented Prev/Next verse control (joined pill with a shared divider).
          <div className="inline-flex items-center h-[32px] rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)]">
            <button
              onClick={versePrev}
              title="Previous verse (preview)"
              className="h-full pl-2.5 pr-3 inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10 border-r border-[var(--color-border)] transition-colors active:scale-95"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={2.4} /> Verse
            </button>
            <button
              onClick={verseNext}
              title="Next verse (preview)"
              className="h-full pl-3 pr-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10 transition-colors active:scale-95"
            >
              Verse <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
            </button>
          </div>
        )}
        <TransitionChooser
          transitionName={transitionName}
          transitionDuration={transitionDuration}
          transitionsOff={transitionsOff}
          onToggleOff={setTransitionsOff}
          onSelect={(name) => {
            setTransitionName(name);
            setTransitionsOff(false);
            // Demo it in the live monitor too, so picking from the bottom bar behaves
            // exactly like picking from the centre Transitions panel (coherence).
            try { window.dispatchEvent(new CustomEvent(TRANSITION_PREVIEW_EVENT, { detail: { name, durationMs: Math.round(transitionDuration * 1000) } })); } catch { /* noop */ }
          }}
          onDurationChange={(d) => setTransitionDuration(d)}
        />
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={transitionDuration}
          onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
          className="pf-fade-slider w-28"
          style={{ accentColor: "var(--color-brand)" }}
          title={`Transition Speed: ${transitionDuration.toFixed(1)}s`}
          aria-label="Transition Speed"
        />
        <span className="text-[10px] uppercase tracking-[0.1em] font-mono font-bold text-[var(--color-muted-foreground)] tabular-nums">Speed: {transitionDuration.toFixed(1)}s</span>
      </div>

      {/* Right — 2026-08-16: the grid/list/text view toggles were REMOVED here;
          they duplicated the ones already in the center-panel header. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenShortcutsHelp}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          className="w-8 h-8 grid place-items-center rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-brand)]/10 hover:text-[var(--color-foreground)] transition-colors"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
