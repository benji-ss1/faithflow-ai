"use client";
/**
 * Inline media library — center-mode "media".
 *
 * UX:
 *   • Click         → send to live immediately (one-click project)
 *   • Right-click   → context menu: Send Live / Add to Playlist / Rename
 *   • Import button → opens MediaImportWizard (4-step modal)
 *   • Rename        → pencil icon on hover OR right-click → Rename
 *                     (previously required awkward double-click of 10px label)
 *
 * Rename propagation:
 *   renameMediaAsset updates mediaAssets.fileName in the DB AND updates any
 *   serviceItems that have payload.mediaId === asset.id (stored when the asset
 *   is added to a playlist). The local assets array is also updated optimistically
 *   so the grid reflects the new name without a full reload.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Upload, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { registerMediaAsset, renameMediaAsset, deleteMediaAsset } from "@/lib/actions";
import { MediaImportWizard } from "./MediaImportWizard";

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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

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
    // Store mediaId in payload so renameMediaAsset can propagate title changes
    // to any service item that references this asset.
    await ctx.onAddLibraryItem("media", { id: a.id, title: a.fileName });
    onExitToSlides();
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteAsset = async (a: Asset) => {
    if (!window.confirm(`Permanently delete "${a.fileName}"? This cannot be undone.`)) return;
    const result = await deleteMediaAsset(a.id);
    if (!result?.ok) {
      toast.error((result as { error?: string } | undefined)?.error ?? "Delete failed");
    } else {
      toast.success(`"${a.fileName}" deleted`);
      setAssets((prev) => prev.filter((x) => x.id !== a.id));
      if (selectedId === a.id) setSelectedId(null);
    }
  };

  // ── Rename ────────────────────────────────────────────────────────────────
  const startRename = (a: Asset) => {
    setRenamingId(a.id);
    setRenameValue(a.fileName);
    // Auto-focus via ref after state update
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const commitRename = async (id: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    const asset = assets.find((a) => a.id === id);
    if (asset && name === asset.fileName) return; // no change
    const result = await renameMediaAsset(id, name);
    if (!result?.ok) {
      toast.error((result as { error?: string } | undefined)?.error ?? "Rename failed");
    } else {
      toast.success("Renamed");
      // Optimistic local update — no full reload needed
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, fileName: name } : a)));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <MediaImportWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onImported={() => loadAssets(true)}
      />

      <div className="p-4 flex flex-col gap-3 h-full">
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
            onClick={() => setWizardOpen(true)}
            title="Import media files"
            className="h-8 px-3 rounded-md bg-[var(--color-brand)] text-black text-[12px] font-semibold flex items-center gap-1.5 hover:opacity-90 active:opacity-80 shrink-0 transition-opacity"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
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
                  {/* Single click = send live · drag to playlist sidebar */}
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "copy";
                      e.dataTransfer.setData(
                        "application/x-pf-library-item",
                        JSON.stringify({ pfType: "media", id: a.id, title: a.fileName }),
                      );
                    }}
                    onClick={() => sendLive(a)}
                    title="Click to project · drag to playlist · right-click for options"
                    className={cn(
                      "relative aspect-video rounded-md overflow-hidden border-2 transition-all bg-black text-left group",
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

                    {/* Filename bar — always visible; pencil icon on hover */}
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-1 flex items-center gap-1">
                      {renamingId === a.id ? (
                        <input
                          ref={renameInputRef}
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
                          className="flex-1 bg-black/40 border border-[var(--color-brand)] rounded px-1 text-[10px] text-white outline-none"
                        />
                      ) : (
                        <>
                          <span
                            className="flex-1 text-[10px] text-white/90 truncate"
                            title={a.fileName}
                          >
                            {a.fileName}
                          </span>
                          {/* Pencil icon — visible on card hover, triggers rename */}
                          <button
                            type="button"
                            title="Rename"
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(a);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/20 text-white/70 hover:text-white shrink-0"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </>
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
                    <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                    <ContextMenu.Item
                      onSelect={() => void deleteAsset(a)}
                      className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer text-[var(--color-destructive)]"
                    >
                      Delete
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
