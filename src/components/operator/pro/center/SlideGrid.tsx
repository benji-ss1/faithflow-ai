"use client";
import { useEffect, useRef, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { ThemedSlideCard } from "./ThemedSlideCard";
import type { BackgroundSpec } from "@/lib/broadcast";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload, ThemeAppearance } from "@/lib/broadcast";
import { useSlideClipboard, setSlideClipboard, getSlideClipboard } from "@/lib/slide-clipboard";
import { updateSongSlides, deleteSongSlide, updateSongSlideText } from "@/lib/actions";
import { applyTextToSlide } from "@/lib/broadcast";
import { useRouter } from "next/navigation";
import { X, Pencil, LayoutGrid, GripVertical, GripHorizontal } from "lucide-react";
import { DotGridBackground } from "../DotGridBackground";

type ViewMode = "grid" | "list" | "text";
const VIEW_MODE_KEY = "presentflow.operator.slideViewMode";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Safe Mode toggle. User-directive polish pass: default is OFF — single-click
// sends live. When ON: single-click selects, double-click sends live. Persisted
// per-machine in localStorage.
const SAFE_MODE_KEY = "presentflow.operator.safeMode";
function safeMode() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(SAFE_MODE_KEY);
  return raw === "1"; // default OFF
}

// Debounce accidental fast repeat clicks / trackpad noise (250ms).
// 2026-07-27 field fix: the old debounce was GLOBAL — clicking slide 1 then
// slide 2 within 250ms silently swallowed slide 2 ("clicked but didn't go
// live" at a live service). Now keyed per-slide: only a repeat click on the
// SAME slide is suppressed; a click on a different slide always fires
// (latest-wins — the send path is idempotent).
let __lastLiveKey = "";
let __lastLiveFire = 0;
function fireLive(key: string, fn: () => void) {
  const now = Date.now();
  if (key === __lastLiveKey && now - __lastLiveFire < 250) {
    console.log("[click] slide live suppressed (same-slide repeat <250ms)", { key });
    return;
  }
  __lastLiveKey = key;
  __lastLiveFire = now;
  fn();
}

export function SlideGrid({ ctx, slideSize, onOpenEditor }: { ctx: OperatorShellCtx; slideSize: number; onOpenEditor?: () => void }) {
  const router = useRouter();
  const item = ctx.plan.items[ctx.previewItemIdx];
  const slides: SlidePayload[] = item?.slides ?? [];
  const lastDragEndRef = useRef(0);

  // View mode is toggled by the BottomBar (fires "presentflow:slide-view-mode").
  // Persist per-machine so operators keep their preferred layout across launches.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEW_MODE_KEY);
      if (raw === "list" || raw === "text" || raw === "grid") setViewMode(raw);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ViewMode>).detail;
      if (detail === "grid" || detail === "list" || detail === "text") {
        setViewMode(detail);
        try { window.localStorage.setItem(VIEW_MODE_KEY, detail); } catch { /* noop */ }
      }
    };
    window.addEventListener("presentflow:slide-view-mode", handler);
    return () => window.removeEventListener("presentflow:slide-view-mode", handler);
  }, []);

  // Quick Edit — floating panel for inline slide text editing.
  // quickEdit.text is the FROZEN text at open (kept stable so the in-place
  // AutoFitText caret + fit don't jump mid-type); the LIVE typed value lives in
  // editedTextRef (a ref, so keystrokes don't re-render the editable node).
  // slideId is the STABLE per-slide id captured at open — Save targets it
  // directly so a grid reorder/delete/paste while the (non-modal) editor is
  // open can't make the array index resolve to a different slide. slideIdx is
  // kept only for the live-preview render + focus re-keying.
  const [quickEdit, setQuickEdit] = useState<{ slideIdx: number; slideId?: string; text: string } | null>(null);
  const [qeSaving, setQeSaving] = useState(false);
  const editedTextRef = useRef("");
  // Quick Edit is DRAGGABLE so it never blocks the slides behind it. Offset is
  // held in a ref and applied directly to the panel's transform, so dragging
  // never re-renders (and can't disturb the in-place caret).
  const qePanelRef = useRef<HTMLDivElement | null>(null);
  const qeOffset = useRef({ x: 0, y: 0 });
  const qeDrag = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);
  const applyQeTransform = () => {
    const el = qePanelRef.current;
    if (el) el.style.transform = `translate(calc(-50% + ${qeOffset.current.x}px), ${qeOffset.current.y}px)`;
  };
  const onQeDragStart = (e: React.PointerEvent) => {
    qeDrag.current = { sx: e.clientX, sy: e.clientY, bx: qeOffset.current.x, by: qeOffset.current.y };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onQeDragMove = (e: React.PointerEvent) => {
    const d = qeDrag.current;
    if (!d) return;
    // Clamp so the drag handle can NEVER leave the viewport — otherwise a
    // non-modal box dragged off-screen would be unrecoverable (✕ + keys gone).
    const maxX = Math.max(40, window.innerWidth / 2 - 60);
    const minY = -Math.round(window.innerHeight * 0.14) + 8; // don't rise above the top
    const maxY = Math.max(0, window.innerHeight - 160);
    const rawX = d.bx + (e.clientX - d.sx);
    const rawY = d.by + (e.clientY - d.sy);
    qeOffset.current = {
      x: Math.min(maxX, Math.max(-maxX, rawX)),
      y: Math.min(maxY, Math.max(minY, rawY)),
    };
    applyQeTransform();
  };
  const onQeDragEnd = (e: React.PointerEvent) => {
    qeDrag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  // App-level clipboard for cut/copy/paste within the grid
  const clipboardSlide = useSlideClipboard();

  // Data-loss guard: the grid's Quick Edit / Duplicate / Delete / Paste rewrite
  // the WHOLE song from lyrics only (updateSongSlides), which drops every slide's
  // designed object layout. For a song that HAS designed slides, steer those
  // actions to the full editor (which preserves objects via the granular
  // create/save/reorder actions). Plain lyric songs are unaffected.
  const songHasObjects = item?.type === "song" && slides.some(
    (s) => s.kind === "text" && Array.isArray((s as { objects?: unknown[] }).objects) && ((s as { objects?: unknown[] }).objects!.length > 0),
  );
  const guardObjectSong = (): boolean => {
    if (songHasObjects) {
      void import("sonner").then(({ toast }) => toast.error("This song has designed slides — open the slide editor to keep the layout."));
      onOpenEditor?.();
      return true;
    }
    return false;
  };

  // Paste the clipboard slide at a chosen position (insertIdx). Shared by the
  // per-slide "Paste after" and the empty-space "Paste at end" menus, so the
  // operator can decide WHERE the copied slide lands.
  const canPasteHere = !!clipboardSlide && item?.type === "song" && !!(item as { songId?: string }).songId;
  const pasteSlideAt = (insertIdx: number) => {
    if (guardObjectSong()) return;
    const copied = getSlideClipboard();
    if (!copied) { void import("sonner").then(({ toast }) => toast.error("Nothing to paste")); return; }
    const songId = (item as { songId?: string })?.songId;
    if (item?.type !== "song" || !songId) return;
    void (async () => {
      const at = Math.max(0, Math.min(insertIdx, slides.length));
      const newSlides = [...slides];
      newSlides.splice(at, 0, copied);
      const updatedSlides = newSlides.map((sl) => ({ lyrics: sl.kind === "text" ? ((sl as { text?: string }).text ?? "") : "" }));
      const res = await updateSongSlides(songId, updatedSlides);
      const { toast } = await import("sonner");
      if (!res.ok) toast.error(res.error ?? "Paste failed"); else toast.success("Slide pasted");
    })();
  };

  const handleQuickEditSave = async (newText: string) => {
    if (!quickEdit) return;
    const trimmed = newText.trim();
    if (!trimmed) {
      const { toast } = await import("sonner");
      toast.error("Slide text can't be empty");
      return;
    }
    if (item?.type !== "song" || !(item as { songId?: string }).songId) return;
    // Prefer the STABLE id captured at open; fall back to the index lookup for
    // safety. This survives a grid reorder while the non-modal editor is open.
    const slideId = quickEdit.slideId ?? item.songSlideRows?.[quickEdit.slideIdx]?.id;
    if (!slideId) {
      const { toast } = await import("sonner");
      toast.error("Couldn't find that slide to save");
      return;
    }
    setQeSaving(true);
    try {
      // Persist ONLY this slide's text, PRESERVING its designed layout
      // (updateSongSlideText loads objectsJson and swaps the first text object) —
      // no more flatten-to-plain. Works for plain AND designed songs.
      const res = await updateSongSlideText(slideId, trimmed);
      const { toast } = await import("sonner");
      if (!res.ok) { toast.error(res.error ?? "Save failed"); return; }
      // Save ONLY persists + updates the slide — it does NOT push to the projector
      // (user directive 2026-08-26). "Send this slide live" is the separate,
      // explicit action; saving and sending live are independent choices. The
      // editor stays open so the operator can then Send Live if they want to.
      toast.success("Slide updated");
      router.refresh(); // grid reflects the saved text; editor stays open
    } finally {
      setQeSaving(false);
    }
  };

  // Task C: derive stable per-slide IDs for dnd + server call. For song
  // items we have real songSlide IDs on songSlideRows; for other item
  // types the reorder validator accepts stringified indices.
  const slideIds: string[] = slides.map((_, i) => {
    if (item?.type === "song" && item.songSlideRows?.[i]?.id) return item.songSlideRows[i].id;
    return `slide-${i}`;
  });

  // 2026-07-27 field fix: distance raised 6 → 8px. A shaky mouse/trackpad
  // press that drifts >6px turned the click into a drag activation and the
  // click never fired (classic dnd-kit click-swallow at live services).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    // dnd-kit can let a trailing click through after a drop — record the drop
    // time so onSelect can ignore that ghost click (prevents an accidental
    // go-live right after reordering slides).
    lastDragEndRef.current = Date.now();
    // Fix-loop 2026-07-27: reordering changes which slide sits behind each
    // key/index — a stale dedupe key could wrongly suppress (or allow) the
    // next go-live. Reset so post-drag clicks always evaluate fresh.
    __lastLiveKey = "";
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = slideIds.indexOf(String(active.id));
    const newIdx = slideIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const nextOrder = arrayMove(slideIds, oldIdx, newIdx);
    ctx.onReorderSlidesInItem?.(ctx.previewItemIdx, nextOrder);
  };

  return (
    <div className="p-2 flex flex-col gap-6">
      {/* Main slide grid — Task B: 6px gutter. Y10: semantic grid + gridcell roles. */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={slideIds} strategy={rectSortingStrategy}>
          <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
          <div
            role="grid"
            aria-label="Slides"
            // min-h so the empty area below the cards is part of the grid and can
            // be right-clicked to paste a copied slide at the end.
            className={cn("relative isolate", viewMode === "text" ? "flex flex-col" : "grid", "min-h-[45vh]")}
            style={viewMode === "text"
              ? { gap: 4 }
              // alignContent:start packs rows at the top so a wrapped row (e.g.
              // slide 6 under slides 1-5) sits directly below the first row
              // instead of the grid stretching rows to fill the 45vh min-height.
              : viewMode === "list"
                ? { gap: 6, alignContent: "start", gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(slideSize * 2, 220)}px, 1fr))` }
                : { gap: 6, alignContent: "start", gridTemplateColumns: `repeat(auto-fill, minmax(${slideSize}px, 1fr))` }
            }
          >
            <DotGridBackground />
            {slides.length === 0 && (
              <div className="col-span-full relative flex flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="w-12 h-12 rounded-xl grid place-items-center surface-elev">
                  <LayoutGrid className="w-5 h-5 text-[var(--color-muted-foreground)]" />
                </div>
                <div className="text-[13px] font-semibold text-[var(--color-foreground)]">No slides yet</div>
                <div className="text-[11px] text-[var(--color-muted-foreground)] max-w-[280px] leading-relaxed">
                  Use <span className="text-[var(--color-foreground)]">Add slide</span> above to create one — or click any slide to send it live. Enable Safe Mode in Settings to require a double-click.
                </div>
              </div>
            )}
            {slides.map((s, idx) => (
              <SortableSlideCard
                key={slideIds[idx]}
                id={slideIds[idx]}
                slide={s}
                index={idx + 1}
                appearance={ctx.appearance ?? undefined}
                background={ctx.background}
                selected={idx === ctx.previewSlideIdx}
                canQuickEdit={item?.type === "song" && !!(item as { songId?: string }).songId}
                onSendLive={() => {
                  fireLive(`${ctx.previewItemIdx}:${slideIds[idx]}`, () => ctx.onSendSlideToLive(s));
                }}
                onSelect={() => {
                  console.log("[click] slide", { id: slideIds[idx], idx, safeMode: safeMode() });
                  // Ignore the ghost click dnd-kit lets through right after a
                  // drag-drop — otherwise reordering could fire a slide live.
                  // Fix-loop 2026-07-27: the guard suppresses ONLY the go-live
                  // fire; preview selection still happens (window 200 → 120ms).
                  const justDragged = Date.now() - lastDragEndRef.current < 120;
                  ctx.onJumpSlide(ctx.previewItemIdx, idx);
                  if (justDragged) {
                    console.log("[click] slide live suppressed (just finished drag)", { id: slideIds[idx] });
                    return;
                  }
                  if (!safeMode()) {
                    // Fix-loop 2026-07-27: dedupe key includes the playlist
                    // item — the `slide-${i}` fallback collides across items
                    // and across reorders.
                    fireLive(`${ctx.previewItemIdx}:${slideIds[idx]}`, () => ctx.onSendSlideToLive(s));
                  }
                }}
                onDouble={() => {
                  console.log("[click] slide double", { id: slideIds[idx], idx });
                  // Double-click is the natural "edit" gesture. For editable song
                  // slides, open the full slide editor (Quick Edit remains on the
                  // right-click menu for fast text-only tweaks). Non-editable
                  // slides keep the fire-to-live-in-safe-mode behaviour.
                  const editable = item?.type === "song" && !!(item as { songId?: string }).songId;
                  if (editable && onOpenEditor) {
                    ctx.onJumpSlide(ctx.previewItemIdx, idx); // select the slide first
                    onOpenEditor();
                    return;
                  }
                  // Media image → open the crop/frame/blur editor (same gesture as
                  // the Media library thumbnails).
                  if (item?.type === "media" && s.kind === "image") {
                    const meta = item.mediaMeta?.[idx];
                    if (meta?.id && s.url) {
                      ctx.onJumpSlide(ctx.previewItemIdx, idx);
                      window.dispatchEvent(new CustomEvent("presentflow:edit-media-image", { detail: { id: meta.id, url: s.url, fileName: meta.fileName || "Image" } }));
                      return;
                    }
                  }
                  if (safeMode()) fireLive(`${ctx.previewItemIdx}:${slideIds[idx]}`, () => ctx.onSendSlideToLive(s));
                }}
                onDelete={() => {
                  // Delete THIS slide immediately by its DB id (works for designed
                  // songs too — no guard redirect, no rewriting other slides), then
                  // refresh so the grid updates. 2026-08-19: previously used a
                  // rewrite-all update with no refresh, so the deletion never showed.
                  void (async () => {
                    const { toast } = await import("sonner");
                    if (item?.type !== "song" || !(item as { songId?: string }).songId) {
                      toast.error("Only song slides can be deleted here");
                      return;
                    }
                    if (slides.length <= 1) {
                      toast.error("A song needs at least one slide");
                      return;
                    }
                    const slideId = item.songSlideRows?.[idx]?.id;
                    if (!slideId) { toast.error("Couldn't find that slide to delete"); return; }
                    const res = await deleteSongSlide(slideId);
                    if (!res.ok) { toast.error(res.error ?? "Delete failed"); return; }
                    // Neutral (not green): a delete is an acknowledgment, not a
                    // "saved" success; red is reserved for failures.
                    toast("Slide deleted");
                    router.refresh();
                  })();
                }}
                onQuickEdit={() => {
                  // Quick Edit now works "no matter the design" — the save path
                  // (updateSongSlideText) preserves the slide's objectsJson layout
                  // and only swaps the FIRST text object, so designed songs no
                  // longer redirect to the full editor. Seed the box from that SAME
                  // first text object (not the flattened lyrics) so a multi-text
                  // slide's other objects can't be duplicated into the first on save.
                  // Falls back to the flat text for plain-lyric slides.
                  let text = s.kind === "text" ? ((s as { text?: string }).text ?? "") : "";
                  const objs = s.kind === "text" ? (s as { objects?: Array<{ kind?: string; text?: string }> }).objects : undefined;
                  if (Array.isArray(objs)) {
                    const firstText = objs.find((o) => o?.kind === "text");
                    if (firstText && typeof firstText.text === "string") text = firstText.text;
                  }
                  editedTextRef.current = text; // seed the live-edit ref
                  // Capture the STABLE slide id now so Save can't be misdirected
                  // by a later reorder/delete while the editor stays open.
                  const slideId = item?.type === "song" ? item.songSlideRows?.[idx]?.id : undefined;
                  qeOffset.current = { x: 0, y: 0 }; // open centred each time
                  applyQeTransform(); // recenter even if the panel is already mounted (target switch)
                  setQuickEdit({ slideIdx: idx, slideId, text });
                }}
                onDuplicate={() => {
                  if (guardObjectSong()) return;
                  void (async () => {
                    if (item?.type === "song" && (item as { songId?: string }).songId) {
                      const songId = (item as { songId?: string }).songId!;
                      const newSlides = [...slides];
                      newSlides.splice(idx + 1, 0, s);
                      const updatedSlides = newSlides.map((sl) => ({
                        lyrics: sl.kind === "text" ? ((sl as { text?: string }).text ?? "") : "",
                      }));
                      const res = await updateSongSlides(songId, updatedSlides);
                      if (!res.ok) {
                        const { toast } = await import("sonner");
                        toast.error(res.error ?? "Duplicate failed");
                      } else {
                        const { toast } = await import("sonner");
                        toast.success("Slide duplicated");
                        router.refresh();
                      }
                    }
                  })();
                }}
                onCopyText={() => {
                  const text = s.kind === "text" ? ((s as { text?: string }).text ?? "") : "";
                  if (text) {
                    navigator.clipboard.writeText(text).then(() => {
                      void import("sonner").then(({ toast }) => toast.success("Copied to clipboard"));
                    }).catch(() => {
                      void import("sonner").then(({ toast }) => toast.error("Copy failed"));
                    });
                  }
                }}
                onCopySlide={() => {
                  setSlideClipboard(s);
                  void import("sonner").then(({ toast }) => toast.success("Slide copied"));
                }}
                canPaste={canPasteHere}
                onPasteSlide={() => pasteSlideAt(idx + 1)}
              />
            ))}
          </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className="min-w-[180px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
              <ContextMenu.Item disabled={!canPasteHere} onSelect={() => pasteSlideAt(slides.length)}
                className={cn("px-3 py-1.5 rounded outline-none cursor-pointer", canPasteHere ? "hover:bg-[var(--color-panel)] text-[var(--color-foreground)]" : "opacity-40 cursor-not-allowed")}>
                {canPasteHere ? "Paste slide (at end)" : "Paste slide"}
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
          </ContextMenu.Root>
        </SortableContext>
      </DndContext>

      {/* Stage row (half-size mirror) */}
      {slides.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Stage</div>
          <div
            className="grid"
            style={{
              gap: 6,
              gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(slideSize / 1.6)}px, 1fr))`,
            }}
          >
            {slides.map((s, idx) => (
              <div
                key={idx}
                className="relative aspect-video rounded-md border border-[var(--color-border)] overflow-hidden opacity-70"
              >
                {/* Fit text down to a small floor so the half-size stage mirror
                    doesn't clip long lyrics (matches the main grid's textMinPx). */}
                <ThemedSlideCard slide={s} textMinPx={8} appearance={ctx.appearance ?? undefined} background={ctx.background} />
                <div className="absolute bottom-1 right-1 text-[8px] font-mono uppercase tracking-wider text-white/55 bg-black/60 px-1 py-px rounded-sm pointer-events-none">
                  Stage
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Edit — ProPresenter-style NON-MODAL floating editor. The selected
          slide pops out ~2x larger as the REAL slide (its own styling/background),
          editable in place. Crucially it is NOT a modal: no overlay, no focus
          trap — the operator can still click other slides in the grid and push
          them LIVE mid-service while a quick edit is open. Small ✕ at top-left. */}
      {quickEdit !== null && (() => {
        const current = slides[quickEdit.slideIdx];
        const preview = current
          ? applyTextToSlide(current, quickEdit.text || " ")
          : ({ kind: "text", text: quickEdit.text || " " } as SlidePayload);
        return (
          <div
            ref={qePanelRef}
            className="fixed z-50 top-[14%] left-1/2 flex flex-col items-center"
            style={{ transform: "translate(-50%, 0)" }}
            role="dialog"
            aria-label={`Quick Edit — Slide ${quickEdit.slideIdx + 1}`}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setQuickEdit(null); }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { void handleQuickEditSave(editedTextRef.current); }
            }}
          >
            {/* Drag handle — grab this bar to move the box so it never blocks the
                slides behind it. Pointer-capture drag; updates the panel transform
                directly (no re-render, so the caret is untouched). */}
            <div
              onPointerDown={onQeDragStart}
              onPointerMove={onQeDragMove}
              onPointerUp={onQeDragEnd}
              className="mb-1.5 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/70 ring-1 ring-white/20 text-white/70 text-[11px] cursor-move select-none touch-none hover:bg-black/85"
              title="Drag to move"
            >
              <GripHorizontal className="w-3.5 h-3.5" /> Drag to move
            </div>
            {/* The popped slide — the REAL render, edited IN PLACE. The themed text
                node itself is contentEditable (via AutoFitText.editable), so the
                caret sits on the real letters and the styling/wrapping is inherently
                correct across ANY theme/background/logo. `preview` is derived from
                the FROZEN quickEdit.text (not the live-typed value) so the caret +
                auto-fit stay put; the live text lives in editedTextRef. Smaller
                (42vw/380px) so more of the grid stays visible behind it. */}
            <div className="relative w-[min(42vw,380px)] aspect-video rounded-lg overflow-hidden shadow-[0_16px_56px_rgba(0,0,0,0.7)] ring-2 ring-white/30">
              <ThemedSlideCard
                // Re-key per edited slide so switching the target while the
                // (non-modal) editor stays open remounts the editable node and
                // re-runs its focus + caret-to-end effect on the new text.
                key={quickEdit.slideId ?? quickEdit.slideIdx}
                slide={preview}
                textMinPx={18}
                appearance={ctx.appearance ?? undefined}
                background={ctx.background}
                editable
                onEditInput={(t) => { editedTextRef.current = t; }}
              />
              {/* Close ✕ — top-left, like ProPresenter. */}
              <button type="button" aria-label="Close" onClick={() => setQuickEdit(null)}
                className="absolute top-1.5 left-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white/90 ring-1 ring-white/20 z-10">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Minimal floating action row. */}
            <div className="mt-2.5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const t = editedTextRef.current.trim();
                  if (!t) return;
                  ctx.onSendSlideToLive(current ? applyTextToSlide(current, t) : { kind: "text", text: t });
                }}
                className="h-8 px-3 rounded-md text-[12px] font-medium bg-white/10 border border-white/20 hover:bg-white/20 text-white backdrop-blur-sm"
              >
                Send this slide live
              </button>
              <button
                type="button"
                onClick={() => void handleQuickEditSave(editedTextRef.current)}
                disabled={qeSaving || !item?.type || item.type !== "song"}
                className="h-8 px-4 rounded-md text-[12px] font-semibold bg-[var(--color-brand)] text-black hover:opacity-90 disabled:opacity-50"
              >
                {qeSaving ? "Saving…" : "Save"}
              </button>
              <span className="ml-1 text-[11px] text-white/60">⌘↵ Save · Esc Close · other slides stay live-clickable</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SortableSlideCard(props: {
  id: string;
  slide: SlidePayload;
  index: number;
  appearance?: ThemeAppearance;
  background?: BackgroundSpec | null;
  selected: boolean;
  canQuickEdit: boolean;
  canPaste: boolean;
  onSelect: () => void;
  onDouble: () => void;
  onDelete: () => void;
  onQuickEdit: () => void;
  onDuplicate: () => void;
  onCopyText: () => void;
  onCopySlide: () => void;
  onPasteSlide: () => void;
  onSendLive: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative w-full min-w-0 group/slide">
      <SlideCard
        slide={props.slide}
        index={props.index}
        appearance={props.appearance}
        background={props.background}
        selected={props.selected}
        canQuickEdit={props.canQuickEdit}
        canPaste={props.canPaste}
        onSelect={props.onSelect}
        onDouble={props.onDouble}
        onDelete={props.onDelete}
        onQuickEdit={props.onQuickEdit}
        onDuplicate={props.onDuplicate}
        onCopyText={props.onCopyText}
        onCopySlide={props.onCopySlide}
        onPasteSlide={props.onPasteSlide}
        onSendLive={props.onSendLive}
      />
      {/* Native drag-to-playlist handle. Kept SEPARATE from the dnd-kit reorder
          (whose pointer listeners live on this wrapper) by stopping propagation
          on pointer/mouse down, so grabbing the handle starts an HTML5 drag —
          drop it on a playlist song to append this slide to that song's end —
          while the rest of the card still reorders within the grid. */}
      <div
        draggable
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.stopPropagation();
          try {
            e.dataTransfer.setData("application/x-presentflow-slide", JSON.stringify(props.slide));
            e.dataTransfer.effectAllowed = "copy";
          } catch { /* noop */ }
        }}
        title="Drag onto a song in the playlist to add this slide to the end of that song"
        className="absolute top-1 right-1 z-10 w-6 h-6 rounded-md flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover/slide:opacity-100 transition-opacity bg-[var(--color-elevated)]/90 border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>
    </div>
  );
}

function SlideCard({
  slide, index, appearance, background, selected, canQuickEdit, canPaste, onSelect, onDouble, onDelete, onQuickEdit, onDuplicate, onCopyText, onCopySlide, onPasteSlide, onSendLive,
}: {
  slide: SlidePayload;
  index: number;
  appearance?: ThemeAppearance;
  background?: BackgroundSpec | null;
  selected: boolean;
  canQuickEdit: boolean;
  canPaste: boolean;
  onSelect: () => void;
  onDouble: () => void;
  onDelete: () => void;
  onQuickEdit: () => void;
  onDuplicate: () => void;
  onCopyText: () => void;
  onCopySlide: () => void;
  onPasteSlide: () => void;
  onSendLive: () => void;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          type="button"
          role="gridcell"
          tabIndex={0}
          onClick={onSelect}
          onDoubleClick={onDouble}
          // 2026-08-25 fix: stop the right-click from ALSO reaching the grid-level
          // "Paste slide" context menu that wraps the whole grid (commit 0e2fead).
          // Radix ContextMenu.Trigger doesn't stopPropagation, so without this a
          // right-click on a card opened the outer paste-only menu ON TOP of the
          // per-slide menu, hiding Quick Edit ("Quick Edit basically nonexistent").
          // The inner (this card's) menu still opens — stopPropagation only blocks
          // the ANCESTOR grid trigger, not this element's own Radix handler.
          onContextMenu={(e) => e.stopPropagation()}
          // Staggered pop-in when a song's slides first mount (keyed by slide id,
          // so it fires on song switch, not on every re-render).
          style={{ animationDelay: `${Math.min(Math.max(index - 1, 0), 14) * 22}ms` }}
          className={cn(
            "pf-slide-pop",
            // w-full so every card fills its grid cell → uniform size regardless
            // of word count (a <button> otherwise shrinks to its text content,
            // which made short slides like "AMEN" tiny). aspect-video then gives
            // a consistent 16:9 box for all.
            "relative w-full min-w-0 aspect-video rounded-lg overflow-hidden text-left",
            "transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-house)]",
            "motion-safe:hover:-translate-y-[3px] active:translate-y-0 active:duration-75",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]",
            selected
              ? "border-2 border-[var(--color-brand)] pf-selected-glow shadow-[var(--shadow-ember)] hover:shadow-[var(--shadow-ember-lg)]"
              : "border border-[var(--color-border)] shadow-[var(--shadow-sm)] hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--shadow-lg)]",
          )}
        >
          {/* 2026-07-25 pull-back — textMinPx=8 + no-pagination made
              lyrics unreadable ("way too small" per field report). Raised
              to 14px (readable at glance size), pagination re-enabled so
              long stanzas split cleanly instead of shrinking to invisible.
              Text still fits WHOLE short verses without truncating, and
              long ones page (visible page indicator inside the card).
              Live projector rendering unaffected (uses the 24px default). */}
          <ThemedSlideCard slide={slide} textMinPx={14} appearance={appearance} background={background} />
          <div
            className="absolute top-1.5 left-1.5 min-w-[20px] h-5 px-1 flex items-center justify-center rounded-md text-[10px] font-bold tabular-nums transition-colors"
            style={selected
              ? { background: "var(--color-brand)", color: "#17130c", boxShadow: "var(--shadow-sm)" }
              : { background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.82)", border: "1px solid rgba(255,255,255,0.14)" }}
            aria-hidden
          >
            {index}
          </div>
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[220px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-1 text-[12px] shadow-xl z-50">
          {/* Send to output — available for every slide type */}
          <ContextMenu.Item
            onSelect={onSendLive}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)] font-medium"
          >
            <span className="w-3.5 h-3.5 rounded-full bg-[var(--color-brand)] inline-block shrink-0" />
            Send to Live
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />

          {/* Quick Edit — only for song slides (non-song items have no editable text stored in DB) */}
          {canQuickEdit && (
            <ContextMenu.Item
              onSelect={onQuickEdit}
              className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
            >
              <Pencil className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
              Quick Edit
            </ContextMenu.Item>
          )}

          {/* Clipboard */}
          <ContextMenu.Item
            onSelect={onCopyText}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
          >
            Copy Text
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={onCopySlide}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
          >
            Copy Slide
          </ContextMenu.Item>
          {canPaste && (
            <ContextMenu.Item
              onSelect={onPasteSlide}
              className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
            >
              Paste Slide
            </ContextMenu.Item>
          )}
          {canQuickEdit && (
            <ContextMenu.Item
              onSelect={onDuplicate}
              className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer data-[highlighted]:bg-[var(--color-panel)] data-[highlighted]:text-[var(--color-foreground)]"
            >
              Duplicate Slide
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator className="h-px bg-[var(--color-border)] my-1" />

          {/* Destructive */}
          <ContextMenu.Item
            onSelect={onDelete}
            className="flex items-center gap-2 px-3 py-1.5 rounded outline-none cursor-pointer text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-panel)]"
          >
            Delete Slide
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
