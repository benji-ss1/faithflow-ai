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
import { Upload, Pencil, Trash2, CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { registerMediaAsset, renameMediaAsset, deleteMediaAsset } from "@/lib/actions";
import { setMediaOnActiveTheme } from "@/lib/theme-quick-apply";
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
type Fit = "contain" | "cover" | "fill";

const FIT_KEY = "pf.media.fit.v1";
const FIT_OPTIONS: { value: Fit; label: string; hint: string }[] = [
  { value: "contain", label: "Fit", hint: "Whole image, letterboxed (never cropped)" },
  { value: "cover", label: "Fill", hint: "Fills the screen, crops the overflow" },
  { value: "fill", label: "Stretch", hint: "Fills the screen exactly (may distort)" },
];

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
  // How images/videos are sized on the projector. Persisted so the operator's
  // choice sticks across sessions.
  const [fit, setFit] = useState<Fit>("contain");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FIT_KEY) as Fit | null;
      if (saved === "contain" || saved === "cover" || saved === "fill") setFit(saved);
    } catch { /* ignore */ }
  }, []);
  // Multi-select for bulk delete.
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
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
    if (a.kind.startsWith("video")) return { kind: "video", url: a.url, fit };
    return { kind: "image", url: a.url, fit };
  };

  // Change the projected size. Persists the choice, and if an image/video is
  // ALREADY live, re-projects it at the new size immediately (fit is part of
  // the slide identity, so this is a real re-fire, not a no-op skip).
  const changeFit = (next: Fit) => {
    setFit(next);
    try { window.localStorage.setItem(FIT_KEY, next); } catch { /* ignore */ }
    const live = ctx.liveSlide;
    if (live && (live.kind === "image" || live.kind === "video")) {
      // instant:true → clean hard re-cut at the new size, no transition fade
      // (the operator is resizing what's already on screen, not changing content).
      ctx.onSendSlideToLive({ ...live, fit: next } as SlidePayload, null, { instant: true });
    }
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

  // ── Bulk selection ────────────────────────────────────────────────────────
  const toggleBulk = (id: string) => setBulkIds((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelected = filtered.length > 0 && filtered.every((a) => bulkIds.has(a.id));
  const toggleSelectAll = () => setBulkIds(allSelected ? new Set() : new Set(filtered.map((a) => a.id)));
  const bulkDelete = async () => {
    const rows = assets.filter((a) => bulkIds.has(a.id));
    if (rows.length === 0) return;
    if (!window.confirm(`Permanently delete ${rows.length} item${rows.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBulkBusy(true);
    const failed = new Set<string>();
    let deleted = 0;
    for (const a of rows) { const res = await deleteMediaAsset(a.id); if (res?.ok) deleted++; else failed.add(a.id); }
    setBulkBusy(false);
    setAssets((prev) => prev.filter((a) => !bulkIds.has(a.id) || failed.has(a.id)));
    if (selectedId && bulkIds.has(selectedId) && !failed.has(selectedId)) setSelectedId(null);
    setBulkIds(failed);
    toast[deleted > 0 ? "success" : "error"](`Deleted ${deleted} item${deleted === 1 ? "" : "s"}${failed.size ? ` — ${failed.size} failed` : ""}`);
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

        {/* Projected size — how images/videos fill the screen. Applies to the
            next item you project AND to whatever is already live (instant). */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">Projected size</span>
          <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden">
            {FIT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => changeFit(o.value)}
                title={o.hint}
                aria-pressed={fit === o.value}
                className={cn(
                  "h-7 px-3 text-[12px] font-medium transition-colors border-r border-[var(--color-border)] last:border-r-0",
                  fit === o.value
                    ? "bg-[var(--color-brand)] text-black"
                    : "bg-[var(--color-elevated)] text-[var(--color-foreground)] hover:bg-[var(--color-panel)]",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-[var(--color-muted-foreground)]">
            {FIT_OPTIONS.find((o) => o.value === fit)?.hint}
          </span>
        </div>

        {/* Bulk-select bar: pick many items to delete at once */}
        {filtered.length > 0 && (
          <div className="px-1 pb-1 flex items-center gap-1.5">
            <button type="button" onClick={toggleSelectAll} title={allSelected ? "Deselect all" : "Select all"}
              className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
              {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-[var(--color-brand)]" /> : <Square className="w-3.5 h-3.5" />}
              {bulkIds.size > 0 ? `${bulkIds.size} selected` : "Select"}
            </button>
            {bulkIds.size > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => void bulkDelete()} disabled={bulkBusy}
                  className="h-6 px-2 rounded border border-red-500/40 flex items-center gap-1 text-[10px] font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
                <button type="button" onClick={() => setBulkIds(new Set())} title="Clear selection"
                  className="grid h-6 w-6 place-items-center rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">×</button>
              </div>
            )}
          </div>
        )}

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
                        JSON.stringify({ pfType: "media", id: a.id, title: a.fileName, url: a.url, kind: a.kind }),
                      );
                    }}
                    onClick={() => sendLive(a)}
                    title="Click to project · drag to playlist · right-click for options"
                    className={cn(
                      "relative aspect-video rounded-md overflow-hidden border-2 transition-all bg-black text-left group",
                      bulkIds.has(a.id)
                        ? "border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]/50"
                        : selectedId === a.id
                          ? "border-[var(--color-brand)]"
                          : "border-[var(--color-border)] hover:border-[var(--color-muted-foreground)]",
                    )}
                  >
                    {/* Bulk-select checkbox (top-left; stops the click from projecting) */}
                    <span
                      role="checkbox"
                      aria-checked={bulkIds.has(a.id)}
                      onClick={(e) => { e.stopPropagation(); toggleBulk(a.id); }}
                      title="Select"
                      className={cn(
                        "absolute left-1 top-1 z-10 grid h-5 w-5 place-items-center rounded bg-black/60 cursor-pointer transition-opacity",
                        bulkIds.has(a.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                      )}
                    >
                      {bulkIds.has(a.id) ? <CheckSquare className="w-3.5 h-3.5 text-[var(--color-brand)]" /> : <Square className="w-3.5 h-3.5 text-white/80" />}
                    </span>
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
                    {!a.kind.startsWith("video") && (
                      <>
                        <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                        <ContextMenu.Item
                          onSelect={() => void setMediaOnActiveTheme("background", a.url).then((name) =>
                            name ? toast.success(`Set as background of theme “${name}”`) : toast.error("No theme to update"))}
                          className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
                        >
                          Set as theme background
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          onSelect={() => void setMediaOnActiveTheme("logo", a.url).then((name) =>
                            name ? toast.success(`Set as logo of theme “${name}”`) : toast.error("No theme to update"))}
                          className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer"
                        >
                          Set as theme logo
                        </ContextMenu.Item>
                      </>
                    )}
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
