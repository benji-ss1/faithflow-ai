"use client";
import { useState } from "react";
import { ListOrdered, Grid3x3, Pencil, BookOpen, Music, Presentation, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { ExpandedItem } from "@/lib/server/services";
import type { SlidePayload } from "@/lib/broadcast";
import { SongReflowMode } from "./workspace/SongReflowMode";
import { BibleBrowserMode } from "./workspace/BibleBrowserMode";
import { SermonDeckMode } from "./workspace/SermonDeckMode";
import { MediaBinMode } from "./workspace/MediaBinMode";

export type WorkspaceMode = "flow" | "grid" | "editor" | "bible" | "reflow" | "sermon" | "media";

const MODES: { key: WorkspaceMode; label: string; icon: typeof ListOrdered; hint: string }[] = [
  { key: "flow",   label: "Service Flow",  icon: ListOrdered,   hint: "Timeline view of every item + slide" },
  { key: "grid",   label: "Slide Grid",    icon: Grid3x3,       hint: "All slides of the current item as thumbnails" },
  { key: "editor", label: "Editor",        icon: Pencil,        hint: "Edit the currently staged item" },
  { key: "bible",  label: "Bible Browser", icon: BookOpen,      hint: "Search + stage scripture without leaving the cockpit" },
  { key: "reflow", label: "Song Reflow",   icon: Music,         hint: "Reorder verses of the current song" },
  { key: "sermon", label: "Sermon Deck",   icon: Presentation,  hint: "PPTX slide deck view" },
  { key: "media",  label: "Media Bin",     icon: ImageIcon,     hint: "Church media grid" },
];

export function WorkspaceTabs({
  mode, onModeChange,
  items, activeItemIdx, activeSlideIdx, onJumpSlide, previewSlide,
  onSendPreviewSlide, onSendLiveSlide, defaultTranslationCode,
  listening = false, transcriptText = "", autopilotActive = false,
}: {
  mode: WorkspaceMode;
  onModeChange: (m: WorkspaceMode) => void;
  items: ExpandedItem[];
  activeItemIdx: number;
  activeSlideIdx: number;
  onJumpSlide: (itemIdx: number, slideIdx: number) => void;
  previewSlide: SlidePayload;
  onSendPreviewSlide: (slide: SlidePayload) => void;
  onSendLiveSlide: (slide: SlidePayload) => void;
  defaultTranslationCode: string;
  listening?: boolean;
  transcriptText?: string;
  autopilotActive?: boolean;
}) {
  const activeItem = items[activeItemIdx];

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col" style={{ background: "var(--color-app-bg)" }}>
      {/* Tab strip */}
      <div className="h-10 shrink-0 flex items-center gap-0.5 px-3 border-b overflow-x-auto"
        style={{ borderColor: "var(--color-border)" }}>
        {MODES.map(({ key, label, icon: Icon, hint }) => {
          const active = mode === key;
          return (
            <button key={key} onClick={() => onModeChange(key)} title={hint}
              className={cn(
                "h-8 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors",
                active
                  ? "bg-[color:var(--color-elevated)] text-[color:var(--color-foreground)]"
                  : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-panel)] hover:text-[color:var(--color-foreground)]",
              )}>
              <Icon className="w-3.5 h-3.5" strokeWidth={active ? 2 : 1.75} /> {label}
            </button>
          );
        })}
      </div>

      {/* Mode body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === "flow" && <ServiceFlowMode items={items} activeItemIdx={activeItemIdx} activeSlideIdx={activeSlideIdx} onJumpSlide={onJumpSlide} />}
        {mode === "grid" && <SlideGridMode item={activeItem} activeSlideIdx={activeSlideIdx} onJumpSlide={(s) => onJumpSlide(activeItemIdx, s)} />}
        {mode === "editor" && <EditorShell activeItem={activeItem} />}
        {mode === "bible" && <BibleBrowserMode
          onSendPreview={onSendPreviewSlide} onSendLive={onSendLiveSlide}
          defaultTranslationCode={defaultTranslationCode} />}
        {mode === "reflow" && <SongReflowMode
          item={activeItem} activeSlideIdx={activeSlideIdx}
          onJumpSlide={(s) => onJumpSlide(activeItemIdx, s)}
          onSendPreview={onSendPreviewSlide} onSendLive={onSendLiveSlide} />}
        {mode === "sermon" && <SermonDeckMode
          item={activeItem} activeSlideIdx={activeSlideIdx}
          onJumpSlide={(s) => onJumpSlide(activeItemIdx, s)}
          onSendPreview={onSendPreviewSlide} onSendLive={onSendLiveSlide}
          listening={listening} transcriptText={transcriptText} autopilotActive={autopilotActive} />}
        {mode === "media" && <MediaBinMode
          onSendPreview={onSendPreviewSlide} onSendLive={onSendLiveSlide} />}
      </div>
    </div>
  );
}

// --- Flow mode: vertical timeline ---------------------------------------
function ServiceFlowMode({ items, activeItemIdx, activeSlideIdx, onJumpSlide }: {
  items: ExpandedItem[]; activeItemIdx: number; activeSlideIdx: number;
  onJumpSlide: (i: number, s: number) => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {items.map((item, i) => (
        <section key={item.id} className="rounded-md border overflow-hidden"
          style={{
            borderColor: i === activeItemIdx ? "var(--color-brand)" : "var(--color-border)",
            background: "var(--color-panel)",
          }}>
          <header className="px-3 py-2 flex items-center gap-2 border-b" style={{ borderColor: "var(--color-border)" }}>
            <span className="text-[10px] font-mono opacity-40 w-6">{String(i + 1).padStart(2, "0")}</span>
            <span className="eyebrow text-[9px]">{item.type}</span>
            <span className="text-sm font-medium truncate">{item.title}</span>
            <span className="ml-auto text-[10px] font-mono text-[color:var(--color-muted-foreground)]">{item.slides.length} slide{item.slides.length !== 1 && "s"}</span>
          </header>
          <div className="p-3 grid grid-cols-6 gap-2">
            {item.slides.map((s, si) => (
              <button key={si} onClick={() => onJumpSlide(i, si)}
                className={cn(
                  "aspect-video rounded-sm overflow-hidden border-2 transition-colors",
                  i === activeItemIdx && si === activeSlideIdx
                    ? "border-[color:var(--color-brand)]"
                    : "border-[color:var(--color-border)] hover:border-[color:var(--color-muted-foreground)]",
                )}>
                <div className="w-full h-full pointer-events-none"><SlideRenderer slide={s} /></div>
              </button>
            ))}
          </div>
        </section>
      ))}
      {items.length === 0 && <EmptyMode msg="Add items to the plan to see them here." />}
    </div>
  );
}

// --- Slide Grid: current item at large ----------------------------------
function SlideGridMode({ item, activeSlideIdx, onJumpSlide }: {
  item: ExpandedItem | undefined; activeSlideIdx: number; onJumpSlide: (s: number) => void;
}) {
  if (!item) return <EmptyMode msg="Select an item in the rail to see its slides." />;
  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-4 flex items-center gap-3">
        <span className="eyebrow">{item.type}</span>
        <h2 className="text-lg font-semibold">{item.title}</h2>
        <span className="ml-auto text-xs text-[color:var(--color-muted-foreground)]">{item.slides.length} slide{item.slides.length !== 1 && "s"}</span>
      </header>
      <div className="grid grid-cols-4 gap-3">
        {item.slides.map((s, i) => (
          <button key={i} onClick={() => onJumpSlide(i)}
            className={cn(
              "group aspect-video rounded-md overflow-hidden border-2 transition-colors relative",
              i === activeSlideIdx ? "border-[color:var(--color-brand)]" : "border-[color:var(--color-border)] hover:border-[color:var(--color-muted-foreground)]",
            )}>
            <div className="absolute inset-0 pointer-events-none"><SlideRenderer slide={s} /></div>
            <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-mono px-1 rounded-sm">{i + 1}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function EditorShell({ activeItem }: { activeItem: ExpandedItem | undefined }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-3">
        <Pencil className="w-8 h-8 mx-auto text-[color:var(--color-muted-foreground)]" />
        <div className="text-sm font-semibold">Inline editor</div>
        <p className="text-xs text-[color:var(--color-muted-foreground)] leading-relaxed">
          Currently editing "{activeItem?.title || "no item selected"}". Full inline editor for lyrics + scripture is coming in the next phase — for now, edit at <code className="font-mono opacity-70">/library/songs/[id]</code>.
        </p>
      </div>
    </div>
  );
}

function EmptyMode({ msg }: { msg: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <p className="text-xs text-[color:var(--color-muted-foreground)]">{msg}</p>
    </div>
  );
}
