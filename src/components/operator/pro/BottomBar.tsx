"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward, SkipBack, LayoutGrid, List, Type, HelpCircle } from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import { TransitionChooser } from "./BottomBar/TransitionChooser";
import { cn } from "@/lib/utils";
import { dispatchInternal } from "@/lib/internal-events";

export const TRANSITION_KEY = "presentflow.pro.transition.v1";

export type SlideViewMode = "grid" | "list" | "text";

export function BottomBar({
  ctx, onOpenShortcutsHelp, centerMode,
}: {
  ctx: OperatorShellCtx;
  onOpenShortcutsHelp?: () => void;
  centerMode?: "slides" | "bible" | "songs" | "media";
}) {
  const [transitionName, setTransitionName] = useState("Amoeba");
  const [transitionDuration, setTransitionDuration] = useState(0.6);
  const [viewMode, setViewMode] = useState<SlideViewMode>("grid");

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
    try {
      ctxRef.current.onSetTransitionSpec?.({ effectId: transitionName, durationMs, easing: "ease", name: transitionName });
    } catch { /* noop */ }
  }, [transitionName, transitionDuration]);

  const item = ctx.plan.items[ctx.previewItemIdx];
  const hasPrev = ctx.previewSlideIdx > 0;
  const hasNext = item ? ctx.previewSlideIdx < item.slides.length - 1 : false;

  const prev = () => hasPrev && ctx.onJumpSlide(ctx.previewItemIdx, ctx.previewSlideIdx - 1);
  const next = () => hasNext && ctx.onJumpSlide(ctx.previewItemIdx, ctx.previewSlideIdx + 1);

  // Bible-mode verse buttons navigate the bible session (via events), not
  // playlist slides. Falls back to slide prev/next in every other mode.
  const versePrev = () => {
    if (centerMode === "bible") {
      dispatchInternal("presentflow:bible-prev");
      return;
    }
    prev();
  };
  const verseNext = () => {
    if (centerMode === "bible") {
      dispatchInternal("presentflow:bible-next");
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
      <div className="flex-1 flex items-center justify-center gap-2 text-[11px] text-[var(--color-muted-foreground)]">
        {centerMode === "bible" && (
          <button onClick={versePrev} className="h-7 px-2 rounded hover:bg-white/5">&lt; Verse</button>
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
          className="w-24"
          style={{ accentColor: "var(--color-brand)" }}
          title={`Transition Speed: ${transitionDuration.toFixed(1)}s`}
          aria-label="Transition Speed"
        />
        <span className="text-[10px] uppercase tracking-wider font-mono text-[var(--color-muted-foreground)]">Speed: {transitionDuration.toFixed(1)}s</span>
        {centerMode === "bible" && (
          <button onClick={verseNext} className="h-7 px-2 rounded hover:bg-white/5">Verse &gt;</button>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded border border-[var(--color-border)] overflow-hidden">
          <button title="Grid view" aria-pressed={viewMode === "grid"} onClick={() => { setViewMode("grid"); try { window.dispatchEvent(new CustomEvent("presentflow:slide-view-mode", { detail: "grid" })); } catch { /* noop */ } }} className={cn("w-7 h-7 flex items-center justify-center hover:bg-white/5", viewMode === "grid" ? "text-[var(--color-foreground)] bg-white/5" : "text-[var(--color-muted-foreground)]")}><LayoutGrid className="w-3.5 h-3.5" /></button>
          <button title="List view" aria-pressed={viewMode === "list"} onClick={() => { setViewMode("list"); try { window.dispatchEvent(new CustomEvent("presentflow:slide-view-mode", { detail: "list" })); } catch { /* noop */ } }} className={cn("w-7 h-7 flex items-center justify-center border-l border-[var(--color-border)] hover:bg-white/5", viewMode === "list" ? "text-[var(--color-foreground)] bg-white/5" : "text-[var(--color-muted-foreground)]")}><List className="w-3.5 h-3.5" /></button>
          <button title="Text view" aria-pressed={viewMode === "text"} onClick={() => { setViewMode("text"); try { window.dispatchEvent(new CustomEvent("presentflow:slide-view-mode", { detail: "text" })); } catch { /* noop */ } }} className={cn("w-7 h-7 flex items-center justify-center border-l border-[var(--color-border)] hover:bg-white/5", viewMode === "text" ? "text-[var(--color-foreground)] bg-white/5" : "text-[var(--color-muted-foreground)]")}><Type className="w-3.5 h-3.5" /></button>
        </div>
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
