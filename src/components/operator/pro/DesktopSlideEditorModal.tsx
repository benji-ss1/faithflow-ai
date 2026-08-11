"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus, Square, Circle, Type, Image as ImageIcon, Trash2 } from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import { useSlideEditor } from "../editor/useSlideEditor";
import { SlideEditorProvider, useSlideEditorCtx, type SlideEditorContextValue } from "../editor/SlideEditorContext";
import { CenterWorkspace } from "../shell/CenterWorkspace";
import { MediaLibraryPicker } from "@/components/library/MediaLibraryPicker";
import { saveSlideObjects, createSongSlide, deleteSongSlide, reorderSongSlides } from "@/lib/actions";
import type { SlideObject, TextObject, ShapeObject, ImageObject } from "@/lib/slide-objects";

/**
 * Desktop full-screen slide editor (Phase 2 of the ProPresenter-style editor).
 * Opened from the SlideGrid (double-click a song slide) as an overlay over the
 * operator console. Reuses the existing CenterWorkspace (canvas + slide rail +
 * save/show) and the useSlideEditor hook — same editing engine as the web shell,
 * whose designs now project verbatim (Phase 1). Adds a compact object inspector
 * (add text/shape/image + selected-object props) so operators can design
 * multi-object lyric/verse slides without leaving the desktop console.
 */
export function DesktopSlideEditorModal({ ctx, open, onClose }: {
  ctx: OperatorShellCtx;
  open: boolean;
  onClose: () => void;
}) {
  const item = ctx.plan.items[ctx.previewItemIdx];
  const itemId = item?.id ?? null;
  const itemType = item?.type ?? null;
  const songId = item?.songId ?? null;

  const initialSlides = item?.songSlideRows ??
    (item?.slides.map((s, i) => ({
      id: `readonly_${item.id}_${i}`,
      lyrics: s.kind === "text" ? s.text : `[${s.kind}]`,
      objectsJson: null,
    })) ?? []);

  const editor = useSlideEditor({ itemId, itemType: itemType ?? "blank", songId, initialSlides });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const router = useRouter();

  // Persist: mirror OperatorShell.onSave — delete removed, create new, save
  // objects for existing, then reorder to the local sequence.
  const onSave = useCallback(async () => {
    if (!editor.isEditable || !songId) return;
    setSaveState("saving");
    try {
      const dbIds = (item?.songSlideRows ?? []).map((r) => r.id);
      const localIds = editor.slides.map((s) => s.id);
      for (const id of dbIds) {
        if (!localIds.includes(id)) await deleteSongSlide(id);
      }
      const finalIds: string[] = [];
      for (let i = 0; i < editor.slides.length; i++) {
        const s = editor.slides[i];
        if (dbIds.includes(s.id)) {
          finalIds.push(s.id);
          await saveSlideObjects(s.id, { bgColor: s.bgColor, bgImageUrl: s.bgImageUrl, objects: s.objects, lyrics: s.lyrics });
        } else {
          const res = await createSongSlide(songId, i, { bgColor: s.bgColor, bgImageUrl: s.bgImageUrl, objects: s.objects, lyrics: s.lyrics });
          if (!res.ok) throw new Error(res.error);
          finalIds.push(res.data!.id);
        }
      }
      if (finalIds.length > 0) await reorderSongSlides(songId, finalIds);
      editor.resetDirty();
      setSaveState("idle");
      toast.success("Slides saved");
      // Refresh so the projector-facing plan (getExpandedServicePlan) picks up
      // the new objects immediately (same pattern as PlaylistSection).
      router.refresh();
    } catch (e) {
      setSaveState("error");
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }, [editor, songId, item, router]);

  const onShow = useCallback(() => {
    if (!item) return;
    ctx.onJumpSlide(ctx.previewItemIdx, editor.currentIndex);
  }, [editor, ctx, item]);

  // Open on the slide the operator double-clicked (they're the same item).
  useEffect(() => {
    if (open) editor.setCurrentIndex(ctx.previewSlideIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const requestClose = useCallback(() => {
    if (editor.hasDirtyChanges && !confirm("Discard unsaved slide changes?")) return;
    onClose();
  }, [editor.hasDirtyChanges, onClose]);

  const providerValue: SlideEditorContextValue = { ...editor, itemId, itemType, songId, saveState, onSave, onShow };

  // Radix Dialog (not a bare div) so the modal registers as an open overlay:
  // this trips the operator hotkey guard (anyOverlayOpen) — so Esc no longer
  // blanks live, Enter no longer fires a slide, and arrow keys no longer switch
  // songs out from under the editor — and it traps focus + closes on Esc, all
  // routed through the dirty guard.
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70]" style={{ background: "rgba(0,0,0,0.6)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => { e.preventDefault(); requestClose(); }}
          onInteractOutside={(e) => { e.preventDefault(); requestClose(); }}
          className="fixed left-1/2 top-1/2 z-[71] -translate-x-1/2 -translate-y-1/2 w-[95vw] h-[92vh] flex flex-col rounded-xl overflow-hidden border shadow-2xl outline-none"
          style={{ borderColor: "#2a3232", background: "#171c1c" }}
        >
          <header className="h-11 shrink-0 flex items-center gap-2 px-3 border-b" style={{ borderColor: "#2a3232", background: "#1a2020" }}>
            <Type className="w-4 h-4 text-teal-300" />
            <Dialog.Title className="text-[12px] font-semibold text-zinc-100">Edit slide</Dialog.Title>
            <span className="text-[11px] text-zinc-500 truncate">— {item?.title ?? ""}</span>
            {!songId && <span className="text-[10px] italic text-amber-300/80 ml-1">Only song slides are editable</span>}
            <button
              onClick={requestClose}
              className="ml-auto grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
              aria-label="Close editor"
            >
              <X className="w-4 h-4" />
            </button>
          </header>

          <SlideEditorProvider value={providerValue}>
            <div className="flex-1 min-h-0 flex">
              {/* Reused canvas + slide rail + save/show */}
              <CenterWorkspace ctx={ctx} />
              {/* Object inspector (new, compact) */}
              <ObjectInspector />
            </div>
          </SlideEditorProvider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Object inspector ────────────────────────────────────────────────────────
// Add-object toolbar + type-specific properties for the selected object, plus
// the per-slide background. Reads the same editor context the canvas uses.
const FONTS = ["Inter", "Sora", "Plus Jakarta Sans", "Georgia", "Helvetica", "Arial", "Times New Roman"];

function ObjectInspector() {
  const editor = useSlideEditorCtx();
  const [imgUrl, setImgUrl] = useState("");
  const [libOpen, setLibOpen] = useState(false);
  if (!editor || !editor.isEditable) {
    return <aside className="w-64 shrink-0 border-l p-3 text-[11px] text-zinc-500" style={{ borderColor: "#2a3232", background: "#1a2020" }}>Editing is available for song slides.</aside>;
  }
  const slide = editor.currentSlide;
  const selected = slide?.objects.find((o) => o.id === editor.selectedObjectId) ?? null;

  const upd = (patch: Partial<SlideObject>) => { if (selected) editor.updateObject(selected.id, patch); };

  return (
    <aside className="w-64 shrink-0 border-l overflow-y-auto" style={{ borderColor: "#2a3232", background: "#1a2020" }}>
      {/* Add-object toolbar */}
      <div className="p-2 border-b grid grid-cols-2 gap-1.5" style={{ borderColor: "#2a3232" }}>
        <ToolBtn icon={Type} label="Text" onClick={editor.addTextObject} />
        <ToolBtn icon={Square} label="Rect" onClick={() => editor.addShape("rect")} />
        <ToolBtn icon={Circle} label="Ellipse" onClick={() => editor.addShape("ellipse")} />
        <ToolBtn icon={Plus} label="Slide" onClick={editor.addSlide} />
      </div>

      {/* Add image — from the media library, or by URL */}
      <div className="p-2 border-b space-y-1.5" style={{ borderColor: "#2a3232" }}>
        <label className="block text-[9px] uppercase tracking-wide text-zinc-500">Add image</label>
        <button onClick={() => setLibOpen(true)}
          className="w-full h-7 rounded border text-[10px] font-bold uppercase text-zinc-200 inline-flex items-center justify-center gap-1.5 hover:bg-white/[0.04]"
          style={{ borderColor: "#2a3232", background: "#1e2525" }}>
          <ImageIcon className="w-3 h-3" /> From media library
        </button>
        <div className="flex gap-1">
          <input value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} placeholder="…or paste image URL"
            className="flex-1 h-7 px-1.5 rounded border text-[11px] text-zinc-200 bg-[#151a1a] outline-none focus:border-teal-500/60" style={{ borderColor: "#2a3232" }} />
          <button onClick={() => { if (imgUrl.trim()) { editor.addImage(imgUrl.trim()); setImgUrl(""); } }}
            className="h-7 px-2 rounded border text-[10px] font-bold uppercase text-zinc-200" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            Add
          </button>
        </div>
        {libOpen && (
          <MediaLibraryPicker kind="image" onPick={(url) => editor.addImage(url)} onClose={() => setLibOpen(false)} />
        )}
      </div>

      {/* Selected-object props */}
      {selected ? (
        <div className="p-2 space-y-2 border-b" style={{ borderColor: "#2a3232" }}>
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wide text-zinc-400">{selected.kind} object</span>
            <button onClick={() => editor.removeObject(selected.id)} className="grid h-6 w-6 place-items-center rounded text-red-300 hover:bg-red-500/10" title="Delete object">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          {selected.kind === "text" && <TextProps o={selected} upd={upd} />}
          {selected.kind === "shape" && <ShapeProps o={selected} upd={upd} />}
          {selected.kind === "image" && <ImageProps o={selected} upd={upd} />}
        </div>
      ) : (
        <div className="p-2 text-[11px] text-zinc-500 border-b" style={{ borderColor: "#2a3232" }}>Select an object on the canvas to edit it.</div>
      )}

      {/* Slide background */}
      <div className="p-2 space-y-1.5">
        <label className="block text-[9px] uppercase tracking-wide text-zinc-500">Slide background</label>
        <input type="color" value={slide?.bgColor ?? "#0b0b0b"} onChange={(e) => editor.setBg({ bgColor: e.target.value })}
          className="h-7 w-full rounded border cursor-pointer bg-transparent" style={{ borderColor: "#2a3232" }} />
      </div>
    </aside>
  );
}

function ToolBtn({ icon: Icon, label, onClick }: { icon: typeof Type; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="h-8 rounded-md border text-[10px] font-bold uppercase inline-flex items-center justify-center gap-1 text-zinc-200 hover:bg-white/[0.04]"
      style={{ borderColor: "#2a3232", background: "#1e2525" }}>
      <Icon className="w-3 h-3" /> {label}
    </button>
  );
}

const rowCls = "block text-[9px] uppercase tracking-wide text-zinc-500 mb-0.5";
const inCls = "w-full h-7 px-1.5 rounded border text-[11px] text-zinc-200 bg-[#151a1a] outline-none focus:border-teal-500/60";

function TextProps({ o, upd }: { o: TextObject; upd: (p: Partial<SlideObject>) => void }) {
  return (
    <>
      <div><span className={rowCls}>Font</span>
        <select value={o.fontFamily ?? "Inter"} onChange={(e) => upd({ fontFamily: e.target.value })} className={inCls} style={{ borderColor: "#2a3232" }}>
          {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div><span className={rowCls}>Size (px)</span>
          <input type="number" min={8} max={800} value={o.fontSize ?? 96} onChange={(e) => upd({ fontSize: Number(e.target.value) })} className={inCls} style={{ borderColor: "#2a3232" }} />
        </div>
        <div><span className={rowCls}>Weight</span>
          <select value={String(o.fontWeight ?? 600)} onChange={(e) => upd({ fontWeight: Number(e.target.value) })} className={inCls} style={{ borderColor: "#2a3232" }}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div><span className={rowCls}>Colour</span>
          <input type="color" value={o.color ?? "#ffffff"} onChange={(e) => upd({ color: e.target.value })} className="h-7 w-full rounded border cursor-pointer bg-transparent" style={{ borderColor: "#2a3232" }} />
        </div>
        <div><span className={rowCls}>Align</span>
          <div className="flex gap-0.5">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} onClick={() => upd({ align: a })}
                className={`flex-1 h-7 rounded border text-[9px] uppercase ${(o.align ?? "center") === a ? "border-teal-400 bg-teal-500/20 text-teal-100" : "text-zinc-400"}`}
                style={(o.align ?? "center") === a ? undefined : { borderColor: "#2a3232" }}>{a[0]}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ShapeProps({ o, upd }: { o: ShapeObject; upd: (p: Partial<SlideObject>) => void }) {
  return (
    <>
      <div><span className={rowCls}>Fill</span>
        <input type="color" value={o.fill ?? "#14b8a6"} onChange={(e) => upd({ fill: e.target.value })} className="h-7 w-full rounded border cursor-pointer bg-transparent" style={{ borderColor: "#2a3232" }} />
      </div>
      <div><span className={rowCls}>Opacity — {Math.round((o.opacity ?? 1) * 100)}%</span>
        <input type="range" min={0} max={100} value={(o.opacity ?? 1) * 100} onChange={(e) => upd({ opacity: Number(e.target.value) / 100 })} className="w-full" />
      </div>
      {o.shape === "rect" && (
        <div><span className={rowCls}>Corner radius — {o.radius ?? 0}px</span>
          <input type="range" min={0} max={200} value={o.radius ?? 0} onChange={(e) => upd({ radius: Number(e.target.value) })} className="w-full" />
        </div>
      )}
    </>
  );
}

function ImageProps({ o, upd }: { o: ImageObject; upd: (p: Partial<SlideObject>) => void }) {
  return (
    <div><span className={rowCls}>Fit</span>
      <div className="flex gap-0.5">
        {(["contain", "cover"] as const).map((f) => (
          <button key={f} onClick={() => upd({ fit: f })}
            className={`flex-1 h-7 rounded border text-[9px] uppercase ${(o.fit ?? "contain") === f ? "border-teal-400 bg-teal-500/20 text-teal-100" : "text-zinc-400"}`}
            style={(o.fit ?? "contain") === f ? undefined : { borderColor: "#2a3232" }}>{f}</button>
        ))}
      </div>
    </div>
  );
}
