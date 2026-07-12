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
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";

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
        <div className="p-2 border-b border-[var(--color-border)]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={loading ? "Loading songs…" : `Search ${songs.length} songs…`}
            className="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-3 h-8 text-sm outline-none focus:border-[var(--color-brand)]"
          />
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
            <div className="text-[11px] text-[var(--color-muted-foreground)]">No slides for this song.</div>
          )}
          {slides && slides.length > 0 && (
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
              {slides.map((sl, idx) => {
                const payload: SlidePayload = { kind: "text", text: sl.lyrics };
                return (
                  <button
                    key={idx}
                    onDoubleClick={() => ctx.onSendSlideToLive(payload)}
                    className="relative aspect-video rounded overflow-hidden border border-[var(--color-border)] hover:border-[var(--color-brand)]"
                    title="Double-click to send to live"
                  >
                    <SlideRenderer slide={payload} />
                    <div className="absolute top-1 left-1 text-[10px] font-mono text-white/70 bg-black/40 px-1 rounded">
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
