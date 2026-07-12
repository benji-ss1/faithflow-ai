"use client";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";

// Safe Mode toggle: when ON, double-click only selects. Persisted per-tab.
const SAFE_MODE_KEY = "presentflow.operator.safeMode";
function safeMode() {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(SAFE_MODE_KEY);
  return raw !== "0"; // default ON
}

export function SlideGrid({ ctx, slideSize }: { ctx: OperatorShellCtx; slideSize: number }) {
  const item = ctx.plan.items[ctx.previewItemIdx];
  const slides: SlidePayload[] = item?.slides ?? [];

  return (
    <div className="p-3 flex flex-col gap-6">
      {/* Main slide grid — Y10: semantic grid + gridcell roles for a11y */}
      <div
        role="grid"
        aria-label="Slides"
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${slideSize}px, 1fr))` }}
      >
        {slides.length === 0 && (
          <div className="col-span-full text-[12px] text-[var(--color-muted-foreground)] py-8 text-center">
            No slides. Select an item on the left, or add one via +.
          </div>
        )}
        {slides.map((s, idx) => (
          <SlideCard
            key={idx}
            slide={s}
            index={idx + 1}
            selected={idx === ctx.previewSlideIdx}
            onSelect={() => ctx.onJumpSlide(ctx.previewItemIdx, idx)}
            onDouble={() => {
              if (safeMode()) {
                ctx.onJumpSlide(ctx.previewItemIdx, idx);
              } else {
                ctx.onSendSlideToLive(s);
              }
            }}
            // R2: pass explicit indices; no more synthetic keydown.
            onDelete={() => ctx.onDeleteSlide?.(ctx.previewItemIdx, idx)}
          />
        ))}
      </div>

      {/* Stage row (half-size mirror) */}
      {slides.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Stage</div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(slideSize / 1.6)}px, 1fr))` }}
          >
            {slides.map((s, idx) => (
              <div
                key={idx}
                className="relative aspect-video rounded-md border border-[var(--color-border)] overflow-hidden opacity-70"
              >
                <SlideRenderer slide={s} />
                <div className="absolute bottom-1 right-1 text-[9px] font-mono uppercase tracking-wider text-white/60 bg-black/50 px-1 rounded">
                  Stage
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SlideCard({
  slide, index, selected, onSelect, onDouble, onDelete,
}: {
  slide: SlidePayload;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onDouble: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          type="button"
          role="gridcell"
          tabIndex={0}
          onClick={onSelect}
          onDoubleClick={onDouble}
          className={cn(
            "relative aspect-video rounded-md overflow-hidden border-2 transition-all text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
            selected
              ? "border-[var(--color-brand)] shadow-[0_0_0_2px_var(--color-glow)]"
              : "border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
          )}
        >
          <SlideRenderer slide={slide} />
          <div className="absolute top-1 left-1 text-[10px] font-mono text-white/70 bg-black/40 px-1 rounded">
            {index}
          </div>
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[220px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl">
          {[
            "Quick Edit", "Edit Slide", "Disable", "Themes ▶", "Transitions…",
            "Hot Key…", "Go to Next Timer", "Add Action ▶", "Add Media Action…",
            "Edit Action: Timer ▶", "Remove Action: Timer", "Group ▶", "Label ▶",
          ].map((label) => (
            <ContextMenu.Item
              key={label}
              className="px-3 py-1.5 rounded outline-none text-[var(--color-muted-foreground)] data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
              onSelect={(e) => e.preventDefault()}
            >
              {label}
            </ContextMenu.Item>
          ))}
          <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
          <ContextMenu.Item className="px-3 py-1.5 rounded outline-none data-[highlighted]:bg-[var(--color-panel)]" onSelect={(e) => e.preventDefault()}>
            Copy Text Style
          </ContextMenu.Item>
          <ContextMenu.Item className="px-3 py-1.5 rounded outline-none data-[highlighted]:bg-[var(--color-panel)]" onSelect={(e) => e.preventDefault()}>
            Paste Text Style
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
          <ContextMenu.Item className="px-3 py-1.5 rounded outline-none data-[highlighted]:bg-[var(--color-panel)]" onSelect={(e) => e.preventDefault()}>Cut</ContextMenu.Item>
          <ContextMenu.Item className="px-3 py-1.5 rounded outline-none data-[highlighted]:bg-[var(--color-panel)]" onSelect={(e) => e.preventDefault()}>Copy</ContextMenu.Item>
          <ContextMenu.Item
            className="px-3 py-1.5 rounded outline-none text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
            onSelect={() => {
              // R2: direct call with explicit indices (was: synthetic
              // keydown → wrong slide by cursor).
              onDelete();
            }}
          >
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
