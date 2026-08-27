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
import { Upload, Pencil, Trash2, CheckSquare, Square, ListPlus, ArrowUpDown, GripVertical, Check, Crop, X } from "lucide-react";
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import { projectableTextSlide, type SlidePayload } from "@/lib/broadcast";
import { registerMediaAsset, renameMediaAsset, deleteMediaAsset } from "@/lib/actions";
import { setMediaOnActiveTheme } from "@/lib/theme-quick-apply";
import { MediaImportWizard } from "./MediaImportWizard";
import { MediaImageEditor } from "./MediaImageEditor";
import { loadMediaFrame, clearMediaFrame, buildMediaFrameSlide } from "./mediaFrame";
import { loadMediaOrder, saveMediaOrder, applyMediaOrder } from "./mediaOrder";

type Asset = {
  id: string;
  fileName: string;
  kind: string; // "image" | "video" | others
  sizeBytes: number;
  createdAt: string;
  url: string;          // full-res original — used for projection + theme apply
  thumbUrl?: string;    // small grid preview — falls back to url server-side
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
  const [editingImage, setEditingImage] = useState<Asset | null>(null);
  // Pending single-click → project timer, so a double-click (to open the framing
  // editor) cancels it instead of first flashing the raw image onto the projector.
  const clickTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current); }, []);
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
  const [addingGroup, setAddingGroup] = useState(false);
  // Operator's custom media ordering (localStorage, church-scoped) + a Reorder
  // mode. In reorder mode, cards are drag-sortable and projection/edit is off.
  const [order, setOrder] = useState<string[]>([]);
  const [reorderMode, setReorderMode] = useState(false);
  useEffect(() => { setOrder(loadMediaOrder(ctx.churchId)); }, [ctx.churchId]);
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

  // One-time thumbnail backfill for PRE-EXISTING assets (rows that predate the
  // on-upload thumbnail step). Fire-and-forget, bounded per call — loop until
  // the server reports 0 remaining, then refresh the grid so the new thumbs
  // show. Fully idempotent and safe to run on every mount: when nothing is
  // missing the first call returns remaining:0 and does no work. Silent on
  // failure — the grid already renders full-res as a fallback.
  useEffect(() => {
    // Once this session has drained the queue, don't re-run on every remount.
    const DONE_KEY = "pf.media.thumbBackfillDone";
    try { if (sessionStorage.getItem(DONE_KEY) === "1") return; } catch { /* no sessionStorage */ }
    let cancelled = false;
    (async () => {
      let didWork = false;
      let prevRemaining = Infinity;
      for (let i = 0; i < 25 && !cancelled; i++) {
        let res: Response;
        try { res = await fetch("/api/media/backfill-thumbnails", { method: "POST" }); }
        catch { return; }
        if (!res.ok) return; // 401/429/500 — give up quietly
        const { processed, remaining } = (await res.json().catch(() => ({}))) as { processed?: number; remaining?: number };
        if (processed && processed > 0) didWork = true;
        const rem = remaining ?? 0;
        if (rem <= 0) { try { sessionStorage.setItem(DONE_KEY, "1"); } catch {} break; }
        // No-progress guard: the server stamps a sentinel on every selected row,
        // so `remaining` must strictly drop each pass. If it didn't, something is
        // wrong — stop rather than burn the remaining iterations on dead work.
        if (rem >= prevRemaining) break;
        prevRemaining = rem;
      }
      if (didWork && !cancelled) loadAssets(true); // quiet refresh → thumbs appear
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Filtering ─────────────────────────────────────────────────────────────
  // Apply the operator's saved order first (self-healing: new uploads go to the
  // end, deleted ids are ignored), THEN filter — so custom order is preserved.
  const ordered = useMemo(() => applyMediaOrder(assets, order), [assets, order]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered.filter((a) => {
      if (filter !== "all" && !a.kind.startsWith(filter)) return false;
      if (q && !a.fileName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ordered, query, filter]);

  // Reorder-mode dnd (whole library, ignores filter so a partial view can't
  // scramble the full order). Mirrors the SlideGrid sortable pattern.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onReorderEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((a) => a.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(ids, oldIdx, newIdx);
    setOrder(next);
    saveMediaOrder(ctx.churchId, next);
  };

  // ── Slide shape ───────────────────────────────────────────────────────────
  const toSlide = (a: Asset): SlidePayload => {
    if (a.kind.startsWith("video")) return { kind: "video", url: a.url, fit };
    // If the operator saved a crop/pan/zoom for this image, project it framed
    // (rich object payload with a black matte) exactly as the editor does — a
    // saved image goes live correctly with a single click, no editor needed.
    // The plain {kind:"image"} path (global fit only) stays the default for
    // un-framed images, which is cheaper and keeps the theme behind letterboxing.
    const frame = loadMediaFrame(ctx.churchId, a.id);
    if (frame) {
      // Reconstruct EXACTLY what the editor's "Save & Show" projects — matte or
      // logo-on-background (solid/theme/gradient) — so a saved frame is faithful
      // on a single click, not silently downgraded to a black matte.
      const { bgColor, objects } = buildMediaFrameSlide(frame, a.url);
      return projectableTextSlide("", bgColor, undefined, objects);
    }
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

  // Add all selected media as ONE collapsible playlist group (in the operator's
  // current display order). Preserves the on-screen order of the selection.
  const bulkAddGroup = async () => {
    if (addingGroup) return; // in-flight guard: no duplicate group on a double-click
    if (!ctx.onAddMediaGroup) { toast.info("Playlist add not available"); return; }
    const ids = filtered.filter((a) => bulkIds.has(a.id)).map((a) => a.id);
    if (ids.length === 0) { toast.info("Nothing selected is visible under the current filter."); return; }
    // Default the group name (window.prompt is unreliable in the Electron shell);
    // the operator can double-click the playlist row to rename it.
    const title = ids.length === 1
      ? (filtered.find((a) => a.id === ids[0])?.fileName ?? "Images")
      : `Images (${ids.length})`;
    setAddingGroup(true);
    try {
      await ctx.onAddMediaGroup(title, ids);
      setBulkIds(new Set());
      toast.success(`Added "${title}" to the playlist — double-click to rename`, { icon: "🗂️" });
      onExitToSlides();
    } finally {
      setAddingGroup(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteAsset = async (a: Asset) => {
    if (!window.confirm(`Permanently delete "${a.fileName}"? This cannot be undone.`)) return;
    const result = await deleteMediaAsset(a.id);
    if (!result?.ok) {
      toast.error((result as { error?: string } | undefined)?.error ?? "Delete failed");
    } else {
      toast.success(`"${a.fileName}" deleted`);
      clearMediaFrame(ctx.churchId, a.id); // don't orphan the saved framing
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
    for (const a of rows) { const res = await deleteMediaAsset(a.id); if (res?.ok) { deleted++; clearMediaFrame(ctx.churchId, a.id); } else failed.add(a.id); }
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

      {editingImage && (
        <MediaImageEditor
          asset={{ id: editingImage.id, url: editingImage.url, fileName: editingImage.fileName }}
          ctx={ctx}
          onClose={() => setEditingImage(null)}
        />
      )}

      <div className="p-4 flex flex-col gap-3 h-full">
        {/* Toolbar: filter input + type dropdown + import button */}
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={loading ? "Loading media…" : `Filter ${assets.length} asset${assets.length !== 1 ? "s" : ""}…`}
            className="flex-1 bg-[var(--color-muted)] border border-[var(--color-border)] rounded-lg px-3 h-8 text-sm font-medium text-[var(--color-foreground)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none transition-colors focus:border-[var(--color-brand)] focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.28),var(--shadow-ember)]"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="h-8 px-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg text-sm font-medium shadow-[var(--edge-top),var(--shadow-sm)] outline-none transition-colors focus:border-[var(--color-brand)]"
          >
            <option value="all">All</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
          </select>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            title="Import media files"
            className="h-8 px-3 rounded-lg bg-[linear-gradient(180deg,#F2712E_0%,#E8501A_100%)] text-black text-[12px] font-bold flex items-center gap-1.5 shadow-[var(--edge-top),var(--shadow-ember)] shrink-0 transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-house)] hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-ember-lg)] active:translate-y-0 active:scale-[0.97]"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
        </div>

        {/* Projected size — how images/videos fill the screen. Applies to the
            next item you project AND to whatever is already live (instant). */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">Projected size</span>
          <div className="inline-flex items-center gap-[3px] rounded-xl border border-[var(--color-border)] bg-[var(--color-app-bg)] p-[3px] shadow-[var(--edge-top),inset_0_1px_2px_rgba(0,0,0,0.28)]">
            {FIT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => changeFit(o.value)}
                title={o.hint}
                aria-pressed={fit === o.value}
                className={cn(
                  "h-7 px-3 rounded-lg text-[12px] transition-[color,background-color,box-shadow] duration-200 [transition-timing-function:var(--ease-house)]",
                  fit === o.value
                    ? "bg-[linear-gradient(180deg,#F2712E_0%,#E8501A_100%)] text-black font-bold shadow-[var(--edge-top),var(--shadow-ember)]"
                    : "text-[var(--color-muted-foreground)] font-semibold hover:text-[var(--color-foreground)] hover:bg-white/[0.04]",
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

        {/* Bulk-select bar: pick many items to group/add/delete; or Reorder mode */}
        {filtered.length > 0 && !reorderMode && (
          <div className="px-1 pb-1 flex items-center gap-1.5">
            <button type="button" onClick={toggleSelectAll} title={allSelected ? "Deselect all" : "Select all"}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]">
              {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-[var(--color-brand)]" /> : <Square className="w-3.5 h-3.5" />}
              {bulkIds.size > 0
                ? <span className="inline-flex items-center rounded-full border border-[color-mix(in_oklab,var(--color-brand)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-brand)_14%,transparent)] px-2 py-0.5 font-bold tabular-nums text-[var(--color-foreground)]">{bulkIds.size} selected</span>
                : "Select"}
            </button>
            <button type="button" onClick={() => { setReorderMode(true); setBulkIds(new Set()); }} title="Drag to reorder the library"
              className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]">
              <ArrowUpDown className="w-3.5 h-3.5" /> Reorder
            </button>
            {bulkIds.size > 0 && (
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => void bulkAddGroup()} disabled={addingGroup}
                  className="h-7 px-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] flex items-center gap-1 text-[10px] font-semibold text-[var(--color-foreground)] transition-[transform,box-shadow,border-color,background-color] duration-200 [transition-timing-function:var(--ease-house)] hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] active:translate-y-0 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none">
                  <ListPlus className="w-3 h-3" /> Add group to playlist
                </button>
                <button type="button" onClick={() => void bulkDelete()} disabled={bulkBusy}
                  className="h-7 px-2.5 rounded-lg border border-red-500/40 shadow-[var(--edge-top),var(--shadow-sm)] flex items-center gap-1 text-[10px] font-semibold text-red-300 transition-[transform,box-shadow,border-color,background-color] duration-200 [transition-timing-function:var(--ease-house)] hover:-translate-y-px hover:bg-red-500/10 hover:border-red-500/60 active:translate-y-0 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
                <button type="button" onClick={() => setBulkIds(new Set())} title="Clear selection"
                  className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))]"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>
        )}
        {reorderMode && (
          <div className="px-1 pb-1 flex items-center gap-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-brand)]"><GripVertical className="w-3.5 h-3.5" /> Reorder mode — drag cards to arrange the library</span>
            <button type="button" onClick={() => setReorderMode(false)}
              className="ml-auto h-7 px-2.5 rounded-lg bg-[linear-gradient(180deg,#F2712E_0%,#E8501A_100%)] text-black shadow-[var(--edge-top),var(--shadow-ember)] flex items-center gap-1 text-[10px] font-bold transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-house)] hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-ember-lg)] active:translate-y-0 active:scale-[0.97]">
              <Check className="w-3 h-3" /> Done
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && !loading && !reorderMode && (
            <div className="text-[12px] text-[var(--color-muted-foreground)] py-10 text-center">
              {assets.length === 0
                ? 'No media yet — click "Import" to add your first file.'
                : "No media matches your filter."}
            </div>
          )}

          {reorderMode ? (
            /* Reorder mode: whole library, drag-sortable, no projection/edit. */
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorderEnd}>
              <SortableContext items={ordered.map((a) => a.id)} strategy={rectSortingStrategy}>
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                  {ordered.map((a) => (
                    <SortableMediaCard key={a.id} asset={a} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
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
                      // If this card is part of a multi-selection, also carry the
                      // WHOLE selection (in display order) so dropping it on the
                      // playlist creates one group. Single-item payload above is
                      // kept so the existing drop handler still works if the group
                      // MIME is ignored.
                      if (bulkIds.has(a.id) && bulkIds.size > 1) {
                        const group = filtered.filter((x) => bulkIds.has(x.id));
                        e.dataTransfer.setData(
                          "application/x-pf-library-items",
                          JSON.stringify({ pfType: "media-group", items: group.map((x) => ({ id: x.id, title: x.fileName })) }),
                        );
                      }
                    }}
                    onClick={() => {
                      // A native double-click fires click,click,dblclick — so a raw
                      // single-click would project the UN-framed image live BEFORE the
                      // editor opens (flashing it on the congregation screen mid-service).
                      // Defer the project by one dblclick window; dblclick cancels it.
                      if (a.kind.startsWith("video")) { sendLive(a); return; }
                      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
                      // 350ms ≈ the low end of the OS double-click window, so a
                      // deliberate double-click to open the editor cancels this
                      // before it can flash the raw image live. Single-click
                      // projection is deferred by this much (imperceptible).
                      clickTimerRef.current = window.setTimeout(() => { clickTimerRef.current = null; sendLive(a); }, 350);
                    }}
                    onDoubleClick={(e) => {
                      if (a.kind.startsWith("video")) return;
                      e.stopPropagation();
                      if (clickTimerRef.current) { window.clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
                      setEditingImage(a);
                    }}
                    title="Click to project · double-click to crop/frame · drag to playlist · right-click for options"
                    className={cn(
                      "relative aspect-video rounded-lg overflow-hidden bg-black text-left group transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-house)]",
                      bulkIds.has(a.id)
                        ? "border-2 border-[var(--color-brand)] shadow-[var(--shadow-ember)]"
                        : selectedId === a.id
                          ? "border-2 border-[var(--color-brand)] shadow-[var(--shadow-ember)]"
                          : "border border-[var(--color-border)] shadow-[var(--edge-top),var(--shadow-sm)] hover:-translate-y-[3px] hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--shadow-lg)]",
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
                    {/* Edit-slide button (top-right; images only) — an explicit
                        alternative to double-click. Stops the click from projecting. */}
                    {!a.kind.startsWith("video") && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Edit slide"
                        title="Edit slide (crop / background)"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (clickTimerRef.current) { window.clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
                          setEditingImage(a);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault(); e.stopPropagation();
                            if (clickTimerRef.current) { window.clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
                            setEditingImage(a);
                          }
                        }}
                        className="absolute right-1 top-1 z-10 inline-flex h-6 px-1.5 items-center gap-1 rounded bg-black/60 text-white/85 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80 hover:text-white text-[10px] font-semibold"
                      >
                        <Crop className="w-3 h-3" /> Edit
                      </span>
                    )}
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
                      // Grid preview uses the small thumbnail (falls back to the
                      // original server-side); the full-res url is reserved for
                      // projection + theme apply so quality there is unchanged.
                      <img src={a.thumbUrl ?? a.url} alt={a.fileName} loading="lazy" decoding="async" className="w-full h-full object-contain" />
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
          )}
        </div>
      </div>
    </>
  );
}

/**
 * A drag-sortable media card for Reorder mode. View + drag only — no projection,
 * no edit, no bulk checkbox (those live on the normal grid). The whole card is
 * the drag handle so it's easy to grab on a touch/trackpad at a live service.
 */
function SortableMediaCard({ asset }: { asset: Asset }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: asset.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const isVideo = asset.kind.startsWith("video");
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      title={`${asset.fileName} — drag to reorder`}
      className="relative aspect-video rounded-lg overflow-hidden border border-[var(--color-border)] shadow-[var(--edge-top),var(--shadow-sm)] bg-black text-left cursor-grab active:cursor-grabbing touch-none select-none transition-[box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-house)] hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--shadow-md)]"
    >
      {isVideo ? (
        <video src={asset.url} muted className="w-full h-full object-cover pointer-events-none" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        // Small reorder-card preview → thumbnail (falls back to url).
        <img src={asset.thumbUrl ?? asset.url} alt={asset.fileName} draggable={false} loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none" />
      )}
      <span className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/60 text-white/80">
        <GripVertical className="w-3.5 h-3.5" />
      </span>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1">
        <span className="block text-[10px] text-white/90 truncate">{asset.fileName}</span>
      </div>
    </div>
  );
}
