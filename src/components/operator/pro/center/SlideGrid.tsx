"use client";
import { useEffect, useRef, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { updateSongSlides } from "@/lib/actions";
import { X, Pencil } from "lucide-react";

type ViewMode = "grid" | "list" | "text";
const VIEW_MODE_KEY = "presentflow.operator.slideViewMode";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Safe Mode toggle. User-directive polish pass: default is OFF — single-click
// sends live. When ON: single-click selects, double-click sends live. Persisted
// per-machine in localStorage.
const SAFE_MODE_KEY = "presentflow.operator.safeMode";
function safeMode() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(SAFE_MODE_KEY);
  return raw === "1"; // default OFF
}

// Debounce accidental fast repeat clicks / trackpad noise (250ms).
// 2026-07-27 field fix: the old debounce was GLOBAL — clicking slide 1 then
// slide 2 within 250ms silently swallowed slide 2 ("clicked but didn't go
// live" at a live service). Now keyed per-slide: only a repeat click on the
// SAME slide is suppressed; a click on a different slide always fires
// (latest-wins — the send path is idempotent).
let __lastLiveKey = "";
let __lastLiveFire = 0;
function fireLive(key: string, fn: () => void) {
  const now = Date.now();
  if (key === __lastLiveKey && now - __lastLiveFire < 250) {
    console.log("[click] slide live suppressed (same-slide repeat <250ms)", { key });
    return;
  }
  __lastLiveKey = key;
  __lastLiveFire = now;
  fn();
}

export function SlideGrid({ ctx, slideSize }: { ctx: OperatorShellCtx; slideSize: number }) {
  const item = ctx.plan.items[ctx.previewItemIdx];
  const slides: SlidePayload[] = item?.slides ?? [];
  const lastDragEndRef = useRef(0);

  // View mode is toggled by the BottomBar (fires "presentflow:slide-view-mode").
  // Persist per-machine so operators keep their preferred layout across launches.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEW_MODE_KEY);
      if (raw === "list" || raw === "text" || raw === "grid") setViewMode(raw);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ViewMode>).detail;
      if (detail === "grid" || detail === "list" || detail === "text") {
        setViewMode(detail);
        try { window.localStorage.setItem(VIEW_MODE_KEY, detail); } catch { /* noop */ }
      }
    };
    window.addEventListener("presentflow:slide-view-mode", handler);
    return () => window.removeEventListener("presentflow:slide-view-mode", handler);
  }, []);

  // Quick Edit — floating panel for inline slide text editing
  const [quickEdit, setQuickEdit] = useState<{ slideIdx: number; text: string } | null>(null);
  const [qeSaving, setQeSaving] = useState(false);
  // App-level clipboard for cut/copy/paste within the grid
  const slideClipboardRef = useRef<SlidePayload | null>(null);

  const handleQuickEditSave = async (newText: string) => {
    if (!quickEdit) return;
    const trimmed = newText.trim();
    if (!trimmed) return;
    setQeSaving(true);
    try {
      if (item?.type === "song" && (item as { songId?: string }).songId) {
        const songId = (item as { songId?: string }).songId!;
        // Build the updated slides array: replace the text at quickEdit.slideIdx
        const updatedSlides = slides.map((s, i) => ({
          lyrics: i === quickEdit.slideIdx
            ? trimmed
            : (s.kind === "text" ? (s as { text?: string }).text ?? "" : ""),
        }));
        const res = await updateSongSlides(songId, updatedSlides);
        if (!res.ok) {
          const { toast } = await import("sonner");
          toast.error(res.error ?? "Save failed");
          return;
        }
        const { toast } = await import("sonner");
        toast.success("Slide updated");
      }
      setQuickEdit(null);
    } finally {
      setQeSaving(false);
    }
  };

  // Task C: derive stable per-slide IDs for dnd + server call. For song
  // items we have real songSlide IDs on songSlideRows; for other item
  // types the reorder validator accepts stringified indices.
  const slideIds: string[] = slides.map((_, i) => {
    if (item?.type === "song" && item.songSlideRows?.[i]?.id) return item.songSlideRows[i].id;
    return `slide-${i}`;
  });

  // 2026-07-27 field fix: distance raised 6 → 8px. A shaky mouse/trackpad
  // press that drifts >6px turned the click into a drag activation and the
  // click never fired (classic dnd-kit click-swallow at live services).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    // dnd-kit can let a trailing click through after a drop — record the drop
    // time so onSelect can ignore that ghost click (prevents an accidental
    // go-live right after reordering slides).
    lastDragEndRef.current = Date.now();
    // Fix-loop 2026-07-27: reordering changes which slide sits behind each
    // key/index — a stale dedupe key could wrongly suppress (or allow) the
    // next go-live. Reset so post-drag clicks always evaluate fresh.
    __lastLiveKey = "";
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = slideIds.indexOf(String(active.id));
    const newIdx = slideIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const nextOrder = arrayMove(slideIds, oldIdx, newIdx);
    ctx.onReorderSlidesInItem?.(ctx.previewItemIdx, nextOrder);
  };

  return (
    <div className="p-2 flex flex-col gap-6">
      {/* Main slide grid — Task B: 6px gutter. Y10: semantic grid + gridcell roles. */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={slideIds} strategy={rectSortingStrategy}>
          <div
            role="grid"
            aria-label="Slides"
            className={cn(viewMode === "text" ? "flex flex-col" : "grid")}
            style={viewMode === "text"
              ? { gap: 4 }
              : viewMode === "list"
                ? { gap: 6, gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(slideSize * 2, 220)}px, 1fr))` }
                : { gap: 6, gridTemplateColumns: `repeat(auto-fill, minmax(${slideSize}px, 1fr))` }
            }
          >
            {slides.length === 0 && (
              <div className="col-span-full text-[12px] text-[var(--color-muted-foreground)] py-12 text-center space-y-1">
                <div>No slides yet</div>
                <div className="text-[11px] opacity-70">
                  Tip: click any slide to send it live. Enable Safe Mode in Settings to require double-click.
                </div>
              </div>
            )}
            {slides.map((s, idx) => (
              <SortableSlideCard
                key={slideIds[idx]}
                id={slideIds[idx]}
                slide={s}
                index={idx + 1}
                selected={idx === ctx.previewSlideIdx}
                canQuickEdit={item?.type === "song" && !!(item as { songId?: string }).songId}
                onSelect={() => {
                  console.log("[click] slide", { id: slideIds[idx], idx, safeMode: safeMode() });
                  // Ignore the ghost click dnd-kit lets through right after a
                  // drag-drop — otherwise reordering could fire a slide live.
                  // Fix-loop 2026-07-27: the guard suppresses ONLY the go-live
                  // fire; preview selection still happens (window 200 → 120ms).
                  const justDragged = Date.now() - lastDragEndRef.current < 120;
                  ctx.onJumpSlide(ctx.previewItemIdx, idx);
                  if (justDragged) {
                    console.log("[click] slide live suppressed (just finished drag)", { id: slideIds[idx] });
                    return;
                  }
                  if (!safeMode()) {
                    // Fix-loop 2026-07-27: dedupe key includes the playlist
                    // item — the `slide-${i}` fallback collides across items
                    // and across reorders.
                    fireLive(`${ctx.previewItemIdx}:${slideIds[idx]}`, () => ctx.onSendSlideToLive(s));
                  }
                }}
                onDouble={() => {
                  console.log("[click] slide double", { id: slideIds[idx], idx });
                  if (safeMode()) fireLive(`${ctx.previewItemIdx}:${slideIds[idx]}`, () => ctx.onSendSlideToLive(s));
                }}
                onDelete={() => ctx.onDeleteSlide?.(ctx.previewItemIdx, idx)}
                onQuickEdit={() => {
                  const text = s.kind === "text" ? ((s as { text?: string }).text ?? "") : "";
                  setQuickEdit({ slideIdx: idx, text });
                }}
                onDuplicate={() => {
                  void (async () => {
                    if (item?.type === "song" && (item as { songId?: string }).songId) {
                      const songId = (item as { songId?: string }).songId!;
                      const newSlides = [...slides];
                      newSlides.splice(idx + 1, 0, s);
                      const updatedSlides = newSlides.map((sl) => ({
                        lyrics: sl.kind === "text" ? ((sl as { text?: string }).text ?? "") : "",
                      }));
                      const res = await updateSongSlides(songId, updatedSlides);
                      if (!res.ok) {
                        const { toast } = await import("sonner");
                        toast.error(res.error ?? "Duplicate failed");
                      } else {
                        const { toast } = await import("sonner");
                        toast.success("Slide duplicated");
                      }
                    }
                  })();
                }}
                onCopyText={() => {
                  const text = s.kind === "text" ? ((s as { text?: string }).text ?? "") : "";
                  if (text) {
                    navigator.clipboard.writeText(text).then(() => {
                      void import("sonner").then(({ toast }) => toast.success("Copied to clipboard"));
                    }).catch(() => {
                      void import("sonner").then(({ toast }) => toast.error("Copy failed"));
                    });
                  }
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Stage row (half-size mirror) */}
      {slides.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Stage</div>
          <div
            className="grid"
            style={{
              gap: 6,
              gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(slideSize / 1.6)}px, 1fr))`,
            }}
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

      {/* Quick Edit Dialog — ProPresenter-style inline slide text editor */}
      <Dialog.Root open={quickEdit !== null} onOpenChange={(o) => { if (!o) setQuickEdit(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
          <Dialog.Content
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-w-[90vw] rounded-xl bg-[var(--color-panel)] border border-[var(--color-border)] shadow-2xl flex flex-col"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
              <Pencil className="w-4 h-4 text-[var(--color-muted-foreground)]" />
              <span className="text-[13px] font-semibold">Quick Edit — Slide {(quickEdit?.slideIdx ?? 0) + 1}</span>
              <Dialog.Close asChild>
                <button type="button" className="ml-auto w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-[var(--color-muted-foreground)]">
                  <X className="w-3.5 h-3.5" />
                </button>
              </Dialog.Close>
            </div>
            <div className="p-4">
              <textarea
                autoFocus
                value={quickEdit?.text ?? ""}
                onChange={(e) => setQuickEdit((prev) => prev ? { ...prev, text: e.target.value } : null)}
                rows={6}
                className="w-full resize-y bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-[var(--color-brand)] text-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)]"
                placeholder="Slide text…"
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setQuickEdit(null); }
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { void handleQuickEditSave(quickEdit?.text ?? ""); }
                }}
              />
              <div className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
                ⌘↵ Save · Esc Cancel
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => {
                  if (quickEdit?.text.trim()) ctx.onSendSlideToLive({ kind: "text", text: quickEdit.text });
                }}
                disabled={!quickEdit?.text.trim()}
                className="h-8 px-3 rounded-md text-[12px] font-medium bg-[var(--color-elevated)] border border-[var(--color-border)] hover:bg-white/10 text-[var(--color-foreground)] disabled:opacity-40"
              >
                Send Live
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="h-8 px-3 rounded-md text-[12px] font-medium bg-transparent border border-[var(--color-border)] hover:bg-white/5 text-[var(--color-muted-foreground)]"
                  disabled={qeSaving}
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void handleQuickEditSave(quickEdit?.text ?? "")}
                disabled={qeSaving || !item?.type || item.type !== "song"}
                className="h-8 px-4 rounded-md text-[12px] font-semibold bg-[var(--color-brand)] text-black hover:opacity-90 disabled:opacity-50"
              >
                {qeSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function SortableSlideCard(props: {
  id: string;
  slide: SlidePayload;
  index: number;
  selected: boolean;
  canQuickEdit: boolean;
  onSelect: () => void;
  onDouble: () => void;
  onDelete: () => void;
  onQuickEdit: () => void;
  onDuplicate: () => void;
  onCopyText: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <SlideCard
        slide={props.slide}
        index={props.index}
        selected={props.selected}
        canQuickEdit={props.canQuickEdit}
        onSelect={props.onSelect}
        onDouble={props.onDouble}
        onDelete={props.onDelete}
        onQuickEdit={props.onQuickEdit}
        onDuplicate={props.onDuplicate}
        onCopyText={props.onCopyText}
      />
    </div>
  );
}

function SlideCard({
  slide, index, selected, canQuickEdit, onSelect, onDouble, onDelete, onQuickEdit, onDuplicate, onCopyText,
}: {
  slide: SlidePayload;
  index: number;
  selected: boolean;
  canQuickEdit: boolean;
  onSelect: () => void;
  onDouble: () => void;
  onDelete: () => void;
  onQuickEdit: () => void;
  onDuplicate: () => void;
  onCopyText: () => void;
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
            "relative aspect-video rounded-[6px] overflow-hidden transition-all text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
            selected
              ? "border-2 border-[var(--color-brand)] shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
              : "border border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
          )}
        >
          {/* 2026-07-25 pull-back — textMinPx=8 + no-pagination made
              lyrics unreadable ("way too small" per field report). Raised
              to 14px (readable at glance size), pagination re-enabled so
              long stanzas split cleanly instead of shrinking to invisible.
              Text still fits WHOLE short verses without truncating, and
              long ones page (visible page indicator inside the card).
              Live projector rendering unaffected (uses the 24px default). */}
          <SlideRenderer slide={slide} textMinPx={14} />
          <div
            className="absolute top-1 left-1 w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: "var(--color-brand)" }}
            aria-hidden
          >
            {index}
          </div>
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[200px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
          {/* Quick Edit — only for song slides (non-song items have no editable text stored in DB) */}
          {canQuickEdit && (
            <>
              <ContextMenu.Item
                onSelect={onQuickEdit}
                className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
              >
                <Pencil className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
                Quick Edit
              </ContextMenu.Item>
              <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
            </>
          )}

          {/* Clipboard */}
          <ContextMenu.Item
            onSelect={onCopyText}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
          >
            Copy Text
          </ContextMenu.Item>
          {canQuickEdit && (
            <ContextMenu.Item
              onSelect={onDuplicate}
              className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
            >
              Duplicate Slide
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />

          {/* Destructive */}
          <ContextMenu.Item
            onSelect={onDelete}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
          >
            Delete Slide
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
