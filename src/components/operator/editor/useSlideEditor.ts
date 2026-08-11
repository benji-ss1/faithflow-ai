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
  selectedObjectId: string | null;
  isEditable: boolean;
  setCurrentIndex: (i: number) => void;
  setSelectedObjectId: (id: string | null) => void;
  addTextObject: () => void;
  addShape: (shape?: "rect" | "ellipse") => void;
  addImage: (url: string) => void;
  addVideo: (url: string) => void;
  reorderObject: (id: string, dir: "front" | "back" | "forward" | "backward") => void;
  updateObject: (id: string, patch: Partial<SlideObject>) => void;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => void;
  moveObject: (id: string, dx: number, dy: number) => void;
  addSlide: () => void;
  duplicateSlide: () => void;
  deleteSlide: (index?: number) => boolean;
  restoreSlide: (index: number, slide: EditableSlide, expectedItemId?: string | null) => void;
  reorderSlide: (from: number, to: number) => void;
  setBg: (patch: { bgColor?: string; bgImageUrl?: string }) => void;
  updateSlideDirect: (patch: Partial<EditableSlide>) => void;
  hasDirtyChanges: boolean;
  resetDirty: () => void;
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
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
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
  // Tracks the item currently loaded in the editor so a deferred action (a
  // slide-delete Undo fired after the operator switched items) can refuse to
  // mutate the wrong song.
  const itemIdRef = useRef(itemId);
  itemIdRef.current = itemId;

  // Reset editor state when the underlying item changes.
  const lastItemIdRef = useRef<string | null>(itemId);
  useEffect(() => {
    if (lastItemIdRef.current === itemId) return;
    lastItemIdRef.current = itemId;
    setSlides(initialSlides.map(normalizeEditableSlide));
    setCurrentIndex(0);
    setSelectedObjectId(null);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // If the parent re-fetched initialSlides for the SAME item (e.g. after a
  // save/CRUD server action), sync from the fresh server state.
  useEffect(() => {
    if (lastItemIdRef.current !== itemId) return;
    // Only sync when we haven't got local unsaved edits.
    if (dirty) return;
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
    setSelectedObjectId(obj.id);
  }, [isEditable, patchCurrent]);

  const addShape = useCallback((shape: "rect" | "ellipse" = "rect") => {
    if (!isEditable) return;
    const obj = emptyShape(shape);
    patchCurrent((s) => ({ ...s, objects: [...s.objects, obj] }));
    setSelectedObjectId(obj.id);
  }, [isEditable, patchCurrent]);

  const addImage = useCallback((url: string) => {
    if (!isEditable) return;
    const obj = emptyImage(url);
    patchCurrent((s) => ({ ...s, objects: [...s.objects, obj] }));
    setSelectedObjectId(obj.id);
  }, [isEditable, patchCurrent]);

  const addVideo = useCallback((url: string) => {
    if (!isEditable) return;
    const obj = emptyVideo(url);
    patchCurrent((s) => ({ ...s, objects: [...s.objects, obj] }));
    setSelectedObjectId(obj.id);
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
    setSelectedObjectId((cur) => (cur === id ? null : cur));
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
    setSelectedObjectId(newId);
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
    setSelectedObjectId(null);
  }, [isEditable, slides.length]);

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
    setSelectedObjectId(null);
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
    setSelectedObjectId(null);
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
    setSelectedObjectId(null);
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
  }, [isEditable]);

  const setBg = useCallback((patch: { bgColor?: string; bgImageUrl?: string }) => {
    patchCurrent((s) => ({ ...s, ...patch }));
  }, [patchCurrent]);

  const updateSlideDirect = useCallback((patch: Partial<EditableSlide>) => {
    patchCurrent((s) => ({ ...s, ...patch }));
  }, [patchCurrent]);

  const currentPayload = currentSlide ? slidePayloadFromEditable(currentSlide) : null;
  const currentLyrics = currentSlide ? extractLyricsFromEditable(currentSlide) : "";

  return {
    slides,
    currentIndex,
    currentSlide,
    selectedObjectId,
    isEditable,
    setCurrentIndex: (i) => { setCurrentIndex(i); setSelectedObjectId(null); },
    setSelectedObjectId,
    addTextObject,
    addShape,
    addImage,
    addVideo,
    reorderObject,
    updateObject,
    removeObject,
    duplicateObject,
    moveObject,
    addSlide,
    duplicateSlide,
    deleteSlide,
    restoreSlide,
    reorderSlide,
    setBg,
    updateSlideDirect,
    hasDirtyChanges: dirty,
    resetDirty: () => setDirty(false),
    currentPayload,
    currentLyrics,
  };
}

// Convenience: type re-exports so consumers only import from the hook module.
export type { EditableSlide, SlideObject, TextObject, ShapeObject, ImageObject };
