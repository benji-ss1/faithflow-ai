"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Popover from "@radix-ui/react-popover";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Music,
  BookOpen,
  Image as ImageIcon,
  Square,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import { addServiceItem, removeServiceItem, reorderServiceItems, deleteSong, createSongSlide, deleteSongSlide } from "@/lib/actions";

function itemIcon(type: string) {
  if (type === "song") return Music;
  if (type === "scripture" || type === "bible") return BookOpen;
  if (type === "media" || type === "video") return ImageIcon;
  return Square;
}

// ── Sortable row ────────────────────────────────────────────────────────────
// Extracted so it can call useSortable at the top level of a component.
function SortablePlaylistItem({
  item,
  idx,
  totalItems,
  isActive,
  onItemClick,
  onRemove,
  onMove,
  onDuplicate,
  onAddSlide,
  onDeleteSong,
}: {
  item: OperatorShellCtx["plan"]["items"][number];
  idx: number;
  totalItems: number;
  isActive: boolean;
  onItemClick: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onAddSlide?: () => void;
  onDeleteSong?: () => void;
}) {
  const id = item.id ?? `item-${idx}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const Icon = itemIcon(item.type ?? "blank");

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
      }}
      data-playlist-item-idx={idx}
      data-item-song-id={item.songId ?? undefined}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            className={cn(
              "flex items-center gap-1 border-l-2 transition-colors",
              isActive
                ? "border-[var(--color-brand)] bg-[var(--color-elevated)]"
                : "border-transparent hover:bg-white/5",
            )}
          >
            {/* Drag handle — only this area initiates a drag */}
            <button
              type="button"
              {...attributes}
              {...listeners}
              tabIndex={-1}
              aria-label="Drag to reorder"
              className="flex items-center justify-center w-5 h-full py-1 cursor-grab active:cursor-grabbing text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] shrink-0 transition-colors"
              onClick={(e) => e.stopPropagation()} // don't trigger item click
            >
              <GripVertical className="w-3 h-3" />
            </button>

            {/* Item button */}
            <button
              type="button"
              onClick={onItemClick}
              className={cn(
                "flex-1 flex items-center gap-2 pr-2 py-1 text-[12px] text-left",
                isActive
                  ? "text-[var(--color-foreground)]"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.title}</span>
              <span className="ml-auto text-[10px] opacity-60 shrink-0">{item.slides.length}</span>
            </button>
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[140px]">
            <ContextMenu.Item
              onSelect={onRemove}
              className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer text-[var(--color-destructive)]"
            >
              Remove
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={() => onMove(-1)}
              disabled={idx === 0}
              className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer data-[disabled]:opacity-50"
            >
              Move Up
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={() => onMove(1)}
              disabled={idx === totalItems - 1}
              className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer data-[disabled]:opacity-50"
            >
              Move Down
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={onDuplicate}
              className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
            >
              Duplicate
            </ContextMenu.Item>
            {onAddSlide && (
              <ContextMenu.Item
                onSelect={onAddSlide}
                className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
              >
                Add slide
              </ContextMenu.Item>
            )}
            {onDeleteSong && (
              <>
                <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                <ContextMenu.Item
                  onSelect={onDeleteSong}
                  className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer text-[var(--color-destructive)]"
                >
                  Delete Song
                </ContextMenu.Item>
              </>
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </li>
  );
}

// ── PlaylistSection ──────────────────────────────────────────────────────────
export function PlaylistSection({
  ctx,
  onCenterMode,
}: {
  ctx: OperatorShellCtx;
  onCenterMode?: (m: "slides" | "bible" | "songs" | "media") => void;
}) {
  const [open, setOpen] = useState(true);
  const [dropOver, setDropOver] = useState(false);
  const router = useRouter();
  const items = ctx.plan.items;

  // 8px activation distance prevents accidental drags on regular clicks.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Result handler ────────────────────────────────────────────────────────
  const handleResult = (res: { ok: boolean; error?: string } | void, successMsg?: string) => {
    if (!res) return;
    if (!res.ok) { toast.error(res.error ?? "Action failed"); return; }
    if (successMsg) toast.success(successMsg);
    router.refresh();
  };

  // Toast with an Undo action that runs the inverse (server) operation, then
  // refreshes. Used for add/remove of songs and slides so a mistake — even a
  // deletion — is one click to recover, matching the "Delete → Undo" pattern.
  const undoToast = (message: string, undo: () => Promise<{ ok: boolean; error?: string } | void>) => {
    toast(message, {
      action: {
        label: "Undo",
        onClick: () => {
          void (async () => {
            const r = await undo();
            if (r && !r.ok) { toast.error(r.error ?? "Undo failed"); return; }
            router.refresh();
          })();
        },
      },
    });
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const addBlank = async () => {
    const res = await addServiceItem(ctx.planId, "blank", "Blank", {});
    if (!res.ok) { toast.error(res.error ?? "Action failed"); return; }
    router.refresh();
    if (res.data) undoToast("Blank slide added", () => removeServiceItem(res.data!.id));
  };

  const remove = async (it: OperatorShellCtx["plan"]["items"][number]) => {
    if (!it.id) return;
    // Snapshot the item + full order BEFORE removal so Undo can re-create it in
    // its original position.
    const beforeIds = items.map((i) => i.id).filter(Boolean) as string[];
    const removedId = it.id;
    const type = (it.type ?? "blank") as "song" | "scripture" | "media" | "sermon" | "blank" | "logo";
    const title = it.title;
    const payload = (it as unknown as { payload?: Record<string, unknown> }).payload ?? {};
    const res = await removeServiceItem(removedId);
    if (!res.ok) { toast.error(res.error ?? "Action failed"); return; }
    router.refresh();
    undoToast(`Removed "${title}"`, async () => {
      const add = await addServiceItem(ctx.planId, type, title, payload);
      if (!add.ok) return add; // couldn't restore the item — surface the error
      // Best-effort position restore. If the plan changed since removal (another
      // item removed/reordered), `beforeIds` may contain a now-dead id and
      // reorderServiceItems will safely reject — the item stays restored at the
      // end rather than the undo reporting failure. Recovery always wins.
      if (add.data) {
        const targetOrder = beforeIds.map((x) => (x === removedId ? add.data!.id : x));
        await reorderServiceItems(ctx.planId, targetOrder);
      }
      return { ok: true };
    });
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const newOrder = items.map((it) => it.id).filter(Boolean) as string[];
    const to = idx + dir;
    if (to < 0 || to >= newOrder.length) return;
    [newOrder[idx], newOrder[to]] = [newOrder[to], newOrder[idx]];
    handleResult(await reorderServiceItems(ctx.planId, newOrder));
  };

  const deleteFromLibrary = async (it: OperatorShellCtx["plan"]["items"][number]) => {
    if (!it.songId) return;
    if (!window.confirm(`Permanently delete "${it.title}" from your song library? This cannot be undone.`)) return;
    // Library-first: if the library delete fails, nothing is removed from the
    // plan either — clean abort. If plan remove fails after library delete,
    // the plan item becomes an orphaned ref (shows 0 slides) that the operator
    // can clear with "Remove". This is less bad than the reverse order where a
    // failed library delete leaves the song absent from the plan but still in
    // the library.
    const libResult = await deleteSong(it.songId);
    if (!libResult?.ok) {
      toast.error((libResult as { error?: string } | undefined)?.error ?? "Delete failed");
      return;
    }
    if (it.id) await removeServiceItem(it.id).catch(() => { /* non-fatal */ });
    toast.success(`"${it.title}" deleted`);
    router.refresh();
  };

  // Add a blank lyric slide to a song item directly from the playlist. Slides
  // for song items live on the underlying library song, so this appends via
  // createSongSlide (the same path the Songs browser uses) then refreshes the
  // plan so the new slide is available live. Only offered for song items.
  const addSlideToItem = async (it: OperatorShellCtx["plan"]["items"][number]) => {
    if (it.type !== "song" || !it.songId) return;
    const res = await createSongSlide(it.songId, undefined, { objects: [], lyrics: "" });
    if (!res.ok) { toast.error(res.error ?? "Add slide failed"); return; }
    router.refresh();
    if (res.data) undoToast("Slide added", () => deleteSongSlide(res.data!.id));
  };

  const duplicate = async (idx: number) => {
    const it = items[idx];
    if (!it) return;
    const t = (it.type ?? "blank") as "song" | "scripture" | "media" | "sermon" | "blank" | "logo";
    const res = await addServiceItem(ctx.planId, t, `${it.title} (copy)`, (it as unknown as { payload?: Record<string, unknown> }).payload ?? {});
    if (!res.ok) { toast.error(res.error ?? "Action failed"); return; }
    router.refresh();
    // res.data absent when the dedup guard no-ops (e.g. duplicating a song
    // already in the plan) — nothing was created, so no Undo is offered.
    if (res.data) undoToast(`Duplicated "${it.title}"`, () => removeServiceItem(res.data!.id));
    else toast.success("Duplicated");
  };

  // ── Drag end — optimistic reorder then persist ─────────────────────────────
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = items.map((it, i) => it.id ?? `item-${i}`);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;

    // Build the new order from item IDs for the server action.
    const reordered = arrayMove(items, oldIdx, newIdx);
    const newOrder = reordered.map((it) => it.id).filter(Boolean) as string[];
    handleResult(await reorderServiceItems(ctx.planId, newOrder));
  };

  // ── Item click (unchanged behaviour from 2026-07-25 field fix) ────────────
  const handleItemClick = (it: OperatorShellCtx["plan"]["items"][number], idx: number) => {
    try {
      console.log("[click] playlist item", { id: it.id, idx, type: it.type, title: it.title, slideCount: it.slides?.length ?? 0 });
    } catch { /* ignore */ }
    onCenterMode?.("slides");
    ctx.onSetPreviewItem(idx);
    if (it.type === "song") {
      const first = it.slides?.[0];
      if (first) {
        try {
          ctx.onSendSlideToLive(first);
          toast.success(`Playing "${it.title}" — slide 1`);
        } catch (e) {
          console.warn("[playlist] song click send-live failed", e);
          toast.error("Couldn't send slide live — check DevTools console.");
        }
      } else {
        toast.info(`"${it.title}" has no slides yet — open the song to add lyrics.`);
      }
    }
  };

  // ── Cross-panel drop (native HTML5 drag from SongsBrowser / MediaBrowser) ──
  // dnd-kit handles internal sort reorder via its own events; these native
  // handlers handle drops originating from outside the playlist panel.
  const handleExternalDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDropOver(false);
    const raw = e.dataTransfer.getData("application/x-pf-library-item");
    if (!raw) return;
    let data: { pfType?: string; id?: string; title?: string };
    try { data = JSON.parse(raw); } catch { return; }
    if (!data.id || !data.title || !data.pfType) return;
    if (!ctx.onAddLibraryItem) { toast.info("Open a service plan first to add items"); return; }
    const kind = data.pfType === "song" ? "song" : "media";
    await ctx.onAddLibraryItem(kind, { id: data.id, title: data.title });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const itemIds = items.map((it, i) => it.id ?? `item-${i}`);

  return (
    <section
      className="border-b border-[var(--color-border)] flex-1 min-h-0 flex flex-col relative"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropOver(true); }}
      onDragLeave={(e) => {
        // Only clear when leaving the section entirely (not just moving over a child)
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false);
      }}
      onDrop={handleExternalDrop}
    >
      <header className="flex items-center h-7 px-2 gap-1">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="eyebrow">Playlist</span>
          <span className="eyebrow ml-1 text-[9px]">· {items.length} items</span>
        </button>

        {/* Add popover */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-[var(--color-muted-foreground)]"
              title="Add item"
            >
              <Plus className="w-3 h-3" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="start"
              className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[140px]"
            >
              <button className="w-full text-left px-3 py-1.5 rounded hover:bg-[var(--color-panel)]" onClick={() => onCenterMode?.("songs")}>From Songs</button>
              <button className="w-full text-left px-3 py-1.5 rounded hover:bg-[var(--color-panel)]" onClick={() => onCenterMode?.("bible")}>From Bible</button>
              <button className="w-full text-left px-3 py-1.5 rounded hover:bg-[var(--color-panel)]" onClick={() => onCenterMode?.("media")}>From Media</button>
              <button className="w-full text-left px-3 py-1.5 rounded hover:bg-[var(--color-panel)]" onClick={addBlank}>Blank</button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </header>

      {/* Drop overlay — shown when dragging a song/media card over the sidebar */}
      {dropOver && (
        <div className="absolute inset-0 z-20 pointer-events-none rounded border-2 border-dashed border-[var(--color-brand)] bg-[var(--color-brand)]/10 flex items-center justify-center">
          <span className="text-[11px] font-semibold text-[var(--color-brand)] bg-[var(--color-panel)]/90 px-2 py-1 rounded">
            Drop to add to playlist
          </span>
        </div>
      )}

      {open && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <ol className="flex-1 min-h-0 overflow-y-auto pb-1">
              {items.length === 0 && (
                <li className="px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">
                  No items yet — drag a song or media here, or press +.
                </li>
              )}
              {items.map((it, idx) => (
                <SortablePlaylistItem
                  key={it.id ?? idx}
                  item={it}
                  idx={idx}
                  totalItems={items.length}
                  isActive={idx === ctx.previewItemIdx}
                  onItemClick={() => handleItemClick(it, idx)}
                  onRemove={() => void remove(it)}
                  onMove={(dir) => void move(idx, dir)}
                  onDuplicate={() => void duplicate(idx)}
                  onAddSlide={it.type === "song" && it.songId ? () => void addSlideToItem(it) : undefined}
                  onDeleteSong={it.type === "song" && it.songId ? () => void deleteFromLibrary(it) : undefined}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}
