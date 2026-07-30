"use client";
/**
 * Inline media library — center-mode "media".
 *
 * UX:
 *   • Click         → send to live immediately (one-click project)
 *   • Right-click   → context menu: Send Live / Add to Playlist / Rename
 *   • Import button → upload from disk (presign → S3 PUT → register)
 *   • Rename        → inline edit on the filename label (context menu or
 *                     double-click the label row)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { registerMediaAsset, renameMediaAsset } from "@/lib/actions";

type Asset = {
  id: string;
  fileName: string;
  kind: string; // "image" | "video" | others
  sizeBytes: number;
  createdAt: string;
  url: string;
};

type Filter = "all" | "image" | "video";

const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const ALLOWED_VIDEO = ["video/mp4", "video/webm", "video/quicktime"];

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
  const [uploading, setUploading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Data loading ─────────────────────────────────────────────────────────
  const loadAssets = (quiet = false) => {
    if (!quiet) setLoading(true);
    fetch("/api/media/list")
      .then((r) => r.json())
      .then((data: unknown) => setAssets((data as { assets?: Asset[] }).assets ?? []))
      .catch(() => toast.error("Failed to load media"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/media/list")
      .then((r) => r.json())
      .then((data: unknown) => { if (!cancelled) setAssets((data as { assets?: Asset[] }).assets ?? []); })
      .catch(() => { if (!cancelled) toast.error("Failed to load media"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter !== "all" && !a.kind.startsWith(filter)) return false;
      if (q && !a.fileName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, query, filter]);

  // ── Slide shape ───────────────────────────────────────────────────────────
  const toSlide = (a: Asset): SlidePayload => {
    if (a.kind.startsWith("video")) return { kind: "video", url: a.url, fit: "contain" };
    return { kind: "image", url: a.url, fit: "contain" };
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const sendLive = (a: Asset) => {
    setSelectedId(a.id);
    ctx.onSendSlideToLive(toSlide(a));
  };

  const addToPlaylist = async (a: Asset) => {
    if (!ctx.onAddLibraryItem) { toast.info("Playlist add not available"); return; }
    await ctx.onAddLibraryItem("media", { id: a.id, title: a.fileName });
    onExitToSlides();
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-selecting the same file

    if (![...ALLOWED_IMAGE, ...ALLOWED_VIDEO].includes(file.type)) {
      toast.error("Unsupported file type. Use JPG, PNG, WebP, GIF, AVIF, MP4, WebM, or MOV.");
      return;
    }

    setUploading(true);
    try {
      // 1. Get presigned S3 URL from the server
      const presignRes = await fetch("/api/media/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: "media" }),
      });
      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed to get upload URL");
      }
      const { url: uploadUrl, key } = await presignRes.json() as { url: string; key: string };

      // 2. Upload directly to S3 (no server proxy — avoids Vercel 4.5MB body limit)
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload to storage failed");

      // 3. Register asset record (church-scoped)
      const kind = file.type.startsWith("video") ? "video" as const : "image" as const;
      const result = await registerMediaAsset({
        kind,
        fileName: file.name,
        s3Key: key,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!result?.ok) throw new Error((result as { error?: string } | undefined)?.error ?? "Registration failed");

      toast.success(`Imported "${file.name}"`);
      loadAssets(true); // quiet reload — don't flash the loading indicator
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setUploading(false);
    }
  };

  // ── Rename ────────────────────────────────────────────────────────────────
  const startRename = (a: Asset) => {
    setRenamingId(a.id);
    setRenameValue(a.fileName);
  };

  const commitRename = async (id: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    const result = await renameMediaAsset(id, name);
    if (!result?.ok) {
      toast.error((result as { error?: string } | undefined)?.error ?? "Rename failed");
    } else {
      toast.success("Renamed");
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, fileName: name } : a)));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      {/* Hidden file input — triggered by the Import button */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Toolbar: filter input + type dropdown + import button */}
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={loading ? "Loading media…" : `Filter ${assets.length} asset${assets.length !== 1 ? "s" : ""}…`}
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
        <button
          type="button"
          onClick={handleImportClick}
          disabled={uploading}
          title="Import a media file from disk"
          className="h-8 px-3 rounded-md bg-[var(--color-brand)] text-black text-[12px] font-semibold flex items-center gap-1.5 hover:opacity-90 active:opacity-80 disabled:opacity-50 shrink-0 transition-opacity"
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "Uploading…" : "Import"}
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !loading && (
          <div className="text-[12px] text-[var(--color-muted-foreground)] py-10 text-center">
            {assets.length === 0
              ? 'No media yet — click "Import" to add your first file.'
              : "No media matches your filter."}
          </div>
        )}
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
        >
          {filtered.map((a) => (
            <ContextMenu.Root key={a.id}>
              <ContextMenu.Trigger asChild>
                {/* Single click = send live immediately */}
                <button
                  type="button"
                  onClick={() => sendLive(a)}
                  title="Click to project · right-click for options"
                  className={cn(
                    "relative aspect-video rounded-md overflow-hidden border-2 transition-all bg-black text-left",
                    selectedId === a.id
                      ? "border-[var(--color-brand)]"
                      : "border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
                  )}
                >
                  {a.kind.startsWith("video") ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video
                      src={a.url}
                      className="w-full h-full object-contain"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.fileName} className="w-full h-full object-contain" />
                  )}

                  {/* Filename label — double-click to rename inline */}
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-1">
                    {renamingId === a.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void commitRename(a.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(a.id);
                          if (e.key === "Escape") setRenamingId(null);
                          e.stopPropagation(); // prevent slide hotkeys
                        }}
                        onClick={(e) => e.stopPropagation()} // don't trigger send-live
                        className="w-full bg-black/40 border border-[var(--color-brand)] rounded px-1 text-[10px] text-white outline-none"
                      />
                    ) : (
                      <span
                        className="block text-[10px] text-white/90 truncate"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startRename(a);
                        }}
                        title={`${a.fileName} — double-click to rename`}
                      >
                        {a.fileName}
                      </span>
                    )}
                  </div>
                </button>
              </ContextMenu.Trigger>

              {/* Right-click context menu */}
              <ContextMenu.Portal>
                <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[160px]">
                  <ContextMenu.Item
                    onSelect={() => sendLive(a)}
                    className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
                  >
                    Send to Live
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    onSelect={() => void addToPlaylist(a)}
                    className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
                  >
                    Add to Playlist
                  </ContextMenu.Item>
                  <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                  <ContextMenu.Item
                    onSelect={() => startRename(a)}
                    className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
                  >
                    Rename
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
        </div>
      </div>
    </div>
  );
}
