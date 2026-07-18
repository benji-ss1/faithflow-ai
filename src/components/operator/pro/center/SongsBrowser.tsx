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
            // Match the Bible verse-card grid density: 280px minmax + slightly
            // larger gap so lyrics don't feel cramped next to Bible cards.
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${slideSize}px, 1fr))` }}>
              {slides.map((sl, idx) => {
                const payload: SlidePayload = { kind: "text", text: sl.lyrics };
                return (
                  <button
                    key={idx}
                    // CLAUDE.md rule 7 — songs NEVER auto-project. Single-click
                    // must not send lyrics live during preaching (copyright
                    // safety). Double-click sends; single-click is preview
                    // only. (Regression fix from prior click-simplification.)
                    onDoubleClick={() => ctx.onSendSlideToLive(payload)}
                    className="relative aspect-video rounded overflow-hidden border-2 border-[var(--color-border)] hover:border-[var(--color-brand)] transition-colors"
                    title="Double-click to send lyric slide to live"
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
