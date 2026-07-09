"use client";
import { useState } from "react";
import { Presentation, Send, Eye, ChevronLeft, ChevronRight, FileText, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { ExpandedItem } from "@/lib/server/services";
import type { SlidePayload } from "@/lib/broadcast";

export function SermonDeckMode({
  item, activeSlideIdx, onJumpSlide, onSendPreview, onSendLive,
}: {
  item: ExpandedItem | undefined;
  activeSlideIdx: number;
  onJumpSlide: (s: number) => void;
  onSendPreview: (slide: SlidePayload) => void;
  onSendLive: (slide: SlidePayload) => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);

  if (!item || item.type !== "sermon") {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <Presentation className="w-8 h-8 mx-auto text-[color:var(--color-muted-foreground)]" />
          <div className="text-sm font-semibold">Sermon Deck</div>
          <p className="text-xs text-[color:var(--color-muted-foreground)] leading-relaxed">
            Pick a sermon (PPTX) item from the Service Order rail to see its deck.
          </p>
        </div>
      </div>
    );
  }

  const current = item.slides[activeSlideIdx];

  return (
    <div className="h-full flex min-h-0">
      {/* Thumbnail strip */}
      <div className="w-56 shrink-0 border-r overflow-y-auto" style={{ borderColor: "var(--color-border)" }}>
        <header className="sticky top-0 z-10 backdrop-blur-sm px-3 py-2 border-b flex items-center gap-2"
          style={{ borderColor: "var(--color-border)", background: "color-mix(in oklab, var(--color-panel) 92%, transparent)" }}>
          <Presentation className="w-4 h-4 text-[color:var(--color-warning)]" />
          <div className="text-xs font-semibold truncate flex-1">{item.title}</div>
          <span className="text-[10px] font-mono text-[color:var(--color-muted-foreground)]">{item.slides.length}</span>
        </header>
        <ul className="p-2 space-y-1.5">
          {item.slides.map((s, i) => (
            <li key={i}>
              <button onClick={() => onJumpSlide(i)}
                className={cn(
                  "block w-full rounded-sm border-2 overflow-hidden relative aspect-video transition-colors",
                  i === activeSlideIdx ? "border-[color:var(--color-brand)]" : "border-[color:var(--color-border)] hover:border-[color:var(--color-muted-foreground)]",
                )}>
                <div className="absolute inset-0 pointer-events-none"><SlideRenderer slide={s} /></div>
                <div className="absolute top-1 left-1 bg-black/70 text-white text-[9px] font-mono px-1 rounded-sm">{i + 1}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Main preview area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="h-12 shrink-0 border-b flex items-center gap-2 px-3" style={{ borderColor: "var(--color-border)" }}>
          <span className="text-xs text-[color:var(--color-muted-foreground)] font-mono">
            Slide {activeSlideIdx + 1} / {item.slides.length}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[color:var(--color-success)] border border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/10 rounded-sm px-1.5 py-0.5 ml-2 inline-flex items-center gap-1">
            <Lock className="w-2.5 h-2.5" /> Locked image (from PPTX)
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => onJumpSlide(Math.max(0, activeSlideIdx - 1))}
              className="h-8 px-2.5 rounded-md text-xs font-semibold border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center gap-1">
              <ChevronLeft className="w-3 h-3" /> Prev
            </button>
            <button onClick={() => onJumpSlide(Math.min(item.slides.length - 1, activeSlideIdx + 1))}
              className="h-8 px-2.5 rounded-md text-xs font-semibold border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center gap-1">
              Next <ChevronRight className="w-3 h-3" />
            </button>
            <div className="w-px h-6 mx-1" style={{ background: "var(--color-border)" }} />
            <button onClick={() => setNotesOpen((v) => !v)}
              className={cn(
                "h-8 px-2.5 rounded-md text-xs font-semibold border inline-flex items-center gap-1",
                notesOpen ? "border-[color:var(--color-brand)] text-[color:var(--color-brand)] bg-[color:var(--color-brand)]/10" : "border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)]",
              )}>
              <FileText className="w-3 h-3" /> Notes
            </button>
            <button disabled={!current} onClick={() => current && onSendPreview(current)}
              className="h-8 px-3 rounded-md text-xs font-semibold border border-[color:var(--color-brand)] text-[color:var(--color-brand)] bg-[color:var(--color-brand)]/10 hover:bg-[color:var(--color-brand)]/20 inline-flex items-center gap-1.5 disabled:opacity-40">
              <Eye className="w-3 h-3" /> Preview
            </button>
            <button disabled={!current} onClick={() => current && onSendLive(current)}
              className="h-8 px-3 rounded-md text-xs font-bold bg-[color:var(--color-destructive)] text-white hover:opacity-90 inline-flex items-center gap-1.5 disabled:opacity-40">
              <Send className="w-3 h-3" /> Live
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 min-h-0 p-6 bg-black">
            {current && <SlideRenderer slide={current} />}
          </div>
          {notesOpen && (
            <aside className="w-72 shrink-0 border-l overflow-y-auto p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
              <div className="eyebrow mb-2">Speaker notes</div>
              <p className="text-xs text-[color:var(--color-muted-foreground)] leading-relaxed">
                PPTX speaker notes are extracted at conversion time. If the source deck didn't include notes, this panel stays empty. To add notes now, edit the deck in the source app and re-import.
              </p>
              <div className="mt-4 eyebrow mb-2">Extracted slide text</div>
              <p className="text-xs text-[color:var(--color-muted-foreground)] leading-relaxed">
                Text-layer extraction (for search + transcript alignment) coming in a later phase.
              </p>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
