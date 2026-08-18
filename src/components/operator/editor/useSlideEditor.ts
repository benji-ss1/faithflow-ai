"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type EditableSlide, type SlideObject, type TextObject, type ShapeObject, type ImageObject,
  emptyTextObject, emptyShape, emptyImage, emptyVideo, newObjectId, fromLegacyLyrics, normalizeEditableSlide,
  slidePayloadFromEditable, extractLyricsFromEditable,
} from "@/lib/slide-objects";

export type EditorSlideRow = {
  id: string;
  lyrics: string;
  objectsJson?: unknown;
};

export type UseSlideEditorArgs = {
  itemId: string | null;
  itemType: "song" | "scripture" | "media" | "sermon" | "blank" | "logo";
  songId: string | null;
  // Server-hydrated legacy slides for the current item. For songs these come
  // straight from song_slides; for other item types we still show a
  // read-only editor derived from ExpandedItem.slides (SlidePayloads).
  initialSlides: EditorSlideRow[];
};

export type UseSlideEditorReturn = {
  slides: EditableSlide[];
  currentIndex: number;
  currentSlide: EditableSlide | null;
  // Primary selection — the single anchored object, or null when zero OR more
  // than one object is selected. Single-object inspectors key off this.
  selectedObjectId: string | null;
  // Full selection set (multi-select). Length 0/1 keeps the classic behaviour;
  // >1 drives group move/align/delete in the desktop canvas + inspector.
  selectedObjectIds: string[];
  isEditable: boolean;
  setCurrentIndex: (i: number) => void;
  setSelectedObjectId: (id: string | null) => void;
  setSelectedObjectIds: (ids: string[]) => void;
  toggleObjectSelection: (id: string) => void;
  updateObjects: (patches: { id: string; patch: Partial<SlideObject> }[]) => void;
  removeObjects: (ids: string[]) => void;
  alignObjects: (ids: string[], edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => void;
  distributeObjects: (ids: string[], axis: "h" | "v") => void;
  duplicateObjects: (ids: string[]) => void;
  addTextObject: () => void;
  addShape: (shape?: "rect" | "ellipse") => void;
  addImage: (url: string) => void;
  addVideo: (url: string) => void;
  reorderObject: (id: string, dir: "front" | "back" | "forward" | "backward") => void;
  updateObject: (id: string, patch: Partial<SlideObject>) => void;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => void;
  addObject: (obj: SlideObject) => void;
  moveObject: (id: string, dx: number, dy: number) => void;
  addSlide: () => void;
  addBlankSlide: () => void;
  applyToAll: () => void;
  duplicateSlide: () => void;
  deleteSlide: (index?: number) => boolean;
  restoreSlide: (index: number, slide: EditableSlide, expectedItemId?: string | null) => void;
  reorderSlide: (from: number, to: number) => void;
  setBg: (patch: { bgColor?: string; bgImageUrl?: string }) => void;
  updateSlideDirect: (patch: Partial<EditableSlide>) => void;
  hasDirtyChanges: boolean;
  resetDirty: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Compat: current slide as a SlidePayload for staging to Preview.
  currentPayload: ReturnType<typeof slidePayloadFromEditable> | null;
  currentLyrics: string;
};

export function useSlideEditor(args: UseSlideEditorArgs): UseSlideEditorReturn {
  const { itemId, itemType, initialSlides } = args;
  const isEditable = itemType === "song";

  // Hydrate from initialSlides. Deterministic init: derive directly from prop.
  const initialParsed = initialSlides.map(normalizeEditableSlide);
  const [slides, setSlides] = useState<EditableSlide[]>(initialParsed);
  const [currentIndex, setCurrentIndex] = useState(0);
  // Selection is a set of object ids. `selectedObjectId` (below) is the derived
  // single-anchor for classic single-object inspectors.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedObjectId = selectedIds.length === 1 ? selectedIds[0] : null;
  const [dirty, setDirty] = useState(false);

  // Refs mirror the latest state so imperative slide-management handlers
  // (e.g. delete from a right-click, which does NOT first left-click-select the
  // slide) act on fresh values instead of a stale render closure. Fixes the bug
  // where right-click → Delete removed the previously-selected slide, not the
  // one under the cursor.
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  // Mirror the selection so imperative bulk ops (applyToAll) can read the
  // current single-selected object without being in the callback's dep list.
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  // Tracks the item currently loaded in the editor so a deferred action (a
  // slide-delete Undo fired after the operator switched items) can refuse to
  // mutate the wrong song.
  const itemIdRef = useRef(itemId);
  itemIdRef.current = itemId;

  // ── Undo / redo ──────────────────────────────────────────────────────────
  // History of `slides` snapshots, recorded automatically by watching `slides`
  // change and pushing the PREVIOUS value. Rapid successive changes (a drag)
  // coalesce into one step. Programmatic changes (undo/redo itself, item reset,
  // server re-sync) set `suppressRecordRef` so they never pollute history.
  const historyRef = useRef<{ past: EditableSlide[][]; future: EditableSlide[][] }>({ past: [], future: [] });
  const prevSlidesRef = useRef(slides);
  const lastSnapRef = useRef(0);
  const suppressRecordRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (prevSlidesRef.current === slides) {
      // No reference change — still consume any pending suppress flag so it can
      // never leak into (and wrongly swallow) the NEXT real edit.
      if (suppressRecordRef.current) suppressRecordRef.current = false;
      return;
    }
    const prev = prevSlidesRef.current;
    prevSlidesRef.current = slides;
    if (suppressRecordRef.current) { suppressRecordRef.current = false; return; }
    const now = Date.now();
    const h = historyRef.current;
    if (now - lastSnapRef.current < 350 && h.past.length > 0) return; // coalesce a drag burst
    lastSnapRef.current = now;
    h.past.push(prev);
    if (h.past.length > 80) h.past.shift();
    h.future = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [slides]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const target = h.past.pop()!;
    h.future.push(slidesRef.current);
    if (h.future.length > 80) h.future.shift();
    lastSnapRef.current = 0;
    suppressRecordRef.current = true;
    slidesRef.current = target; // keep the ref fresh so a synchronous 2nd undo is safe
    setSlides(target);
    setSelectedIds([]);
    setCurrentIndex((i) => Math.max(0, Math.min(i, target.length - 1)));
    setDirty(true);
    setCanUndo(h.past.length > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const target = h.future.pop()!;
    h.past.push(slidesRef.current);
    if (h.past.length > 80) h.past.shift();
    lastSnapRef.current = 0;
    suppressRecordRef.current = true;
    slidesRef.current = target; // keep the ref fresh so a synchronous 2nd redo is safe
    setSlides(target);
    setSelectedIds([]);
    setCurrentIndex((i) => Math.max(0, Math.min(i, target.length - 1)));
    setDirty(true);
    setCanUndo(true);
    setCanRedo(h.future.length > 0);
  }, []);

  // Reset editor state when the underlying item changes.
  const lastItemIdRef = useRef<string | null>(itemId);
  useEffect(() => {
    if (lastItemIdRef.current === itemId) return;
    lastItemIdRef.current = itemId;
    // New item — clear undo history and don't record the reset itself.
    historyRef.current = { past: [], future: [] };
    lastSnapRef.current = 0;
    suppressRecordRef.current = true;
    setCanUndo(false);
    setCanRedo(false);
    setSlides(initialSlides.map(normalizeEditableSlide));
    setCurrentIndex(0);
    setSelectedIds([]);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // If the parent re-fetched initialSlides for the SAME item (e.g. after a
  // save/CRUD server action), sync from the fresh server state.
  useEffect(() => {
    if (lastItemIdRef.current !== itemId) return;
    // Only sync when we haven't got local unsaved edits.
    if (dirty) return;
    // Fresh server state (e.g. after a save that reassigned pending_ ids) —
    // clear undo history so a later undo can't revive a pre-sync pending id.
    historyRef.current = { past: [], future: [] };
    lastSnapRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);
    suppressRecordRef.current = true; // server re-sync isn't an undoable edit
    setSlides(initialSlides.map(normalizeEditableSlide));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlides.length, itemId]);

  const currentSlide = slides[currentIndex] ?? null;

  const patchCurrent = useCallback((fn: (s: EditableSlide) => EditableSlide) => {
    if (!isEditable) return;
    setSlides((prev) => {
      if (!prev[currentIndex]) return prev;
      const copy = prev.slice();
      copy[currentIndex] = fn(prev[currentIndex]);
      return copy;
    });
    setDirty(true);
  }, [currentIndex, isEditable]);

  const addTextObject = useCallback(() => {
    if (!isEditable) return;
    const obj = emptyTextObject();
    patchCurrent((s) => ({ ...s, objects: [...s.objects, obj] }));
    setSelectedIds([obj.id]);
  }, [isEditable, patchCurrent]);

  const addShape = useCallback((shape: "rect" | "ellipse" = "rect") => {
    if (!isEditable) return;
    const obj = emptyShape(shape);
    patchCurrent((s) => ({ ...s, objects: [...s.objects, obj] }));
    setSelectedIds([obj.id]);
  }, [isEditable, patchCurrent]);

  const addImage = useCallback((url: string) => {
    if (!isEditable) return;
    const obj = emptyImage(url);
    patchCurrent((s) => ({ ...s, objects: [...s.objects, obj] }));
    setSelectedIds([obj.id]);
  }, [isEditable, patchCurrent]);

  const addVideo = useCallback((url: string) => {
    if (!isEditable) return;
    const obj = emptyVideo(url);
    patchCurrent((s) => ({ ...s, objects: [...s.objects, obj] }));
    setSelectedIds([obj.id]);
  }, [isEditable, patchCurrent]);

  // Z-order: objects paint in array order (last = front). Move the selected
  // object within that order.
  const reorderObject = useCallback((id: string, dir: "front" | "back" | "forward" | "backward") => {
    if (!isEditable) return;
    patchCurrent((s) => {
      const idx = s.objects.findIndex((o) => o.id === id);
      if (idx < 0) return s;
      const objs = s.objects.slice();
      const [obj] = objs.splice(idx, 1);
      const to = dir === "front" ? objs.length
        : dir === "back" ? 0
        : dir === "forward" ? Math.min(objs.length, idx + 1)
        : Math.max(0, idx - 1);
      objs.splice(to, 0, obj);
      return { ...s, objects: objs };
    });
  }, [isEditable, patchCurrent]);

  const updateObject = useCallback((id: string, patch: Partial<SlideObject>) => {
    if (!isEditable) return;
    patchCurrent((s) => ({
      ...s,
      objects: s.objects.map((o) => {
        if (o.id !== id) return o;
        // TS is grumpy about a discriminated-union spread; the runtime is fine
        // because we only ever patch kind-compatible fields.
        return { ...o, ...patch } as SlideObject;
      }),
    }));
  }, [isEditable, patchCurrent]);

  const removeObject = useCallback((id: string) => {
    if (!isEditable) return;
    patchCurrent((s) => ({ ...s, objects: s.objects.filter((o) => o.id !== id) }));
    setSelectedIds((cur) => cur.filter((x) => x !== id));
  }, [isEditable, patchCurrent]);

  // ── Multi-select group operations ─────────────────────────────────────────
  // Toggle one id in/out of the selection (shift/⌘-click on the canvas).
  const toggleObjectSelection = useCallback((id: string) => {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  // Apply a batch of per-object patches in a SINGLE setSlides pass — used by a
  // group drag/nudge so N objects move in one render (and one history step),
  // instead of N cascading updateObject calls.
  const updateObjects = useCallback((patches: { id: string; patch: Partial<SlideObject> }[]) => {
    if (!isEditable || patches.length === 0) return;
    const byId = new Map(patches.map((p) => [p.id, p.patch]));
    patchCurrent((s) => ({
      ...s,
      objects: s.objects.map((o) => {
        const p = byId.get(o.id);
        return p ? ({ ...o, ...p } as SlideObject) : o;
      }),
    }));
  }, [isEditable, patchCurrent]);

  const removeObjects = useCallback((ids: string[]) => {
    if (!isEditable || ids.length === 0) return;
    const rm = new Set(ids);
    patchCurrent((s) => ({ ...s, objects: s.objects.filter((o) => !rm.has(o.id)) }));
    setSelectedIds((cur) => cur.filter((x) => !rm.has(x)));
  }, [isEditable, patchCurrent]);

  // Align every selected object's edge/centre to the SELECTION's bounding box
  // (classic multi-align). With <2 ids it's a no-op — single-object align uses
  // the canvas-relative buttons instead.
  const alignObjects = useCallback((ids: string[], edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => {
    if (!isEditable || ids.length < 2) return;
    patchCurrent((s) => {
      const sel = s.objects.filter((o) => ids.includes(o.id));
      if (sel.length < 2) return s;
      const minX = Math.min(...sel.map((o) => o.x));
      const maxX = Math.max(...sel.map((o) => o.x + o.w));
      const minY = Math.min(...sel.map((o) => o.y));
      const maxY = Math.max(...sel.map((o) => o.y + o.h));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const move = (o: SlideObject): SlideObject => {
        switch (edge) {
          case "left": return { ...o, x: Math.round(minX) } as SlideObject;
          case "hcenter": return { ...o, x: Math.round(cx - o.w / 2) } as SlideObject;
          case "right": return { ...o, x: Math.round(maxX - o.w) } as SlideObject;
          case "top": return { ...o, y: Math.round(minY) } as SlideObject;
          case "vcenter": return { ...o, y: Math.round(cy - o.h / 2) } as SlideObject;
          case "bottom": return { ...o, y: Math.round(maxY - o.h) } as SlideObject;
        }
      };
      const idset = new Set(ids);
      return { ...s, objects: s.objects.map((o) => (idset.has(o.id) ? move(o) : o)) };
    });
  }, [isEditable, patchCurrent]);

  // Evenly space 3+ selected objects along an axis: the two extreme objects
  // stay put and the middle ones are distributed so the gaps between adjacent
  // objects are equal (ProPresenter's "distribute horizontally/vertically").
  const distributeObjects = useCallback((ids: string[], axis: "h" | "v") => {
    if (!isEditable || ids.length < 3) return;
    patchCurrent((s) => {
      const sel = s.objects.filter((o) => ids.includes(o.id));
      if (sel.length < 3) return s;
      // Sort by leading edge along the axis.
      const sorted = sel.slice().sort((a, b) => (axis === "h" ? a.x - b.x : a.y - b.y));
      const size = (o: SlideObject) => (axis === "h" ? o.w : o.h);
      const start = axis === "h" ? sorted[0].x : sorted[0].y;
      const last = sorted[sorted.length - 1];
      const end = (axis === "h" ? last.x : last.y) + size(last);
      const totalSize = sorted.reduce((sum, o) => sum + size(o), 0);
      // Gap distributed across (n-1) intervals; can be negative if objects
      // overlap the span — that's fine, it just packs them.
      const gap = (end - start - totalSize) / (sorted.length - 1);
      let cursor = start;
      const pos = new Map<string, number>();
      for (const o of sorted) {
        pos.set(o.id, Math.round(cursor));
        cursor += size(o) + gap;
      }
      return {
        ...s,
        objects: s.objects.map((o) => {
          if (!pos.has(o.id)) return o;
          return (axis === "h" ? { ...o, x: pos.get(o.id)! } : { ...o, y: pos.get(o.id)! }) as SlideObject;
        }),
      };
    });
  }, [isEditable, patchCurrent]);

  // Duplicate every selected object at once (group duplicate). Clones get fresh
  // ids nudged +40,+40 and become the new selection. Ids are pre-generated
  // OUTSIDE the setSlides updater (pure updater — mirrors duplicateObject) so a
  // pending same-tick update or StrictMode double-invoke can't drop the
  // selection.
  const duplicateObjects = useCallback((ids: string[]) => {
    if (!isEditable || ids.length === 0) return;
    const cur = slidesRef.current[currentIndexRef.current];
    if (!cur) return;
    const present = ids.filter((id) => cur.objects.some((o) => o.id === id));
    if (present.length === 0) return;
    const cloneId = new Map(present.map((id) => [id, newObjectId()]));
    patchCurrent((s) => {
      const clones = s.objects
        .filter((o) => cloneId.has(o.id))
        .map((o) => ({ ...o, id: cloneId.get(o.id)!, x: o.x + 40, y: o.y + 40 } as SlideObject));
      return clones.length ? { ...s, objects: [...s.objects, ...clones] } : s;
    });
    setSelectedIds(present.map((id) => cloneId.get(id)!));
  }, [isEditable, patchCurrent]);

  // Insert a clone of an arbitrary object (e.g. pasted from another slide) onto
  // the current slide with a fresh id, nudged so it's visibly a copy.
  const addObject = useCallback((obj: SlideObject) => {
    if (!isEditable) return;
    const newId = newObjectId();
    const clone = { ...obj, id: newId, x: obj.x + 40, y: obj.y + 40 } as SlideObject;
    patchCurrent((s) => ({ ...s, objects: [...s.objects, clone] }));
    setSelectedIds([newId]);
  }, [isEditable, patchCurrent]);

  const duplicateObject = useCallback((id: string) => {
    if (!isEditable) return;
    const newId = newObjectId();
    patchCurrent((s) => {
      const idx = s.objects.findIndex((o) => o.id === id);
      if (idx < 0) return s;
      // Clone with a fresh id, nudged 40px so it's visibly a copy, inserted
      // directly above the original.
      const clone = { ...s.objects[idx], id: newId, x: s.objects[idx].x + 40, y: s.objects[idx].y + 40 } as SlideObject;
      const objs = s.objects.slice();
      objs.splice(idx + 1, 0, clone);
      return { ...s, objects: objs };
    });
    setSelectedIds([newId]);
  }, [isEditable, patchCurrent]);

  const moveObject = useCallback((id: string, dx: number, dy: number) => {
    if (!isEditable) return;
    updateObject(id, { x: dx, y: dy } as Partial<SlideObject>);
  }, [isEditable, updateObject]);

  const addSlide = useCallback(() => {
    if (!isEditable) return;
    setSlides((prev) => {
      const blank: EditableSlide = {
        id: `pending_${Date.now()}`,
        objects: [emptyTextObject(0, 0, 1920, 1080, "New slide")],
      };
      const next = [...prev, blank];
      return next;
    });
    setDirty(true);
    setCurrentIndex(slides.length);
    setSelectedIds([]);
  }, [isEditable, slides.length]);

  // Insert a GENUINELY empty slide (zero objects) — distinct from addSlide,
  // which seeds a "New slide" text object. Selects the new slide.
  const addBlankSlide = useCallback(() => {
    if (!isEditable) return;
    setSlides((prev) => {
      const blank: EditableSlide = { id: `pending_${Date.now()}`, objects: [] };
      return [...prev, blank];
    });
    setDirty(true);
    setCurrentIndex(slides.length);
    setSelectedIds([]);
  }, [isEditable, slides.length]);

  // Apply the current slide's styling to EVERY other slide in the song:
  //  • Always copies the background (bgColor + bgImageUrl).
  //  • If a single object is selected, copies its STYLE + GEOMETRY (never its
  //    text/url content) onto the first same-kind object of each other slide
  //    (first text object = the "primary" lyric box). Slides with no matching
  //    object just get the background. Mutates `slides` + sets dirty so the
  //    existing onSave persists it; recorded as one undoable history step.
  const applyToAll = useCallback(() => {
    if (!isEditable) return;
    const prev = slidesRef.current;
    const curIdx = currentIndexRef.current;
    const cur = prev[curIdx];
    if (!cur) return;
    const selId = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null;
    const source = selId ? cur.objects.find((o) => o.id === selId) ?? null : null;

    let stylePatch: Partial<SlideObject> | null = null;
    let sourceKind: SlideObject["kind"] | null = null;
    if (source) {
      sourceKind = source.kind;
      // Strip identity + content + per-object behaviour; keep style + geometry.
      const rest = { ...source } as Record<string, unknown>;
      delete rest.id;
      delete rest.kind;
      delete rest.hidden;
      delete rest.locked;
      delete rest.anim;
      delete rest.animDelayMs;
      if (source.kind === "text") delete rest.text;
      if (source.kind === "image" || source.kind === "video") delete rest.url;
      stylePatch = rest as Partial<SlideObject>;
    }

    const next = prev.map((s, i) => {
      if (i === curIdx) return s;
      let objects = s.objects;
      if (stylePatch && sourceKind) {
        const targetIdx = s.objects.findIndex((o) => o.kind === sourceKind);
        if (targetIdx >= 0) {
          objects = s.objects.map((o, oi) =>
            oi === targetIdx ? ({ ...o, ...stylePatch } as SlideObject) : o);
        }
      }
      return { ...s, bgColor: cur.bgColor, bgImageUrl: cur.bgImageUrl, objects };
    });
    setSlides(next);
    setDirty(true);
  }, [isEditable]);

  const duplicateSlide = useCallback(() => {
    if (!isEditable) return;
    setSlides((prev) => {
      if (!prev[currentIndex]) return prev;
      const src = prev[currentIndex];
      const dup: EditableSlide = {
        ...src,
        id: `pending_${Date.now()}`,
        objects: src.objects.map((o) => ({ ...o, id: `${o.id}_dup_${Math.random().toString(36).slice(2, 6)}` })),
      };
      const copy = prev.slice();
      copy.splice(currentIndex + 1, 0, dup);
      return copy;
    });
    setDirty(true);
    setCurrentIndex((i) => i + 1);
    setSelectedIds([]);
  }, [isEditable, currentIndex]);

  // deleteSlide(index?) — deletes the slide at `index`, or the currently
  // selected slide when no index is given. Reads slides/currentIndex from refs
  // so a right-click delete (which never selects the slide first) removes the
  // correct one, and keeps the selection stable afterward.
  const deleteSlide = useCallback((index?: number): boolean => {
    if (!isEditable) return false;
    const prev = slidesRef.current;
    const cur = currentIndexRef.current;
    const target = typeof index === "number" ? index : cur;
    if (target < 0 || target >= prev.length) return false;
    if (prev.length <= 1) {
      if (typeof window !== "undefined" && !window.confirm("Delete the only slide? The item will have no slides.")) {
        return false;
      }
    }
    const copy = prev.slice();
    copy.splice(target, 1);
    // Shift the selection left if we removed at/before it, then clamp to the
    // shortened list so currentSlide never points past the end.
    const nextIndex = Math.max(0, Math.min(target <= cur ? cur - 1 : cur, copy.length - 1));
    setSlides(copy);
    setCurrentIndex(nextIndex);
    setSelectedIds([]);
    setDirty(true);
    return true;
  }, [isEditable]);

  // Re-insert a previously-deleted slide at `index` (undo for deleteSlide).
  // Clamps the index into range and selects the restored slide.
  const restoreSlide = useCallback((index: number, slide: EditableSlide, expectedItemId?: string | null) => {
    if (!isEditable) return;
    // Refuse to inject the slide if the editor has since switched to another
    // item — otherwise an Undo clicked after an item switch would corrupt a
    // different song.
    if (expectedItemId !== undefined && expectedItemId !== itemIdRef.current) return;
    setSlides((prev) => {
      const at = Math.max(0, Math.min(index, prev.length));
      const copy = prev.slice();
      copy.splice(at, 0, slide);
      return copy;
    });
    setCurrentIndex(Math.max(0, Math.min(index, slidesRef.current.length)));
    setSelectedIds([]);
    setDirty(true);
  }, [isEditable]);

  const reorderSlide = useCallback((from: number, to: number) => {
    if (!isEditable) return;
    if (from === to) return;
    setSlides((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const copy = prev.slice();
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
    setDirty(true);
    setCurrentIndex(to);
    // Object ids are per-slide; changing the displayed slide invalidates any
    // multi-selection (mirrors the setCurrentIndex wrapper) so the group panel
    // and group ops never linger over objects that aren't on screen.
    setSelectedIds([]);
  }, [isEditable]);

  const setBg = useCallback((patch: { bgColor?: string; bgImageUrl?: string }) => {
    patchCurrent((s) => ({ ...s, ...patch }));
  }, [patchCurrent]);

  const updateSlideDirect = useCallback((patch: Partial<EditableSlide>) => {
    patchCurrent((s) => ({ ...s, ...patch }));
    // A template/bulk apply that replaces the object list invalidates any
    // current selection (the old ids are gone) — clear it so the group panel
    // and group ops can't linger over non-existent objects.
    if (patch.objects) setSelectedIds([]);
  }, [patchCurrent]);

  const currentPayload = currentSlide ? slidePayloadFromEditable(currentSlide) : null;
  const currentLyrics = currentSlide ? extractLyricsFromEditable(currentSlide) : "";

  return {
    slides,
    currentIndex,
    currentSlide,
    selectedObjectId,
    selectedObjectIds: selectedIds,
    isEditable,
    setCurrentIndex: (i) => { setCurrentIndex(i); setSelectedIds([]); },
    setSelectedObjectId: (id) => setSelectedIds(id ? [id] : []),
    setSelectedObjectIds: setSelectedIds,
    toggleObjectSelection,
    updateObjects,
    removeObjects,
    alignObjects,
    distributeObjects,
    duplicateObjects,
    addTextObject,
    addShape,
    addImage,
    addVideo,
    reorderObject,
    updateObject,
    removeObject,
    duplicateObject,
    addObject,
    moveObject,
    addSlide,
    addBlankSlide,
    applyToAll,
    duplicateSlide,
    deleteSlide,
    restoreSlide,
    reorderSlide,
    setBg,
    updateSlideDirect,
    hasDirtyChanges: dirty,
    resetDirty: () => setDirty(false),
    undo,
    redo,
    canUndo,
    canRedo,
    currentPayload,
    currentLyrics,
  };
}

// Convenience: type re-exports so consumers only import from the hook module.
export type { EditableSlide, SlideObject, TextObject, ShapeObject, ImageObject };
