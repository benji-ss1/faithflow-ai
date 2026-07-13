"use client";
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Plus, Pause, Play, SkipForward, SkipBack, ChevronDown, LayoutGrid, List, Type, Smile, SlidersHorizontal, HelpCircle } from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";

const TRANSITION_KEY = "presentflow.pro.transition.v1";
const TRANSITIONS = ["Fade", "Dissolve", "Slide", "Cut", "Amoeba", "Wipe"];

export type SlideViewMode = "grid" | "list" | "text";

export function BottomBar({
  ctx, onOpenShortcutsHelp,
}: {
  ctx: OperatorShellCtx;
  onOpenShortcutsHelp?: () => void;
}) {
  const [transitionName, setTransitionName] = useState("Amoeba");
  const [transitionDuration, setTransitionDuration] = useState(0.6);
  const [_viewMode, setViewMode] = useState<SlideViewMode>("grid");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TRANSITION_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p.name) setTransitionName(p.name);
        if (typeof p.duration === "number") setTransitionDuration(p.duration);
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(TRANSITION_KEY, JSON.stringify({ name: transitionName, duration: transitionDuration }));
    } catch { /* noop */ }
  }, [transitionName, transitionDuration]);

  const item = ctx.plan.items[ctx.previewItemIdx];
  const hasPrev = ctx.previewSlideIdx > 0;
  const hasNext = item ? ctx.previewSlideIdx < item.slides.length - 1 : false;

  const prev = () => hasPrev && ctx.onJumpSlide(ctx.previewItemIdx, ctx.previewSlideIdx - 1);
  const next = () => hasNext && ctx.onJumpSlide(ctx.previewItemIdx, ctx.previewSlideIdx + 1);

  return (
    <div className="h-10 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] flex items-center px-2 gap-2">
      {/* Left */}
      <div className="flex items-center gap-1">
        <button data-todo="1" title="Add slide — coming soon" disabled className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-muted-foreground)] opacity-50 cursor-not-allowed"><Plus className="w-4 h-4" /></button>
        <button title="Blank" onClick={ctx.onBlank} className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"><Pause className="w-4 h-4" /></button>
        <button title="Send to live" onClick={ctx.onSendToLive} className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"><Play className="w-4 h-4" /></button>
        <button title="Previous slide" onClick={prev} disabled={!hasPrev} className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)] disabled:opacity-50"><SkipBack className="w-4 h-4" /></button>
        <button title="Next slide" onClick={next} disabled={!hasNext} className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)] disabled:opacity-50"><SkipForward className="w-4 h-4" /></button>
        <button data-todo="1" title="Save As — coming soon" disabled className="h-7 px-2 rounded text-[11px] flex items-center gap-1 border border-[var(--color-border)] opacity-50 cursor-not-allowed">
          Save As <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Center */}
      <div className="flex-1 flex items-center justify-center gap-2 text-[11px] text-[var(--color-muted-foreground)]">
        <button onClick={prev} disabled={!hasPrev} className="h-7 px-2 rounded hover:bg-[var(--color-elevated)] disabled:opacity-50">&lt; Verse</button>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button className="font-mono hover:text-[var(--color-foreground)]" title="Transition settings">
              {transitionName}: {transitionDuration.toFixed(1)}s
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="top" align="center" className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-3 text-[12px] shadow-lg z-50 w-[240px] flex flex-col gap-2">
              <div className="eyebrow">Transition</div>
              <div className="grid grid-cols-3 gap-1">
                {TRANSITIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTransitionName(t)}
                    className={`h-7 rounded border ${transitionName === t ? "border-[var(--color-brand)] text-[var(--color-foreground)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="eyebrow mt-1">Duration: {transitionDuration.toFixed(1)}s</div>
              <input
                type="range"
                min={0}
                max={5}
                step={0.1}
                value={transitionDuration}
                onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
                className="w-full accent-[var(--color-brand)]"
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={transitionDuration}
          onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
          className="w-24"
          style={{ accentColor: "var(--color-brand)" }}
          title={`Transition duration: ${transitionDuration.toFixed(1)}s`}
          aria-label="Transition duration"
        />
        <button onClick={next} disabled={!hasNext} className="h-7 px-2 rounded hover:bg-[var(--color-elevated)] disabled:opacity-50">Verse &gt;</button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded border border-[var(--color-border)] overflow-hidden">
          <button title="Grid view" onClick={() => setViewMode("grid")} className="w-7 h-7 flex items-center justify-center text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)]"><LayoutGrid className="w-3.5 h-3.5" /></button>
          <button title="List view — coming soon" data-todo="1" onClick={() => setViewMode("list")} className="w-7 h-7 flex items-center justify-center text-[var(--color-muted-foreground)] border-l border-[var(--color-border)] hover:bg-[var(--color-elevated)]"><List className="w-3.5 h-3.5" /></button>
          <button title="Text view — coming soon" data-todo="1" onClick={() => setViewMode("text")} className="w-7 h-7 flex items-center justify-center text-[var(--color-muted-foreground)] border-l border-[var(--color-border)] hover:bg-[var(--color-elevated)]"><Type className="w-3.5 h-3.5" /></button>
        </div>
        <button data-todo="1" title="Emoji — coming soon" disabled className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-muted-foreground)] opacity-50 cursor-not-allowed"><Smile className="w-4 h-4" /></button>
        <button data-todo="1" title="Filters — coming soon" disabled className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-muted-foreground)] opacity-50 cursor-not-allowed"><SlidersHorizontal className="w-4 h-4" /></button>
        <button
          type="button"
          onClick={onOpenShortcutsHelp}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-foreground)]"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
