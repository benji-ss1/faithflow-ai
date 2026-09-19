"use client";
/**
 * Media bin — a compact, collapsible dock of the church's media assets that
 * lives in the CENTER bottom strip (field fix 6A), under the slide grid.
 *
 * It is a THIN reuse of the existing media data + drag idiom:
 *   • lists /api/media/list assets as small thumbnails (same source as the full
 *     MediaBrowser)
 *   • each thumbnail is HTML5-draggable with the SAME `application/x-pf-library-
 *     item` payload the MediaBrowser emits, so the EXISTING drop targets handle
 *     it with no new wiring (playlist add / library file / drop-onto-slide bg)
 *   • a hover "Bg" affordance reuses setMediaAsBackground (undoable)
 *   • clicking a thumbnail (or the header link) opens the full Media center panel
 *
 * Field wave 6E — the deferred operator asks, all reusing existing actions:
 *   1. Pull-up RESIZE: a drag handle on the bin's top edge enlarges/shrinks the
 *      strip (thumbnails scale with height); persisted per-machine; coexists with
 *      collapse + pop-out.
 *   3. UPLOAD image/video buttons: open the existing MediaImportWizard pre-queued
 *      with the picked files; on import the bin re-pulls and the asset is
 *      immediately draggable/usable.
 *   4. RIGHT-CLICK context menu on every item (Send as slide / Set as current
 *      slide's background / Set as global background / Move to library / Delete)
 *      + DOUBLE-CLICK quick preview modal (image full view; video with controls).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  ChevronDown, ChevronRight, Images, ExternalLink, Maximize2, Minimize2,
  Upload, ImagePlus, Film, MonitorPlay, PanelBottom, FolderInput, Trash2, X, GripHorizontal,
  CheckCircle2, RotateCw, Music,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CenterMode } from "../ProOperatorShell";
import type { OperatorShellCtx } from "../../shell/types";
import { setMediaAsBackground, normalizeMediaKind } from "@/backgrounds/mediaAsBackground";
import { snapshotBackgroundState, restoreBackgroundState, removeCustomBackground } from "@/backgrounds/store/backgroundStore";
import { deleteMediaAsset, setMediaLibrary, listLibraries, type LibraryRow } from "@/lib/actions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { isImageAsset } from "@/lib/media-drop";
import { loadMediaFrame, clearMediaFrame, buildMediaFrameSlide } from "../center/mediaFrame";
import { resolveFramedBackground } from "../center/mediaFrameBake";
import { FramedImage } from "../center/FramedImage";
import { mediaClickAction, AUDIO_NOT_PROJECTABLE_MESSAGE } from "@/lib/media-click";
import { projectableTextSlide, type SlidePayload } from "@/lib/broadcast";
import { MediaImportWizard } from "../center/MediaImportWizard";
import { isOsFileDrag, collectDroppedFiles, isFileInputTarget } from "@/lib/media-bin-drop";
import { isRealDragLeave } from "@/lib/spring-load";
import { MediaBinUploadQueue, type MediaBinUploadQueueHandle } from "./MediaBinUploadQueue";
import { MediaImageEditor } from "../center/MediaImageEditor";
import { Pencil } from "lucide-react";

type Asset = {
  id: string;
  fileName?: string | null;
  kind?: string | null;
  url?: string | null;
  thumbUrl?: string | null;
  mediaKey?: string | null;
};

/** Audio has no output path yet (no audio slide kind) — it must never be sent
 *  live, used as a background, or dragged onto a slide. */
const isAudioAsset = (a: Asset) => mediaClickAction(a.kind) === "audio-blocked";
const AUDIO_NOT_PROJECTABLE = AUDIO_NOT_PROJECTABLE_MESSAGE;

// Popped-out preset height (used when the operator taps the pop-out button
// instead of hand-dragging the resize handle).
const POPPED_H = 420;
// Manual-resize bounds. Floor keeps a usable 1-row strip; ceiling keeps the
// slide grid above it from being squeezed off-screen.
const MIN_H = 96;
const MAX_H = 620;

export function MediaBinSection({
  open,
  onToggle,
  onCenterMode,
  poppedOut = false,
  onTogglePopout,
  ctx,
  height = 148,
  onResize,
}: {
  open: boolean;
  onToggle: () => void;
  onCenterMode?: (m: CenterMode) => void;
  // Pop-out "v1" (field fix 6A): quick toggle to a taller preset.
  poppedOut?: boolean;
  onTogglePopout?: () => void;
  // Wave 6E: full operator wiring (send-as-slide / per-slide bg / delete).
  ctx?: OperatorShellCtx;
  // Wave 6E item 1: persisted manual strip height (px).
  height?: number;
  onResize?: (px: number) => void;
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [hasOpened, setHasOpened] = useState(open);
  const [libs, setLibs] = useState<LibraryRow[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardFiles, setWizardFiles] = useState<File[] | undefined>(undefined);
  const [wizardFromDrop, setWizardFromDrop] = useState(false); // decks auto-start only for OS drops
  const [preview, setPreview] = useState<Asset | null>(null);
  // E2: the image being edited in the crop/frame editor (opened from the menu).
  const [editAsset, setEditAsset] = useState<{ id: string; url: string; fileName: string } | null>(null);
  // Live drag height override while the operator is pulling the handle.
  const [dragH, setDragH] = useState<number | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const imgInputRef = useRef<HTMLInputElement>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);
  // ── OS file drop (Finder / Explorer → bin) ──────────────────────────────────
  const [fileDragOver, setFileDragOver] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const queueRef = useRef<MediaBinUploadQueueHandle>(null);
  const dragClearTimerRef = useRef<number | null>(null);
  // Defer a single-click (open full library) so a double-click (quick preview)
  // cancels it — otherwise the first click of a dblclick navigates away first.
  const clickTimerRef = useRef<number | null>(null);
  // Where the pointer went down, so a click that was really an ABORTED drag-grab
  // (press → small move → release on a draggable tile) doesn't accidentally
  // project to the congregation. A genuine click (no movement) still goes live.
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => { if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current); }, []);

  useEffect(() => { if (open) setHasOpened(true); }, [open]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/media/list?audio=1", { cache: "no-store" });
      if (!res.ok) { setAssets([]); return; }
      const json = await res.json();
      setAssets(Array.isArray(json?.assets) ? json.assets : []);
    } catch {
      setAssets([]);
    }
  }, []);

  useEffect(() => {
    if (!hasOpened) return;
    void load();
    const h = () => void load();
    window.addEventListener("presentflow:libraries-changed", h);
    return () => { window.removeEventListener("presentflow:libraries-changed", h); };
  }, [hasOpened, load]);

  // Libraries for the "Move to library" submenu — cheap, church-scoped list.
  useEffect(() => {
    if (!hasOpened) return;
    let m = true;
    const pull = () => { void listLibraries().then((r) => { if (m && r.ok) setLibs(r.data!.libraries); }); };
    pull();
    window.addEventListener("presentflow:libraries-changed", pull);
    return () => { m = false; window.removeEventListener("presentflow:libraries-changed", pull); };
  }, [hasOpened]);

  // ── Actions (all reuse existing paths) ─────────────────────────────────────
  const setAsBackground = async (a: Asset) => {
    if (isAudioAsset(a)) { toast.error(AUDIO_NOT_PROJECTABLE); return; }
    if (!a.url) { toast.error("This asset has no file to use as a background"); return; }
    const prev = snapshotBackgroundState();
    const kind = normalizeMediaKind(a.kind || "image");
    // A saved crop / blur / logo layout must come with the image — use the framed copy.
    const fb = kind === "image" ? await resolveFramedBackground(ctx?.churchId, { id: a.id, url: a.url, fileName: a.fileName || undefined, mediaKey: a.mediaKey || undefined }) : null;
    if (fb?.failed) toast.error("Couldn't apply your edit to the background — used the original image");
    const bg = setMediaAsBackground({
      id: a.id, url: fb?.url ?? a.url, fileName: a.fileName || "Media",
      kind, mediaKey: fb?.mediaKey ?? (a.mediaKey || undefined),
    });
    toast.success(`“${bg.name}” is now your background — it stays behind every slide`, {
      id: "pf-media-background",
      action: { label: "Undo", onClick: () => { restoreBackgroundState(prev); toast.success("Background reverted", { id: "pf-media-background" }); } },
      duration: 8000,
    });
  };

  // Send the asset to the projector as a full slide (image → framed if the
  // operator saved a crop; video → plain). Mirrors MediaBrowser.toSlide.
  const toSlide = (a: Asset): SlidePayload | null => {
    if (!a.url || isAudioAsset(a)) return null;
    if ((a.kind || "").startsWith("video")) return { kind: "video", url: a.url, fit: "contain" };
    const frame = ctx ? loadMediaFrame(ctx.churchId, a.id) : null;
    if (frame) {
      const { bgColor, objects } = buildMediaFrameSlide(frame, a.url);
      return projectableTextSlide("", bgColor, undefined, objects);
    }
    return { kind: "image", url: a.url, fit: "contain" };
  };

  const sendAsSlide = (a: Asset) => {
    if (isAudioAsset(a)) { toast.error(AUDIO_NOT_PROJECTABLE); return; }
    const slide = toSlide(a);
    if (!slide || !ctx) { toast.error("Can't send this asset"); return; }
    ctx.onSendSlideToLive(slide);
    toast.success(`Sent “${a.fileName || "Media"}” to the screen`);
  };

  // Set as the CURRENTLY-LIVE slide's per-slide background (images only). Re-sends
  // the live text slide with bgImageUrl set — the words stay on top, exactly like
  // the drag-onto-slide path (6C). No-op with a clear message when nothing text is live.
  const setCurrentSlideBg = async (a: Asset) => {
    if (!ctx) return;
    if (!a.url || !isImageAsset({ kind: a.kind ?? undefined, url: a.url })) {
      toast.error("Only an image can be a slide background — use ‘Set as global background’ for video");
      return;
    }
    const live = ctx.liveSlide;
    if (!live || live.kind !== "text") {
      toast.error("No lyric/text slide is live — project a slide first, then set its background");
      return;
    }
    const fb = await resolveFramedBackground(ctx.churchId, { id: a.id, url: a.url, fileName: a.fileName || undefined, mediaKey: a.mediaKey || undefined });
    if (fb.failed) toast.error("Couldn't apply your edit to the background — used the original image");
    ctx.onSendSlideToLive({ ...live, bgImageUrl: fb.url }, null, { instant: true, carryLiveOrigin: true });
    toast.success("Background set on the live slide");
  };

  // E2: open the crop/frame editor for an image asset (menu action).
  const editImage = (a: Asset) => {
    if (!ctx) return;
    if (!a.url || !isImageAsset({ kind: a.kind ?? undefined, url: a.url })) {
      toast.error("Only images can be edited");
      return;
    }
    setEditAsset({ id: a.id, url: a.url, fileName: a.fileName || "Media" });
  };

  const moveToLibrary = async (a: Asset, libraryId: string | null) => {
    const res = await setMediaLibrary(a.id, libraryId);
    if (!res.ok) { toast.error(res.error ?? "Move failed"); return; }
    const destName = libraryId ? (libs.find((l) => l.id === libraryId)?.name ?? "that library") : "Ungrouped";
    toast.success(`Moved to ${destName}`);
    window.dispatchEvent(new CustomEvent("presentflow:libraries-changed"));
  };

  const deleteAsset = async (a: Asset) => {
    if (!(await confirm({ title: `Delete "${a.fileName || "this asset"}"?`, description: "This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    const result = await deleteMediaAsset(a.id);
    if (!result?.ok) { toast.error((result as { error?: string } | undefined)?.error ?? "Delete failed"); return; }
    if (ctx) clearMediaFrame(ctx.churchId, a.id);
    removeCustomBackground(`media-bg-${a.id}`);
    setAssets((prev) => (prev ? prev.filter((x) => x.id !== a.id) : prev));
    toast.success(`"${a.fileName || "Asset"}" deleted`);
    window.dispatchEvent(new CustomEvent("presentflow:libraries-changed"));
  };

  // ── Upload (item 3) — reuse the MediaImportWizard, pre-queued with the pick ──
  const pickFiles = (kind: "image" | "video") => {
    (kind === "image" ? imgInputRef : vidInputRef).current?.click();
  };
  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ""; // allow re-picking the same file
    if (files.length === 0) return;
    setWizardFiles(files);
    setWizardFromDrop(false);
    setWizardOpen(true);
  };

  // ── OS file drop ─────────────────────────────────────────────────────────────
  // Only REAL OS files are handled here; in-app drags (media tiles, library
  // items, slides) never match isOsFileDrag, so every existing drop target keeps
  // working exactly as before. Uploads/progress live in MediaBinUploadQueue so
  // progress never re-renders this (large) component.

  // Post-upload refresh that NEVER blanks the bin on a failed fetch (unlike the
  // general `load`, whose behaviour is left untouched).
  const refreshAfterUpload = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/media/list?audio=1", { cache: "no-store" });
      if (!res.ok) return false;
      const json = await res.json();
      if (!Array.isArray(json?.assets)) return false;
      setAssets(json.assets);
      return true;
    } catch {
      return false;
    }
  }, []);
  const openWizardWith = useCallback((files: File[]) => {
    setWizardFiles(files);
    setWizardFromDrop(true);
    setWizardOpen(true);
  }, []);

  // Guard so a burst of dragenter events (children) can't toggle open→closed.
  const springOpenedRef = useRef(false);
  useEffect(() => { if (open) springOpenedRef.current = false; }, [open]);
  const springOpen = () => {
    if (open || springOpenedRef.current) return;
    springOpenedRef.current = true;
    onToggle();
  };
  // A drag event belongs to the bin only if its DOM target is really inside the
  // section. React bubbles events out of PORTALS (the import wizard / image
  // editor dialogs render inside this component), so without this a drop on
  // the wizard's own drop zone would be imported twice.
  const ownsDragEvent = (e: React.DragEvent) =>
    isOsFileDrag(e.dataTransfer?.types) && (e.currentTarget as HTMLElement).contains(e.target as Node);
  const armOverlay = () => {
    setFileDragOver(true);
    // Fallback: an OS drag cancelled with Esc may never send dragleave/drop.
    if (dragClearTimerRef.current) window.clearTimeout(dragClearTimerRef.current);
    dragClearTimerRef.current = window.setTimeout(() => setFileDragOver(false), 1500);
  };
  const onBinDragEnter = (e: React.DragEvent) => {
    if (!ownsDragEvent(e)) return;
    e.preventDefault();
    springOpen(); // collapsed bin springs open for a file drag
    armOverlay();
  };
  const onBinDragOver = (e: React.DragEvent) => {
    if (!ownsDragEvent(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    armOverlay();
  };
  const onBinDragLeave = (e: React.DragEvent) => {
    if (!isRealDragLeave(e.currentTarget as HTMLElement, e.relatedTarget)) return;
    setFileDragOver(false);
  };
  const onBinDrop = (e: React.DragEvent) => {
    if (!ownsDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragOver(false);
    springOpen();
    // Entries must be read synchronously from the live DataTransfer.
    void collectDroppedFiles(e.dataTransfer)
      .then(({ files, truncated }) => queueRef.current?.importFiles(files, { truncated }))
      .catch(() => toast.error("Couldn't read the dropped files"));
  };

  // Safety net: a file dropped anywhere that ISN'T a drop target must not make
  // the page (or the desktop shell) navigate to / open the file. Only OS-file
  // drags are touched; element drop handlers run first (bubble phase) and mark
  // the event handled; native <input type=file> drops are left alone.
  useEffect(() => {
    const onOver = (e: DragEvent) => {
      if (!isOsFileDrag(e.dataTransfer ? Array.from(e.dataTransfer.types) : null)) return;
      if (isFileInputTarget(e.target)) return;
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      setFileDragOver(false);
      if (!isOsFileDrag(e.dataTransfer ? Array.from(e.dataTransfer.types) : null)) return;
      if (isFileInputTarget(e.target)) return;
      if (e.defaultPrevented) return; // a real drop target handled it
      e.preventDefault();
      toast.info("Drop files on the Media Bin to upload them", { id: "pf-stray-file-drop" });
    };
    const onLeaveWindow = (e: DragEvent) => { if (!e.relatedTarget) setFileDragOver(false); };
    const clear = () => setFileDragOver(false);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragleave", onLeaveWindow);
    window.addEventListener("dragend", clear);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragleave", onLeaveWindow);
      window.removeEventListener("dragend", clear);
      if (dragClearTimerRef.current) window.clearTimeout(dragClearTimerRef.current);
    };
  }, []);

  // ── Resize (item 1) — pointer-drag the top edge; up = taller, down = shorter ─
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = dragH ?? (poppedOut ? POPPED_H : height);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    // rAF-gate: pointermove fires far faster than we can paint. Stash the latest
    // height and flush at most once per frame so we don't queue a setState (and
    // a full strip+thumbnail re-layout) on every raw move event.
    let rafId: number | null = null;
    let pendingH: number | null = null;
    const flush = () => {
      rafId = null;
      if (pendingH !== null) setDragH(pendingH);
    };
    const onMove = (ev: PointerEvent) => {
      pendingH = Math.max(MIN_H, Math.min(MAX_H, Math.round(startH + (startY - ev.clientY))));
      if (rafId === null) rafId = window.requestAnimationFrame(flush);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }
      const finalH = Math.max(MIN_H, Math.min(MAX_H, Math.round(startH + (startY - ev.clientY))));
      setDragH(null);
      onResize?.(finalH);
      // Manual height now owns — leave pop-out preset if it was active.
      if (poppedOut) onTogglePopout?.();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const count = assets?.length ?? 0;
  const GRID_CAP = 60;
  const shown = assets ? assets.slice(0, GRID_CAP) : [];
  const overflow = Math.max(0, count - GRID_CAP);

  // Effective open height + thumbnail scaling: taller strip ⇒ bigger boxes.
  const effH = dragH ?? (poppedOut ? POPPED_H : height);
  const thumbMin = Math.round(Math.max(84, Math.min(170, 84 + (effH - 148) * 0.35)));

  return (
    <section
      className={cn(
        "relative border-t border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col min-h-0 shrink-0",
      )}
      onDragEnter={onBinDragEnter}
      onDragOver={onBinDragOver}
      onDragLeave={onBinDragLeave}
      onDrop={onBinDrop}
    >
      {/* OS file drop overlay — pointer-events:none so it never steals the drop. */}
      <div className="pf-bin-drop" data-on={fileDragOver ? "" : undefined} aria-hidden>
        <span className="pf-bin-drop-label"><Upload className="w-4 h-4" /> Drop to add to Media Bin</span>
      </div>
      <span className="sr-only" aria-live="polite">
        {uploadingCount > 0 ? `Uploading ${uploadingCount} file${uploadingCount === 1 ? "" : "s"}` : ""}
      </span>
      {confirmDialog}
      {/* Resize handle — only meaningful when the bin is open. A thin grab strip
          on the TOP edge; pull up to enlarge, down to shrink. */}
      {open && onResize && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the media bin — drag up to enlarge, down to shrink"
          title="Drag to resize the media bin"
          onPointerDown={startResize}
          className="group h-2 -mb-1 cursor-row-resize flex items-center justify-center shrink-0 touch-none"
        >
          <GripHorizontal className="w-4 h-4 text-[var(--color-muted-foreground)] opacity-40 group-hover:opacity-90 group-hover:text-[var(--color-brand)] transition-opacity" />
        </div>
      )}

      <header className="flex items-center h-8 px-2.5 gap-1 bg-[linear-gradient(180deg,var(--color-panel),transparent)] shrink-0">
        <button type="button" className="flex items-center gap-1 shrink-0 text-left" onClick={onToggle}>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="eyebrow" title="Media Bin — drag files here from Finder or File Explorer to upload">Media Bin</span>
          {assets !== null && (
            <span className="ml-1.5 min-w-[16px] h-[15px] px-1 grid place-items-center rounded-full bg-[var(--color-brand)]/16 text-[var(--color-brand)] text-[9px] font-mono font-bold tabular-nums">{count}</span>
          )}
          {uploadingCount > 0 && (
            <span className="ml-1 h-[15px] px-1.5 grid place-items-center rounded-full bg-[var(--color-brand)]/16 text-[var(--color-brand)] text-[9px] font-semibold tabular-nums">
              Uploading {uploadingCount}
            </span>
          )}
        </button>
        <span className="h-px flex-1 mx-2" style={{ background: "linear-gradient(90deg, var(--color-border), transparent)" }} aria-hidden />
        {/* Upload image / video (item 3) — only when the bin is open. */}
        {open && (
          <>
            <input ref={imgInputRef} type="file" accept="image/*" multiple hidden onChange={onFilesPicked} />
            <input ref={vidInputRef} type="file" accept="video/*" multiple hidden onChange={onFilesPicked} />
            <button
              type="button"
              onClick={() => pickFiles("image")}
              title="Upload image"
              aria-label="Upload image"
              className="h-[22px] px-1.5 grid grid-flow-col items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[10px] font-semibold text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-brand)] hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))]"
            >
              <ImagePlus className="w-3 h-3" /> Image
            </button>
            <button
              type="button"
              onClick={() => pickFiles("video")}
              title="Upload video"
              aria-label="Upload video"
              className="h-[22px] px-1.5 grid grid-flow-col items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[10px] font-semibold text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-brand)] hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))]"
            >
              <Film className="w-3 h-3" /> Video
            </button>
          </>
        )}
        {open && onTogglePopout && (
          <button
            type="button"
            onClick={onTogglePopout}
            title={poppedOut ? "Shrink the media bin" : "Pop out — show a taller media bin"}
            aria-label={poppedOut ? "Shrink the media bin" : "Pop out the media bin"}
            className="w-[22px] h-[22px] grid place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-brand)] hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))]"
          >
            {poppedOut ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => onCenterMode?.("media")}
          title="Open the full Media library"
          className="w-[22px] h-[22px] grid place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-brand)] hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))]"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </header>

      {/* Upload queue stays MOUNTED while collapsed so uploads keep going. */}
      <div className={open ? undefined : "hidden"}>
        <MediaBinUploadQueue
          ref={queueRef}
          refresh={refreshAfterUpload}
          onOpenWizard={openWizardWith}
          onActiveCountChange={setUploadingCount}
          live={!!ctx?.liveSlide}
          thumbMin={thumbMin}
        />
      </div>
      {open && (
        <div className="overflow-y-auto p-2" style={{ height: effH }}>
          {assets === null && (
            <div className="text-[11px] text-[var(--color-muted-foreground)] opacity-60 px-1 py-2">Loading media…</div>
          )}
          {assets !== null && assets.length === 0 && uploadingCount === 0 && (
            <div className="flex flex-col items-start gap-1.5 px-1 py-2">
              <span className="text-[11px] text-[var(--color-muted-foreground)]">No media yet.</span>
              <button
                onClick={() => pickFiles("image")}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline"
              >
                <Upload className="w-3 h-3" /> Upload your first image or video
              </button>
              <span className="text-[10px] text-[var(--color-muted-foreground)] opacity-70">…or drag files here from Finder or File Explorer (images, video, PowerPoint, PDF)</span>
            </div>
          )}
          {assets && assets.length > 0 && (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbMin}px, 1fr))` }}>
              {shown.map((a) => {
                if (isAudioAsset(a)) {
                  return (
                    <ContextMenu.Root key={a.id}>
                      <ContextMenu.Trigger asChild>
                        <div>
                          <AudioTile asset={a} onPreview={() => setPreview(a)} />
                        </div>
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[190px]">
                          <ContextMenu.Item onSelect={() => setPreview(a)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center gap-2">
                            <Music className="w-3.5 h-3.5 opacity-80" /> Listen (this computer only)
                          </ContextMenu.Item>
                          <ContextMenu.Sub>
                            <ContextMenu.SubTrigger className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center justify-between gap-2 data-[state=open]:bg-[var(--color-panel)]">
                              <span className="flex items-center gap-2"><FolderInput className="w-3.5 h-3.5 opacity-80" /> Move to library</span><span className="opacity-60">▸</span>
                            </ContextMenu.SubTrigger>
                            <ContextMenu.Portal>
                              <ContextMenu.SubContent className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[160px] max-h-[300px] overflow-y-auto">
                                <ContextMenu.Item onSelect={() => void moveToLibrary(a, null)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer">Default (unfiled)</ContextMenu.Item>
                                {libs.map((lib) => (
                                  <ContextMenu.Item key={lib.id} onSelect={() => void moveToLibrary(a, lib.id)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer truncate">{lib.name}</ContextMenu.Item>
                                ))}
                              </ContextMenu.SubContent>
                            </ContextMenu.Portal>
                          </ContextMenu.Sub>
                          <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                          <ContextMenu.Item onSelect={() => void deleteAsset(a)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer text-[var(--color-destructive)] flex items-center gap-2">
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </ContextMenu.Item>
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    </ContextMenu.Root>
                  );
                }
                const isVideo = (a.kind || "").startsWith("video");
                return (
                  <ContextMenu.Root key={a.id}>
                    <ContextMenu.Trigger asChild>
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "copyMove";
                          e.dataTransfer.setData(
                            "application/x-pf-library-item",
                            JSON.stringify({ pfType: "media", id: a.id, title: a.fileName || "Media", url: a.url, kind: a.kind }),
                          );
                        }}
                        onPointerDown={(e) => { pointerDownRef.current = { x: e.clientX, y: e.clientY }; }}
                        onClick={(e) => {
                          // Ignore a click that was actually an aborted drag-grab (pointer
                          // moved >6px between down and up) — that must NOT project.
                          const dn = pointerDownRef.current; pointerDownRef.current = null;
                          if (dn) {
                            const dx = e.clientX - dn.x, dy = e.clientY - dn.y;
                            if (dx * dx + dy * dy > 36) return;
                          }
                          // E1: single-click sends this media LIVE as a slide (deferred so a
                          // double-click can cancel it and preview instead). Falls back to
                          // opening the full library if there's no live pipeline (ctx).
                          if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
                          clickTimerRef.current = window.setTimeout(() => {
                            clickTimerRef.current = null;
                            // A click ALWAYS sends the media live to the screen (framed if it
                            // has a saved edit). Only the "Bg" button / "Set as background"
                            // menu items change the background behind every slide
                            // (user-directed 2026-09-17 — a click must never set a background).
                            if (!ctx) { onCenterMode?.("media"); return; }
                            if (mediaClickAction(a.kind) === "send-live") sendAsSlide(a);
                            else toast.error(AUDIO_NOT_PROJECTABLE);
                          }, 250);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (clickTimerRef.current) { window.clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
                          setPreview(a);
                        }}
                        title={`${a.fileName || "Media"} — click to send live · double-click to preview · drag onto a slide · right-click for options`}
                        className="group relative aspect-video rounded-md overflow-hidden bg-black border border-[var(--color-border)] cursor-grab active:cursor-grabbing hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] transition-colors"
                      >
                        {a.url ? (
                          isVideo ? (
                            // eslint-disable-next-line jsx-a11y/media-has-caption
                            <video src={a.url} muted preload="none" poster={a.thumbUrl || undefined} className="w-full h-full object-cover pointer-events-none" />
                          ) : (
                            <FramedImage churchId={ctx?.churchId} assetId={a.id} src={a.thumbUrl || a.url} fullSrc={a.url} alt={a.fileName || ""} className="w-full h-full object-cover pointer-events-none" />
                          )
                        ) : (
                          <div className="w-full h-full grid place-items-center text-[9px] text-[var(--color-muted-foreground)] px-1 text-center">{a.fileName || a.kind || "Asset"}</div>
                        )}
                        {/* Hover Bg pill — kept as a quick affordance (item 4 keeps it). */}
                        <button
                          type="button"
                          aria-label="Set as background"
                          title="Set as background — stays behind your lyrics for every slide"
                          onClick={(e) => { e.stopPropagation(); setAsBackground(a); }}
                          className="absolute right-0.5 bottom-0.5 z-10 inline-flex h-5 px-1 items-center gap-0.5 rounded bg-black/65 text-white/85 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/85 hover:text-white text-[9px] font-semibold"
                        >
                          <Images className="w-2.5 h-2.5" /> Bg
                        </button>
                      </div>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[190px]">
                        <ContextMenu.Item onSelect={() => sendAsSlide(a)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center gap-2">
                          <MonitorPlay className="w-3.5 h-3.5 opacity-80" /> Send as slide
                        </ContextMenu.Item>
                        <ContextMenu.Item onSelect={() => setCurrentSlideBg(a)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center gap-2">
                          <PanelBottom className="w-3.5 h-3.5 opacity-80" /> Set as current slide&rsquo;s background
                        </ContextMenu.Item>
                        <ContextMenu.Item onSelect={() => setAsBackground(a)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center gap-2">
                          <Images className="w-3.5 h-3.5 opacity-80" /> Set as global background
                        </ContextMenu.Item>
                        {!isVideo && (
                          <ContextMenu.Item onSelect={() => editImage(a)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center gap-2">
                            <Pencil className="w-3.5 h-3.5 opacity-80" /> Edit image (crop &amp; frame)
                          </ContextMenu.Item>
                        )}
                        <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                        <ContextMenu.Sub>
                          <ContextMenu.SubTrigger className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center justify-between gap-2 data-[state=open]:bg-[var(--color-panel)]">
                            <span className="flex items-center gap-2"><FolderInput className="w-3.5 h-3.5 opacity-80" /> Move to library</span><span className="opacity-60">▸</span>
                          </ContextMenu.SubTrigger>
                          <ContextMenu.Portal>
                            <ContextMenu.SubContent className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-lg z-50 min-w-[160px] max-h-[300px] overflow-y-auto">
                              <ContextMenu.Item onSelect={() => void moveToLibrary(a, null)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer">Default (unfiled)</ContextMenu.Item>
                              {libs.length > 0 && <ContextMenu.Separator className="h-px my-1 bg-[var(--color-border)]" />}
                              {libs.map((lib) => (
                                <ContextMenu.Item key={lib.id} onSelect={() => void moveToLibrary(a, lib.id)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer truncate">{lib.name}</ContextMenu.Item>
                              ))}
                            </ContextMenu.SubContent>
                          </ContextMenu.Portal>
                        </ContextMenu.Sub>
                        <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />
                        <ContextMenu.Item onSelect={() => void deleteAsset(a)} className="px-3 py-1.5 rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer text-[var(--color-destructive)] flex items-center gap-2">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                );
              })}
            </div>
          )}
          {overflow > 0 && (
            <button
              type="button"
              onClick={() => onCenterMode?.("media")}
              className="mt-1.5 w-full text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-brand)] underline underline-offset-2 px-1 py-1.5 text-left"
              title="Open the full Media library"
            >
              Open full library ({overflow} more)
            </button>
          )}
        </div>
      )}

      {/* Upload wizard — reused; on import re-pull the bin + notify the library. */}
      <MediaImportWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); setWizardFiles(undefined); }}
        onImported={() => { void load(); window.dispatchEvent(new CustomEvent("presentflow:libraries-changed")); }}
        initialFiles={wizardFiles}
        autoStartDecks={wizardFromDrop}
      />

      {/* Double-click quick preview (item 4) */}
      {preview && <MediaPreviewModal asset={preview} churchId={ctx?.churchId} onClose={() => setPreview(null)} />}

      {/* E2: crop/frame image editor — same modal the full Media browser uses. */}
      {editAsset && ctx && (
        <MediaImageEditor
          asset={editAsset}
          ctx={ctx}
          onClose={() => setEditAsset(null)}
          onAssetReplaced={(a) => { setEditAsset(a); void load(); }}
        />
      )}
    </section>
  );
}

// ── Quick preview modal ───────────────────────────────────────────────────────
function MediaPreviewModal({ asset, onClose, churchId }: { asset: Asset; onClose: () => void; churchId?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  const isVideo = (asset.kind || "").startsWith("video");
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${asset.fileName || "media"}`}
      onClick={onClose}
      className="fixed inset-0 z-[200] grid place-items-center bg-black/80 p-6"
    >
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white/85 hover:bg-black/85 hover:text-white transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
      <div onClick={(e) => e.stopPropagation()} className="max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-2">
        {asset.url ? (
          isAudioAsset(asset) ? (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-[var(--color-elevated)] p-6">
              <Music className="w-10 h-10 text-white/70" />
              {/* Local listen only — never routed to any output. */}
              <audio src={asset.url} controls autoPlay className="w-[min(420px,80vw)]" />
            </div>
          ) : isVideo ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={asset.url} controls autoPlay className="max-w-[90vw] max-h-[80vh] rounded-lg shadow-2xl" />
          ) : (
            <FramedImage churchId={churchId} assetId={asset.id} src={asset.url} alt={asset.fileName || ""} canvasWidth={1280} className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl" />
          )
        ) : (
          <div className="text-white/70 text-sm">This asset has no file to preview.</div>
        )}
        {asset.fileName && <span className="text-[12px] text-white/80 truncate max-w-[80vw]">{asset.fileName}</span>}
      </div>
    </div>,
    document.body,
  );
}

// ── Audio tile (music icon + filename + duration; never draggable / live) ─────
function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AudioTile({ asset, onPreview }: { asset: Asset; onPreview: () => void }) {
  const [duration, setDuration] = useState("");
  useEffect(() => {
    if (!asset.url) return;
    // Metadata-only load (a few KB) just to read the duration.
    const el = new Audio();
    el.preload = "metadata";
    const onMeta = () => setDuration(formatDuration(el.duration));
    el.addEventListener("loadedmetadata", onMeta);
    el.src = asset.url;
    return () => { el.removeEventListener("loadedmetadata", onMeta); el.removeAttribute("src"); el.load(); };
  }, [asset.url]);
  return (
    <button
      type="button"
      onDoubleClick={onPreview}
      title={`${asset.fileName || "Audio"} — audio files can't be shown on screen yet · double-click to listen · right-click for options`}
      className="relative aspect-video w-full rounded-md overflow-hidden bg-[var(--color-elevated)] border border-[var(--color-border)] flex flex-col items-center justify-center gap-0.5 text-left hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] transition-colors"
    >
      <Music className="w-5 h-5 text-[var(--color-muted-foreground)]" aria-hidden />
      {duration && <span className="text-[9px] tabular-nums text-[var(--color-muted-foreground)]">{duration}</span>}
      <span className="absolute left-0 right-0 bottom-0 px-1 py-0.5 truncate text-[9px] text-white/85 bg-gradient-to-t from-black/70 to-transparent">{asset.fileName || "Audio"}</span>
    </button>
  );
}
