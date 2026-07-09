"use client";
import { useEffect, useState } from "react";
import { Image as ImageIcon, Video, Sun, Layers, Upload, AlertTriangle, Send, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlidePayload } from "@/lib/broadcast";

type MediaAsset = { id: string; fileName: string; kind: "image" | "video"; url: string; sizeBytes: number; createdAt: string };
type BinTab = "images" | "videos" | "logos" | "backgrounds" | "recent";

const TABS: { key: BinTab; label: string; icon: typeof ImageIcon }[] = [
  { key: "images",      label: "Images",       icon: ImageIcon },
  { key: "videos",      label: "Videos",       icon: Video },
  { key: "logos",       label: "Logos",        icon: Sun },
  { key: "backgrounds", label: "Backgrounds",  icon: Layers },
  { key: "recent",      label: "Recent",       icon: Upload },
];

export function MediaBinMode({
  onSendPreview, onSendLive,
}: {
  onSendPreview: (slide: SlidePayload) => void;
  onSendLive: (slide: SlidePayload) => void;
}) {
  const [tab, setTab] = useState<BinTab>("images");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingCount, setMissingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/media/list").then((r) => r.json()).catch(() => ({ assets: [] }));
        if (cancelled) return;
        const list = (r.assets || []) as MediaAsset[];
        setAssets(list);
        // Missing detection: assets whose url is empty (S3 not configured
        // or presign expired). Real HEAD probing added in a later phase.
        setMissingCount(list.filter((a) => !a.url).length);
      } finally { setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = assets.filter((a) => {
    if (tab === "images") return a.kind === "image";
    if (tab === "videos") return a.kind === "video";
    if (tab === "logos") return /(logo|brand|wordmark|header)/i.test(a.fileName);
    if (tab === "backgrounds") return /(bg|background|texture)/i.test(a.fileName);
    if (tab === "recent") {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return new Date(a.createdAt).getTime() > cutoff;
    }
    return true;
  });

  function slideFor(a: MediaAsset): SlidePayload | null {
    if (!a.url) return null;
    return a.kind === "video"
      ? { kind: "video", url: a.url, fit: "contain" }
      : { kind: "image", url: a.url, fit: "contain" };
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab strip */}
      <div className="h-10 shrink-0 border-b flex items-center gap-0.5 px-3" style={{ borderColor: "var(--color-border)" }}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)}
              className={cn(
                "h-8 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors",
                active ? "bg-[color:var(--color-elevated)]" : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-raised-shell)]",
              )}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          );
        })}
        {missingCount > 0 && (
          <div className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-semibold text-[color:var(--color-warning)]">
            <AlertTriangle className="w-3 h-3" /> {missingCount} asset{missingCount !== 1 && "s"} missing
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-xs text-[color:var(--color-muted-foreground)] text-center py-8">Loading media…</div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-[color:var(--color-muted-foreground)] text-center py-8">
            No {TABS.find((t) => t.key === tab)?.label.toLowerCase()} yet. Upload at <code className="font-mono opacity-70">/library/media</code>.
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {filtered.map((a) => (
              <MediaCard key={a.id} asset={a}
                onPreview={() => { const s = slideFor(a); if (s) onSendPreview(s); }}
                onLive={() => { const s = slideFor(a); if (s) onSendLive(s); }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaCard({ asset, onPreview, onLive }: { asset: MediaAsset; onPreview: () => void; onLive: () => void }) {
  const missing = !asset.url;
  return (
    <div className={cn(
      "group rounded-md overflow-hidden border transition-colors",
      missing ? "border-[color:var(--color-warning)]/50" : "border-[color:var(--color-border)] hover:border-[color:var(--color-muted-foreground)]",
    )} style={{ background: "var(--color-panel)" }}>
      <div className="aspect-video bg-black relative flex items-center justify-center">
        {missing ? (
          <div className="text-[color:var(--color-warning)] text-[10px] font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Missing
          </div>
        ) : asset.kind === "video" ? (
          <video src={asset.url} muted className="w-full h-full object-contain" />
        ) : (
          <img src={asset.url} alt={asset.fileName} className="w-full h-full object-contain" />
        )}
      </div>
      <div className="p-2 space-y-1">
        <div className="text-xs font-medium truncate">{asset.fileName}</div>
        <div className="text-[10px] text-[color:var(--color-muted-foreground)] flex items-center gap-2">
          <span className="uppercase font-mono">{asset.kind}</span>
          <span className="ml-auto">{Math.round(asset.sizeBytes / 1024)} KB</span>
        </div>
        <div className="flex gap-1 pt-1">
          <button disabled={missing} onClick={onPreview}
            className="flex-1 h-7 rounded-sm text-[10px] font-semibold border border-[color:var(--color-brand)]/50 text-[color:var(--color-brand)] hover:bg-[color:var(--color-brand)]/10 disabled:opacity-30 inline-flex items-center justify-center gap-1">
            <Eye className="w-2.5 h-2.5" /> Preview
          </button>
          <button disabled={missing} onClick={onLive}
            className="flex-1 h-7 rounded-sm text-[10px] font-bold bg-[color:var(--color-destructive)] text-white hover:opacity-90 disabled:opacity-30 inline-flex items-center justify-center gap-1">
            <Send className="w-2.5 h-2.5" /> Live
          </button>
        </div>
      </div>
    </div>
  );
}
