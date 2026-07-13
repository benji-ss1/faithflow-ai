"use client";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
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
let __lastLiveFire = 0;
function fireLive(fn: () => void) {
  const now = Date.now();
  if (now - __lastLiveFire < 250) return;
  __lastLiveFire = now;
  fn();
}

export function SlideGrid({ ctx, slideSize }: { ctx: OperatorShellCtx; slideSize: number }) {
  const item = ctx.plan.items[ctx.previewItemIdx];
  const slides: SlidePayload[] = item?.slides ?? [];

  // Task C: derive stable per-slide IDs for dnd + server call. For song
  // items we have real songSlide IDs on songSlideRows; for other item
  // types the reorder validator accepts stringified indices.
  const slideIds: string[] = slides.map((_, i) => {
    if (item?.type === "song" && item.songSlideRows?.[i]?.id) return item.songSlideRows[i].id;
    return `slide-${i}`;
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
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
            className="grid"
            style={{
              gap: 6,
              gridTemplateColumns: `repeat(auto-fill, minmax(${slideSize}px, 1fr))`,
            }}
          >
            {slides.length === 0 && (
              <div className="col-span-full text-[12px] text-[var(--color-muted-foreground)] py-12 text-center">
                No slides yet
              </div>
            )}
            {slides.map((s, idx) => (
              <SortableSlideCard
                key={slideIds[idx]}
                id={slideIds[idx]}
                slide={s}
                index={idx + 1}
                selected={idx === ctx.previewSlideIdx}
                onSelect={() => {
                  if (safeMode()) {
                    ctx.onJumpSlide(ctx.previewItemIdx, idx);
                  } else {
                    ctx.onJumpSlide(ctx.previewItemIdx, idx);
                    fireLive(() => ctx.onSendSlideToLive(s));
                  }
                }}
                onDouble={() => {
                  if (safeMode()) fireLive(() => ctx.onSendSlideToLive(s));
                }}
                onDelete={() => ctx.onDeleteSlide?.(ctx.previewItemIdx, idx)}
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
    </div>
  );
}

function SortableSlideCard(props: {
  id: string;
  slide: SlidePayload;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onDouble: () => void;
  onDelete: () => void;
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
        onSelect={props.onSelect}
        onDouble={props.onDouble}
        onDelete={props.onDelete}
      />
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
            "relative aspect-video rounded-[6px] overflow-hidden transition-all text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
            selected
              ? "border-2 border-[var(--color-brand)] shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
              : "border border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
          )}
        >
          <SlideRenderer slide={slide} />
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
