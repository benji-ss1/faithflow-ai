"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus, Square, Circle, Type, Image as ImageIcon, Film, Trash2, Copy, ClipboardCopy, ClipboardPaste, ChevronsUp, ChevronsDown, ArrowUp, ArrowDown, Undo2, Redo2, Eye, EyeOff, Lock, Unlock, Save, Play, Loader2, SlidersHorizontal, PlusSquare, LayoutTemplate, Layers as LayersIcon, PanelLeftClose, PanelLeftOpen, PanelBottom } from "lucide-react";
import { LayoutDefaultControl } from "@/components/operator/layout/LayoutDefaultControl";
import type { OperatorShellCtx } from "../shell/types";
import { useSlideEditor, type EditableSlide } from "../editor/useSlideEditor";
import { SlideCanvas, SlideThumb } from "../editor/SlideCanvas";
import { CanvasWarnings } from "../editor/CanvasWarnings";
import { ProjectionZoneControls } from "../zone/ProjectionZoneControls";
import { SlideContextMenu } from "../SlideContextMenu";
import { MediaLibraryPicker } from "@/components/library/MediaLibraryPicker";
import { SLIDE_TEMPLATES } from "@/lib/slide-templates";
import { saveSlideObjects, createSongSlide, deleteSongSlide, reorderSongSlides } from "@/lib/actions";
import type { SlideObject, TextObject, ShapeObject, ImageObject, VideoObject, ObjectAnim } from "@/lib/slide-objects";
import { projectableTextSlide } from "@/lib/broadcast";
import { CANVAS_W, CANVAS_H, newObjectId } from "@/lib/slide-objects";
import { loadCustomTemplates, saveCustomTemplate, deleteCustomTemplate, type CustomTemplate } from "@/lib/custom-templates";
import { cn } from "@/lib/utils";

/**
 * Desktop full-screen slide editor — reskinned to match the "Projection Zone"
 * editor (ZoneEditor.tsx): a big checkerboard stage the slide sits on, a slim
 * orange top bar, a horizontal slide rail, and a right-side CONTEXTUAL DRAWER
 * (Design / Add / Templates / Background / Layers) instead of one endless
 * scrolling sidebar. Every feature of the old inspector is preserved — it just
 * lives in the drawer tab it belongs to, and the Design drawer auto-opens the
 * moment you add or select an object so its full properties are one click away.
 *
 * When `targetSong` is set the editor edits THAT song (opened from the Songs
 * Library "Edit slide" button) instead of the playlist preview item.
 */

// ── Design Language v2 palette (token-backed) ───────────────────────────────
// AMBER stays the literal brand hex because it is composited with alpha suffixes
// (e.g. `${AMBER}22`) in inline styles — it equals var(--color-brand).
const AMBER = "#e8501a";
const PANEL = "var(--color-panel)";
const ELEV = "var(--color-elevated)";
const HAIR = "var(--color-border)"; // hairline divider
const CHECKER = "repeating-conic-gradient(#141418 0% 25%, #0d0d10 0% 50%)";

type DrawerTab = "design" | "add" | "templates" | "background" | "layers" | "layout";

export type SlideEditorTargetSong = {
  songId: string;
  title: string;
  slides: { id: string; lyrics: string; objectsJson?: unknown }[];
};

export function DesktopSlideEditorModal({ ctx, open, onClose, targetSong = null, openBlank = false, openAdd = false }: {
  ctx: OperatorShellCtx;
  open: boolean;
  onClose: () => void;
  targetSong?: SlideEditorTargetSong | null;
  openBlank?: boolean;
  openAdd?: boolean;
}) {
  const playlistItem = ctx.plan.items[ctx.previewItemIdx];
  const item = targetSong ? null : playlistItem;
  const itemId = targetSong ? `song_${targetSong.songId}` : (playlistItem?.id ?? null);
  const itemType = targetSong ? "song" : (playlistItem?.type ?? null);
  const songId = targetSong ? targetSong.songId : (playlistItem?.songId ?? null);
  const title = targetSong ? targetSong.title : (playlistItem?.title ?? "");

  const initialSlides = targetSong
    ? targetSong.slides
    : (playlistItem?.songSlideRows ??
      (playlistItem?.slides.map((s, i) => ({
        id: `readonly_${playlistItem.id}_${i}`,
        lyrics: s.kind === "text" ? s.text : `[${s.kind}]`,
        objectsJson: null,
      })) ?? []));

  const editor = useSlideEditor({ itemId, itemType: itemType ?? "blank", songId, initialSlides });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [tab, setTab] = useState<DrawerTab>("add");
  // Left slide rail is collapsible; remember the operator's choice.
  const [railOpen, setRailOpen] = useState(true);
  useEffect(() => {
    try { const v = window.localStorage.getItem("presentflow.editor.railOpen"); if (v === "0") setRailOpen(false); } catch { /* noop */ }
  }, []);
  const toggleRail = useCallback(() => {
    setRailOpen((v) => { const next = !v; try { window.localStorage.setItem("presentflow.editor.railOpen", next ? "1" : "0"); } catch { /* noop */ } return next; });
  }, []);
  const router = useRouter();

  // Persist: mirror OperatorShell.onSave — delete removed, create new, save
  // objects for existing, then reorder to the local sequence.
  const onSave = useCallback(async () => {
    if (!editor.isEditable || !songId) return;
    setSaveState("saving");
    try {
      const dbIds = (targetSong ? targetSong.slides : (item?.songSlideRows ?? [])).map((r) => r.id);
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
      router.refresh();
    } catch (e) {
      setSaveState("error");
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }, [editor, songId, item, targetSong, router]);

  // "Save to all slides" — apply the CURRENT slide's text style (+ background)
  // to every slide, then persist. applyToAll() is a synchronous setState, so we
  // flag a pending save and let the effect below fire onSave AFTER the applied
  // slides have committed (calling onSave() in the same tick would save the
  // pre-apply state). Auto-targets the slide's text object when nothing is
  // explicitly selected (see useSlideEditor.applyToAll).
  const [confirmSaveAll, setConfirmSaveAll] = useState(false);
  const pendingSaveAllRef = useRef(false);
  const doSaveToAll = useCallback(() => {
    if (!editor.isEditable || !songId) return;
    pendingSaveAllRef.current = true;
    editor.applyToAll();
  }, [editor, songId]);
  useEffect(() => {
    if (!pendingSaveAllRef.current) return;
    pendingSaveAllRef.current = false;
    void onSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.slides]);

  // "Show" projects the CURRENT in-editor slide to the live projector — the ONLY
  // way edits reach the output (nothing auto-projects while editing). Fix
  // (2026-08-20 field video): the old handler sent { kind:"text", text: lyrics },
  // discarding the slide's objects + background, so a designed slide projected
  // BLANK. It now builds the full projectable payload (text + bgColor +
  // bgImageUrl + objects) via projectableTextSlide — the same converter the
  // server plan-loader uses — so exactly what's on the edit canvas is what the
  // projector shows. Works for both the song-library target and playlist items.
  const onShow = useCallback(() => {
    const cur = editor.slides[editor.currentIndex];
    if (cur) {
      const textFromObjects = cur.objects
        .filter((o): o is TextObject => o.kind === "text")
        .map((o) => o.text)
        .filter(Boolean)
        .join("\n");
      const text = textFromObjects || cur.lyrics || "";
      ctx.onSendSlideToLive(projectableTextSlide(text, cur.bgColor, cur.bgImageUrl, cur.objects));
      // Confirmation (user directive): the editor is fullscreen, so the operator
      // can't see the projector — tell them the slide went live.
      toast.success(`Slide ${editor.currentIndex + 1} is now on the projector`, { icon: <Play className="w-4 h-4" /> });
      return;
    }
    // Fallback (no in-editor slide): jump the live output to the saved slide.
    if (item) { ctx.onJumpSlide(ctx.previewItemIdx, editor.currentIndex); toast.success("Sent to the projector", { icon: <Play className="w-4 h-4" /> }); }
  }, [editor, ctx, item]);

  // Open on the slide the operator double-clicked (playlist mode); target song
  // opens at the top.
  useEffect(() => {
    if (!open) return;
    if (openBlank && editor.isEditable) {
      // "Blank slide" toolbar entry — drop straight onto a fresh empty slide.
      editor.addBlankSlide();
      setTab("add");
    } else if (openAdd && editor.isEditable) {
      // "Add slide" toolbar entry — drop onto a fresh seeded slide.
      editor.addSlide();
      setTab("add");
    } else {
      editor.setCurrentIndex(targetSong ? 0 : ctx.previewSlideIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Selecting an object on the canvas jumps the drawer to Design so its full
  // properties are right there — the behaviour the user asked for ("as soon as
  // you press text it should be the area that shows all its options").
  const selId = editor.selectedObjectId;
  useEffect(() => {
    if (selId) setTab("design");
  }, [selId]);

  const requestClose = useCallback(() => {
    if (editor.hasDirtyChanges && !confirm("Discard unsaved slide changes?")) return;
    onClose();
  }, [editor.hasDirtyChanges, onClose]);

  const isSong = editor.isEditable;
  const total = editor.slides.length;

  // Add an object then focus its Design drawer.
  const addFocus = (fn: () => void) => { fn(); setTab("design"); };

  // App-wide copy/paste for objects (⌘C / ⌘V / ⌘X) — clipboard persists while
  // the editor is open, so you can copy an object and paste it on any slide.
  const clipRef = useRef<SlideObject[]>([]);
  const copySelection = useCallback(() => {
    const slide = editor.currentSlide;
    if (!slide) return false;
    const objs = slide.objects.filter((o) => editor.selectedObjectIds.includes(o.id));
    if (!objs.length) return false;
    clipRef.current = objs.map((o) => ({ ...o }));
    return true;
  }, [editor]);
  const pasteClipboard = useCallback(() => {
    if (!clipRef.current.length) return;
    for (const o of clipRef.current) editor.addObject(o);
    setTab("design");
  }, [editor]);

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
            else if (k === "c") { if (copySelection()) e.preventDefault(); }
            else if (k === "v") { if (clipRef.current.length) { e.preventDefault(); pasteClipboard(); } }
            else if (k === "x") { if (copySelection()) { e.preventDefault(); editor.removeObjects(editor.selectedObjectIds); } }
          }}
          className="fixed inset-0 z-[71] flex flex-col overflow-hidden outline-none"
          style={{ background: "var(--color-shell)" }}
        >
          {/* ── Top bar ───────────────────────────────────────────────────── */}
          <header className="h-14 shrink-0 flex items-center gap-2 px-4 border-b" style={{ borderColor: HAIR, background: PANEL }}>
            <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: `${AMBER}1a` }}>
              <Type className="w-4 h-4" style={{ color: AMBER }} />
            </span>
            <Dialog.Title className="text-[15px] font-semibold text-[var(--color-foreground)]">Edit slide</Dialog.Title>
            <span className="text-[12px] text-[var(--color-muted-foreground)] truncate max-w-[220px]">— {title}</span>
            {editor.hasDirtyChanges
              ? <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ color: AMBER, background: `${AMBER}1f` }}>Unsaved</span>
              : <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full text-[var(--color-success)]" style={{ background: "color-mix(in oklab, var(--color-success) 14%, transparent)" }}>Saved</span>}
            {!songId && <span className="text-[10px] italic text-[var(--color-warning)]/80 ml-1">Only song slides are editable</span>}

            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={editor.undo} disabled={!editor.canUndo} title="Undo (⌘Z)"
                className="grid h-9 w-9 place-items-center rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-brand)]/10 hover:text-[var(--color-foreground)] disabled:opacity-30">
                <Undo2 className="w-4 h-4" />
              </button>
              <button onClick={editor.redo} disabled={!editor.canRedo} title="Redo (⌘⇧Z)"
                className="grid h-9 w-9 place-items-center rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-brand)]/10 hover:text-[var(--color-foreground)] disabled:opacity-30">
                <Redo2 className="w-4 h-4" />
              </button>
              <span className="mx-1 h-6 w-px" style={{ background: HAIR }} />
              <button
                onClick={onSave}
                disabled={!isSong || saveState === "saving" || !editor.hasDirtyChanges}
                title={!isSong ? "Editing is available for songs" : !editor.hasDirtyChanges ? "No changes to save" : "Save slide edits"}
                className="h-9 px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 text-[var(--color-foreground)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--edge-top),var(--shadow-md)] active:scale-[0.97] transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none"
              >
                {saveState === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
              <button
                onClick={() => setConfirmSaveAll(true)}
                disabled={!isSong || saveState === "saving" || editor.slides.length < 2}
                title={!isSong ? "Editing is available for songs" : editor.slides.length < 2 ? "Only one slide" : "Apply this slide's font, size, colour & style to every slide, then save"}
                className="h-9 px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 text-[var(--color-foreground)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--edge-top),var(--shadow-md)] active:scale-[0.97] transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none"
              >
                <LayersIcon className="w-4 h-4" /> Save to all
              </button>
              <button
                onClick={onShow}
                disabled={!isSong || !editor.currentSlide}
                title={!isSong ? "Editing is available for songs" : "Send the current slide to Preview / Live"}
                className="h-9 px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 text-[var(--color-brand)] border border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:border-[var(--color-brand)] hover:bg-[var(--color-brand)]/10 hover:shadow-[var(--edge-top),var(--shadow-md)] active:scale-[0.97] transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none"
              >
                <Play className="w-4 h-4" /> Show
              </button>
              <button
                onClick={requestClose}
                className="h-9 px-4 rounded-lg text-[13px] font-bold inline-flex items-center gap-1.5 bg-[image:var(--grad-ember)] text-black shadow-[var(--edge-top),var(--shadow-ember)] motion-safe:hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-ember-lg)] active:translate-y-0 active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]"
              >
                Done
              </button>
            </div>
          </header>

          <ConfirmDialog
            open={confirmSaveAll}
            title="Save this look to every slide?"
            confirmLabel="Save to all slides"
            body={<>Applies this slide&rsquo;s font, size, weight, colour, alignment and style (and its background) to all <b className="text-[var(--color-foreground)]">{editor.slides.length}</b> slides in this song, then saves. Each slide keeps its own words — only the look changes. You can undo.</>}
            onConfirm={() => { setConfirmSaveAll(false); doSaveToAll(); }}
            onCancel={() => setConfirmSaveAll(false)}
          />

          {/* ── Body: slides (left) · canvas + zone controls (center) · features (right) ── */}
          <div className="flex-1 min-h-0 flex">
            {/* Left: vertical slide rail (1,2,3,4…) — collapsible */}
            <SlideRail editor={editor} isSong={isSong} itemId={itemId} open={railOpen} onToggle={toggleRail} />

            {/* Center: big checkerboard canvas, projection-zone controls kept below */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 min-w-0 relative" style={{ backgroundColor: "#0d0d10", backgroundImage: CHECKER, backgroundSize: "28px 28px" }}>
                {isSong ? (
                  <SlideCanvas
                    slide={editor.currentSlide}
                    selectedIds={editor.selectedObjectIds}
                    onSelectObject={(id, additive) => {
                      if (additive && id) editor.toggleObjectSelection(id);
                      else editor.setSelectedObjectId(id);
                    }}
                    onSetSelection={editor.setSelectedObjectIds}
                    onUpdateObject={editor.updateObject}
                    onUpdateObjects={editor.updateObjects}
                    onRemoveObjects={editor.removeObjects}
                    readOnly={false}
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-[12px] text-[var(--color-muted-foreground)]">
                    Editing is available for song slides.
                  </div>
                )}
              </div>
              {isSong && <CanvasWarnings slide={editor.currentSlide} />}
              {/* Simple size / resolution bar — kept exactly as the Projection Zone */}
              <ProjectionZoneControls className="shrink-0 border-t" />
            </div>

            {/* Right contextual drawer (fonts, text, image, lower third, templates…) */}
            <RightDrawer editor={editor} churchId={ctx.churchId} tab={tab} setTab={setTab} addFocus={addFocus} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Slide rail (horizontal) ─────────────────────────────────────────────────
type Editor = ReturnType<typeof useSlideEditor>;

function deleteSlideWithUndo(editor: Editor, index: number, itemId: string | null) {
  const removed: EditableSlide | undefined = editor.slides[index];
  if (!removed) return;
  if (!editor.deleteSlide(index)) return;
  toast(`Slide ${index + 1} deleted`, {
    action: { label: "Undo", onClick: () => editor.restoreSlide(index, removed, itemId) },
  });
}

function SlideRail({ editor, isSong, itemId, open, onToggle }: { editor: Editor; isSong: boolean; itemId: string | null; open: boolean; onToggle: () => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Collapsed: a thin strip with just the slide numbers + an expand button, so
  // the canvas gets maximum room but the slides are one click away.
  if (!open) {
    return (
      <aside className="shrink-0 w-12 border-r flex flex-col min-h-0 items-center" style={{ borderColor: HAIR, background: PANEL }}>
        <button onClick={onToggle} title="Show slides" className="shrink-0 my-2 grid h-8 w-8 place-items-center rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-brand)]/10 hover:text-[var(--color-foreground)]">
          <PanelLeftOpen className="w-4 h-4" />
        </button>
        <div className="flex-1 min-h-0 overflow-y-auto w-full flex flex-col items-center gap-1.5 pb-2">
          {editor.slides.map((s, i) => {
            const active = i === editor.currentIndex;
            return (
              <button key={s.id} onClick={() => editor.setCurrentIndex(i)} title={`Slide ${i + 1}`}
                className="shrink-0 h-8 w-8 rounded-md text-[12px] font-mono tabular-nums grid place-items-center"
                style={active ? { background: `${AMBER}22`, color: AMBER, outline: `1px solid ${AMBER}` } : { color: "var(--color-muted-foreground)", border: "1px solid var(--color-border)" }}>
                {i + 1}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="shrink-0 w-[184px] border-r flex flex-col min-h-0" style={{ borderColor: HAIR, background: PANEL }}>
      {/* Slide actions */}
      <div className="shrink-0 p-2 border-b" style={{ borderColor: HAIR }}>
        <div className="flex items-center justify-between mb-1.5 px-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Slides</span>
          <button onClick={onToggle} title="Hide slides" className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-brand)]/10 hover:text-[var(--color-foreground)]">
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <RailBtn label="Add" icon={Plus} onClick={editor.addSlide} disabled={!isSong} />
          <RailBtn label="Blank" icon={PlusSquare} onClick={editor.addBlankSlide} disabled={!isSong} accent />
          <RailBtn label="Copy" icon={Copy} onClick={editor.duplicateSlide} disabled={!isSong || !editor.currentSlide} />
          <RailBtn label="Del" icon={Trash2} onClick={() => deleteSlideWithUndo(editor, editor.currentIndex, itemId)} disabled={!isSong || !editor.currentSlide} danger />
        </div>
      </div>
      {/* Thumbnails (1,2,3,4…) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {editor.slides.length === 0 && <span className="block text-[11px] text-[var(--color-muted-foreground)] italic px-1 py-2">No slides yet — add one.</span>}
        {editor.slides.map((s, i) => {
          const active = i === editor.currentIndex;
          return (
            <SlideContextMenu key={s.id} onEdit={() => editor.setCurrentIndex(i)} onDelete={() => deleteSlideWithUndo(editor, i, itemId)}>
              <div
                draggable={isSong}
                onDragStart={() => isSong && setDragIdx(i)}
                onDragOver={(e) => { if (isSong && dragIdx !== null && dragIdx !== i) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (!isSong || dragIdx === null || dragIdx === i) { setDragIdx(null); return; } editor.reorderSlide(dragIdx, i); setDragIdx(null); }}
                onDragEnd={() => setDragIdx(null)}
                onClick={() => editor.setCurrentIndex(i)}
                className="relative rounded-lg overflow-hidden cursor-pointer flex items-center gap-1.5"
                title={`Slide ${i + 1}${isSong ? " — drag to reorder" : ""}`}
              >
                <span className="shrink-0 w-5 text-center text-[11px] font-mono tabular-nums" style={{ color: active ? AMBER : "var(--color-muted-foreground)" }}>{i + 1}</span>
                <div className="relative flex-1 rounded-md overflow-hidden"
                  style={{ outline: active ? `2px solid ${AMBER}` : "1px solid var(--color-border)", boxShadow: active ? `0 0 0 3px ${AMBER}22` : undefined }}>
                  <SlideThumb slide={s} />
                </div>
              </div>
            </SlideContextMenu>
          );
        })}
      </div>
    </aside>
  );
}

function RailBtn({ label, icon: Icon, onClick, disabled, accent, danger }: { label: string; icon: typeof Type; onClick: () => void; disabled?: boolean; accent?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("h-8 px-2.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-md)] active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)] disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none",
        danger ? "text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10" : "text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10")}
      style={{ border: `1px solid ${accent ? `${AMBER}55` : HAIR}`, background: ELEV, color: accent ? AMBER : undefined }}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

// ── Right drawer ────────────────────────────────────────────────────────────
const FONTS = ["Inter", "Sora", "Plus Jakarta Sans", "Playfair Display", "Cormorant Garamond", "Fraunces", "Spectral", "Montserrat", "DM Serif Display", "Georgia", "Helvetica", "Arial", "Times New Roman"];
const rowCls = "eyebrow block mb-1";
const inCls = "w-full h-8 px-2 rounded-lg border border-[var(--color-border)] text-[12px] text-[var(--color-foreground)] bg-[var(--color-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none transition-colors duration-200 focus:border-[var(--color-brand)]";
const segOn = { borderColor: "var(--color-brand)", background: "color-mix(in oklab, var(--color-brand) 16%, transparent)", color: "var(--color-brand-hi)" };
const segOff: React.CSSProperties = { borderColor: "var(--color-border)" };

const TABS: { id: DrawerTab; label: string; icon: typeof Type }[] = [
  { id: "design", label: "Design", icon: SlidersHorizontal },
  { id: "add", label: "Add", icon: PlusSquare },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "background", label: "Background", icon: ImageIcon },
  { id: "layout", label: "Layout", icon: PanelBottom },
  { id: "layers", label: "Layers", icon: LayersIcon },
];

function RightDrawer({ editor, churchId, tab, setTab, addFocus }: { editor: Editor; churchId: string; tab: DrawerTab; setTab: (t: DrawerTab) => void; addFocus: (fn: () => void) => void }) {
  if (!editor.isEditable) {
    return <aside className="w-[300px] shrink-0 border-l p-4 text-[12px] text-[var(--color-muted-foreground)]" style={{ borderColor: HAIR, background: PANEL }}>Editing is available for song slides.</aside>;
  }
  return (
    <aside className="w-[320px] shrink-0 border-l flex flex-col min-h-0" style={{ borderColor: HAIR, background: PANEL }}>
      {/* Tab rail */}
      <div className="shrink-0 p-2 grid grid-cols-6 gap-1 border-b" style={{ borderColor: HAIR }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} title={t.label}
              className={cn("h-12 rounded-lg flex flex-col items-center justify-center gap-1 border shadow-[var(--edge-top),var(--shadow-sm)] active:scale-[0.97] transition-[transform,box-shadow,color] duration-200 [transition-timing-function:var(--ease-spring)]", !on && "hover:bg-[var(--color-brand)]/10")}
              style={on ? segOn : segOff}>
              <t.icon className="w-4 h-4 shrink-0" style={{ color: on ? AMBER : "var(--color-muted-foreground)" }} />
              <span className="w-full px-0.5 text-center truncate text-[7.5px] font-semibold uppercase tracking-[0.02em] leading-none" style={{ color: on ? "var(--color-brand-hi)" : "var(--color-muted-foreground)" }}>{t.label}</span>
            </button>
          );
        })}
      </div>
      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "design" && <DesignPanel editor={editor} />}
        {tab === "add" && <AddPanel editor={editor} churchId={churchId} addFocus={addFocus} />}
        {tab === "templates" && <TemplatesPanel editor={editor} churchId={churchId} />}
        {tab === "background" && <BackgroundPanel editor={editor} />}
        {tab === "layout" && <div className="p-3"><LayoutDefaultControl churchId={churchId} /></div>}
        {tab === "layers" && <LayersPanel editor={editor} />}
      </div>
    </aside>
  );
}

// ── Design (contextual: selected object / group) ────────────────────────────
function DesignPanel({ editor }: { editor: Editor }) {
  const slide = editor.currentSlide;
  const selected = slide?.objects.find((o) => o.id === editor.selectedObjectId) ?? null;
  const selIds = editor.selectedObjectIds;
  const multi = selIds.length > 1;
  const [clip, setClip] = useState<SlideObject | null>(null);
  const upd = (patch: Partial<SlideObject>) => { if (selected) editor.updateObject(selected.id, patch); };

  if (multi) {
    return (
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">{selIds.length} objects selected</span>
          <div className="flex items-center gap-0.5">
            <IconBtn icon={Copy} title="Duplicate all" onClick={() => editor.duplicateObjects(selIds)} />
            <IconBtn icon={Trash2} title="Delete all" danger onClick={() => editor.removeObjects(selIds)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><span className={rowCls}>Align X</span><div className="flex gap-0.5">
            <AlignBtn label="L" onClick={() => editor.alignObjects(selIds, "left")} />
            <AlignBtn label="C" onClick={() => editor.alignObjects(selIds, "hcenter")} />
            <AlignBtn label="R" onClick={() => editor.alignObjects(selIds, "right")} />
          </div></div>
          <div><span className={rowCls}>Align Y</span><div className="flex gap-0.5">
            <AlignBtn label="T" onClick={() => editor.alignObjects(selIds, "top")} />
            <AlignBtn label="M" onClick={() => editor.alignObjects(selIds, "vcenter")} />
            <AlignBtn label="B" onClick={() => editor.alignObjects(selIds, "bottom")} />
          </div></div>
        </div>
        {selIds.length >= 3 && (
          <div><span className={rowCls}>Distribute — even spacing</span><div className="flex gap-0.5">
            <AlignBtn label="Horizontal" onClick={() => editor.distributeObjects(selIds, "h")} />
            <AlignBtn label="Vertical" onClick={() => editor.distributeObjects(selIds, "v")} />
          </div></div>
        )}
        <p className="text-[10px] text-[var(--color-muted-foreground)] leading-snug">Drag any selected object to move the group. ⇧-click to add or remove one.</p>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="p-6 text-center text-[12px] text-[var(--color-muted-foreground)]">
        <SlidersHorizontal className="w-5 h-5 mx-auto mb-2 text-[var(--color-muted-foreground)]" />
        Select an object on the canvas — or add one from the <b className="text-[var(--color-muted-foreground)]">Add</b> tab — to edit all its properties here.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">{selected.kind} object</span>
        <div className="flex items-center gap-0.5">
          <IconBtn icon={selected.hidden ? EyeOff : Eye} title={selected.hidden ? "Show on projector" : "Hide from projector"} onClick={() => editor.updateObject(selected.id, { hidden: !selected.hidden })} />
          <IconBtn icon={selected.locked ? Lock : Unlock} title={selected.locked ? "Unlock" : "Lock"} active={selected.locked} onClick={() => editor.updateObject(selected.id, { locked: !selected.locked })} />
          <IconBtn icon={ClipboardCopy} title="Copy object" onClick={() => setClip({ ...selected })} />
          <IconBtn icon={Copy} title="Duplicate" onClick={() => editor.duplicateObject(selected.id)} />
          <IconBtn icon={Trash2} title="Delete" danger onClick={() => editor.removeObject(selected.id)} />
        </div>
      </div>
      {clip && (
        <button onClick={() => editor.addObject(clip)} className="w-full h-8 rounded-md border text-[11px] font-semibold text-[var(--color-foreground)] inline-flex items-center justify-center gap-1.5 hover:bg-[var(--color-brand)]/10" style={segOff}>
          <ClipboardPaste className="w-3.5 h-3.5" /> Paste copied object
        </button>
      )}

      <div><span className={rowCls}>Layer order</span><div className="flex gap-0.5">
        <ZBtn icon={ChevronsDown} title="Send to back" onClick={() => editor.reorderObject(selected.id, "back")} />
        <ZBtn icon={ArrowDown} title="Send backward" onClick={() => editor.reorderObject(selected.id, "backward")} />
        <ZBtn icon={ArrowUp} title="Bring forward" onClick={() => editor.reorderObject(selected.id, "forward")} />
        <ZBtn icon={ChevronsUp} title="Bring to front" onClick={() => editor.reorderObject(selected.id, "front")} />
      </div></div>

      <div className="grid grid-cols-2 gap-2">
        <div><span className={rowCls}>Align X</span><div className="flex gap-0.5">
          <AlignBtn label="L" onClick={() => upd({ x: 0 })} />
          <AlignBtn label="C" onClick={() => upd({ x: Math.round((CANVAS_W - selected.w) / 2) })} />
          <AlignBtn label="R" onClick={() => upd({ x: CANVAS_W - selected.w })} />
        </div></div>
        <div><span className={rowCls}>Align Y</span><div className="flex gap-0.5">
          <AlignBtn label="T" onClick={() => upd({ y: 0 })} />
          <AlignBtn label="M" onClick={() => upd({ y: Math.round((CANVAS_H - selected.h) / 2) })} />
          <AlignBtn label="B" onClick={() => upd({ y: CANVAS_H - selected.h })} />
        </div></div>
      </div>

      <div><span className={rowCls}>Entrance</span><div className="flex gap-1.5">
        <select value={selected.anim ?? "none"} onChange={(e) => upd({ anim: e.target.value as ObjectAnim })} className={inCls} style={{ borderColor: "var(--color-border)" }}>
          {(["none", "fade", "slide-up", "slide-down", "slide-left", "slide-right", "zoom"] as const).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="number" min={0} max={10000} step={100} value={selected.animDelayMs ?? 0} onChange={(e) => upd({ animDelayMs: Number(e.target.value) })} title="Delay (ms)" className="w-16 h-8 px-1.5 rounded-md border text-[12px] text-[var(--color-foreground)] bg-[var(--color-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none" style={{ borderColor: "var(--color-border)" }} />
      </div></div>

      <div className="grid grid-cols-4 gap-1.5">
        <div><span className={rowCls}>X</span><input type="number" value={Math.round(selected.x)} onChange={(e) => upd({ x: Number(e.target.value) })} className={inCls} style={{ borderColor: "var(--color-border)" }} /></div>
        <div><span className={rowCls}>Y</span><input type="number" value={Math.round(selected.y)} onChange={(e) => upd({ y: Number(e.target.value) })} className={inCls} style={{ borderColor: "var(--color-border)" }} /></div>
        <div><span className={rowCls}>W</span><input type="number" value={Math.round(selected.w)} onChange={(e) => upd({ w: Math.max(20, Number(e.target.value)) })} className={inCls} style={{ borderColor: "var(--color-border)" }} /></div>
        <div><span className={rowCls}>H</span><input type="number" value={Math.round(selected.h)} onChange={(e) => upd({ h: Math.max(20, Number(e.target.value)) })} className={inCls} style={{ borderColor: "var(--color-border)" }} /></div>
      </div>
      <div><span className={rowCls}>Rotation — {Math.round(selected.rotation ?? 0)}°</span>
        <input type="range" min={-180} max={180} value={selected.rotation ?? 0} onChange={(e) => upd({ rotation: Number(e.target.value) })} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>
      <div><span className={rowCls}>Opacity — {Math.round((selected.opacity ?? 1) * 100)}%</span>
        <input type="range" min={0} max={100} value={(selected.opacity ?? 1) * 100} onChange={(e) => upd({ opacity: Number(e.target.value) / 100 })} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>

      {selected.kind === "text" && <TextProps o={selected} upd={upd} />}
      {selected.kind === "shape" && <ShapeProps o={selected} upd={upd} />}
      {selected.kind === "image" && <ImageProps o={selected} upd={upd} />}
      {selected.kind === "video" && <VideoProps o={selected} upd={upd} />}
    </div>
  );
}

// ── Add (objects + media + bulk) ────────────────────────────────────────────
function AddPanel({ editor, churchId, addFocus }: { editor: Editor; churchId: string; addFocus: (fn: () => void) => void }) {
  void churchId;
  const [imgUrl, setImgUrl] = useState("");
  const [libKind, setLibKind] = useState<"image" | "video" | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <div className="p-3 space-y-3">
      <div>
        <span className={rowCls}>Add to slide</span>
        <div className="grid grid-cols-3 gap-1.5">
          <ToolBtn icon={Type} label="Text" onClick={() => addFocus(editor.addTextObject)} />
          <ToolBtn icon={Square} label="Rect" onClick={() => addFocus(() => editor.addShape("rect"))} />
          <ToolBtn icon={Circle} label="Ellipse" onClick={() => addFocus(() => editor.addShape("ellipse"))} />
        </div>
      </div>

      <div>
        <span className={rowCls}>Media</span>
        <div className="grid grid-cols-2 gap-1.5">
          <ToolBtn icon={ImageIcon} label="Image" onClick={() => setLibKind("image")} />
          <ToolBtn icon={Film} label="Video" onClick={() => setLibKind("video")} />
        </div>
        <div className="flex gap-1.5 mt-1.5">
          <input value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} placeholder="…or paste an image URL"
            className="flex-1 h-8 px-2 rounded-md border text-[12px] text-[var(--color-foreground)] bg-[var(--color-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none focus:border-[var(--color-brand)]" style={{ borderColor: "var(--color-border)" }} />
          <button onClick={() => { if (imgUrl.trim()) { addFocus(() => editor.addImage(imgUrl.trim())); setImgUrl(""); } }}
            className="h-8 px-3.5 rounded-md border text-[11px] font-bold text-[var(--color-foreground)] shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:bg-[var(--color-brand)]/10 hover:shadow-[var(--edge-top),var(--shadow-md)] active:scale-[0.97] transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)]" style={segOff}>Add</button>
        </div>
        {libKind && (
          <MediaLibraryPicker kind={libKind} onClose={() => setLibKind(null)}
            onPick={(url) => { if (libKind === "video") addFocus(() => editor.addVideo(url)); else addFocus(() => editor.addImage(url)); }} />
        )}
      </div>

      <div className="h-px" style={{ background: HAIR }} />

      <div className="space-y-1.5">
        <button onClick={editor.addBlankSlide}
          className="w-full h-10 rounded-lg text-[12px] font-semibold text-[var(--color-foreground)] inline-flex items-center justify-center gap-1.5 shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:bg-[var(--color-brand)]/10 hover:border-[var(--color-brand)] hover:shadow-[var(--edge-top),var(--shadow-md)] active:scale-[0.97] transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)]" style={{ background: ELEV, border: `1px solid ${AMBER}55` }}>
          <PlusSquare className="w-4 h-4" style={{ color: AMBER }} /> Blank slide
        </button>
        <button
          onClick={() => setConfirmAll(true)}
          className="w-full h-10 rounded-lg text-[12px] font-bold inline-flex items-center justify-center gap-1.5 bg-[image:var(--grad-ember)] text-black shadow-[var(--edge-top),var(--shadow-ember)] motion-safe:hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-ember-lg)] active:translate-y-0 active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]">
          <Copy className="w-4 h-4" /> Apply to all slides
        </button>
        <ConfirmDialog
          open={confirmAll}
          title="Apply to all slides?"
          confirmLabel="Apply to all"
          body={<>Copies this slide&rsquo;s background{editor.selectedObjectId ? " and the selected object's style/position" : ""} to all <b className="text-[var(--color-foreground)]">{editor.slides.length}</b> slides in this song. Text and media content are never overwritten — and you can undo this.</>}
          onCancel={() => setConfirmAll(false)}
          onConfirm={() => { editor.applyToAll(); toast.success("Applied to all slides"); setConfirmAll(false); }}
        />
        <p className="text-[10px] text-[var(--color-muted-foreground)] leading-snug">
          Copies the background{editor.selectedObjectId ? " + the selected object's style and position" : ""} to every slide. Lyrics/text are kept.
        </p>
      </div>
    </div>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────
function TemplatesPanel({ editor, churchId }: { editor: Editor; churchId: string }) {
  const slide = editor.currentSlide;
  const [customTpls, setCustomTpls] = useState<CustomTemplate[]>([]);
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // Pending template application awaiting in-app confirmation (only set when the
  // current slide already has content, so applying would replace it).
  const [pendingReplace, setPendingReplace] = useState<(() => void) | null>(null);
  useEffect(() => { setCustomTpls(loadCustomTemplates(churchId)); }, [churchId]);

  const guardReplace = (apply: () => void) => {
    if ((slide?.objects.length ?? 0) === 0) apply();
    else setPendingReplace(() => apply);
  };
  const applyTemplate = (tid: string) => { const tpl = SLIDE_TEMPLATES.find((x) => x.id === tid); if (!tpl) return; guardReplace(() => editor.updateSlideDirect(tpl.build())); };
  const applyCustom = (ct: CustomTemplate) => { guardReplace(() => { const objects = ct.objects.map((o) => ({ ...o, id: newObjectId() })); editor.updateSlideDirect({ objects, bgColor: ct.bgColor, bgImageUrl: ct.bgImageUrl }); }); };
  const beginSave = () => { if (!slide || slide.objects.length === 0) { toast.error("Add something to the slide first"); return; } setNameDraft(""); setNaming(true); };
  const commitSave = () => { const name = nameDraft.trim() || "Untitled template"; if (!slide) return; setCustomTpls(saveCustomTemplate(churchId, { name, bgColor: slide.bgColor, bgImageUrl: slide.bgImageUrl, objects: slide.objects })); setNaming(false); toast.success(`Saved template "${name}"`); };
  const removeCustom = (id: string) => setCustomTpls(deleteCustomTemplate(churchId, id));

  return (
    <div className="p-3 space-y-3">
      <div>
        <span className={rowCls}>Start from a template</span>
        <div className="grid grid-cols-2 gap-1.5">
          {SLIDE_TEMPLATES.map((tpl) => (
            <button key={tpl.id} onClick={() => applyTemplate(tpl.id)}
              className="h-8 rounded-md border text-[11px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10" style={{ ...segOff, background: ELEV }}>{tpl.name}</button>
          ))}
        </div>
      </div>
      {customTpls.length > 0 && (
        <div>
          <span className={rowCls}>Your templates</span>
          <div className="space-y-1">
            {customTpls.map((ct) => (
              <div key={ct.id} className="flex gap-1">
                <button onClick={() => applyCustom(ct)} title={`Apply "${ct.name}"`}
                  className="flex-1 h-8 rounded-md border text-[11px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10 truncate px-2 text-left" style={{ ...segOff, background: ELEV }}>{ct.name}</button>
                <button onClick={() => removeCustom(ct.id)} title="Delete template" className="grid h-8 w-8 place-items-center rounded-md border text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10" style={segOff}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {naming ? (
        <div className="flex gap-1">
          <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Template name" maxLength={60}
            onKeyDown={(e) => { if (e.key === "Enter") commitSave(); else if (e.key === "Escape") setNaming(false); }}
            className="flex-1 h-8 px-2 rounded-md border text-[12px] text-[var(--color-foreground)] bg-[var(--color-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none focus:border-[var(--color-brand)]" style={{ borderColor: "var(--color-border)" }} />
          <button onClick={commitSave} className="h-8 px-3 rounded-md text-[11px] font-bold bg-[image:var(--grad-ember)] text-black shadow-[var(--edge-top),var(--shadow-ember)] motion-safe:hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-ember-lg)] active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]">Save</button>
          <button onClick={() => setNaming(false)} className="grid h-8 w-8 place-items-center rounded-md border text-[var(--color-muted-foreground)]" style={segOff}><X className="w-3.5 h-3.5" /></button>
        </div>
      ) : (
        <button onClick={beginSave} className="w-full h-9 rounded-lg border text-[11px] font-bold text-[var(--color-foreground)] inline-flex items-center justify-center gap-1.5 hover:bg-[var(--color-brand)]/10" style={{ ...segOff, background: ELEV }}>
          <Plus className="w-3.5 h-3.5" /> Save current slide as template
        </button>
      )}
      <ConfirmDialog
        open={pendingReplace !== null}
        title="Replace slide content?"
        confirmLabel="Replace"
        body={<>This slide already has content. Applying the template replaces the objects on this slide. You can undo this.</>}
        onCancel={() => setPendingReplace(null)}
        onConfirm={() => { pendingReplace?.(); setPendingReplace(null); }}
      />
    </div>
  );
}

// ── Background ──────────────────────────────────────────────────────────────
function BackgroundPanel({ editor }: { editor: Editor }) {
  const slide = editor.currentSlide;
  const [bgLib, setBgLib] = useState(false);
  const [confirmBgAll, setConfirmBgAll] = useState(false);
  return (
    <div className="p-3 space-y-3">
      <div>
        <span className={rowCls}>Background colour</span>
        <input type="color" value={slide?.bgColor ?? "#0b0b0b"} onChange={(e) => editor.setBg({ bgColor: e.target.value })}
          className="h-9 w-full rounded-md border cursor-pointer bg-transparent" style={{ borderColor: "var(--color-border)" }} />
      </div>
      <div>
        <span className={rowCls}>Background image</span>
        <button onClick={() => setBgLib(true)}
          className="w-full h-9 rounded-lg border text-[11px] font-semibold text-[var(--color-foreground)] inline-flex items-center justify-center gap-1.5 hover:bg-[var(--color-brand)]/10" style={{ ...segOff, background: ELEV }}>
          <ImageIcon className="w-3.5 h-3.5" /> {slide?.bgImageUrl ? "Change background image" : "Choose background image…"}
        </button>
        {slide?.bgImageUrl && (
          <button onClick={() => editor.setBg({ bgImageUrl: "" })} className="mt-1.5 text-[10px] text-[var(--color-destructive)] hover:opacity-80">Remove background image</button>
        )}
        {bgLib && <MediaLibraryPicker kind="image" onPick={(url) => editor.setBg({ bgImageUrl: url })} onClose={() => setBgLib(false)} />}
      </div>
      <div className="h-px" style={{ background: HAIR }} />
      <button
        onClick={() => setConfirmBgAll(true)}
        className="w-full h-9 rounded-lg text-[12px] font-bold inline-flex items-center justify-center gap-1.5 bg-[image:var(--grad-ember)] text-black shadow-[var(--edge-top),var(--shadow-ember)] motion-safe:hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-ember-lg)] active:translate-y-0 active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]">
        <Copy className="w-4 h-4" /> Apply background to all slides
      </button>
      <ConfirmDialog
        open={confirmBgAll}
        title="Apply background to all slides?"
        confirmLabel="Apply to all"
        body={<>Copies this background to all <b className="text-[var(--color-foreground)]">{editor.slides.length}</b> slides in this song. You can undo this.</>}
        onCancel={() => setConfirmBgAll(false)}
        onConfirm={() => { editor.applyToAll(); toast.success("Background applied to all slides"); setConfirmBgAll(false); }}
      />
    </div>
  );
}

// ── Layers ──────────────────────────────────────────────────────────────────
function LayersPanel({ editor }: { editor: Editor }) {
  const slide = editor.currentSlide;
  const selIds = editor.selectedObjectIds;
  if (!slide || slide.objects.length === 0) {
    return <div className="p-6 text-center text-[12px] text-[var(--color-muted-foreground)]"><LayersIcon className="w-5 h-5 mx-auto mb-2 text-[var(--color-muted-foreground)]" />No objects on this slide yet.</div>;
  }
  return (
    <div className="p-3">
      <span className={rowCls}>Layers — top first</span>
      <div className="space-y-0.5">
        {slide.objects.slice().reverse().map((o) => {
          const Icon = o.kind === "text" ? Type : o.kind === "shape" ? (o.shape === "ellipse" ? Circle : Square) : o.kind === "image" ? ImageIcon : Film;
          const label = o.kind === "text" ? (o.text.trim().slice(0, 22) || "Text") : o.kind === "shape" ? (o.shape === "ellipse" ? "Ellipse" : "Rectangle") : o.kind === "image" ? "Image" : "Video";
          const isSel = selIds.includes(o.id);
          return (
            <div key={o.id} onClick={() => editor.setSelectedObjectId(o.id)}
              className="flex items-center gap-1.5 rounded-md px-1.5 h-8 cursor-pointer border"
              style={isSel ? segOn : { borderColor: "transparent" }}>
              <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: isSel ? AMBER : "var(--color-muted-foreground)" }} />
              <span className={cn("flex-1 truncate text-[11px]", o.hidden ? "text-[var(--color-muted-foreground)] line-through" : isSel ? "text-[var(--color-brand-hi)]" : "text-[var(--color-foreground)]")}>{label}</span>
              <button onClick={(e) => { e.stopPropagation(); editor.updateObject(o.id, { hidden: !o.hidden }); }} title={o.hidden ? "Show" : "Hide"}
                className="grid h-6 w-6 place-items-center rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10">{o.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
              <button onClick={(e) => { e.stopPropagation(); editor.updateObject(o.id, { locked: !o.locked }); }} title={o.locked ? "Unlock" : "Lock"}
                className={cn("grid h-6 w-6 place-items-center rounded hover:bg-[var(--color-brand)]/10", o.locked ? "text-[var(--color-warning)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}>{o.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Shared small controls ───────────────────────────────────────────────────
function IconBtn({ icon: Icon, title, onClick, danger, active }: { icon: typeof Type; title: string; onClick: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button onClick={onClick} title={title}
      className={cn("grid h-7 w-7 place-items-center rounded-md transition-colors duration-200 hover:bg-[var(--color-brand)]/10", danger ? "text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10" : active ? "text-[var(--color-brand)]" : "text-[var(--color-foreground)]")}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function ZBtn({ icon: Icon, title, onClick }: { icon: typeof Type; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} className="flex-1 h-8 rounded-md border inline-flex items-center justify-center text-[var(--color-foreground)] shadow-[var(--edge-top),var(--shadow-sm)] hover:bg-[var(--color-brand)]/10 active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]" style={{ ...segOff, background: ELEV }}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function AlignBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={`Align ${label}`} className="flex-1 h-8 rounded-md border text-[10px] font-bold text-[var(--color-foreground)] shadow-[var(--edge-top),var(--shadow-sm)] hover:bg-[var(--color-brand)]/10 active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]" style={{ ...segOff, background: ELEV }}>{label}</button>
  );
}

// In-app confirmation modal — replaces the native window.confirm(). Sits above
// the editor Dialog (z-[70]) at z-[80]. Plain fixed overlay (no nested Radix
// Dialog) to avoid focus-trap fights with the parent editor Dialog.
function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", onConfirm, onCancel }: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onConfirm, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onCancel}>
      <div className="w-[360px] max-w-full rounded-xl border p-4" style={{ borderColor: HAIR, background: PANEL, boxShadow: "var(--edge-top), var(--shadow-xl)" }} onClick={(e) => e.stopPropagation()}>
        <div className="text-[14px] font-semibold text-[var(--color-foreground)]">{title}</div>
        <div className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-muted-foreground)]">{body}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="h-9 px-3.5 rounded-lg border text-[12px] font-semibold text-[var(--color-foreground)] shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:bg-[var(--color-brand)]/10 hover:shadow-[var(--edge-top),var(--shadow-md)] active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]" style={segOff}>Cancel</button>
          <button type="button" autoFocus onClick={onConfirm}
            className="h-9 px-4 rounded-lg text-[12px] font-bold inline-flex items-center gap-1.5 bg-[image:var(--grad-ember)] text-black shadow-[var(--edge-top),var(--shadow-ember)] motion-safe:hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-ember-lg)] active:translate-y-0 active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ icon: Icon, label, onClick }: { icon: typeof Type; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group h-12 rounded-lg border text-[11px] font-semibold inline-flex flex-col items-center justify-center gap-1 text-[var(--color-foreground)] shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:bg-[var(--color-brand)]/10 hover:shadow-[var(--edge-top),var(--shadow-md)] active:scale-[0.97] transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)]" style={{ ...segOff, background: ELEV }}>
      <Icon className="w-4 h-4 text-[var(--color-muted-foreground)] transition-colors group-hover:text-[var(--color-brand)]" /> {label}
    </button>
  );
}

// Selected-toggle pill (amber when on).
function Toggle({ on, label, onClick, className }: { on: boolean; label: string; onClick: () => void; className?: string }) {
  return (
    <button onClick={onClick} className={cn("flex-1 h-8 rounded-md border text-[10px] shadow-[var(--edge-top),var(--shadow-sm)] active:scale-[0.97] transition-[transform,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)]", !on && "hover:bg-[var(--color-brand)]/10", className)}
      style={on ? segOn : segOff}>{label}</button>
  );
}

function TextProps({ o, upd }: { o: TextObject; upd: (p: Partial<SlideObject>) => void }) {
  return (
    <>
      <div><span className={rowCls}>Text</span>
        <textarea value={o.text} onChange={(e) => upd({ text: e.target.value })} rows={3}
          className="w-full px-2 py-1.5 rounded-md border text-[12px] text-[var(--color-foreground)] bg-[var(--color-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none focus:border-[var(--color-brand)] resize-y" style={{ borderColor: "var(--color-border)" }} />
      </div>
      <div><span className={rowCls}>Font</span>
        <select value={o.fontFamily ?? "Inter"} onChange={(e) => upd({ fontFamily: e.target.value })} className={inCls} style={{ borderColor: "var(--color-border)" }}>
          {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><span className={rowCls}>Size (px)</span><input type="number" min={8} max={800} value={o.fontSize ?? 96} onChange={(e) => upd({ fontSize: Number(e.target.value) })} className={inCls} style={{ borderColor: "var(--color-border)" }} /></div>
        <div><span className={rowCls}>Weight</span>
          <select value={String(o.fontWeight ?? 600)} onChange={(e) => upd({ fontWeight: Number(e.target.value) })} className={inCls} style={{ borderColor: "var(--color-border)" }}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><span className={rowCls}>Colour</span><input type="color" value={o.color ?? "#ffffff"} onChange={(e) => upd({ color: e.target.value })} className="h-8 w-full rounded-md border cursor-pointer bg-transparent" style={{ borderColor: "var(--color-border)" }} /></div>
        <div><span className={rowCls}>Align</span><div className="flex gap-0.5">
          {(["left", "center", "right"] as const).map((a) => (
            <Toggle key={a} on={(o.align ?? "center") === a} label={a[0].toUpperCase()} onClick={() => upd({ align: a })} className="uppercase" />
          ))}
        </div></div>
      </div>
      <div className="flex gap-1.5">
        <Toggle on={!!o.italic} label="Italic" onClick={() => upd({ italic: !o.italic })} className="italic" />
        <Toggle on={!!o.underline} label="Underline" onClick={() => upd({ underline: !o.underline })} className="underline" />
      </div>
      <div className="flex gap-1.5">
        <Toggle on={!!o.uppercase} label="Uppercase" onClick={() => upd({ uppercase: !o.uppercase })} className="uppercase" />
        <Toggle on={o.shadow ?? true} label="Shadow" onClick={() => upd({ shadow: !(o.shadow ?? true) })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><span className={rowCls}>Line height</span><input type="number" min={0.5} max={4} step={0.05} value={o.lineHeight ?? 1.1} onChange={(e) => upd({ lineHeight: Number(e.target.value) })} className={inCls} style={{ borderColor: "var(--color-border)" }} /></div>
        <div><span className={rowCls}>Letter spacing</span><input type="number" min={-20} max={100} step={1} value={o.letterSpacing ?? 0} onChange={(e) => upd({ letterSpacing: Number(e.target.value) })} className={inCls} style={{ borderColor: "var(--color-border)" }} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><span className={rowCls}>Outline</span><input type="color" value={o.stroke ?? "#000000"} onChange={(e) => upd({ stroke: e.target.value })} className="h-8 w-full rounded-md border cursor-pointer bg-transparent" style={{ borderColor: "var(--color-border)" }} /></div>
        <div><span className={rowCls}>Outline width</span><input type="number" min={0} max={40} step={1} value={o.strokeWidth ?? 0} onChange={(e) => upd({ strokeWidth: Number(e.target.value) })} className={inCls} style={{ borderColor: "var(--color-border)" }} /></div>
      </div>
    </>
  );
}

function ShapeProps({ o, upd }: { o: ShapeObject; upd: (p: Partial<SlideObject>) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div><span className={rowCls}>Fill</span><input type="color" value={o.fill ?? "#e8501a"} onChange={(e) => upd({ fill: e.target.value })} className="h-8 w-full rounded-md border cursor-pointer bg-transparent" style={{ borderColor: "var(--color-border)" }} /></div>
        <div><span className={rowCls}>Border</span><input type="color" value={o.stroke ?? "#0f766e"} onChange={(e) => upd({ stroke: e.target.value })} className="h-8 w-full rounded-md border cursor-pointer bg-transparent" style={{ borderColor: "var(--color-border)" }} /></div>
      </div>
      <Toggle on={!!o.fill2} label={`Gradient ${o.fill2 ? "on" : "off"}`} onClick={() => upd({ fill2: o.fill2 ? undefined : "#0f766e" })} className="uppercase" />
      {o.fill2 && (
        <div className="grid grid-cols-2 gap-2">
          <div><span className={rowCls}>Fill 2</span><input type="color" value={o.fill2} onChange={(e) => upd({ fill2: e.target.value })} className="h-8 w-full rounded-md border cursor-pointer bg-transparent" style={{ borderColor: "var(--color-border)" }} /></div>
          <div><span className={rowCls}>Angle — {o.fillAngle ?? 135}°</span><input type="range" min={0} max={360} value={o.fillAngle ?? 135} onChange={(e) => upd({ fillAngle: Number(e.target.value) })} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>
        </div>
      )}
      <div><span className={rowCls}>Border width — {o.strokeWidth ?? 0}px</span><input type="range" min={0} max={40} value={o.strokeWidth ?? 0} onChange={(e) => upd({ strokeWidth: Number(e.target.value) })} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>
      {o.shape === "rect" && (
        <div><span className={rowCls}>Corner radius — {o.radius ?? 0}px</span><input type="range" min={0} max={200} value={o.radius ?? 0} onChange={(e) => upd({ radius: Number(e.target.value) })} className="w-full" style={{ accentColor: "var(--color-brand)" }} /></div>
      )}
    </>
  );
}

function ImageProps({ o, upd }: { o: ImageObject; upd: (p: Partial<SlideObject>) => void }) {
  return (
    <div><span className={rowCls}>Fit</span><div className="flex gap-0.5">
      {(["contain", "cover"] as const).map((f) => (
        <Toggle key={f} on={(o.fit ?? "contain") === f} label={f} onClick={() => upd({ fit: f })} className="uppercase" />
      ))}
    </div></div>
  );
}

function VideoProps({ o, upd }: { o: VideoObject; upd: (p: Partial<SlideObject>) => void }) {
  return (
    <>
      <div><span className={rowCls}>Fit</span><div className="flex gap-0.5">
        {(["contain", "cover"] as const).map((f) => (
          <Toggle key={f} on={(o.fit ?? "contain") === f} label={f} onClick={() => upd({ fit: f })} className="uppercase" />
        ))}
      </div></div>
      <div className="grid grid-cols-2 gap-2">
        <Toggle on={o.loop ?? true} label={`Loop ${(o.loop ?? true) ? "on" : "off"}`} onClick={() => upd({ loop: !(o.loop ?? true) })} className="uppercase" />
        <Toggle on={o.muted ?? true} label={(o.muted ?? true) ? "Muted" : "Sound on"} onClick={() => upd({ muted: !(o.muted ?? true) })} className="uppercase" />
      </div>
    </>
  );
}
