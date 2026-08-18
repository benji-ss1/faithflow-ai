"use client";
import { useEffect, useRef, useState } from "react";
import { LayoutGrid, List, Eye, Play, Music, BookOpen, Image as ImageIcon, Type, Pencil, FilePlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { dispatchInternal } from "@/lib/internal-events";
import type { OperatorShellCtx } from "../../shell/types";
import type { CenterMode } from "../ProOperatorShell";

// Y5: mirror SlideGrid's Safe Mode source of truth.
const SAFE_MODE_KEY = "presentflow.operator.safeMode";
function safeMode() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(SAFE_MODE_KEY);
  return raw === "1"; // default OFF per user directive
}

const VIEW_MODE_KEY = "presentflow.operator.slideViewMode";
type ViewMode = "grid" | "list" | "text";

export function CenterHeader({
  ctx,
  centerMode,
  slideSize,
  onSlideSize,
}: {
  ctx: OperatorShellCtx;
  centerMode: CenterMode;
  slideSize?: number;
  onSlideSize?: (n: number) => void;
}) {
  const item = ctx.plan.items[ctx.previewItemIdx];
  // R6/Y4: mode-aware titles. Read-only per the earlier decision — rename
  // routes through the item edit flow in slides mode only.
  const Icon =
    centerMode === "bible" ? BookOpen
    : centerMode === "songs" ? Music
    : centerMode === "media" ? ImageIcon
    : item?.type === "song" ? Music
    : LayoutGrid;
  const title =
    centerMode === "bible" ? "Bible"
    : centerMode === "songs" ? "Songs Library"
    : centerMode === "media" ? "Media Library"
    : (item?.title ?? "No item selected");

  return (
    <div className="h-11 shrink-0 border-b border-[var(--color-border)] flex items-center px-3 gap-2">
      <Icon className="w-4 h-4 text-[var(--color-muted-foreground)]" />
      {/* Item title is read-only; edit via the library entry. */}
      <div
        className="min-w-0 text-[14px] font-medium px-2 py-1 truncate"
        title={title}
      >
        {title}
      </div>
      {/* Edit slide — opens the full-screen style editor for the current song
          (fonts, layout, backgrounds, objects). Slides mode ONLY: here `item`
          (the playlist preview item) is exactly what the SlideGrid shows, so
          the editor targets the right song. In Songs Library mode the displayed
          song is the SongsBrowser selection (not the playlist item), so its own
          "Edit slide" button lives there and passes the selected song along. */}
      {centerMode === "slides" && item?.type === "song" && (
        <>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("presentflow:open-slide-editor"))}
            title="Edit slide — fonts, layout, backgrounds"
            className="shrink-0 h-7 px-2.5 rounded-md border border-[var(--color-border)] flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-elevated)]"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit slide
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("presentflow:open-slide-editor", { detail: { blank: true } }))}
            title="Add a blank slide and open it in the editor"
            className="shrink-0 h-7 px-2.5 rounded-md border flex items-center gap-1.5 text-[11px] font-semibold hover:brightness-110"
            style={{ borderColor: "#ff7a2c55", color: "#ff7a2c" }}
          >
            <FilePlus className="w-3.5 h-3.5" /> Blank slide
          </button>
        </>
      )}
      <div className="flex-1" />
      {/* Unified size slider — slides mode uses the ctx-supplied setter,
          bible/songs modes broadcast to their own local size state via a
          shared window event so a single control drives every center panel. */}
      {(centerMode === "slides" || centerMode === "bible" || centerMode === "songs") && (
        <CenterSizeSlider centerMode={centerMode} slideSize={slideSize} onSlideSize={onSlideSize} />
      )}
      <ViewModeToggle />
      <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-muted-foreground)]" title="Preview (open Live in a new window)"
        onClick={() => { try { window.open("/live", "presentflow-live", "width=1280,height=720"); } catch { /* noop */ } }}
      >
        <Eye className="w-4 h-4" />
      </button>
        <button
          onClick={() => {
            // 2026-07-25 field bug fix — the Play button silently no-op'd
            // in Bible/Songs modes because it only read `plan.items`. Now
            // context-aware:
            //   - Bible mode → dispatch bible-play-current so BibleMode
            //     fires the selected verse card
            //   - Songs mode → dispatch songs-play-current so SongsBrowser
            //     fires the selected song's first slide
            //   - Slides mode → existing behavior (first slide of preview
            //     playlist item)
            try { console.log("[center-play] clicked", { centerMode, hasItem: !!ctx.plan.items[ctx.previewItemIdx], slideCount: ctx.plan.items[ctx.previewItemIdx]?.slides?.length ?? 0 }); } catch { /* ignore */ }
            if (centerMode === "bible") {
              dispatchInternal("presentflow:bible-play-current");
              return;
            }
            if (centerMode === "songs") {
              dispatchInternal("presentflow:songs-play-current");
              return;
            }
            const s = ctx.plan.items[ctx.previewItemIdx]?.slides?.[0];
            if (!s) {
              toast.info("Nothing to play — pick a playlist item first, or load a Bible reference.");
              return;
            }
            if (safeMode()) {
              ctx.onJumpSlide(ctx.previewItemIdx, 0);
            } else {
              ctx.onSendSlideToLive(s);
              toast.success(`Playing ${ctx.plan.items[ctx.previewItemIdx]?.title ?? "slide 1"}`, { duration: 1500 });
            }
          }}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-brand)]"
          title={centerMode === "bible" ? "Play the currently selected Bible verse" : centerMode === "songs" ? "Play the currently selected song's first slide" : "Play first slide of this playlist item"}
        >
          <Play className="w-4 h-4" />
        </button>
    </div>
  );
}

function CenterSizeSlider({
  centerMode,
  slideSize,
  onSlideSize,
}: {
  centerMode: CenterMode;
  slideSize?: number;
  onSlideSize?: (n: number) => void;
}) {
  const [localSize, setLocalSize] = useState<number>(280);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("presentflow.center.slideSize");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 120 && n <= 480) setLocalSize(n);
    } catch { /* noop */ }
  }, []);
  const value = centerMode === "slides" && typeof slideSize === "number" ? slideSize : localSize;
  const min = centerMode === "slides" ? 96 : 160;
  const max = centerMode === "slides" ? 240 : 480;
  // Debounce localStorage + broadcast writes so a drag doesn't fire ~100
  // storage writes per second. The visual state (localSize) updates
  // immediately so the slider still feels responsive.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clean up pending debounce on unmount so a mid-drag mode swap doesn't
  // fire a stale setState/broadcast after the component has torn down.
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);
  const onChange = (n: number) => {
    if (centerMode === "slides" && onSlideSize) {
      onSlideSize(n);
      return;
    }
    setLocalSize(n);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      try { window.localStorage.setItem("presentflow.center.slideSize", String(n)); } catch { /* noop */ }
      try { window.dispatchEvent(new CustomEvent("presentflow:center-slide-size", { detail: n })); } catch { /* noop */ }
    }, 100);
  };
  return (
    <div className="flex items-center gap-2 pr-2" title={`Card size: ${value}px`}>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-[150px]"
        style={{ accentColor: "#5b9bd5" }}
        aria-label="Card size"
      />
    </div>
  );
}

function ViewModeToggle() {
  const [mode, setMode] = useState<ViewMode>("grid");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEW_MODE_KEY);
      if (raw === "grid" || raw === "list" || raw === "text") setMode(raw);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const d = (e as CustomEvent<ViewMode>).detail;
      if (d === "grid" || d === "list" || d === "text") setMode(d);
    };
    window.addEventListener("presentflow:slide-view-mode", handler);
    return () => window.removeEventListener("presentflow:slide-view-mode", handler);
  }, []);
  const set = (m: ViewMode) => {
    setMode(m);
    try { window.localStorage.setItem(VIEW_MODE_KEY, m); } catch { /* noop */ }
    try { window.dispatchEvent(new CustomEvent("presentflow:slide-view-mode", { detail: m })); } catch { /* noop */ }
  };
  return (
    <div className="flex items-center rounded border border-[var(--color-border)] overflow-hidden">
      <button title="Grid view" aria-pressed={mode === "grid"} onClick={() => set("grid")}
        className={cn("w-7 h-7 flex items-center justify-center hover:bg-white/5",
          mode === "grid" ? "text-[var(--color-foreground)] bg-white/5" : "text-[var(--color-muted-foreground)]")}>
        <LayoutGrid className="w-4 h-4" />
      </button>
      <button title="List view" aria-pressed={mode === "list"} onClick={() => set("list")}
        className={cn("w-7 h-7 flex items-center justify-center border-l border-[var(--color-border)] hover:bg-white/5",
          mode === "list" ? "text-[var(--color-foreground)] bg-white/5" : "text-[var(--color-muted-foreground)]")}>
        <List className="w-4 h-4" />
      </button>
      <button title="Text view" aria-pressed={mode === "text"} onClick={() => set("text")}
        className={cn("w-7 h-7 flex items-center justify-center border-l border-[var(--color-border)] hover:bg-white/5",
          mode === "text" ? "text-[var(--color-foreground)] bg-white/5" : "text-[var(--color-muted-foreground)]")}>
        <Type className="w-4 h-4" />
      </button>
    </div>
  );
}
