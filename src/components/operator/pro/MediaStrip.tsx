"use client";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { CenterMode } from "./ProOperatorShell";

type Asset = { id: string; url?: string | null; kind?: string | null; fileName?: string | null };

export function MediaStrip({ onCenterMode }: { onCenterMode?: (m: CenterMode) => void }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/media/list", { cache: "no-store" });
        if (!res.ok) { if (!cancelled) setAssets([]); return; }
        const json = await res.json();
        if (cancelled) return;
        setAssets(Array.isArray(json?.assets) ? json.assets.slice(0, 20) : []);
      } catch {
        if (!cancelled) setAssets([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="h-[140px] shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col">
      <div className="h-6 px-3 flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
        <button
          className="hover:text-[var(--color-foreground)]"
          title="Open Media library"
          onClick={() => onCenterMode?.("media")}
        >
          Media Library
        </button>
        <ChevronRight className="w-3 h-3" />
        <span>Recent</span>
      </div>
      <div className="flex-1 min-h-0 flex items-center gap-2 px-3 overflow-x-auto">
        {assets === null && (
          <div className="text-[11px] text-[var(--color-muted-foreground)] opacity-60">Loading media…</div>
        )}
        {assets !== null && assets.length === 0 && (
          <button
            onClick={() => onCenterMode?.("media")}
            className="text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] underline"
          >
            No media yet — open Media Library to upload
          </button>
        )}
        {assets?.map((a) => (
          <button
            key={a.id}
            onClick={() => onCenterMode?.("media")}
            title={a.fileName || a.kind || "Media asset"}
            className="shrink-0 w-[160px] h-[90px] rounded-md bg-[var(--color-elevated)] overflow-hidden hover:ring-1 hover:ring-[var(--color-brand)] transition"
          >
            {a.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.url} alt={a.fileName || ""} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[11px] text-[var(--color-muted-foreground)]">
                {a.fileName || a.kind || "Asset"}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
