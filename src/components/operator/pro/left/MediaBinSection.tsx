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
import { projectableTextSlide, type SlidePayload } from "@/lib/broadcast";
import { MediaImportWizard } from "../center/MediaImportWizard";

type Asset = {
  id: string;
  fileName?: string | null;
  kind?: string | null;
  url?: string | null;
  thumbUrl?: string | null;
  mediaKey?: string | null;
};

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
  const [preview, setPreview] = useState<Asset | null>(null);
  // Live drag height override while the operator is pulling the handle.
  const [dragH, setDragH] = useState<number | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const imgInputRef = useRef<HTMLInputElement>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);
  // Defer a single-click (open full library) so a double-click (quick preview)
  // cancels it — otherwise the first click of a dblclick navigates away first.
  const clickTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current); }, []);

  useEffect(() => { if (open) setHasOpened(true); }, [open]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/media/list", { cache: "no-store" });
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
  const setAsBackground = (a: Asset) => {
    if (!a.url) { toast.error("This asset has no file to use as a background"); return; }
    const prev = snapshotBackgroundState();
    const bg = setMediaAsBackground({
      id: a.id, url: a.url, fileName: a.fileName || "Media",
      kind: normalizeMediaKind(a.kind || "image"), mediaKey: a.mediaKey || undefined,
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
    if (!a.url) return null;
    if ((a.kind || "").startsWith("video")) return { kind: "video", url: a.url, fit: "contain" };
    const frame = ctx ? loadMediaFrame(ctx.churchId, a.id) : null;
    if (frame) {
      const { bgColor, objects } = buildMediaFrameSlide(frame, a.url);
      return projectableTextSlide("", bgColor, undefined, objects);
    }
    return { kind: "image", url: a.url, fit: "contain" };
  };

  const sendAsSlide = (a: Asset) => {
    const slide = toSlide(a);
    if (!slide || !ctx) { toast.error("Can't send this asset"); return; }
    ctx.onSendSlideToLive(slide);
    toast.success(`Sent “${a.fileName || "Media"}” to the screen`);
  };

  // Set as the CURRENTLY-LIVE slide's per-slide background (images only). Re-sends
  // the live text slide with bgImageUrl set — the words stay on top, exactly like
  // the drag-onto-slide path (6C). No-op with a clear message when nothing text is live.
  const setCurrentSlideBg = (a: Asset) => {
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
    ctx.onSendSlideToLive({ ...live, bgImageUrl: a.url }, null, { instant: true });
    toast.success("Background set on the live slide");
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
    setWizardOpen(true);
  };

  // ── Resize (item 1) — pointer-drag the top edge; up = taller, down = shorter ─
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = dragH ?? (poppedOut ? POPPED_H : height);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(MIN_H, Math.min(MAX_H, Math.round(startH + (startY - ev.clientY))));
      setDragH(next);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
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
        "border-t border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col min-h-0 shrink-0",
      )}
    >
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
          <span className="eyebrow">Media Bin</span>
          {assets !== null && (
            <span className="ml-1.5 min-w-[16px] h-[15px] px-1 grid place-items-center rounded-full bg-[var(--color-brand)]/16 text-[var(--color-brand)] text-[9px] font-mono font-bold tabular-nums">{count}</span>
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

      {open && (
        <div className="overflow-y-auto p-2" style={{ height: effH }}>
          {assets === null && (
            <div className="text-[11px] text-[var(--color-muted-foreground)] opacity-60 px-1 py-2">Loading media…</div>
          )}
          {assets !== null && assets.length === 0 && (
            <div className="flex flex-col items-start gap-1.5 px-1 py-2">
              <span className="text-[11px] text-[var(--color-muted-foreground)]">No media yet.</span>
              <button
                onClick={() => pickFiles("image")}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--color-brand)] hover:underline"
              >
                <Upload className="w-3 h-3" /> Upload your first image or video
              </button>
            </div>
          )}
          {assets && assets.length > 0 && (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbMin}px, 1fr))` }}>
              {shown.map((a) => {
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
                        onClick={() => {
                          if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
                          clickTimerRef.current = window.setTimeout(() => { clickTimerRef.current = null; onCenterMode?.("media"); }, 300);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (clickTimerRef.current) { window.clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
                          setPreview(a);
                        }}
                        title={`${a.fileName || "Media"} — drag onto a slide or the playlist · double-click to preview · right-click for options`}
                        className="group relative aspect-video rounded-md overflow-hidden bg-black border border-[var(--color-border)] cursor-grab active:cursor-grabbing hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] transition-colors"
                      >
                        {a.url ? (
                          isVideo ? (
                            // eslint-disable-next-line jsx-a11y/media-has-caption
                            <video src={a.url} muted preload="none" poster={a.thumbUrl || undefined} className="w-full h-full object-cover pointer-events-none" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.thumbUrl || a.url} alt={a.fileName || ""} loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none" />
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
      />

      {/* Double-click quick preview (item 4) */}
      {preview && <MediaPreviewModal asset={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

// ── Quick preview modal ───────────────────────────────────────────────────────
function MediaPreviewModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
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
          isVideo ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={asset.url} controls autoPlay className="max-w-[90vw] max-h-[80vh] rounded-lg shadow-2xl" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.url} alt={asset.fileName || ""} className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl" />
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
