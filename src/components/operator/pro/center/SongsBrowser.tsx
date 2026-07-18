"use client";
/**
 * Inline songs library — center-mode "songs".
 * Left: searchable song list. Right: preview slides for the selected song.
 * Single click = select (loads preview). Double click = add to playlist &
 * jump to slides mode. "Send first to live" button honors nothing extra —
 * onSendSlideToLive is the operator's opt-in.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { createSong, createSongSlide } from "@/lib/actions";

type SongRow = { id: string; title: string; artist: string | null };
type SlideRow = { lyrics: string };

export function SongsBrowser({
  ctx,
  onExitToSlides,
}: {
  ctx: OperatorShellCtx;
  onExitToSlides: () => void;
}) {
  const [songs, setSongs] = useState<SongRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SongRow | null>(null);
  const [slides, setSlides] = useState<SlideRow[] | null>(null);
  const [slidesLoading, setSlidesLoading] = useState(false);
  // Shared slide-size preference — same event/localStorage key the CenterHeader
  // and BottomBar use so a single slider works everywhere.
  const [slideSize, setSlideSize] = useState(280);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("presentflow.center.slideSize");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 120 && n <= 480) setSlideSize(n);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      if (typeof d === "number" && d >= 120 && d <= 480) setSlideSize(d);
    };
    window.addEventListener("presentflow:center-slide-size", handler);
    return () => window.removeEventListener("presentflow:center-slide-size", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/songs/list")
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setSongs(data.songs || []); })
      .catch(() => { if (!cancelled) toast.error("Failed to load songs"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selected) { setSlides(null); return; }
    let cancelled = false;
    setSlidesLoading(true);
    fetch(`/api/songs/${selected.id}/slides`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setSlides(data.slides || []); })
      .catch(() => { if (!cancelled) toast.error("Failed to load slides"); })
      .finally(() => { if (!cancelled) setSlidesLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) =>
      s.title.toLowerCase().includes(q) || (s.artist || "").toLowerCase().includes(q));
  }, [songs, query]);

  const addToPlaylist = async (s: SongRow) => {
    if (!ctx.onAddLibraryItem) { toast.info("Playlist add not available in this view"); return; }
    await ctx.onAddLibraryItem("song", { id: s.id, title: s.title });
    onExitToSlides();
  };

  return (
    <div className="p-4 grid gap-3 h-full" style={{ gridTemplateColumns: "minmax(280px, 360px) 1fr" }}>
      {/* Song list */}
      <div className="flex flex-col border border-[var(--color-border)] rounded-md overflow-hidden">
        <div className="p-2 border-b border-[var(--color-border)] flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={loading ? "Loading songs…" : `Search ${songs.length} songs…`}
            className="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-3 h-8 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <AddSongDialog onCreated={(row) => {
            // Optimistic: prepend to local list so the operator sees it
            // instantly, then select it so the preview panel opens the
            // (still-empty) slide editor path.
            setSongs((cur) => [{ id: row.id, title: row.title, artist: row.artist }, ...cur]);
            setSelected({ id: row.id, title: row.title, artist: row.artist });
          }} />
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 && !loading && (
            <li className="p-3 text-[12px] text-[var(--color-muted-foreground)]">No songs found.</li>
          )}
          {filtered.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setSelected(s)}
                onDoubleClick={() => void addToPlaylist(s)}
                className={cn(
                  "w-full text-left px-3 py-2 border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)]",
                  selected?.id === s.id && "bg-[var(--color-elevated)]",
                )}
              >
                <div className="text-[13px] text-[var(--color-foreground)] truncate">{s.title}</div>
                {s.artist && <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">{s.artist}</div>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Preview column */}
      <div className="flex flex-col border border-[var(--color-border)] rounded-md overflow-hidden">
        <div className="p-2 border-b border-[var(--color-border)] flex items-center gap-2">
          <div className="flex-1 text-[13px] font-medium truncate">
            {selected ? selected.title : "Select a song to preview"}
          </div>
          {selected && (
            <button
              onClick={() => void addToPlaylist(selected)}
              className="h-8 px-3 rounded-md bg-[var(--color-brand)] text-black text-[12px] font-semibold"
            >
              Add to playlist
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {slidesLoading && <div className="text-[11px] text-[var(--color-muted-foreground)]">Loading slides…</div>}
          {slides && slides.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="text-[12px] text-[var(--color-muted-foreground)]">No slides yet for this song.</div>
              {selected && (
                <AddLyricSlide
                  songId={selected.id}
                  onAdded={() => {
                    // refresh preview slides
                    fetch(`/api/songs/${selected.id}/slides`)
                      .then((r) => r.json())
                      .then((data) => setSlides(data.slides || []))
                      .catch(() => { /* silent — retry on next select */ });
                  }}
                />
              )}
            </div>
          )}
          {slides && slides.length > 0 && (
            // Match the Bible verse-card grid density: 280px minmax + slightly
            // larger gap so lyrics don't feel cramped next to Bible cards.
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${slideSize}px, 1fr))` }}>
              {slides.map((sl, idx) => {
                const payload: SlidePayload = { kind: "text", text: sl.lyrics };
                return (
                  <button
                    key={idx}
                    // Operator-directive: single-click sends to live. This is
                    // a MANUAL operator click — copyright rule 7 (songs never
                    // AUTO-project) applies to AI/autopilot only. Direct
                    // operator intent is trusted.
                    onClick={() => ctx.onSendSlideToLive(payload)}
                    className="relative aspect-video rounded overflow-hidden border-2 border-[var(--color-border)] hover:border-[var(--color-brand)] transition-colors"
                    title="Click to send lyric slide to live"
                  >
                    <SlideRenderer slide={payload} />
                    <div className="absolute top-1 left-1 text-[10px] font-mono text-white/70 bg-black/40 px-1.5 py-0.5 rounded">
                      {idx + 1}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddSongDialog({ onCreated }: { onCreated: (row: SongRow) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    const t = title.trim();
    if (!t) { toast.error("Song title required"); return; }
    if (t.length > 200) { toast.error("Title too long (max 200 chars)"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("title", t);
      if (artist.trim()) fd.set("artist", artist.trim().slice(0, 120));
      const res = await createSong(fd);
      if (!res.ok) { toast.error(res.error); return; }
      onCreated({ id: res.data!.id, title: t, artist: artist.trim() || null });
      toast.success(`"${t}" created — add lyric slides on the right`);
      setTitle(""); setArtist(""); setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          title="Add new song"
          className="h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-brand)] text-black flex items-center gap-1 text-[11px] font-semibold hover:opacity-90"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4 flex flex-col gap-3">
          <Dialog.Title className="text-sm font-semibold">New song</Dialog.Title>
          <label className="text-[11px] flex flex-col gap-1">
            Title
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              maxLength={200}
              placeholder="Amazing Grace"
              className="h-9 px-3 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-sm"
            />
          </label>
          <label className="text-[11px] flex flex-col gap-1">
            Artist / author (optional)
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              maxLength={120}
              placeholder="John Newton"
              className="h-9 px-3 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-sm"
            />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <Dialog.Close asChild>
              <button className="h-8 px-3 rounded border border-[var(--color-border)] text-[12px]">Cancel</button>
            </Dialog.Close>
            <button
              onClick={save}
              disabled={busy || !title.trim()}
              className="h-8 px-3 rounded bg-[var(--color-brand)] text-black text-[12px] font-semibold disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create song"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AddLyricSlide({ songId, onAdded }: { songId: string; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    const t = text.trim();
    if (!t) { toast.error("Enter lyrics for the slide"); return; }
    if (t.length > 5000) { toast.error("Slide text too long (max 5000 chars)"); return; }
    setBusy(true);
    try {
      const res = await createSongSlide(songId, undefined, { objects: [], lyrics: t });
      if (!res.ok) { toast.error(res.error); return; }
      setText("");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add slide failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-full max-w-md flex flex-col gap-2 items-stretch">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Amazing grace, how sweet the sound\nThat saved a wretch like me…"}
        rows={4}
        maxLength={5000}
        className="w-full px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-sm resize-none"
      />
      <button
        onClick={save}
        disabled={busy || !text.trim()}
        className="h-8 px-3 rounded bg-[var(--color-brand)] text-black text-[12px] font-semibold self-end disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add lyric slide"}
      </button>
    </div>
  );
}
