"use client";
import { useState } from "react";
import { Plus, Copy, Trash2, ChevronRight, Save, Play, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { OperatorShellCtx } from "./types";
import { useSlideEditorCtx } from "../editor/SlideEditorContext";
import { SlideCanvas, SlideThumb } from "../editor/SlideCanvas";

export function CenterWorkspace({ ctx }: { ctx: OperatorShellCtx }) {
  const editor = useSlideEditorCtx();
  const item = ctx.plan.items[ctx.previewItemIdx];

  if (!item || !editor) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center"
        style={{ background: "#171c1c" }}>
        <div className="text-center max-w-sm p-6 rounded-lg border"
          style={{ borderColor: "#2a3232", background: "#1e2525" }}>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-2">Workspace</div>
          <div className="text-sm font-semibold text-zinc-200 mb-1">Select an item or create new content</div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Pick a playlist item on the left, or use the top toolbar to open a library.
          </p>
        </div>
      </div>
    );
  }

  const isSong = editor.isEditable;
  const total = editor.slides.length;

  return (
    <div className="flex-1 min-w-0 min-h-0 flex" style={{ background: "#171c1c" }}>
      {/* Slide list rail */}
      <SlideListRail item={item} />

      {/* Editor pane */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Header */}
        <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b" style={{ borderColor: "#2a3232" }}>
          <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-zinc-500">{item.type}</span>
          <ChevronRight className="w-3 h-3 text-zinc-600" />
          <span className="text-[12px] font-medium text-zinc-200 truncate" title={item.title}>{item.title}</span>
          <span className="text-[10px] font-mono text-zinc-500 ml-2">
            Slide {total === 0 ? 0 : editor.currentIndex + 1} / {total}
          </span>
          {!isSong && (
            <span className="text-[10px] italic text-amber-300/80 ml-2">Read-only in this run</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={editor.onSave}
              disabled={!isSong || editor.saveState === "saving" || !editor.hasDirtyChanges}
              title={
                !isSong ? "Editing is available for songs in this run"
                : !editor.hasDirtyChanges ? "No changes to save"
                : "Save slide edits"
              }
              className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 disabled:opacity-40"
              style={{ borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" }}
            >
              {editor.saveState === "saving" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
            <button
              onClick={editor.onShow}
              disabled={!isSong || !editor.currentSlide}
              title={!isSong ? "Editing is available for songs in this run" : "Stage current edits to Preview"}
              className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 bg-teal-500/20 border-teal-500/60 text-teal-200 disabled:opacity-40"
            >
              <Play className="w-3 h-3" /> Show
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
          {isSong ? (
            <SlideCanvas
              slide={editor.currentSlide}
              selectedObjectId={editor.selectedObjectId}
              onSelectObject={editor.setSelectedObjectId}
              onUpdateObject={editor.updateObject}
              onRemoveObject={editor.removeObject}
              readOnly={false}
            />
          ) : (
            <ReadOnlyPreview item={item} slideIdx={editor.currentIndex} />
          )}
        </div>
      </div>
    </div>
  );
}

function SlideListRail({ item }: { item: OperatorShellCtx["plan"]["items"][number] }) {
  const editor = useSlideEditorCtx();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  if (!editor) return null;
  const isSong = editor.isEditable;

  return (
    <aside className="w-40 shrink-0 flex flex-col border-r min-h-0"
      style={{ borderColor: "#2a3232", background: "#1a2020" }}>
      {/* Toolbar */}
      <div className="shrink-0 p-2 flex items-center gap-1 border-b" style={{ borderColor: "#2a3232" }}>
        <button
          onClick={editor.addSlide}
          disabled={!isSong}
          title={isSong ? "Add slide" : "Editing is available for songs in this run"}
          className="h-6 px-1.5 rounded-md border text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 disabled:opacity-40"
          style={{ borderColor: "#2a3232", background: "#1e2525", color: "#e4e4e7" }}
        >
          <Plus className="w-3 h-3" /> Add
        </button>
        <button
          onClick={editor.duplicateSlide}
          disabled={!isSong || !editor.currentSlide}
          title={isSong ? "Duplicate selected slide" : "Editing is available for songs in this run"}
          className="h-6 w-6 rounded-md border inline-flex items-center justify-center disabled:opacity-40"
          style={{ borderColor: "#2a3232", background: "#1e2525", color: "#e4e4e7" }}
        >
          <Copy className="w-3 h-3" />
        </button>
        <button
          onClick={editor.deleteSlide}
          disabled={!isSong || !editor.currentSlide}
          title={isSong ? "Delete selected slide" : "Editing is available for songs in this run"}
          className="h-6 w-6 rounded-md border inline-flex items-center justify-center text-red-300 disabled:opacity-40"
          style={{ borderColor: "#2a3232", background: "#1e2525" }}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Thumbnail list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {editor.slides.length === 0 && (
          <div className="text-[10px] text-zinc-500 italic px-1 py-2">No slides.</div>
        )}
        {editor.slides.map((s, i) => {
          const active = i === editor.currentIndex;
          return (
            <div
              key={s.id}
              draggable={isSong}
              onDragStart={() => isSong && setDragIdx(i)}
              onDragOver={(e) => { if (isSong && dragIdx !== null && dragIdx !== i) e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                if (!isSong || dragIdx === null || dragIdx === i) { setDragIdx(null); return; }
                editor.reorderSlide(dragIdx, i);
                setDragIdx(null);
              }}
              onDragEnd={() => setDragIdx(null)}
              onClick={() => editor.setCurrentIndex(i)}
              className={cn(
                "relative rounded-md border-2 cursor-pointer group",
                active ? "border-teal-400 ring-2 ring-teal-500/30" : "border-[#2a3232] hover:border-zinc-500",
              )}
              title={`Slide ${i + 1}${isSong ? " — drag to reorder" : ""}`}
            >
              <SlideThumb slide={s} />
              <span className="absolute top-0.5 left-0.5 text-[9px] font-mono text-white bg-black/70 px-1 rounded-sm">
                {i + 1}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ReadOnlyPreview({ item, slideIdx }: { item: OperatorShellCtx["plan"]["items"][number]; slideIdx: number }) {
  const slide = item.slides[slideIdx];
  if (!slide) return <div className="w-full h-full flex items-center justify-center text-zinc-500 text-[12px]">No slide.</div>;
  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <div className="relative w-full max-w-full max-h-full" style={{ aspectRatio: "16 / 9" }}>
        <div className="absolute inset-0 rounded-md overflow-hidden border" style={{ borderColor: "#2a3232", background: "#000" }}>
          <SlideRenderer slide={slide} />
        </div>
      </div>
    </div>
  );
}
