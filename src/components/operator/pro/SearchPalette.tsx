"use client";
/**
 * Global Cmd+K search palette.
 *
 * Sections:
 *   - Songs    → fetched from `/api/songs/list` (best-effort; empty if absent)
 *   - Bible    → hard-coded common references (John 3:16 etc.)
 *   - Media    → fetched from `/api/media/list`
 *   - Playlist → the current plan's items
 *
 * Selecting a Songs/Bible/Media result switches the center mode so the
 * user can locate the item. Selecting a Playlist entry jumps preview to it.
 */
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Music, BookOpen, Image as ImageIcon, ListOrdered } from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import type { CenterMode } from "./ProOperatorShell";

type SongLite = { id: string; title: string; artist?: string | null };
type MediaLite = { id: string; fileName?: string; name?: string };

const COMMON_REFS = [
  "John 3:16", "Psalm 23", "Romans 8:28", "Philippians 4:13",
  "Jeremiah 29:11", "Isaiah 40:31", "Matthew 6:33", "Proverbs 3:5-6",
];

export function SearchPalette({
  open, onOpenChange, ctx, onCenterMode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: OperatorShellCtx;
  onCenterMode: (m: CenterMode) => void;
}) {
  const [songs, setSongs] = useState<SongLite[]>([]);
  const [media, setMedia] = useState<MediaLite[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const r = await fetch("/api/songs/list");
        if (r.ok) {
          const j = await r.json();
          setSongs(Array.isArray(j) ? j : (j.items ?? j.songs ?? []));
        }
      } catch { /* noop */ }
      try {
        const r = await fetch("/api/media/list");
        if (r.ok) {
          const j = await r.json();
          setMedia(Array.isArray(j) ? j : (j.items ?? j.media ?? []));
        }
      } catch { /* noop */ }
    })();
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-24 -translate-x-1/2 w-[560px] max-w-[92vw] bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg z-50 shadow-2xl overflow-hidden">
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Command className="flex flex-col max-h-[420px]">
            <Command.Input
              autoFocus
              placeholder="Search songs, Bible verses, media, playlist…"
              className="h-11 px-3 bg-transparent border-b border-[var(--color-border)] outline-none text-[13px]"
            />
            <Command.List className="flex-1 min-h-0 overflow-y-auto p-1 text-[12px]">
              <Command.Empty className="px-3 py-4 text-[var(--color-muted-foreground)]">
                No results.
              </Command.Empty>

              <Command.Group heading="Playlist" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-muted-foreground)]">
                {ctx.plan.items.map((it, idx) => (
                  <Command.Item
                    key={it.id ?? idx}
                    value={`playlist ${it.title}`}
                    onSelect={() => { ctx.onSetPreviewItem(idx); onOpenChange(false); }}
                    className="px-3 py-2 rounded flex items-center gap-2 cursor-pointer data-[selected=true]:bg-[var(--color-elevated)]"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                    <span className="truncate">{it.title}</span>
                    <span className="ml-auto text-[10px] opacity-60">{it.type}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Bible" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-muted-foreground)]">
                {COMMON_REFS.map((ref) => (
                  <Command.Item
                    key={ref}
                    value={`bible ${ref}`}
                    onSelect={() => { onCenterMode("bible"); onOpenChange(false); }}
                    className="px-3 py-2 rounded flex items-center gap-2 cursor-pointer data-[selected=true]:bg-[var(--color-elevated)]"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    {ref}
                  </Command.Item>
                ))}
              </Command.Group>

              {songs.length > 0 && (
                <Command.Group heading="Songs" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-muted-foreground)]">
                  {songs.slice(0, 20).map((s) => (
                    <Command.Item
                      key={s.id}
                      value={`song ${s.title} ${s.artist ?? ""}`}
                      onSelect={() => { onCenterMode("songs"); onOpenChange(false); }}
                      className="px-3 py-2 rounded flex items-center gap-2 cursor-pointer data-[selected=true]:bg-[var(--color-elevated)]"
                    >
                      <Music className="w-3.5 h-3.5" />
                      <span className="truncate">{s.title}</span>
                      {s.artist && <span className="ml-auto text-[10px] opacity-60 truncate">{s.artist}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {media.length > 0 && (
                <Command.Group heading="Media" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-muted-foreground)]">
                  {media.slice(0, 20).map((m) => {
                    const name = m.fileName || m.name || m.id;
                    return (
                      <Command.Item
                        key={m.id}
                        value={`media ${name}`}
                        onSelect={() => { onCenterMode("media"); onOpenChange(false); }}
                        className="px-3 py-2 rounded flex items-center gap-2 cursor-pointer data-[selected=true]:bg-[var(--color-elevated)]"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span className="truncate">{name}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}
            </Command.List>
            <div className="h-7 px-3 flex items-center justify-between text-[10px] text-[var(--color-muted-foreground)] border-t border-[var(--color-border)]">
              <span>Cmd+K to toggle</span>
              <span>Esc to close</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
