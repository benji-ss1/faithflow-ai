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
import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Music, BookOpen, Image as ImageIcon, ListOrdered, Quote } from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import type { CenterMode } from "./ProOperatorShell";
import { phraseSearch } from "@/services/bible/phraseSearch";
import { dispatchInternal } from "@/lib/internal-events";

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
  const [query, setQuery] = useState("");

  // Reference-shaped queries win over phrase results (mirrors COMMON_REFS
  // matching path). Skip phrase section for those to avoid noise.
  const REF_SHAPE = /\b(?:[1-3]\s*)?[a-z]{3,}\s*\d+(?::\d+(?:\s*-\s*\d+)?)?\b/i;
  const phraseHits = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    if (REF_SHAPE.test(q)) return [];
    return phraseSearch(q).slice(0, 5);
  }, [query]);

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
        {/* 2026-07-30 fix — transform-based centering (`left-1/2 -translate-x-1/2`)
            was being overridden by Radix Dialog's own data-state transform,
            leaving the palette anchored at left:50% with no translateX and
            falling off the right of the viewport. Switched to inset-x-0
            + mx-auto: no transform involved, works with any ancestor. */}
        <Dialog.Content className="fixed inset-x-0 mx-auto top-24 w-[560px] max-w-[92vw] bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg z-50 shadow-2xl overflow-hidden">
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Command className="flex flex-col max-h-[420px]">
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
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

              {phraseHits.length > 0 && (
                <Command.Group heading="Bible Phrases" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-muted-foreground)]">
                  {phraseHits.map((h) => (
                    <Command.Item
                      key={h.entry.id}
                      value={`phrase ${h.entry.reference} ${h.entry.phrase}`}
                      onSelect={() => {
                        onCenterMode("bible");
                        // Review fix (A-2, 2026-07-29): actually LOAD the selected
                        // phrase's verse — landing in Bible mode with nothing
                        // loaded was a bait-and-switch.
                        dispatchInternal("presentflow:bible-goto", {
                          book: h.entry.book,
                          chapter: h.entry.chapter,
                          verseStart: h.entry.verse,
                          verseEnd: h.entry.verseEnd ?? h.entry.verse,
                          live: false,
                        });
                        onOpenChange(false);
                      }}
                      className="px-3 py-2 rounded flex items-center gap-2 cursor-pointer data-[selected=true]:bg-[var(--color-elevated)]"
                    >
                      <Quote className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-muted-foreground)] shrink-0">
                        {h.entry.reference}
                      </span>
                      <span className="truncate">{h.entry.phrase}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

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
