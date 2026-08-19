"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward, SkipBack, HelpCircle, ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { OperatorShellCtx } from "../shell/types";
import { TransitionChooser } from "./BottomBar/TransitionChooser";
import { cn } from "@/lib/utils";
import { dispatchInternal } from "@/lib/internal-events";

export const TRANSITION_KEY = "presentflow.pro.transition.v1";

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
  ctx, onOpenShortcutsHelp, centerMode,
}: {
  ctx: OperatorShellCtx;
  onOpenShortcutsHelp?: () => void;
  centerMode?: "slides" | "bible" | "songs" | "media";
}) {
  const [transitionName, setTransitionName] = useState("Amoeba");
  const [transitionDuration, setTransitionDuration] = useState(0.6);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TRANSITION_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.name) setTransitionName(p.name);
        // Accept new durationMs or legacy duration (seconds)
        if (typeof p.durationMs === "number") setTransitionDuration(p.durationMs / 1000);
        else if (typeof p.duration === "number") setTransitionDuration(p.duration);
      }
    } catch { /* noop */ }
  }, []);

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  useEffect(() => {
    const durationMs = Math.max(0, Math.min(5000, Math.round(transitionDuration * 1000)));
    try {
      window.localStorage.setItem(TRANSITION_KEY, JSON.stringify({ name: transitionName, durationMs }));
    } catch { /* noop */ }
    // Push into the live TransitionSpec so the OutputState effect picks it up.
    // ctxRef avoids re-running this on every OperatorConsole re-render (would cause infinite loop).
    // Map display name → concrete effect ID before publishing (see
    // TRANSITION_NAME_TO_EFFECT_ID above for why). null effectId means
    // "no animation" (Cut) — pass null so TransitionWrapper renders
    // children with no animation instead of a bogus effect.
    try {
      const effectId = TRANSITION_NAME_TO_EFFECT_ID[transitionName];
      if (effectId === null) {
        ctxRef.current.onSetTransitionSpec?.(null);
      } else if (effectId) {
        ctxRef.current.onSetTransitionSpec?.({ effectId, durationMs, easing: "ease-in-out", name: transitionName });
      }
    } catch { /* noop */ }
  }, [transitionName, transitionDuration]);

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
      try { ctx.onSendSlideToLive(targetSlide); }
      catch (e) { console.warn("[bottom-bar] prev sendSlideToLive failed", e); }
    }
  };
  const next = () => {
    if (!hasNext) return;
    const targetIdx = ctx.previewSlideIdx + 1;
    ctx.onJumpSlide(ctx.previewItemIdx, targetIdx);
    const targetSlide = item?.slides?.[targetIdx];
    if (targetSlide) {
      try { ctx.onSendSlideToLive(targetSlide); }
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

  return (
    <div className="h-10 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] flex items-center px-2 gap-2">
      {/* Left */}
      <div className="flex items-center gap-1">
        <button
          title={ctx.liveSlide?.kind === "empty" || ctx.liveSlide?.kind === "blank" ? "Unblank live output" : "Blank live output"}
          aria-pressed={ctx.liveSlide?.kind === "empty" || ctx.liveSlide?.kind === "blank"}
          onClick={ctx.onBlank}
          className={cn(
            "w-7 h-7 flex items-center justify-center rounded hover:bg-white/5",
            (ctx.liveSlide?.kind === "empty" || ctx.liveSlide?.kind === "blank")
              ? "text-[var(--color-brand)] bg-white/5"
              : "text-[var(--color-muted-foreground)]",
          )}
        ><Pause className="w-4 h-4" /></button>
        <button title="Send to live" onClick={ctx.onSendToLive} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-muted-foreground)]"><Play className="w-4 h-4" /></button>
        <button title="Previous slide" onClick={prev} disabled={!hasPrev} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-muted-foreground)] disabled:opacity-50"><SkipBack className="w-4 h-4" /></button>
        <button title="Next slide" onClick={next} disabled={!hasNext} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-muted-foreground)] disabled:opacity-50"><SkipForward className="w-4 h-4" /></button>
      </div>

      {/* Center — verse-nav is Bible-mode only; other modes just show
          the transition selector so the space isn't dead. */}
      <div className="flex-1 flex items-center justify-center gap-3 text-[11px] text-[var(--color-muted-foreground)]">
        {centerMode === "bible" && (
          // Segmented Prev/Next verse control (joined pill with a shared divider).
          <div className="inline-flex items-center rounded-lg border border-[var(--color-border)] overflow-hidden bg-[var(--color-panel)]">
            <button
              onClick={versePrev}
              title="Previous verse (preview)"
              className="h-7 pl-2 pr-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-foreground)] hover:bg-white/[0.06] border-r border-[var(--color-border)] transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Verse
            </button>
            <button
              onClick={verseNext}
              title="Next verse (preview)"
              className="h-7 pl-2.5 pr-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-foreground)] hover:bg-white/[0.06] transition-colors"
            >
              Verse <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <TransitionChooser
          transitionName={transitionName}
          transitionDuration={transitionDuration}
          onSelect={(name) => setTransitionName(name)}
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
          title={`Transition Speed: ${transitionDuration.toFixed(1)}s`}
          aria-label="Transition Speed"
        />
        <span className="text-[10px] uppercase tracking-wider font-mono text-[var(--color-muted-foreground)]">Speed: {transitionDuration.toFixed(1)}s</span>
      </div>

      {/* Right — 2026-08-16: the grid/list/text view toggles were REMOVED here;
          they duplicated the ones already in the center-panel header. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenShortcutsHelp}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-white/5 hover:text-[var(--color-foreground)]"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
