"use client";
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { ChevronDown, ChevronRight, Plus, Music, BookOpen, Image as ImageIcon, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import { addServiceItem, removeServiceItem, reorderServiceItems } from "@/lib/actions";

function itemIcon(type: string) {
  if (type === "song") return Music;
  if (type === "scripture" || type === "bible") return BookOpen;
  if (type === "media" || type === "video") return ImageIcon;
  return Square;
}

export function PlaylistSection({
  ctx, onCenterMode,
}: {
  ctx: OperatorShellCtx;
  onCenterMode?: (m: "slides" | "bible" | "songs" | "media") => void;
}) {
  const [open, setOpen] = useState(true);
  const items = ctx.plan.items;

  const addBlank = async () => {
    try { await addServiceItem(ctx.planId, "blank", "Blank", {}); } catch { /* noop */ }
  };

  const remove = async (id: string) => {
    try { await removeServiceItem(id); } catch { /* noop */ }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const newOrder = items.map((it) => it.id).filter(Boolean) as string[];
    const to = idx + dir;
    if (to < 0 || to >= newOrder.length) return;
    [newOrder[idx], newOrder[to]] = [newOrder[to], newOrder[idx]];
    try { await reorderServiceItems(ctx.planId, newOrder); } catch { /* noop */ }
  };

  const duplicate = async (idx: number) => {
    const it = items[idx];
    if (!it) return;
    try {
      // Best-effort duplicate: create a new item with same type/title/payload.
      const t = (it.type ?? "blank") as "song" | "scripture" | "media" | "sermon" | "blank" | "logo";
      await addServiceItem(ctx.planId, t, `${it.title} (copy)`, (it as unknown as { payload?: Record<string, unknown> }).payload ?? {});
    } catch { /* noop */ }
  };

  return (
    <section className="border-b border-[var(--color-border)] flex-1 min-h-0 flex flex-col">
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
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]"
              title="Add"
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
      {open && (
        <ol className="flex-1 min-h-0 overflow-y-auto pb-1">
          {items.length === 0 && (
            <li className="px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">
              No items yet.
            </li>
          )}
          {items.map((it, idx) => {
            const Icon = itemIcon(it.type);
            const active = idx === ctx.previewItemIdx;
            return (
              <li key={it.id ?? idx}>
                <ContextMenu.Root>
                  <ContextMenu.Trigger asChild>
                    <button
                      type="button"
                      onClick={() => ctx.onSetPreviewItem(idx)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors",
                        active
                          ? "border-l-2 border-[var(--color-brand)] bg-[var(--color-elevated)] text-[var(--color-foreground)]"
                          : "border-l-2 border-transparent text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-foreground)]",
                      )}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{it.title}</span>
                      <span className="ml-auto text-[10px] opacity-60">{it.slides.length}</span>
                    </button>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[140px]">
                      <ContextMenu.Item
                        onSelect={() => it.id && remove(it.id)}
                        className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer text-[var(--color-destructive)]"
                      >
                        Remove
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        onSelect={() => move(idx, -1)}
                        disabled={idx === 0}
                        className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer data-[disabled]:opacity-50"
                      >
                        Move Up
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        onSelect={() => move(idx, 1)}
                        disabled={idx === items.length - 1}
                        className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer data-[disabled]:opacity-50"
                      >
                        Move Down
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        onSelect={() => duplicate(idx)}
                        className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
                      >
                        Duplicate
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
