"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus, Square, Circle, Type, Image as ImageIcon, Film, Trash2, Copy, ClipboardCopy, ClipboardPaste, ChevronsUp, ChevronsDown, ArrowUp, ArrowDown, Undo2, Redo2 } from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import { useSlideEditor } from "../editor/useSlideEditor";
import { SlideEditorProvider, useSlideEditorCtx, type SlideEditorContextValue } from "../editor/SlideEditorContext";
import { CenterWorkspace } from "../shell/CenterWorkspace";
import { MediaLibraryPicker } from "@/components/library/MediaLibraryPicker";
import { SLIDE_TEMPLATES } from "@/lib/slide-templates";
import { saveSlideObjects, createSongSlide, deleteSongSlide, reorderSongSlides } from "@/lib/actions";
import type { SlideObject, TextObject, ShapeObject, ImageObject, VideoObject, ObjectAnim } from "@/lib/slide-objects";
import { CANVAS_W, CANVAS_H, newObjectId } from "@/lib/slide-objects";
import { loadCustomTemplates, saveCustomTemplate, deleteCustomTemplate, type CustomTemplate } from "@/lib/custom-templates";

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
          onKeyDown={(e) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            const tgt = e.target as HTMLElement | null;
            if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
            const k = e.key.toLowerCase();
            if (k === "z" && !e.shiftKey) { e.preventDefault(); editor.undo(); }
            else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); editor.redo(); }
          }}
          className="fixed left-1/2 top-1/2 z-[71] -translate-x-1/2 -translate-y-1/2 w-[95vw] h-[92vh] flex flex-col rounded-xl overflow-hidden border shadow-2xl outline-none"
          style={{ borderColor: "#2a3232", background: "#171c1c" }}
        >
          <header className="h-11 shrink-0 flex items-center gap-2 px-3 border-b" style={{ borderColor: "#2a3232", background: "#1a2020" }}>
            <Type className="w-4 h-4 text-teal-300" />
            <Dialog.Title className="text-[12px] font-semibold text-zinc-100">Edit slide</Dialog.Title>
            <span className="text-[11px] text-zinc-500 truncate">— {item?.title ?? ""}</span>
            {!songId && <span className="text-[10px] italic text-amber-300/80 ml-1">Only song slides are editable</span>}
            <div className="ml-auto flex items-center gap-1">
              <button onClick={editor.undo} disabled={!editor.canUndo} title="Undo (⌘Z)"
                className="grid h-8 w-8 place-items-center rounded-md text-zinc-300 hover:bg-white/[0.06] disabled:opacity-30">
                <Undo2 className="w-4 h-4" />
              </button>
              <button onClick={editor.redo} disabled={!editor.canRedo} title="Redo (⌘⇧Z)"
                className="grid h-8 w-8 place-items-center rounded-md text-zinc-300 hover:bg-white/[0.06] disabled:opacity-30">
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={requestClose}
              className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
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
              <ObjectInspector churchId={ctx.churchId} />
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

function ObjectInspector({ churchId }: { churchId: string }) {
  const editor = useSlideEditorCtx();
  const [imgUrl, setImgUrl] = useState("");
  const [libKind, setLibKind] = useState<"image" | "video" | null>(null);
  const [customTpls, setCustomTpls] = useState<CustomTemplate[]>([]);
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  useEffect(() => { setCustomTpls(loadCustomTemplates(churchId)); }, [churchId]);
  // Clipboard for copying an object to another slide (persists while the editor
  // is open). Cleared implicitly when the modal closes.
  const [clip, setClip] = useState<SlideObject | null>(null);
  const [bgLib, setBgLib] = useState(false);
  if (!editor || !editor.isEditable) {
    return <aside className="w-64 shrink-0 border-l p-3 text-[11px] text-zinc-500" style={{ borderColor: "#2a3232", background: "#1a2020" }}>Editing is available for song slides.</aside>;
  }
  const slide = editor.currentSlide;
  const selected = slide?.objects.find((o) => o.id === editor.selectedObjectId) ?? null;

  const upd = (patch: Partial<SlideObject>) => { if (selected) editor.updateObject(selected.id, patch); };

  const confirmReplace = () => (slide?.objects.length ?? 0) === 0 || confirm("Replace this slide's content with the template?");

  const applyTemplate = (tid: string) => {
    const tpl = SLIDE_TEMPLATES.find((x) => x.id === tid);
    if (!tpl || !confirmReplace()) return;
    editor.updateSlideDirect(tpl.build());
  };

  const applyCustom = (ct: CustomTemplate) => {
    if (!confirmReplace()) return;
    // Clone objects with fresh ids so re-applying never collides ids.
    const objects = ct.objects.map((o) => ({ ...o, id: newObjectId() }));
    editor.updateSlideDirect({ objects, bgColor: ct.bgColor, bgImageUrl: ct.bgImageUrl });
  };

  const beginSaveTemplate = () => {
    if (!slide || slide.objects.length === 0) { void import("sonner").then(({ toast }) => toast.error("Add something to the slide first")); return; }
    setNameDraft("");
    setNaming(true);
  };
  const commitSaveTemplate = () => {
    const name = nameDraft.trim() || "Untitled template";
    if (!slide) return;
    setCustomTpls(saveCustomTemplate(churchId, { name, bgColor: slide.bgColor, bgImageUrl: slide.bgImageUrl, objects: slide.objects }));
    setNaming(false);
    void import("sonner").then(({ toast }) => toast.success(`Saved template "${name}"`));
  };

  const removeCustom = (id: string) => setCustomTpls(deleteCustomTemplate(churchId, id));

  return (
    <aside className="w-64 shrink-0 border-l overflow-y-auto" style={{ borderColor: "#2a3232", background: "#1a2020" }}>
      {/* Start from a template */}
      <div className="p-2 border-b" style={{ borderColor: "#2a3232" }}>
        <label className="block text-[9px] uppercase tracking-wide text-zinc-500 mb-1">Start from template</label>
        <div className="grid grid-cols-2 gap-1.5">
          {SLIDE_TEMPLATES.map((tpl) => (
            <button key={tpl.id} onClick={() => applyTemplate(tpl.id)}
              className="h-7 rounded border text-[10px] font-semibold text-zinc-200 hover:bg-white/[0.04]"
              style={{ borderColor: "#2a3232", background: "#1e2525" }}>
              {tpl.name}
            </button>
          ))}
        </div>
        {customTpls.length > 0 && (
          <>
            <div className="mt-2 mb-1 text-[9px] uppercase tracking-wide text-zinc-500">Your templates</div>
            <div className="space-y-1">
              {customTpls.map((ct) => (
                <div key={ct.id} className="flex gap-1">
                  <button onClick={() => applyCustom(ct)} title={`Apply "${ct.name}"`}
                    className="flex-1 h-7 rounded border text-[10px] font-semibold text-zinc-200 hover:bg-white/[0.04] truncate px-2 text-left"
                    style={{ borderColor: "#2a3232", background: "#1e2525" }}>
                    {ct.name}
                  </button>
                  <button onClick={() => removeCustom(ct.id)} title="Delete template"
                    className="grid h-7 w-7 place-items-center rounded border text-red-300 hover:bg-red-500/10" style={{ borderColor: "#2a3232" }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {naming ? (
          <div className="mt-2 flex gap-1">
            <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Template name"
              onKeyDown={(e) => { if (e.key === "Enter") commitSaveTemplate(); else if (e.key === "Escape") setNaming(false); }}
              maxLength={60}
              className="flex-1 h-7 px-1.5 rounded border text-[11px] text-zinc-100 bg-[#151a1a] outline-none focus:border-teal-500/60" style={{ borderColor: "#2a3232" }} />
            <button onClick={commitSaveTemplate} className="h-7 px-2 rounded border text-[10px] font-bold uppercase text-teal-200 border-teal-500/60 bg-teal-500/20">Save</button>
            <button onClick={() => setNaming(false)} className="grid h-7 w-7 place-items-center rounded border text-zinc-400" style={{ borderColor: "#2a3232" }}><X className="w-3 h-3" /></button>
          </div>
        ) : (
          <button onClick={beginSaveTemplate}
            className="mt-2 w-full h-7 rounded border text-[10px] font-bold uppercase text-zinc-200 inline-flex items-center justify-center gap-1.5 hover:bg-white/[0.04]"
            style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            <Plus className="w-3 h-3" /> Save current as template
          </button>
        )}
      </div>
      {/* Add-object toolbar */}
      <div className="p-2 border-b grid grid-cols-2 gap-1.5" style={{ borderColor: "#2a3232" }}>
        <ToolBtn icon={Type} label="Text" onClick={editor.addTextObject} />
        <ToolBtn icon={Square} label="Rect" onClick={() => editor.addShape("rect")} />
        <ToolBtn icon={Circle} label="Ellipse" onClick={() => editor.addShape("ellipse")} />
        <ToolBtn icon={Plus} label="Slide" onClick={editor.addSlide} />
        {clip && <ToolBtn icon={ClipboardPaste} label="Paste" onClick={() => editor.addObject(clip)} />}
      </div>

      {/* Add media — image or video, from the library or by URL */}
      <div className="p-2 border-b space-y-1.5" style={{ borderColor: "#2a3232" }}>
        <label className="block text-[9px] uppercase tracking-wide text-zinc-500">Add media</label>
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => setLibKind("image")}
            className="h-7 rounded border text-[10px] font-bold uppercase text-zinc-200 inline-flex items-center justify-center gap-1 hover:bg-white/[0.04]"
            style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            <ImageIcon className="w-3 h-3" /> Image
          </button>
          <button onClick={() => setLibKind("video")}
            className="h-7 rounded border text-[10px] font-bold uppercase text-zinc-200 inline-flex items-center justify-center gap-1 hover:bg-white/[0.04]"
            style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            <Film className="w-3 h-3" /> Video
          </button>
        </div>
        <div className="flex gap-1">
          <input value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} placeholder="…or paste an image URL"
            className="flex-1 h-7 px-1.5 rounded border text-[11px] text-zinc-200 bg-[#151a1a] outline-none focus:border-teal-500/60" style={{ borderColor: "#2a3232" }} />
          <button onClick={() => { if (imgUrl.trim()) { editor.addImage(imgUrl.trim()); setImgUrl(""); } }}
            className="h-7 px-2 rounded border text-[10px] font-bold uppercase text-zinc-200" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
            Add
          </button>
        </div>
        {libKind && (
          <MediaLibraryPicker
            kind={libKind}
            onPick={(url) => { if (libKind === "video") editor.addVideo(url); else editor.addImage(url); }}
            onClose={() => setLibKind(null)}
          />
        )}
      </div>

      {/* Selected-object props */}
      {selected ? (
        <div className="p-2 space-y-2 border-b" style={{ borderColor: "#2a3232" }}>
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wide text-zinc-400">{selected.kind} object</span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => setClip({ ...selected })} className="grid h-6 w-6 place-items-center rounded text-zinc-300 hover:bg-white/[0.06]" title="Copy object (paste on any slide)">
                <ClipboardCopy className="w-3 h-3" />
              </button>
              <button onClick={() => editor.duplicateObject(selected.id)} className="grid h-6 w-6 place-items-center rounded text-zinc-300 hover:bg-white/[0.06]" title="Duplicate object">
                <Copy className="w-3 h-3" />
              </button>
              <button onClick={() => editor.removeObject(selected.id)} className="grid h-6 w-6 place-items-center rounded text-red-300 hover:bg-red-500/10" title="Delete object">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          {/* Z-order (layer) controls */}
          <div>
            <span className={rowCls}>Layer order</span>
            <div className="flex gap-0.5">
              <ZBtn icon={ChevronsDown} title="Send to back" onClick={() => editor.reorderObject(selected.id, "back")} />
              <ZBtn icon={ArrowDown} title="Send backward" onClick={() => editor.reorderObject(selected.id, "backward")} />
              <ZBtn icon={ArrowUp} title="Bring forward" onClick={() => editor.reorderObject(selected.id, "forward")} />
              <ZBtn icon={ChevronsUp} title="Bring to front" onClick={() => editor.reorderObject(selected.id, "front")} />
            </div>
          </div>
          {/* Align to slide */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <span className={rowCls}>Align X</span>
              <div className="flex gap-0.5">
                <AlignBtn label="L" onClick={() => upd({ x: 0 })} />
                <AlignBtn label="C" onClick={() => upd({ x: Math.round((CANVAS_W - selected.w) / 2) })} />
                <AlignBtn label="R" onClick={() => upd({ x: CANVAS_W - selected.w })} />
              </div>
            </div>
            <div>
              <span className={rowCls}>Align Y</span>
              <div className="flex gap-0.5">
                <AlignBtn label="T" onClick={() => upd({ y: 0 })} />
                <AlignBtn label="M" onClick={() => upd({ y: Math.round((CANVAS_H - selected.h) / 2) })} />
                <AlignBtn label="B" onClick={() => upd({ y: CANVAS_H - selected.h })} />
              </div>
            </div>
          </div>
          {/* Entrance animation (plays once when the slide goes live) */}
          <div>
            <span className={rowCls}>Entrance</span>
            <div className="flex gap-1">
              <select value={selected.anim ?? "none"} onChange={(e) => upd({ anim: e.target.value as ObjectAnim })}
                className={inCls} style={{ borderColor: "#2a3232" }}>
                {(["none", "fade", "slide-up", "slide-down", "slide-left", "slide-right", "zoom"] as const).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <input type="number" min={0} max={10000} step={100} value={selected.animDelayMs ?? 0}
                onChange={(e) => upd({ animDelayMs: Number(e.target.value) })} title="Delay before it appears (ms)"
                className="w-14 h-7 px-1.5 rounded border text-[11px] text-zinc-200 bg-[#151a1a] outline-none" style={{ borderColor: "#2a3232" }} />
            </div>
          </div>
          {/* Precise position & size (canvas units, 1920×1080) */}
          <div className="grid grid-cols-2 gap-1.5">
            <div><span className={rowCls}>X</span><input type="number" value={Math.round(selected.x)} onChange={(e) => upd({ x: Number(e.target.value) })} className={inCls} style={{ borderColor: "#2a3232" }} /></div>
            <div><span className={rowCls}>Y</span><input type="number" value={Math.round(selected.y)} onChange={(e) => upd({ y: Number(e.target.value) })} className={inCls} style={{ borderColor: "#2a3232" }} /></div>
            <div><span className={rowCls}>W</span><input type="number" value={Math.round(selected.w)} onChange={(e) => upd({ w: Math.max(20, Number(e.target.value)) })} className={inCls} style={{ borderColor: "#2a3232" }} /></div>
            <div><span className={rowCls}>H</span><input type="number" value={Math.round(selected.h)} onChange={(e) => upd({ h: Math.max(20, Number(e.target.value)) })} className={inCls} style={{ borderColor: "#2a3232" }} /></div>
          </div>
          <div><span className={rowCls}>Rotation — {Math.round(selected.rotation ?? 0)}°</span>
            <input type="range" min={-180} max={180} value={selected.rotation ?? 0} onChange={(e) => upd({ rotation: Number(e.target.value) })} className="w-full" />
          </div>
          {selected.kind === "text" && <TextProps o={selected} upd={upd} />}
          {selected.kind === "shape" && <ShapeProps o={selected} upd={upd} />}
          {selected.kind === "image" && <ImageProps o={selected} upd={upd} />}
          {selected.kind === "video" && <VideoProps o={selected} upd={upd} />}
        </div>
      ) : (
        <div className="p-2 text-[11px] text-zinc-500 border-b" style={{ borderColor: "#2a3232" }}>Select an object on the canvas to edit it.</div>
      )}

      {/* Slide background — colour + optional image */}
      <div className="p-2 space-y-1.5">
        <label className="block text-[9px] uppercase tracking-wide text-zinc-500">Slide background</label>
        <input type="color" value={slide?.bgColor ?? "#0b0b0b"} onChange={(e) => editor.setBg({ bgColor: e.target.value })}
          className="h-7 w-full rounded border cursor-pointer bg-transparent" style={{ borderColor: "#2a3232" }} />
        <button onClick={() => setBgLib(true)}
          className="w-full h-7 rounded border text-[10px] font-semibold text-zinc-200 inline-flex items-center justify-center gap-1.5 hover:bg-white/[0.04]"
          style={{ borderColor: "#2a3232", background: "#1e2525" }}>
          <ImageIcon className="w-3 h-3" /> {slide?.bgImageUrl ? "Change background image" : "Background image…"}
        </button>
        {slide?.bgImageUrl && (
          <button onClick={() => editor.setBg({ bgImageUrl: "" })} className="text-[10px] text-red-300 hover:opacity-80">Remove background image</button>
        )}
        {bgLib && (
          <MediaLibraryPicker kind="image" onPick={(url) => editor.setBg({ bgImageUrl: url })} onClose={() => setBgLib(false)} />
        )}
      </div>
    </aside>
  );
}

function ZBtn({ icon: Icon, title, onClick }: { icon: typeof Type; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title}
      className="flex-1 h-7 rounded border inline-flex items-center justify-center text-zinc-300 hover:bg-white/[0.04]"
      style={{ borderColor: "#2a3232", background: "#1e2525" }}>
      <Icon className="w-3 h-3" />
    </button>
  );
}

function AlignBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={`Align ${label}`}
      className="flex-1 h-7 rounded border text-[10px] font-bold text-zinc-300 hover:bg-white/[0.04]"
      style={{ borderColor: "#2a3232", background: "#1e2525" }}>
      {label}
    </button>
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
      <div><span className={rowCls}>Text</span>
        <textarea value={o.text} onChange={(e) => upd({ text: e.target.value })} rows={3}
          className="w-full px-1.5 py-1 rounded border text-[12px] text-zinc-100 bg-[#151a1a] outline-none focus:border-teal-500/60 resize-y"
          style={{ borderColor: "#2a3232" }} />
      </div>
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
      <div className="flex gap-1.5">
        <button onClick={() => upd({ italic: !o.italic })}
          className={`flex-1 h-7 rounded border text-[10px] italic ${o.italic ? "border-teal-400 bg-teal-500/20 text-teal-100" : "text-zinc-400"}`}
          style={o.italic ? undefined : { borderColor: "#2a3232" }}>Italic</button>
        <button onClick={() => upd({ underline: !o.underline })}
          className={`flex-1 h-7 rounded border text-[10px] underline ${o.underline ? "border-teal-400 bg-teal-500/20 text-teal-100" : "text-zinc-400"}`}
          style={o.underline ? undefined : { borderColor: "#2a3232" }}>Underline</button>
      </div>
    </>
  );
}

function ShapeProps({ o, upd }: { o: ShapeObject; upd: (p: Partial<SlideObject>) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <div><span className={rowCls}>Fill</span>
          <input type="color" value={o.fill ?? "#14b8a6"} onChange={(e) => upd({ fill: e.target.value })} className="h-7 w-full rounded border cursor-pointer bg-transparent" style={{ borderColor: "#2a3232" }} />
        </div>
        <div><span className={rowCls}>Border</span>
          <input type="color" value={o.stroke ?? "#0f766e"} onChange={(e) => upd({ stroke: e.target.value })} className="h-7 w-full rounded border cursor-pointer bg-transparent" style={{ borderColor: "#2a3232" }} />
        </div>
      </div>
      <button onClick={() => upd({ fill2: o.fill2 ? undefined : "#0f766e" })}
        className={`w-full h-7 rounded border text-[10px] uppercase ${o.fill2 ? "border-teal-400 bg-teal-500/20 text-teal-100" : "text-zinc-400"}`}
        style={o.fill2 ? undefined : { borderColor: "#2a3232" }}>Gradient {o.fill2 ? "on" : "off"}</button>
      {o.fill2 && (
        <div className="grid grid-cols-2 gap-1.5">
          <div><span className={rowCls}>Fill 2</span>
            <input type="color" value={o.fill2} onChange={(e) => upd({ fill2: e.target.value })} className="h-7 w-full rounded border cursor-pointer bg-transparent" style={{ borderColor: "#2a3232" }} />
          </div>
          <div><span className={rowCls}>Angle — {o.fillAngle ?? 135}°</span>
            <input type="range" min={0} max={360} value={o.fillAngle ?? 135} onChange={(e) => upd({ fillAngle: Number(e.target.value) })} className="w-full" />
          </div>
        </div>
      )}
      <div><span className={rowCls}>Border width — {o.strokeWidth ?? 0}px</span>
        <input type="range" min={0} max={40} value={o.strokeWidth ?? 0} onChange={(e) => upd({ strokeWidth: Number(e.target.value) })} className="w-full" />
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

function VideoProps({ o, upd }: { o: VideoObject; upd: (p: Partial<SlideObject>) => void }) {
  return (
    <>
      <div><span className={rowCls}>Fit</span>
        <div className="flex gap-0.5">
          {(["contain", "cover"] as const).map((f) => (
            <button key={f} onClick={() => upd({ fit: f })}
              className={`flex-1 h-7 rounded border text-[9px] uppercase ${(o.fit ?? "contain") === f ? "border-teal-400 bg-teal-500/20 text-teal-100" : "text-zinc-400"}`}
              style={(o.fit ?? "contain") === f ? undefined : { borderColor: "#2a3232" }}>{f}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => upd({ loop: !(o.loop ?? true) })}
          className={`h-7 rounded border text-[9px] uppercase ${(o.loop ?? true) ? "border-teal-400 bg-teal-500/20 text-teal-100" : "text-zinc-400"}`}
          style={(o.loop ?? true) ? undefined : { borderColor: "#2a3232" }}>Loop {(o.loop ?? true) ? "on" : "off"}</button>
        <button onClick={() => upd({ muted: !(o.muted ?? true) })}
          className={`h-7 rounded border text-[9px] uppercase ${(o.muted ?? true) ? "border-teal-400 bg-teal-500/20 text-teal-100" : "text-zinc-400"}`}
          style={(o.muted ?? true) ? undefined : { borderColor: "#2a3232" }}>{(o.muted ?? true) ? "Muted" : "Sound on"}</button>
      </div>
    </>
  );
}
