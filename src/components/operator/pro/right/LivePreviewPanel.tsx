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
      {/* 2026-07-25 Phase 1 refactor:
          - `SCREEN 1` label → `LIVE ●` (red pulse when active) / `IDLE ○`
            (grey when nothing on projector). Matches operator mental model.
          - min-h bumped 200 → 220 px so verses/lyrics have visibly more room
            (AutoFitText inside SlideRenderer keeps its binary-search scaling
            so long content still fits within the 16:9 aspect-video frame).
          - When live, subtle outer red glow via box-shadow layered on top of
            the existing 2px red border so the preview reads as "hot" from
            across the room, not just from the pixel-precise border color. */}
      {/* 2026-07-25 field bug fix: preview was still clipping longer
          stanzas ("And grace will lead me home" showed "hom…"). Root
          cause: aspect-video constrained width from the sidebar and
          derived height, which for typical sidebar widths landed at
          ~215 px — not enough vertical room for 6-line verses even at
          MIN_READABLE_PX=24. Dropped the aspect-video constraint so
          the box can grow to fit content (min 320px, max 60vh so it
          doesn't push the transcript out of view). Text still uses
          the projector-quality readability floor via AutoFitText. */}
      <div
        className={
          isLive
            ? "relative min-h-[320px] max-h-[60vh] rounded-md overflow-hidden border-2 border-[color:var(--color-destructive,#e11d48)] bg-black"
            : "relative min-h-[320px] max-h-[60vh] rounded-md overflow-hidden border border-[var(--color-border)] bg-black"
        }
        style={isLive ? { boxShadow: "0 0 12px 2px rgba(225, 29, 72, 0.35)" } : undefined}
      >
        {isLive && (
          <div className="absolute top-1 left-1 z-10 text-[9px] font-mono uppercase tracking-wider text-white bg-[color:var(--color-destructive,#e11d48)] px-1.5 py-0.5 rounded flex items-center gap-1">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-white pf-ai-live-dot" />
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
      <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
        <span
          aria-hidden
          className={
            isLive
              ? "inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-destructive,#e11d48)] pf-ai-live-dot"
              : "inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-muted-foreground)] opacity-60"
          }
        />
        <span className={isLive ? "text-[color:var(--color-destructive,#e11d48)] font-semibold" : ""}>
          {isLive ? "Live" : "Idle"}
        </span>
      </div>
    </div>
  );
}
