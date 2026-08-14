"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CANVAS_W, CANVAS_H, type EditableSlide, type SlideObject } from "@/lib/slide-objects";
import { cn } from "@/lib/utils";

type HandleKey = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export function SlideCanvas({
  slide,
  selectedIds,
  onSelectObject,
  onSetSelection,
  onUpdateObject,
  onUpdateObjects,
  onRemoveObjects,
  readOnly,
}: {
  slide: EditableSlide | null;
  // Full selection set. Length 1 = classic single-select (with resize handles);
  // length >1 = a group (move/delete/nudge together, no per-object handles).
  selectedIds: string[];
  // additive = shift/⌘-click → toggle this id in/out of the selection.
  onSelectObject: (id: string | null, additive?: boolean) => void;
  // Replace the whole selection (marquee result).
  onSetSelection: (ids: string[]) => void;
  onUpdateObject: (id: string, patch: Partial<SlideObject>) => void;
  onUpdateObjects: (patches: { id: string; patch: Partial<SlideObject> }[]) => void;
  onRemoveObjects: (ids: string[]) => void;
  readOnly?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Snap guides — teal alignment lines (in canvas units) shown while a moving
  // object's edge/centre snaps to the canvas or another object's edge/centre.
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  // Marquee rubber-band (in canvas units) while dragging on empty canvas.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Fresh refs so the drag/marquee mousemove closures read the latest values.
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const selRef = useRef(selectedIds);
  selRef.current = selectedIds;
  // Which text object (if any) is being edited inline (double-click to enter).
  const [editingId, setEditingId] = useState<string | null>(null);
  // Leaving the slide cancels any in-progress inline edit.
  useEffect(() => { setEditingId(null); }, [slide?.id]);
  // If selection moves off the object being edited (e.g. clicking another
  // object, whose beginDrag preventDefault()s the mousedown and so blocks the
  // textarea's blur), exit edit mode explicitly — no dual selected/editing state.
  useEffect(() => {
    if (editingId && !selectedIds.includes(editingId)) setEditingId(null);
  }, [selectedIds, editingId]);

  // Keyboard: delete / escape / nudge. Don't hijack when a text input has focus.
  useEffect(() => {
    if (readOnly) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const ids = selRef.current;
      if (ids.length === 0) {
        if (e.key === "Escape") onSelectObject(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onRemoveObjects(ids);
      } else if (e.key === "Escape") {
        onSelectObject(null);
      } else if (e.key.startsWith("Arrow")) {
        // Nudge every selected object. Shift = 1px fine, otherwise 10px.
        const objs = (slideRef.current?.objects ?? []).filter((o) => ids.includes(o.id));
        if (objs.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 10;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        onUpdateObjects(objs.map((o) => ({ id: o.id, patch: { x: o.x + dx, y: o.y + dy } as Partial<SlideObject> })));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRemoveObjects, onSelectObject, onUpdateObjects, readOnly]);

  const getCanvasRect = useCallback(() => {
    const el = wrapRef.current?.querySelector<HTMLDivElement>("[data-canvas-inner]");
    return el?.getBoundingClientRect() ?? null;
  }, []);

  const beginDrag = useCallback((
    e: React.MouseEvent, obj: SlideObject, mode: "move" | HandleKey,
  ) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = getCanvasRect();
    if (!rect) return;
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { x: obj.x, y: obj.y, w: obj.w, h: obj.h };

    // Group move: if the grabbed object is part of a multi-selection, move ALL
    // selected objects by the same delta (no snapping — snapping a whole group
    // to a single edge is more surprising than helpful).
    const groupIds = selRef.current;
    const isGroup = mode === "move" && groupIds.length > 1 && groupIds.includes(obj.id);
    const groupStart = isGroup
      ? (slideRef.current?.objects ?? [])
          .filter((o) => groupIds.includes(o.id))
          .map((o) => ({ id: o.id, x: o.x, y: o.y }))
      : null;

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) * scaleX;
      const dy = (ev.clientY - startY) * scaleY;
      if (groupStart) {
        onUpdateObjects(groupStart.map((g) => ({ id: g.id, patch: { x: g.x + dx, y: g.y + dy } as Partial<SlideObject> })));
        return;
      }
      let nx = start.x, ny = start.y, nw = start.w, nh = start.h;
      if (mode === "move") {
        nx = start.x + dx; ny = start.y + dy;
        // Snap the moving object's left/centre/right (and top/mid/bottom) to the
        // canvas edges/centre OR any other object's edges/centre, within a
        // threshold — and remember the snapped line to draw a guide.
        const T = 20; // canvas units
        const others = (slideRef.current?.objects ?? []).filter((o) => o.id !== obj.id);
        const xTargets = [0, CANVAS_W / 2, CANVAS_W, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
        const yTargets = [0, CANVAS_H / 2, CANVAS_H, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
        let gx: number | null = null, gy: number | null = null;
        outerX: for (const t of xTargets) {
          for (const a of [nx, nx + nw / 2, nx + nw]) {
            if (Math.abs(a - t) < T) { nx += t - a; gx = t; break outerX; }
          }
        }
        outerY: for (const t of yTargets) {
          for (const a of [ny, ny + nh / 2, ny + nh]) {
            if (Math.abs(a - t) < T) { ny += t - a; gy = t; break outerY; }
          }
        }
        setGuides({ x: gx, y: gy });
      } else {
        if (mode.includes("e")) nw = Math.max(20, start.w + dx);
        if (mode.includes("s")) nh = Math.max(20, start.h + dy);
        if (mode.includes("w")) { nw = Math.max(20, start.w - dx); nx = start.x + (start.w - nw); }
        if (mode.includes("n")) { nh = Math.max(20, start.h - dy); ny = start.y + (start.h - nh); }
      }
      onUpdateObject(obj.id, { x: nx, y: ny, w: nw, h: nh } as Partial<SlideObject>);
    }
    function onUp() {
      setGuides({ x: null, y: null });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [getCanvasRect, onUpdateObject, onUpdateObjects, readOnly]);

  // Rubber-band marquee: begins on empty-canvas mousedown. On release, selects
  // every object that intersects the box. A tiny box (a plain click) clears.
  const beginMarquee = useCallback((e: React.MouseEvent) => {
    if (readOnly) return;
    const rect = getCanvasRect();
    if (!rect) return;
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const ox = (e.clientX - rect.left) * scaleX;
    const oy = (e.clientY - rect.top) * scaleY;
    let moved = false;

    function onMove(ev: MouseEvent) {
      const cx = (ev.clientX - rect!.left) * scaleX;
      const cy = (ev.clientY - rect!.top) * scaleY;
      const x = Math.min(ox, cx), y = Math.min(oy, cy);
      const w = Math.abs(cx - ox), h = Math.abs(cy - oy);
      if (w > 6 || h > 6) moved = true;
      setMarquee({ x, y, w, h });
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setMarquee(null);
      if (!moved) { onSelectObject(null); return; } // plain click → clear
      const cx = (ev.clientX - rect!.left) * scaleX;
      const cy = (ev.clientY - rect!.top) * scaleY;
      const bx = Math.min(ox, cx), by = Math.min(oy, cy);
      const bw = Math.abs(cx - ox), bh = Math.abs(cy - oy);
      const hits = (slideRef.current?.objects ?? [])
        .filter((o) => o.x < bx + bw && o.x + o.w > bx && o.y < by + bh && o.y + o.h > by)
        .map((o) => o.id);
      onSetSelection(hits);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [getCanvasRect, onSelectObject, onSetSelection, readOnly]);

  if (!slide) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-500 text-[12px]">
        No slide.
      </div>
    );
  }

  const selSet = new Set(selectedIds);

  return (
    <div ref={wrapRef} className="w-full h-full flex items-center justify-center p-4 min-h-0 min-w-0">
      <div className="relative w-full max-w-full max-h-full" style={{ aspectRatio: "16 / 9" }}>
        <div
          data-canvas-inner
          className="absolute inset-0 overflow-hidden rounded-md border select-none"
          style={{
            background: slide.bgColor || "#0b0b0b",
            borderColor: "#2a3232",
            backgroundImage: slide.bgImageUrl ? `url("${slide.bgImageUrl}")` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            // Establish a query container so text objects' `cqh` font sizing
            // resolves against the CANVAS (not the viewport) — matching the
            // projector's SlideObjectsLayer exactly, so the editor is true WYSIWYG.
            containerType: "size",
          }}
          onMouseDown={(e) => {
            if (readOnly) return;
            if (e.target === e.currentTarget) beginMarquee(e);
          }}
        >
          {/* Alignment snap guides (positioned at the snapped canvas coordinate) */}
          {guides.x !== null && <div className="pointer-events-none absolute inset-y-0 w-px bg-teal-400/80 z-50" style={{ left: `${(guides.x / CANVAS_W) * 100}%` }} />}
          {guides.y !== null && <div className="pointer-events-none absolute inset-x-0 h-px bg-teal-400/80 z-50" style={{ top: `${(guides.y / CANVAS_H) * 100}%` }} />}
          {/* Marquee rubber-band */}
          {marquee && (
            <div className="pointer-events-none absolute z-50 border border-teal-400 bg-teal-400/10"
              style={{
                left: `${(marquee.x / CANVAS_W) * 100}%`, top: `${(marquee.y / CANVAS_H) * 100}%`,
                width: `${(marquee.w / CANVAS_W) * 100}%`, height: `${(marquee.h / CANVAS_H) * 100}%`,
              }} />
          )}
          {slide.objects.map((o) => (
            <ObjectView
              key={o.id}
              obj={o}
              selected={!readOnly && selSet.has(o.id)}
              soleSelected={!readOnly && selSet.has(o.id) && selectedIds.length === 1}
              onSelect={(additive) => !readOnly && onSelectObject(o.id, additive)}
              selectedNow={selSet.has(o.id)}
              beginDrag={beginDrag}
              readOnly={!!readOnly}
              editing={editingId === o.id}
              onStartEdit={() => setEditingId(o.id)}
              onEndEdit={() => setEditingId(null)}
              onText={(t) => onUpdateObject(o.id, { text: t } as Partial<SlideObject>)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ObjectView({
  obj, selected, soleSelected, selectedNow, onSelect, beginDrag, readOnly,
  editing, onStartEdit, onEndEdit, onText,
}: {
  obj: SlideObject;
  selected: boolean;
  soleSelected: boolean;
  selectedNow: boolean;
  onSelect: (additive: boolean) => void;
  beginDrag: (e: React.MouseEvent, obj: SlideObject, mode: "move" | HandleKey) => void;
  readOnly: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onText: (t: string) => void;
}) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: `${(obj.x / CANVAS_W) * 100}%`,
    top: `${(obj.y / CANVAS_H) * 100}%`,
    width: `${(obj.w / CANVAS_W) * 100}%`,
    height: `${(obj.h / CANVAS_H) * 100}%`,
    rotate: obj.rotation ? `${obj.rotation}deg` : undefined,
    cursor: readOnly ? "default" : editing ? "text" : "grab",
  };

  let inner: React.ReactNode = null;
  if (obj.kind === "text") {
    // Shared font styling so the inline-edit textarea matches the rendered text
    // exactly (true WYSIWYG while typing).
    const textStyle: React.CSSProperties = {
      fontFamily: obj.fontFamily || "Inter, system-ui, sans-serif",
      // fontSize is expressed in canvas px (1920×1080 virtual space) so we
      // scale via a container-derived em unit. Approximation with cqw:
      fontSize: `${((obj.fontSize ?? 96) / CANVAS_H) * 100}cqh`,
      fontWeight: obj.fontWeight ?? 600,
      color: obj.color ?? "#ffffff",
      fontStyle: obj.italic ? "italic" : undefined,
      textDecoration: obj.underline ? "underline" : undefined,
      textAlign: obj.align ?? "center",
      padding: "2%",
      containerType: "size",
      // Match the projector's text shadow so the editor is true WYSIWYG.
      textShadow: "0 2px 8px rgba(0,0,0,0.45)",
      opacity: obj.opacity ?? 1,
    };
    inner = editing ? (
      <textarea
        autoFocus
        value={obj.text}
        onChange={(e) => onText(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={onEndEdit}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") { e.preventDefault(); onEndEdit(); }
          else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEndEdit(); }
        }}
        className="w-full h-full resize-none border-0 bg-transparent outline-none overflow-hidden"
        style={{ ...textStyle, display: "block", caretColor: obj.color ?? "#ffffff" }}
      />
    ) : (
      <div
        className="w-full h-full flex whitespace-pre-wrap overflow-hidden"
        style={{
          ...textStyle,
          justifyContent: obj.align === "left" ? "flex-start" : obj.align === "right" ? "flex-end" : "center",
          alignItems: "center",
        }}
      >
        {obj.text}
      </div>
    );
  } else if (obj.kind === "shape") {
    inner = (
      <div
        className="w-full h-full"
        style={{
          background: obj.fill2
            ? `linear-gradient(${obj.fillAngle ?? 135}deg, ${obj.fill ?? "#14b8a6"}, ${obj.fill2})`
            : (obj.fill ?? "#14b8a6"),
          border: obj.strokeWidth ? `${((obj.strokeWidth / CANVAS_W) * 100)}cqw solid ${obj.stroke ?? "#0f766e"}` : undefined,
          borderRadius: obj.shape === "ellipse" ? "50%" : `${(((obj.radius ?? 0) / CANVAS_W) * 100)}cqw`,
          opacity: obj.opacity ?? 1,
        }}
      />
    );
  } else if (obj.kind === "image") {
    inner = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={obj.url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", display: "block", opacity: obj.opacity ?? 1 }}
        draggable={false}
      />
    );
  } else if (obj.kind === "video") {
    inner = (
      <video
        src={obj.url}
        autoPlay
        loop={obj.loop ?? true}
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", display: "block", opacity: obj.opacity ?? 1 }}
      />
    );
  }

  return (
    <div
      style={style}
      onMouseDown={(e) => {
        if (readOnly || editing) return;
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (additive) { e.stopPropagation(); onSelect(true); return; }
        // Plain click: if this object isn't already part of the selection,
        // select it alone; if it IS (part of a group), keep the group so the
        // drag moves the whole group. Then begin the move.
        if (!selectedNow) onSelect(false);
        beginDrag(e, obj, "move");
      }}
      onDoubleClick={(e) => {
        // Double-click a text object to edit its text right on the canvas.
        if (readOnly || obj.kind !== "text") return;
        e.stopPropagation();
        onSelect(false);
        onStartEdit();
      }}
    >
      {inner}
      {selected && !readOnly && !editing && (
        <>
          <div className={cn("absolute inset-0 pointer-events-none ring-2", soleSelected ? "ring-teal-400" : "ring-teal-400/70")} />
          {/* Resize handles only for a sole selection — a group moves as a unit. */}
          {soleSelected && (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as HandleKey[]).map((k) => (
            <Handle key={k} k={k} onBegin={(e) => beginDrag(e, obj, k)} />
          ))}
        </>
      )}
    </div>
  );
}

function Handle({ k, onBegin }: { k: HandleKey; onBegin: (e: React.MouseEvent) => void }) {
  const pos: React.CSSProperties = { position: "absolute", width: 10, height: 10, background: "#14b8a6", border: "1px solid #fff", borderRadius: 2 };
  const map: Record<HandleKey, React.CSSProperties> = {
    nw: { left: -5, top: -5, cursor: "nwse-resize" },
    n:  { left: "50%", top: -5, transform: "translateX(-50%)", cursor: "ns-resize" },
    ne: { right: -5, top: -5, cursor: "nesw-resize" },
    e:  { right: -5, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
    se: { right: -5, bottom: -5, cursor: "nwse-resize" },
    s:  { left: "50%", bottom: -5, transform: "translateX(-50%)", cursor: "ns-resize" },
    sw: { left: -5, bottom: -5, cursor: "nesw-resize" },
    w:  { left: -5, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
  };
  return (
    <div
      style={{ ...pos, ...map[k] }}
      onMouseDown={(e) => { e.stopPropagation(); onBegin(e); }}
    />
  );
}

// Thumbnail for the slide list. Non-interactive.
export function SlideThumb({ slide, className }: { slide: EditableSlide; className?: string }) {
  return (
    <div className={cn("relative w-full overflow-hidden rounded-sm", className)}
      style={{ background: slide.bgColor || "#0b0b0b", aspectRatio: "16 / 9" }}>
      {slide.objects.map((o) => {
        const s: React.CSSProperties = {
          position: "absolute",
          left: `${(o.x / CANVAS_W) * 100}%`,
          top: `${(o.y / CANVAS_H) * 100}%`,
          width: `${(o.w / CANVAS_W) * 100}%`,
          height: `${(o.h / CANVAS_H) * 100}%`,
        };
        if (o.kind === "text") {
          return (
            <div key={o.id} style={{ ...s, color: o.color ?? "#fff", fontSize: 6, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", textAlign: "center", lineHeight: 1.1, padding: 1 }}>
              <span className="line-clamp-2">{o.text}</span>
            </div>
          );
        }
        if (o.kind === "shape") {
          return <div key={o.id} style={{ ...s, background: o.fill, borderRadius: o.shape === "ellipse" ? "50%" : (o.radius ?? 0) / 4 }} />;
        }
        return <div key={o.id} style={{ ...s, background: "#333" }} />;
      })}
    </div>
  );
}
