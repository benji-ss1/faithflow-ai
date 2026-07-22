"use client";
import { X } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OperatorShellCtx } from "../../shell/types";

// The live slide's text carries its reference/translation as a trailing
// line after a blank line ("...verse body...\n\nBook Ch:Verse (KJV)") — see
// every cardToSlide/applyAdvancedVerse call site across the app. The box was
// too small to read that label at a glance, and it wasn't pulled out
// separately at all, so book/chapter/verse/translation was easy to miss.
function splitBodyAndReference(text: string): { body: string; reference: string | null } {
  const idx = text.lastIndexOf("\n\n");
  if (idx < 0) return { body: text, reference: null };
  const reference = text.slice(idx + 2).trim();
  // Only treat it as a reference label if it actually looks like one
  // (short line, not another paragraph of verse text) — avoids splitting a
  // slide that legitimately has a blank line in the middle of its body.
  if (reference.length === 0 || reference.length > 80 || reference.includes("\n")) {
    return { body: text, reference: null };
  }
  return { body: text.slice(0, idx), reference };
}

export function LivePreviewPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const isLive = ctx.liveSlide.kind !== "empty";
  const { reference } = ctx.liveSlide.kind === "text" ? splitBodyAndReference(ctx.liveSlide.text) : { reference: null };
  return (
    <div className="p-2 flex flex-col gap-2">
      <div
        className={
          isLive
            ? "relative aspect-video min-h-[200px] rounded-md overflow-hidden border-2 border-[color:var(--color-destructive,#e11d48)] bg-black"
            : "relative aspect-video min-h-[200px] rounded-md overflow-hidden border border-[var(--color-border)] bg-black"
        }
      >
        {isLive && (
          <div className="absolute top-1 left-1 z-10 text-[9px] font-mono uppercase tracking-wider text-white bg-[color:var(--color-destructive,#e11d48)] px-1.5 py-0.5 rounded">
            LIVE
          </div>
        )}
        <SlideRenderer slide={ctx.liveSlide} />
        {ctx.liveSlide.kind !== "empty" && (
          <button
            onClick={ctx.onKill}
            className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded bg-black/60 text-white hover:bg-[var(--color-destructive)]"
            title="Clear live"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {/* Always-legible reference strip — book, chapter:verse, translation —
          pulled out of the slide text so it's never cramped inside the tiny
          preview box regardless of panel width. */}
      {reference && (
        <div className="px-2 py-1.5 rounded bg-[var(--color-elevated)] border border-[var(--color-border)] text-[12px] font-semibold text-center truncate" title={reference}>
          {reference}
        </div>
      )}
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] text-center">
        Screen 1
      </div>
    </div>
  );
}
