"use client";
import { useState, useEffect, useRef } from "react";
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
import { addServiceItem, removeServiceItem, reorderServiceItems, deleteSong, createSongSlide, deleteSongSlide, setServiceItemTheme, renameSong, renameServiceItem, applyThemeToSong, revertSongTheme, renameMediaAsset } from "@/lib/actions";
import { useSlideClipboard, getSlideClipboard } from "@/lib/slide-clipboard";

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
  onSendLive,
  onProjectSlide,
  onRemove,
  onMove,
  onDuplicate,
  onAddSlide,
  onPasteSlide,
  canPasteSlide = false,
  onDeleteSong,
  onRename,
  onDropSlide,
  onReorderGroup,
  onRenameMedia,
  themes = [],
  currentThemeId = null,
  onSetTheme,
}: {
  item: OperatorShellCtx["plan"]["items"][number];
  idx: number;
  totalItems: number;
  isActive: boolean;
  onItemClick: () => void;
  onSendLive: () => void;
  onProjectSlide?: (slideIdx: number) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onAddSlide?: () => void;
  onPasteSlide?: () => void;
  canPasteSlide?: boolean;
  onDeleteSong?: () => void;
  onRename?: (newTitle: string) => void;
  onDropSlide?: (json: string) => void;
  // Reorder the slides WITHIN this (media group) item — newOrder is "slide-<i>" ids.
  onReorderGroup?: (newOrder: string[]) => void;
  // Rename one underlying media asset (a child of a group).
  onRenameMedia?: (assetId: string, name: string) => void;
  themes?: { id: string; name: string }[];
  currentThemeId?: string | null;
  onSetTheme?: (themeId: string | null) => void;
}) {
  const id = item.id ?? `item-${idx}`;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.title);
  // Inline rename for a single child image inside an expanded group.
  const [renamingChild, setRenamingChild] = useState<number | null>(null);
  const [childDraft, setChildDraft] = useState("");
  // Guards a blur-after-Escape from re-committing the (cancelled) draft.
  const childCancelRef = useRef(false);
  const [slideDragOver, setSlideDragOver] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // A grouped media item (multi-select "group") = a media item with >1 slide.
  // It renders as a collapsible row: click the chevron to reveal its images.
  const isGroup = (item.type === "media") && item.slides.length > 1;
  const SLIDE_DND_TYPE = "application/x-presentflow-slide";
  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== item.title) onRename?.(next);
    else setDraft(item.title);
  };
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
            onDragOver={onDropSlide ? (e) => {
              if (e.dataTransfer.types.includes(SLIDE_DND_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (!slideDragOver) setSlideDragOver(true);
              }
            } : undefined}
            onDragLeave={onDropSlide ? () => setSlideDragOver(false) : undefined}
            onDrop={onDropSlide ? (e) => {
              const json = e.dataTransfer.getData(SLIDE_DND_TYPE);
              setSlideDragOver(false);
              if (json) { e.preventDefault(); onDropSlide(json); }
            } : undefined}
            className={cn(
              "flex items-center gap-1 border-l-[3px] rounded-r-md transition-[background,border-color,box-shadow] duration-150",
              slideDragOver
                ? "border-[var(--color-brand)] bg-[var(--color-brand)]/15 ring-1 ring-inset ring-[var(--color-brand)]"
                : isActive
                  ? "border-[var(--color-brand)] bg-[var(--color-elevated)] shadow-[var(--edge-top),inset_0_0_20px_-8px_var(--color-glow)]"
                  : "border-transparent hover:bg-[var(--color-brand)]/10",
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

            {/* Group expand/collapse chevron (media groups only) */}
            {isGroup && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                aria-label={expanded ? "Collapse group" : "Expand group"}
                className="flex items-center justify-center w-4 h-full py-1 shrink-0 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
            )}

            {/* Item button (double-click the title to rename song items) */}
            {renaming ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                  else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); setDraft(item.title); }
                }}
                onClick={(e) => e.stopPropagation()}
                maxLength={120}
                className="flex-1 mr-2 my-0.5 px-1.5 py-0.5 text-[12px] rounded bg-[var(--color-panel)] border border-[var(--color-brand)] text-[var(--color-foreground)] outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={onItemClick}
                onDoubleClick={(e) => {
                  if (!onRename) return;
                  e.stopPropagation();
                  setDraft(item.title);
                  setRenaming(true);
                }}
                title={onRename ? "Double-click to rename" : undefined}
                className={cn(
                  "flex-1 flex items-center gap-2 pr-2 py-1.5 text-[12.5px] text-left transition-colors",
                  isActive
                    ? "text-[var(--color-foreground)] font-semibold"
                    : "text-[var(--color-muted-foreground)] font-medium hover:text-[var(--color-foreground)]",
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0 transition-colors", isActive && "text-[var(--color-brand)]")} />
                <span className="truncate">{item.title}</span>
                <span className={cn(
                  "ml-auto shrink-0 min-w-[18px] h-[17px] px-1 grid place-items-center rounded-full text-[10px] font-bold tabular-nums transition-colors",
                  isActive
                    ? "bg-[var(--color-brand)]/18 text-[var(--color-brand)]"
                    : "bg-white/[0.06] text-[var(--color-muted-foreground)]",
                )}>{item.slides.length}</span>
              </button>
            )}
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[140px]">
            <ContextMenu.Item
              onSelect={onSendLive}
              className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer text-[var(--color-brand)] font-semibold"
            >
              Send to live
            </ContextMenu.Item>
            <ContextMenu.Separator className="h-px my-1 bg-[var(--color-border)]" />
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
            {onRename && (
              <ContextMenu.Item
                onSelect={() => { setDraft(item.title); setRenaming(true); }}
                className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
              >
                Rename
              </ContextMenu.Item>
            )}
            {onAddSlide && (
              <ContextMenu.Item
                onSelect={onAddSlide}
                className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
              >
                Add slide
              </ContextMenu.Item>
            )}
            {onPasteSlide && canPasteSlide && (
              <ContextMenu.Item
                onSelect={onPasteSlide}
                className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
              >
                Paste slide
              </ContextMenu.Item>
            )}
            {onSetTheme && themes.length > 0 && (
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center justify-between data-[state=open]:bg-[var(--color-panel)]">
                  <span>Section theme</span><span className="opacity-60">▸</span>
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[160px] max-h-[300px] overflow-y-auto">
                    <ContextMenu.Item
                      onSelect={() => onSetTheme(null)}
                      className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center justify-between"
                    >
                      <span>Default (church)</span>{!currentThemeId && <span className="text-[var(--color-brand)]">✓</span>}
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                    {themes.map((t) => (
                      <ContextMenu.Item
                        key={t.id}
                        onSelect={() => onSetTheme(t.id)}
                        className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center justify-between"
                      >
                        <span className="truncate">{t.name}</span>{currentThemeId === t.id && <span className="text-[var(--color-brand)]">✓</span>}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
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

      {/* Expanded media group — each child image: click to project, right-click
          for Send live / Rename / Move up / Move down. */}
      {isGroup && expanded && (() => {
        const slideIds = item.slides.map((_, i) => `slide-${i}`);
        const moveChild = (from: number, to: number) => {
          if (to < 0 || to >= slideIds.length) return;
          const next = [...slideIds];
          const [m] = next.splice(from, 1);
          next.splice(to, 0, m);
          onReorderGroup?.(next);
        };
        return (
        <ul className="pl-8 pr-2 pb-1 flex flex-col gap-0.5">
          {item.slides.map((s, sIdx) => {
            const url = (s as { url?: string }).url;
            const isVideo = (s as { kind?: string }).kind === "video";
            const label = isVideo ? "Video" : "Image";
            const meta = item.mediaMeta?.[sIdx];
            const name = meta?.fileName || `${label} ${sIdx + 1}`;
            return (
              <li key={meta?.id ?? sIdx}>
                {renamingChild === sIdx ? (
                  <div className="flex items-center gap-2 py-0.5 pr-1 pl-4">
                    <input
                      autoFocus
                      value={childDraft}
                      onChange={(e) => setChildDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); const n = childDraft.trim(); if (n && meta?.id && n !== name) onRenameMedia?.(meta.id, n); childCancelRef.current = true; setRenamingChild(null); }
                        if (e.key === "Escape") { e.preventDefault(); childCancelRef.current = true; setRenamingChild(null); }
                      }}
                      onBlur={() => { if (childCancelRef.current) { childCancelRef.current = false; return; } const n = childDraft.trim(); if (n && meta?.id && n !== name) onRenameMedia?.(meta.id, n); setRenamingChild(null); }}
                      className="flex-1 h-6 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 text-[11px] outline-none focus:border-[var(--color-brand)]"
                    />
                  </div>
                ) : (
                  <ContextMenu.Root>
                    <ContextMenu.Trigger asChild>
                      <button
                        type="button"
                        onClick={() => onProjectSlide?.(sIdx)}
                        title={`${name} — click to send live, right-click for options`}
                        className="w-full flex items-center gap-2 py-0.5 pr-1 rounded text-left text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10"
                      >
                        <span className="w-4 text-right opacity-50 shrink-0">{sIdx + 1}</span>
                        {url && isVideo ? (
                          <video src={url} muted className="w-10 h-6 object-cover rounded border border-[var(--color-border)] shrink-0" />
                        ) : url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt="" className="w-10 h-6 object-cover rounded border border-[var(--color-border)] shrink-0" />
                        ) : (
                          <span className="w-10 h-6 rounded border border-[var(--color-border)] bg-black/40 shrink-0" />
                        )}
                        <span className="truncate">{name}</span>
                      </button>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[150px]">
                        <ContextMenu.Item onSelect={() => onProjectSlide?.(sIdx)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer">Send to live</ContextMenu.Item>
                        {meta?.id && onRenameMedia ? (
                          <ContextMenu.Item onSelect={() => { childCancelRef.current = false; setChildDraft(name); setRenamingChild(sIdx); }} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer">Rename</ContextMenu.Item>
                        ) : null}
                        <ContextMenu.Separator className="h-px my-1 bg-[var(--color-border)]" />
                        <ContextMenu.Item disabled={sIdx === 0} onSelect={() => moveChild(sIdx, sIdx - 1)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer data-[disabled]:opacity-40 data-[disabled]:cursor-default">Move up</ContextMenu.Item>
                        <ContextMenu.Item disabled={sIdx === item.slides.length - 1} onSelect={() => moveChild(sIdx, sIdx + 1)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer data-[disabled]:opacity-40 data-[disabled]:cursor-default">Move down</ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                )}
              </li>
            );
          })}
        </ul>
        );
      })()}
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
  const clipboardSlide = useSlideClipboard(); // reactive: enables "Paste slide"

  // 8px activation distance prevents accidental drags on regular clicks.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Themes 2c — church themes for the per-item "section theme" submenu.
  const [themes, setThemes] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let m = true;
    fetch("/api/themes").then((r) => r.json()).then((d: { themes?: { id: string; name: string }[] }) => {
      if (m) setThemes((d.themes ?? []).map((t) => ({ id: t.id, name: t.name })));
    }).catch(() => { /* no themes */ });
    return () => { m = false; };
  }, []);

  // ── Result handler ────────────────────────────────────────────────────────
  const handleResult = (res: { ok: boolean; error?: string } | void, successMsg?: string) => {
    if (!res) return;
    if (!res.ok) { toast.error(res.error ?? "Action failed"); return; }
    if (successMsg) toast.success(successMsg);
    router.refresh();
  };

  // Hybrid Phase 2 (safe slice) — honest offline feedback so a plan edit made
  // offline never fails silently or looks saved when it isn't. Deliberately NOT
  // a replay queue: replaying order-dependent mutations against changed server
  // state could corrupt the plan, so offline edits are declined cleanly and the
  // operator retries on reconnect (the offline banner is already visible).
  const blockedIfOffline = (): boolean => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("You're offline — reconnect to change the service plan.");
      return true;
    }
    return false;
  };

  const setTheme = async (itemId: string, themeId: string | null) => {
    if (blockedIfOffline()) return;
    handleResult(await setServiceItemTheme(ctx.planId, itemId, themeId), themeId ? "Section theme set" : "Reset to default theme");
  };

  // Rename one image inside a media group (renames the underlying media asset;
  // the change also propagates to any other place that references it).
  const renameGroupImage = async (assetId: string, name: string) => {
    if (blockedIfOffline()) return;
    handleResult(await renameMediaAsset(assetId, name), "Image renamed");
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

  // Apply a theme to the WHOLE current song (every slide/preview), reversibly.
  // The Themes tab fires this; we resolve the current song, restyle all its
  // slides server-side, refresh so the previews update, and offer Undo.
  useEffect(() => {
    const onApplyThemeToSong = (e: Event) => {
      const themeId = (e as CustomEvent<{ themeId?: string; themeName?: string }>).detail?.themeId;
      if (!themeId) return;
      const it = ctx.plan.items[ctx.previewItemIdx];
      // No song selected → the theme still applied as the live default (Themes
      // tab handled that + toasted); nothing to restyle here, so stay silent.
      if (!it || it.type !== "song" || !it.songId) return;
      const songId = it.songId;
      const itemId = it.id ?? null;
      void (async () => {
        // (1) Restyle every slide's stored design (drives the slide-grid boxes).
        const res = await applyThemeToSong(themeId, songId);
        if (!res.ok) { toast.error(res.error ?? "Couldn't apply theme to the song"); return; }
        // (2) Set the item's theme so the LIVE/projector output renders the theme
        //     appearance (bg gradient + text colour) — this is the path the
        //     projector actually paints from (effectiveAppearance), which the
        //     objectsJson rewrite alone does NOT feed.
        if (itemId) await setServiceItemTheme(ctx.planId, itemId, themeId);
        router.refresh();
        const n = res.data?.slidesUpdated ?? 0;
        undoToast(`Theme applied to ${n} slide${n === 1 ? "" : "s"} of "${it.title}"`, async () => {
          const r = await revertSongTheme(songId);
          if (itemId) await setServiceItemTheme(ctx.planId, itemId, null);
          return r;
        });
      })();
    };
    window.addEventListener("presentflow:apply-theme-to-song", onApplyThemeToSong);
    return () => window.removeEventListener("presentflow:apply-theme-to-song", onApplyThemeToSong);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.plan.items, ctx.previewItemIdx]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const addBlank = async () => {
    if (blockedIfOffline()) return;
    const res = await addServiceItem(ctx.planId, "blank", "Blank", {});
    if (!res.ok) { toast.error(res.error ?? "Action failed"); return; }
    router.refresh();
    if (res.data) undoToast("Blank slide added", () => removeServiceItem(res.data!.id));
  };

  const renameItem = async (it: OperatorShellCtx["plan"]["items"][number], newTitle: string) => {
    if (blockedIfOffline()) return;
    // Song items rename the underlying song (keeps library + every plan in
    // sync); every other item type renames just this playlist item's label.
    if (it.type === "song" && it.songId) {
      handleResult(await renameSong(it.songId, newTitle), "Renamed");
    } else if (it.id) {
      handleResult(await renameServiceItem(it.id, newTitle), "Renamed");
    }
  };

  // Append a slide dragged from the center preview onto a playlist song. The
  // dragged JSON is a SlidePayload; we append it to the END of the target
  // song's slides via createSongSlide(songId, undefined, ...).
  const appendDroppedSlide = async (it: OperatorShellCtx["plan"]["items"][number], json: string) => {
    if (it.type !== "song" || !it.songId) return;
    if (blockedIfOffline()) return;
    let slide: { kind?: string; text?: string; objects?: unknown[] } | null = null;
    try { slide = JSON.parse(json); } catch { slide = null; }
    if (!slide) { toast.error("Couldn't read that slide"); return; }
    const objects = Array.isArray(slide.objects) ? slide.objects : [];
    const lyrics = slide.kind === "text" && typeof slide.text === "string" ? slide.text : "";
    if (!lyrics && objects.length === 0) { toast.error("Only text slides can be added to a song"); return; }
    const res = await createSongSlide(it.songId, undefined, { lyrics, objects } as Parameters<typeof createSongSlide>[2]);
    if (!res.ok) { toast.error(res.error ?? "Couldn't add the slide"); return; }
    router.refresh();
    toast.success(`Slide added to "${it.title}"`);
  };

  // Top-bar title rename (TopBar dispatches this on double-click of the centred
  // item name) — renames whatever item is currently in preview.
  useEffect(() => {
    const onRenamePreview = (e: Event) => {
      const title = (e as CustomEvent<{ title?: string }>).detail?.title;
      const it = ctx.plan.items[ctx.previewItemIdx];
      if (title && it) void renameItem(it, title);
    };
    window.addEventListener("presentflow:rename-preview-item", onRenamePreview);
    return () => window.removeEventListener("presentflow:rename-preview-item", onRenamePreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.plan.items, ctx.previewItemIdx]);

  const remove = async (it: OperatorShellCtx["plan"]["items"][number]) => {
    if (!it.id) return;
    if (blockedIfOffline()) return;
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
    const to = idx + dir;
    const newOrder = items.map((it) => it.id).filter(Boolean) as string[];
    if (to < 0 || to >= newOrder.length) return;
    if (blockedIfOffline()) return; // reorder needs the server — block honestly offline
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
    if (blockedIfOffline()) return;
    const res = await createSongSlide(it.songId, undefined, { objects: [], lyrics: "" });
    if (!res.ok) { toast.error(res.error ?? "Add slide failed"); return; }
    router.refresh();
    if (res.data) undoToast("Slide added", () => deleteSongSlide(res.data!.id));
  };

  // Paste the app-clipboard slide into a song item (appends its text as a new
  // lyric slide). Same path as Add slide, but seeded with the copied slide.
  const pasteSlideToItem = async (it: OperatorShellCtx["plan"]["items"][number]) => {
    if (it.type !== "song" || !it.songId) return;
    if (blockedIfOffline()) return;
    const copied = getSlideClipboard();
    if (!copied) { toast.error("Nothing to paste"); return; }
    const lyrics = copied.kind === "text" ? ((copied as { text?: string }).text ?? "") : "";
    const res = await createSongSlide(it.songId, undefined, { objects: [], lyrics });
    if (!res.ok) { toast.error(res.error ?? "Paste failed"); return; }
    router.refresh();
    if (res.data) undoToast(`Slide pasted into "${it.title}"`, () => deleteSongSlide(res.data!.id));
  };

  const duplicate = async (idx: number) => {
    const it = items[idx];
    if (!it) return;
    if (blockedIfOffline()) return;
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
    // Reorder is a server write; block honestly offline (consistent with every
    // other plan edit) rather than letting the drag silently fail.
    if (blockedIfOffline()) return;

    // Build the new order from item IDs for the server action.
    const reordered = arrayMove(items, oldIdx, newIdx);
    const newOrder = reordered.map((it) => it.id).filter(Boolean) as string[];
    handleResult(await reorderServiceItems(ctx.planId, newOrder));
  };

  // ── Item click (2026-08-15 directive: clicking a playlist item PREVIEWS it in
  // the center — it does NOT auto-project to live). To go live the operator
  // either right-clicks → "Send to live", or single-clicks a slide inside the
  // center panel. This reverses the 2026-07-25 click-to-project behaviour so an
  // accidental click can never change what the congregation sees. ────────────
  const handleItemClick = (it: OperatorShellCtx["plan"]["items"][number], idx: number) => {
    try {
      console.log("[click] playlist item (preview only)", { id: it.id, idx, type: it.type, title: it.title, slideCount: it.slides?.length ?? 0 });
    } catch { /* ignore */ }
    onCenterMode?.("slides");
    ctx.onSetPreviewItem(idx);
  };

  // ── Explicit "send to live" (right-click menu). Fires the item's first slide
  // to the projector — the deliberate operator action that click no longer does.
  const handleSendItemLive = (it: OperatorShellCtx["plan"]["items"][number], idx: number) => {
    onCenterMode?.("slides");
    ctx.onSetPreviewItem(idx);
    const first = it.slides?.[0];
    if (!first) {
      toast.info(`"${it.title}" has no slides yet — open it to add content.`);
      return;
    }
    try {
      ctx.onSendSlideToLive(first);
      toast.success(`"${it.title}" — slide 1 → LIVE`);
    } catch (e) {
      console.warn("[playlist] send-live failed", e);
      toast.error("Couldn't send slide live — check DevTools console.");
    }
  };

  // Project a SPECIFIC slide within an item (used by an expanded media group —
  // click a thumbnail to send that exact image live).
  const handleProjectSlideAt = (it: OperatorShellCtx["plan"]["items"][number], idx: number, sIdx: number) => {
    onCenterMode?.("slides");
    ctx.onSetPreviewItem(idx);
    const s = it.slides?.[sIdx];
    if (!s) return;
    try {
      ctx.onSendSlideToLive(s);
      toast.success(`"${it.title}" — slide ${sIdx + 1} → LIVE`);
    } catch (e) {
      console.warn("[playlist] send-slide failed", e);
      toast.error("Couldn't send slide live — check DevTools console.");
    }
  };

  // ── Cross-panel drop (native HTML5 drag from SongsBrowser / MediaBrowser) ──
  // dnd-kit handles internal sort reorder via its own events; these native
  // handlers handle drops originating from outside the playlist panel.
  const handleExternalDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDropOver(false);
    // Multi-select media group takes precedence: dropping a selection of images
    // creates ONE collapsible playlist group.
    const rawGroup = e.dataTransfer.getData("application/x-pf-library-items");
    if (rawGroup) {
      let g: { pfType?: string; items?: { id?: string; title?: string }[] };
      try { g = JSON.parse(rawGroup); } catch { g = {}; }
      const ids = Array.isArray(g.items) ? g.items.map((x) => x.id).filter((x): x is string => typeof x === "string") : [];
      if (g.pfType === "media-group" && ids.length > 0) {
        if (!ctx.onAddMediaGroup) { toast.info("Open a service plan first to add items"); return; }
        await ctx.onAddMediaGroup(`Images (${ids.length})`, ids);
        return;
      }
    }
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
      <header className="flex items-center h-8 px-2.5 gap-1 bg-[linear-gradient(180deg,var(--color-panel),transparent)]">
        <button
          type="button"
          className="flex items-center gap-1 shrink-0 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="eyebrow">Playlist</span>
          <span className="ml-1.5 min-w-[16px] h-[15px] px-1 grid place-items-center rounded-full bg-[var(--color-brand)]/16 text-[var(--color-brand)] text-[9px] font-mono font-bold tabular-nums">{items.length}</span>
        </button>
        <span className="h-px flex-1 mx-2" style={{ background: "linear-gradient(90deg, var(--color-border), transparent)" }} aria-hidden />

        {/* Add popover */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="w-[22px] h-[22px] grid place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[var(--color-muted-foreground)] transition-[transform,box-shadow,color,border-color] duration-200 [transition-timing-function:var(--ease-spring)] hover:-translate-y-px hover:text-[var(--color-brand)] hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))] active:translate-y-0 active:scale-95"
              title="Add item"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.4} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="start"
              className="rounded-xl bg-[var(--color-elevated)] border border-[var(--color-border)] p-1.5 text-[12.5px] shadow-[var(--edge-top),var(--shadow-lg)] z-50 min-w-[152px]"
            >
              <button className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg font-medium transition-colors hover:bg-[var(--color-brand)]/12 hover:text-[var(--color-brand)]" onClick={() => onCenterMode?.("songs")}><Music className="w-3.5 h-3.5 shrink-0 opacity-70" />From Songs</button>
              <button className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg font-medium transition-colors hover:bg-[var(--color-brand)]/12 hover:text-[var(--color-brand)]" onClick={() => onCenterMode?.("bible")}><BookOpen className="w-3.5 h-3.5 shrink-0 opacity-70" />From Bible</button>
              <button className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg font-medium transition-colors hover:bg-[var(--color-brand)]/12 hover:text-[var(--color-brand)]" onClick={() => onCenterMode?.("media")}><ImageIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />From Media</button>
              <div className="my-1 h-px bg-[var(--color-border)]" />
              <button className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg font-medium transition-colors hover:bg-[var(--color-brand)]/10" onClick={addBlank}><Square className="w-3.5 h-3.5 shrink-0 opacity-70" />Blank</button>
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
        <>
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
                  onSendLive={() => handleSendItemLive(it, idx)}
                  onProjectSlide={(sIdx) => handleProjectSlideAt(it, idx, sIdx)}
                  onRemove={() => void remove(it)}
                  onMove={(dir) => void move(idx, dir)}
                  onDuplicate={() => void duplicate(idx)}
                  onAddSlide={it.type === "song" && it.songId ? () => void addSlideToItem(it) : undefined}
                  onPasteSlide={it.type === "song" && it.songId ? () => void pasteSlideToItem(it) : undefined}
                  canPasteSlide={!!clipboardSlide && it.type === "song" && !!it.songId}
                  onDeleteSong={it.type === "song" && it.songId ? () => void deleteFromLibrary(it) : undefined}
                  onRename={(it.type === "song" && it.songId) || it.id ? (newTitle) => void renameItem(it, newTitle) : undefined}
                  onDropSlide={it.type === "song" && it.songId ? (json) => void appendDroppedSlide(it, json) : undefined}
                  onReorderGroup={it.type === "media" ? (newOrder) => ctx.onReorderSlidesInItem?.(idx, newOrder) : undefined}
                  onRenameMedia={it.type === "media" ? (assetId, name) => void renameGroupImage(assetId, name) : undefined}
                  themes={themes}
                  currentThemeId={(it as { themeId?: string }).themeId ?? null}
                  onSetTheme={it.id ? (themeId) => void setTheme(it.id!, themeId) : undefined}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        {/* The playlist "New slide" button was removed 2026-08-19 (user directive);
            new slides are added from the center header's "Add slide", and the
            "+" popover above still offers Blank / From Songs / Bible / Media. */}
        </>
      )}
    </section>
  );
}
