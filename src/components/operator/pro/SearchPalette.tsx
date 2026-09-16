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
import { modKeyLabel } from "@/lib/platform";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Music, BookOpen, Image as ImageIcon, ListOrdered, Quote, Search } from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import type { CenterMode } from "./ProOperatorShell";
import { phraseSearch } from "@/services/bible/phraseSearch";
import { dispatchInternal } from "@/lib/internal-events";
import { defaultFilter } from "cmdk";
import { parseTypedReference } from "@/lib/bible-parser";
import { requestSongOpen } from "@/lib/song-selection";
import { useSongLyricSearch } from "@/lib/song-lyric-search-store";
import {
  createBiblePaletteSearcher,
  fastPathShownKeys,
  dedupeAgainstShown,
  isConfirmedBibleReference,
  refKey,
  type BiblePaletteHit,
} from "@/lib/bible-palette-search";

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

  const [bibleHits, setBibleHits] = useState<BiblePaletteHit[]>([]);
  const [bibleSearching, setBibleSearching] = useState(false);
  // Review fix 🔴4: a rate-limited/failed Bible search is NOT "no verses found".
  const [bibleBusy, setBibleBusy] = useState(false);

  // ONE predicate gates BOTH the Bible/phrase group and the lyric group
  // (2026-09-16 symmetry fix). It used to be asymmetric: the loose REF_SHAPE
  // regex suppressed Bible/phrase results while lyrics were only suppressed on
  // a PARSER-CONFIRMED reference — so "bless the lord 10000 reasons" lost its
  // Bible group for no reason. Now a real reference ("John 3:16") suppresses
  // lyrics exactly as before, and a digit-bearing lyric keeps both groups.
  const looksLikeBibleRef = useMemo(() => isConfirmedBibleReference(query), [query]);

  const phraseHits = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    if (looksLikeBibleRef) return [];
    return phraseSearch(q).slice(0, 5);
  }, [query, looksLikeBibleRef]);

  // Real Bible verse search (hybrid FTS ⊕ pgvector) — debounced, min 3 chars,
  // aborted when superseded, cached per session. See bible-palette-search.ts
  // for the rate-limit contract (shared 20/min bucket with BibleMode).
  const searcherRef = useRef<ReturnType<typeof createBiblePaletteSearcher> | null>(null);
  if (!searcherRef.current) {
    searcherRef.current = createBiblePaletteSearcher({
      onResults: (_q, hits, status) => { setBibleHits(hits); setBibleBusy(status === "busy"); },
      onPending: setBibleSearching,
    });
  }
  useEffect(() => {
    // Only runs while the palette is OPEN — nothing is added to the operator's
    // audio/detection loop.
    if (!open) { searcherRef.current?.cancel(); setBibleHits([]); setBibleBusy(false); return; }
    searcherRef.current?.search(query);
  }, [open, query]);
  useEffect(() => () => { searcherRef.current?.cancel(); }, []);

  // Never show the same reference twice: the fast path (COMMON_REFS + curated
  // phrase corpus) wins, the server group fills in what it didn't have.
  // A common ref only suppresses a server hit when its own item is actually
  // VISIBLE under cmdk's filter — see fastPathShownKeys (review fix 🟡2).
  const shownRefKeys = useMemo(
    () => fastPathShownKeys(
      query,
      COMMON_REFS,
      phraseHits.map((h) => refKey({ book: h.entry.book, chapter: h.entry.chapter, verse: h.entry.verse })),
      (value, search) => defaultFilter!(value, search, []),
    ),
    [query, phraseHits],
  );
  const bibleVerseHits = useMemo(
    () => dedupeAgainstShown(bibleHits, shownRefKeys),
    [bibleHits, shownRefKeys],
  );

  // Lyric search over the shared song library (built lazily on first keystroke).
  // Needs ≥2 words so a single typed word stays a quick title/playlist lookup.
  const lyricEnabled = open && query.trim().split(/\s+/).filter(Boolean).length >= 2 && !looksLikeBibleRef;
  const { hits: lyricHits, indexing: lyricIndexing } = useSongLyricSearch(query, lyricEnabled, 8);

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
              {/* Review fix 🟡1: the Bible Verses group is forceMounted, and
                  forceMounted items don't increment cmdk's filtered.count — so
                  Command.Empty rendered "No results." directly ABOVE five listed
                  verses. Gate it on that group being empty too. Any future
                  forceMounted group must be added here. */}
              {bibleVerseHits.length === 0 && (
                <Command.Empty className="px-4 py-6 text-center text-[var(--color-muted-foreground)]">
                  No results.
                </Command.Empty>
              )}

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
                    onSelect={() => {
                      onCenterMode("bible");
                      // J1: actually LOAD the picked reference into the Bible preview
                      // (was only switching mode → landed on a stale grid). Parse the
                      // typed ref and fire the same event the phrase results use.
                      const parsed = parseTypedReference(ref)[0];
                      if (parsed) {
                        dispatchInternal("presentflow:bible-goto", {
                          book: parsed.book,
                          chapter: parsed.chapter,
                          verseStart: parsed.verseStart,
                          verseEnd: parsed.verseEnd,
                          live: false,
                        });
                      }
                      onOpenChange(false);
                    }}
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
                      onSelect={() => {
                        onCenterMode("songs");
                        // Open the picked song. The event is caught by the ALWAYS-mounted
                        // ProOperatorShell (like the Bible path), which stores it and passes
                        // it to SongsBrowser as a prop — so it survives the mount race of
                        // switching INTO songs mode (the in-panel listener couldn't).
                        requestSongOpen({ id: s.id, title: s.title, artist: s.artist ?? null });
                        onOpenChange(false);
                      }}
                      className="px-3 py-2.5 rounded-lg flex items-center gap-3 cursor-pointer text-[var(--color-foreground)] border-l-[3px] border-transparent transition-all duration-150 [transition-timing-function:var(--ease-house)] data-[selected=true]:bg-[var(--color-elevated)] data-[selected=true]:border-[var(--color-brand)] data-[selected=true]:shadow-[var(--edge-top),var(--shadow-sm)]"
                    >
                      <Music className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" />
                      <span className="truncate">{s.title}</span>
                      {s.artist && <span className="ml-auto text-[11px] text-[var(--color-muted-foreground)] truncate shrink-0 max-w-[40%]">{s.artist}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {lyricIndexing && lyricHits.length === 0 && (
                <div className="px-4 py-2 text-[11px] italic text-[var(--color-muted-foreground)]">Indexing lyrics…</div>
              )}
              {lyricHits.length > 0 && (
                <Command.Group heading={<span className="eyebrow">Lyrics</span>} className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5">
                  {lyricHits.map((h) => (
                    <Command.Item
                      key={`lyric-${h.songId}`}
                      // Include the typed query so cmdk's own filter never hides a
                      // lyric hit whose line doesn't literally contain the words (typos).
                      value={`lyrics ${query} ${h.songId}`}
                      onSelect={() => {
                        onCenterMode("songs");
                        requestSongOpen({ id: h.songId, title: h.title, artist: h.artist, slideOrder: h.slideOrder >= 0 ? h.slideOrder : undefined });
                        onOpenChange(false);
                      }}
                      className="px-3 py-2.5 rounded-lg flex items-center gap-3 cursor-pointer text-[var(--color-foreground)] border-l-[3px] border-transparent transition-all duration-150 [transition-timing-function:var(--ease-house)] data-[selected=true]:bg-[var(--color-elevated)] data-[selected=true]:border-[var(--color-brand)] data-[selected=true]:shadow-[var(--edge-top),var(--shadow-sm)]"
                    >
                      <Quote className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" />
                      <span className="min-w-0 flex flex-col">
                        <span className="truncate">{h.title}</span>
                        {h.matchedLine && (
                          <span className="truncate text-[11px] italic text-[var(--color-muted-foreground)]">
                            “{h.matchedLine.length > 80 ? `${h.matchedLine.slice(0, 80)}…` : h.matchedLine}”
                          </span>
                        )}
                      </span>
                      {h.slideOrder >= 0 && (
                        <span className="ml-auto text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shrink-0">
                          slide {h.slideOrder + 1}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {bibleSearching && bibleVerseHits.length === 0 && !bibleBusy && (
                <div className="px-4 py-2 text-[11px] italic text-[var(--color-muted-foreground)]">Searching the Bible…</div>
              )}
              {bibleBusy && bibleVerseHits.length === 0 && (
                <div className="px-4 py-2 text-[11px] italic text-[var(--color-muted-foreground)]">Bible search is busy — try again in a moment</div>
              )}
              {bibleVerseHits.length > 0 && (
                <Command.Group forceMount heading={<span className="eyebrow">Bible Verses</span>} className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5">
                  {bibleVerseHits.map((h) => (
                    <Command.Item
                      key={`verse-${h.book}-${h.chapter}-${h.verse}`}
                      forceMount
                      // Review fix 🔴1 (2026-09-16). This value used to inject the
                      // RAW QUERY (`verse ${query} …`) purely so cmdk's filter
                      // couldn't hide a semantic hit whose text doesn't contain the
                      // typed words. Side effect: every verse item then scored
                      // ~0.891 against ANY query — beating the song it was meant to
                      // sit under ("way maker" → song 0.890822), and because cmdk
                      // sorts GROUPS by their max item score, the Bible group jumped
                      // above Songs and Enter loaded Proverbs 30:19 instead of the
                      // song. `forceMount` gets the same "never filtered out"
                      // guarantee WITHOUT manufacturing a score, so these
                      // server-ranked hits sit below Songs/Lyrics (which is also
                      // their DOM order now) and only win when nothing else matches.
                      value={`verse ${h.book} ${h.chapter}:${h.verse}`}
                      onSelect={() => {
                        onCenterMode("bible");
                        // Same as the existing Bible entries: LOAD into preview,
                        // never project.
                        dispatchInternal("presentflow:bible-goto", {
                          book: h.book,
                          chapter: h.chapter,
                          verseStart: h.verse,
                          verseEnd: h.verse,
                          live: false,
                        });
                        onOpenChange(false);
                      }}
                      className="px-3 py-2.5 rounded-lg flex items-center gap-3 cursor-pointer text-[var(--color-foreground)] border-l-[3px] border-transparent transition-all duration-150 [transition-timing-function:var(--ease-house)] data-[selected=true]:bg-[var(--color-elevated)] data-[selected=true]:border-[var(--color-brand)] data-[selected=true]:shadow-[var(--edge-top),var(--shadow-sm)]"
                    >
                      <BookOpen className="w-4 h-4 shrink-0 text-[var(--color-muted-foreground)]" />
                      <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shrink-0">
                        {h.book} {h.chapter}:{h.verse}
                      </span>
                      <span className="truncate text-[var(--color-muted-foreground)]">
                        {h.text.length > 90 ? `${h.text.slice(0, 90)}…` : h.text}
                      </span>
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
                <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-[var(--shadow-sm)]">{modKeyLabel()}K</kbd>
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
