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
import { Music, BookOpen, Image as ImageIcon, ListOrdered, Quote, Search } from "lucide-react";
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
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        {/* 2026-07-30 fix — transform-based centering (`left-1/2 -translate-x-1/2`)
            was being overridden by Radix Dialog's own data-state transform,
            leaving the palette anchored at left:50% with no translateX and
            falling off the right of the viewport. Switched to inset-x-0
            + mx-auto: no transform involved, works with any ancestor. */}
        <Dialog.Content className="fixed inset-x-0 mx-auto top-24 w-[560px] max-w-[92vw] bg-[linear-gradient(180deg,var(--color-card)_0%,var(--color-panel)_100%)] border border-[var(--color-border)] rounded-2xl z-50 shadow-[var(--edge-top),var(--shadow-xl)] overflow-hidden">
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Command className="flex flex-col max-h-[420px]">
            <div className="relative flex items-center border-b-2 border-[var(--color-brand)] bg-[var(--color-elevated)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)]">
              <Search className="absolute left-4 w-[18px] h-[18px] text-[var(--color-muted-foreground)] pointer-events-none" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search songs, Bible verses, media, playlist…"
                className="h-14 w-full pl-12 pr-4 bg-transparent outline-none text-[15px] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]"
              />
            </div>
            <Command.List className="flex-1 min-h-0 overflow-y-auto p-1.5 text-[13px]">
              <Command.Empty className="px-4 py-6 text-center text-[var(--color-muted-foreground)]">
                No results.
              </Command.Empty>

              <Command.Group heading={<span className="eyebrow">Playlist</span>} className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5">
                {ctx.plan.items.map((it, idx) => (
                  <Command.Item
                    key={it.id ?? idx}
                    value={`playlist ${it.title}`}
                    onSelect={() => { ctx.onSetPreviewItem(idx); onOpenChange(false); }}
                    className="px-3 py-2.5 rounded-lg flex items-center gap-3 cursor-pointer text-[var(--color-foreground)] border-l-[3px] border-transparent transition-all duration-150 [transition-timing-function:var(--ease-house)] data-[selected=true]:bg-[var(--color-elevated)] data-[selected=true]:border-[var(--color-brand)] data-[selected=true]:shadow-[var(--edge-top),var(--shadow-sm)]"
                  >
                    <ListOrdered className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" />
                    <span className="truncate">{it.title}</span>
                    <span className="ml-auto text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shrink-0">{it.type}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading={<span className="eyebrow">Bible</span>} className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5">
                {COMMON_REFS.map((ref) => (
                  <Command.Item
                    key={ref}
                    value={`bible ${ref}`}
                    onSelect={() => { onCenterMode("bible"); onOpenChange(false); }}
                    className="px-3 py-2.5 rounded-lg flex items-center gap-3 cursor-pointer text-[var(--color-foreground)] border-l-[3px] border-transparent transition-all duration-150 [transition-timing-function:var(--ease-house)] data-[selected=true]:bg-[var(--color-elevated)] data-[selected=true]:border-[var(--color-brand)] data-[selected=true]:shadow-[var(--edge-top),var(--shadow-sm)]"
                  >
                    <BookOpen className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" />
                    {ref}
                  </Command.Item>
                ))}
              </Command.Group>

              {phraseHits.length > 0 && (
                <Command.Group heading={<span className="eyebrow">Bible Phrases</span>} className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5">
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
                      className="px-3 py-2.5 rounded-lg flex items-center gap-3 cursor-pointer text-[var(--color-foreground)] border-l-[3px] border-transparent transition-all duration-150 [transition-timing-function:var(--ease-house)] data-[selected=true]:bg-[var(--color-elevated)] data-[selected=true]:border-[var(--color-brand)] data-[selected=true]:shadow-[var(--edge-top),var(--shadow-sm)]"
                    >
                      <Quote className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" />
                      <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shrink-0">
                        {h.entry.reference}
                      </span>
                      <span className="truncate">{h.entry.phrase}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {songs.length > 0 && (
                <Command.Group heading={<span className="eyebrow">Songs</span>} className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5">
                  {songs.slice(0, 20).map((s) => (
                    <Command.Item
                      key={s.id}
                      value={`song ${s.title} ${s.artist ?? ""}`}
                      onSelect={() => { onCenterMode("songs"); onOpenChange(false); }}
                      className="px-3 py-2.5 rounded-lg flex items-center gap-3 cursor-pointer text-[var(--color-foreground)] border-l-[3px] border-transparent transition-all duration-150 [transition-timing-function:var(--ease-house)] data-[selected=true]:bg-[var(--color-elevated)] data-[selected=true]:border-[var(--color-brand)] data-[selected=true]:shadow-[var(--edge-top),var(--shadow-sm)]"
                    >
                      <Music className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" />
                      <span className="truncate">{s.title}</span>
                      {s.artist && <span className="ml-auto text-[11px] text-[var(--color-muted-foreground)] truncate shrink-0 max-w-[40%]">{s.artist}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {media.length > 0 && (
                <Command.Group heading={<span className="eyebrow">Media</span>} className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5">
                  {media.slice(0, 20).map((m) => {
                    const name = m.fileName || m.name || m.id;
                    return (
                      <Command.Item
                        key={m.id}
                        value={`media ${name}`}
                        onSelect={() => { onCenterMode("media"); onOpenChange(false); }}
                        className="px-3 py-2.5 rounded-lg flex items-center gap-3 cursor-pointer text-[var(--color-foreground)] border-l-[3px] border-transparent transition-all duration-150 [transition-timing-function:var(--ease-house)] data-[selected=true]:bg-[var(--color-elevated)] data-[selected=true]:border-[var(--color-brand)] data-[selected=true]:shadow-[var(--edge-top),var(--shadow-sm)]"
                      >
                        <ImageIcon className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" />
                        <span className="truncate">{name}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}
            </Command.List>
            <div className="h-10 px-4 flex items-center justify-between text-[11px] text-[var(--color-muted-foreground)] border-t border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top)]">
              <span className="flex items-center gap-1.5">
                <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-[var(--shadow-sm)]">⌘K</kbd>
                to toggle
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-[var(--shadow-sm)]">Esc</kbd>
                to close
              </span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
