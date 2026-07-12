"use client";
/**
 * Inline media library — center-mode "media".
 * Thumbnails grid with filter (name) + kind dropdown. Click adds to
 * playlist (safer default for the operator), double-click sends to live.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";

type Asset = {
  id: string;
  fileName: string;
  kind: string; // "image" | "video" | others
  sizeBytes: number;
  createdAt: string;
  url: string;
};

type Filter = "all" | "image" | "video";

export function MediaBrowser({
  ctx,
  onExitToSlides,
}: {
  ctx: OperatorShellCtx;
  onExitToSlides: () => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/media/list")
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setAssets(data.assets || []); })
      .catch(() => { if (!cancelled) toast.error("Failed to load media"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter !== "all" && !a.kind.startsWith(filter)) return false;
      if (q && !a.fileName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, query, filter]);

  const toSlide = (a: Asset): SlidePayload => {
    if (a.kind.startsWith("video")) return { kind: "video", url: a.url, fit: "contain" };
    return { kind: "image", url: a.url, fit: "contain" };
  };

  const addToPlaylist = async (a: Asset) => {
    if (!ctx.onAddLibraryItem) { toast.info("Playlist add not available"); return; }
    await ctx.onAddLibraryItem("media", { id: a.id, title: a.fileName });
    onExitToSlides();
  };

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={loading ? "Loading media…" : `Filter ${assets.length} assets…`}
          className="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-3 h-8 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md text-sm"
        >
          <option value="all">All</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !loading && (
          <div className="text-[12px] text-[var(--color-muted-foreground)] py-6 text-center">No media matches.</div>
        )}
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
          {filtered.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              onDoubleClick={() => ctx.onSendSlideToLive(toSlide(a))}
              title="Click to select · double-click to send live · Add button for playlist"
              className={cn(
                "relative aspect-video rounded-md overflow-hidden border-2 transition-all bg-black",
                selectedId === a.id ? "border-[var(--color-brand)]" : "border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
              )}
            >
              {a.kind.startsWith("video") ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={a.url} className="w-full h-full object-contain" muted playsInline preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={a.fileName} className="w-full h-full object-contain" />
              )}
              <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-1 text-[10px] text-white/90 truncate">
                {a.fileName}
              </div>
              {selectedId === a.id && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); void addToPlaylist(a); }}
                  className="absolute top-1 right-1 h-6 px-2 rounded bg-[var(--color-brand)] text-black text-[10px] font-semibold flex items-center"
                >
                  + Playlist
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
