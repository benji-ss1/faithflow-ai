"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CANVAS_W, CANVAS_H, type EditableSlide, type SlideObject } from "@/lib/slide-objects";
import { cn } from "@/lib/utils";
import { flipTransform, constrainAspect, type Rect } from "@/lib/editor-geometry";
import { DEFAULT_VIEW_PREFS, RULER_SIZE, RULER_PAD, rulerTicks, markerPct, rulersVisible, type EditorViewPrefs } from "@/lib/editor-view-prefs";
import { useProjectionZoneStore } from "@/lib/projection-zone-store";
import { normalizeZone, isFullZone, resolveZoneRects, FULL_ZONE } from "@/lib/projection-zone";

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
  themeBgStyle,
  backgroundNode,
  objectBadge,
  zoom = null,
  lockAspect = false,
  view = DEFAULT_VIEW_PREFS,
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
  // Editor view zoom. `null`/absent = "Fit" — the canvas sizes itself to the
  // available space exactly as it always has (the pre-existing, default path).
  // A number scales that fitted size and the canvas becomes scrollable.
  zoom?: number | null;
  // Size lock: constrain drag-resize to the object's aspect ratio (PP7's chain
  // link beside W/H). Absent/false = the original unconstrained resize.
  lockAspect?: boolean;
  // Editor view options (rulers / grid / transparency grid / snap guides).
  // Absent = DEFAULT_VIEW_PREFS, which is exactly the pre-existing look: no
  // rulers, no grid, no checker, snap guides ON.
  view?: EditorViewPrefs;
  // Optional theme-background CSS applied ONLY when the slide has no explicit
  // bgColor/bgImageUrl — lets the media "logo over theme" mode preview the live
  // theme in the editor (WYSIWYG). Callers that don't pass it are unaffected.
  themeBgStyle?: React.CSSProperties;
  // Optional live React background rendered BEHIND the objects, inside the
  // clipped canvas at preview scale — used by the media "logo on background"
  // editor to preview the church's REAL active theme background (animated
  // gradient / theme video / active Background Template shader/image/video) so
  // the editor is 1:1 with the projector, not just a flat CSS approximation.
  // When provided, the canvas container background is forced transparent so the
  // node shows through. Takes precedence over themeBgStyle.
  backgroundNode?: React.ReactNode;
  // Optional small label drawn at an object's top-left (theme editor: text-box
  // role). Callers that don't pass it render exactly as before.
  objectBadge?: (o: SlideObject) => string | null;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Width the canvas WOULD have at "Fit" (the 16:9 box that fits the padded
  // container). Only used when zoomed; at Fit the original CSS still drives.
  // Viewport height drives the ruler auto-hide (see RULER_MIN_VIEWPORT_H).
  const [viewportH, setViewportH] = useState(1080);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => setViewportH(window.innerHeight);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const [fitW, setFitW] = useState(0);
  // Padding around the canvas box. It already existed (16px); rulers only widen
  // it to RULER_PAD so the gutters have somewhere to sit — the canvas box itself
  // is never made smaller to make room for them.
  const padRef = useRef(16);
  // Rulers auto-hide on a short viewport (1366x768 @150% = 512 CSS px tall)
  // rather than taking another slice of an already-tight canvas.
  const showRulers = rulersVisible(view, viewportH);
  padRef.current = showRulers ? RULER_PAD : 16;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const pad = padRef.current * 2;
      const cw = el.clientWidth - pad;
      const ch = el.clientHeight - pad;
      if (cw > 0 && ch > 0) setFitW(Math.min(cw, ch * (CANVAS_W / CANVAS_H)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showRulers]);
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
  const lockRef = useRef(lockAspect);
  lockRef.current = lockAspect;
  const snapRef = useRef(view.snapGuides);
  snapRef.current = view.snapGuides;
  // Pointer position in CANVAS UNITS, for the ruler markers. Only tracked while
  // the rulers are actually on screen, so it costs nothing when they're off.
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
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
      const objsNow = slideRef.current?.objects ?? [];
      const lockedIds = new Set(objsNow.filter((o) => o.locked).map((o) => o.id));
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const del = ids.filter((id) => !lockedIds.has(id)); // never delete locked
        if (del.length) onRemoveObjects(del);
      } else if (e.key === "Escape") {
        onSelectObject(null);
      } else if (e.key.startsWith("Arrow")) {
        // Nudge every selected UNLOCKED object. Shift = 1px fine, otherwise 10px.
        const objs = objsNow.filter((o) => ids.includes(o.id) && !o.locked);
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
        const T = snapRef.current ? 20 : 0; // canvas units; 0 = guides off
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
        // Size lock: re-derive the rect from the START ratio (not the live one,
        // which would drift over a long drag). Pure helper, unit-tested.
        if (lockRef.current) {
          const c: Rect = constrainAspect(start, { x: nx, y: ny, w: nw, h: nh }, mode);
          nx = c.x; ny = c.y; nw = c.w; nh = c.h;
        }
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
        .filter((o) => !o.locked && !o.hidden && o.x < bx + bw && o.x + o.w > bx && o.y < by + bh && o.y + o.h > by)
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

  // Live Projection-Zone preview. Subscribing to the store re-renders this
  // canvas the instant the Size / Font / Margins / Center controls change, so
  // the operator SEES where content lands on the projector as they drag —
  // exactly the rect the live output + projector use (resolveZoneRects). Shown
  // only when the zone isn't full-bleed (nothing to show otherwise).
  const zoneStore = useProjectionZoneStore();
  const zone = zoneStore.activeProfile ? normalizeZone(zoneStore.activeProfile) : FULL_ZONE;
  const showZone = !isFullZone(zone);
  const zoneRects = resolveZoneRects(zone, CANVAS_W, CANVAS_H);
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  return (
    <div
      ref={wrapRef}
      style={{ padding: showRulers ? RULER_PAD : 16 }}
      className={cn(
        "w-full h-full flex min-h-0 min-w-0",
        // Fit (the default, unchanged): centre and let the canvas shrink to the
        // box. Zoomed: scroll, and only centre while the canvas is smaller than
        // the viewport (`justify-center` would otherwise clip the left edge).
        zoom === null ? "items-center justify-center" : "overflow-auto items-start justify-start",
      )}
    >
      <div
        className={cn("relative", zoom === null ? "w-full max-w-full max-h-full" : "shrink-0 mx-auto my-auto")}
        style={zoom === null
          ? { aspectRatio: "16 / 9" }
          // Zoom is a multiple of the FITTED size (measured below), so 100% is
          // literally what "Fit" shows and the readout never lies.
          : { aspectRatio: "16 / 9", width: fitW > 0 ? fitW * zoom : undefined }}
      >
        {showRulers && <CanvasRulers pointer={pointer} />}
        <div
          data-canvas-inner
          className="absolute inset-0 overflow-hidden rounded-md border select-none"
          style={{
            // Precedence mirrors the projector (SlideRenderer designBg): explicit
            // per-slide bgColor wins; else a per-slide image; else a caller-supplied
            // theme bg; else the neutral editor backdrop. Each branch is internally
            // consistent (never mixes the `background` shorthand with `background*`
            // longhands — that combination warns + can bug out on rerender).
            // A live backgroundNode paints its own bg → keep the container
            // transparent so it shows through (and still let an explicit
            // per-slide bgColor/image win, matching the projector precedence).
            ...(slide.bgColor
              ? { background: slide.bgColor }
              : slide.bgImageUrl
                ? { backgroundImage: `url("${slide.bgImageUrl}")`, backgroundSize: "cover", backgroundPosition: "center" }
                : backgroundNode
                  ? { background: "transparent" }
                  : themeBgStyle
                    ? themeBgStyle
                    : { background: "#0b0b0b" }),
            borderColor: "#2a3232",
            // Establish a query container so text objects' `cqh` font sizing
            // resolves against the CANVAS (not the viewport) — matching the
            // projector's SlideObjectsLayer exactly, so the editor is true WYSIWYG.
            containerType: "size",
          }}
          onMouseDown={(e) => {
            if (readOnly) return;
            if (e.target === e.currentTarget) beginMarquee(e);
          }}
          onMouseMove={showRulers ? (e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            setPointer({
              x: ((e.clientX - r.left) / r.width) * CANVAS_W,
              y: ((e.clientY - r.top) / r.height) * CANVAS_H,
            });
          } : undefined}
          onMouseLeave={showRulers ? () => setPointer(null) : undefined}
        >
          {/* Grid — sixteenths of the canvas, in PERCENT so it stays true at
              every zoom and window size. Sits under every object. */}
          {view.grid && (
            <div className="pointer-events-none absolute inset-0 z-0" aria-hidden style={{
              backgroundImage: "repeating-linear-gradient(to right,rgba(255,255,255,0.10) 0 1px,transparent 1px 6.25%),repeating-linear-gradient(to bottom,rgba(255,255,255,0.10) 0 1px,transparent 1px 6.25%)",
            }} />
          )}
          {/* Live theme/background preview layer (media "logo on background"
              editor) — clipped by the canvas, sits behind every object + guide.
              pointer-events-none so it never intercepts drags. */}
          {backgroundNode && (
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
              {backgroundNode}
            </div>
          )}
          {/* Live Projection-Zone preview — the solid box is where the whole
              slide maps on the projector; the dashed box is the text area after
              margins. Updates in real time as the operator drags Size / Margins
              / Center below, so they can SEE the zone working (the same rect the
              live output + projector use). */}
          {showZone && (
            <>
              <div
                className="pointer-events-none absolute z-40 border-2 border-[#e8501a] rounded-[2px]"
                style={{
                  left: pct(zoneRects.outer.x, CANVAS_W), top: pct(zoneRects.outer.y, CANVAS_H),
                  width: pct(zoneRects.outer.w, CANVAS_W), height: pct(zoneRects.outer.h, CANVAS_H),
                  boxShadow: "0 0 0 100vmax rgba(0,0,0,0.28)",
                }}
              >
                <span className="absolute top-0.5 left-1 text-[9px] font-mono uppercase tracking-wider text-[#ffd9bf] bg-black/60 px-1 rounded">Projection area</span>
              </div>
              <div
                className="pointer-events-none absolute z-40 border border-dashed border-[#e8501a]/50"
                style={{
                  left: pct(zoneRects.inner.x, CANVAS_W), top: pct(zoneRects.inner.y, CANVAS_H),
                  width: pct(zoneRects.inner.w, CANVAS_W), height: pct(zoneRects.inner.h, CANVAS_H),
                }}
              />
            </>
          )}
          {/* Alignment snap guides (positioned at the snapped canvas coordinate) */}
          {guides.x !== null && <div className="pointer-events-none absolute inset-y-0 w-px bg-[#e8501a]/80 z-50" style={{ left: `${(guides.x / CANVAS_W) * 100}%` }} />}
          {guides.y !== null && <div className="pointer-events-none absolute inset-x-0 h-px bg-[#e8501a]/80 z-50" style={{ top: `${(guides.y / CANVAS_H) * 100}%` }} />}
          {/* Marquee rubber-band */}
          {marquee && (
            <div className="pointer-events-none absolute z-50 border border-[#e8501a] bg-[#e8501a]/10"
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
              textScale={zone.fontScale}
            />
          ))}
          {objectBadge && slide.objects.map((o) => {
            const label = objectBadge(o);
            if (!label) return null;
            return (
              <span key={`badge_${o.id}`} aria-hidden
                className="pointer-events-none absolute z-40 rounded-sm px-1 py-px text-[9px] font-bold uppercase tracking-wide bg-[#e8501a] text-black"
                style={{ left: `${(o.x / CANVAS_W) * 100}%`, top: `${(o.y / CANVAS_H) * 100}%` }}>
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ObjectView({
  obj, selected, soleSelected, selectedNow, onSelect, beginDrag, readOnly,
  editing, onStartEdit, onEndEdit, onText, textScale = 1,
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
  // Live preview of the Projection-Zone Font multiplier (zone.fontScale). 1 =
  // no change (WYSIWYG). >1 grows text to match how the projector renders it.
  textScale?: number;
}) {
  const locked = !!obj.locked;
  const hidden = !!obj.hidden;
  const style: React.CSSProperties = {
    position: "absolute",
    left: `${(obj.x / CANVAS_W) * 100}%`,
    top: `${(obj.y / CANVAS_H) * 100}%`,
    width: `${(obj.w / CANVAS_W) * 100}%`,
    height: `${(obj.h / CANVAS_H) * 100}%`,
    rotate: obj.rotation ? `${obj.rotation}deg` : undefined,
    // Same independent `scale` the projector uses (flipTransform) so the editor
    // shows the flip exactly as it will project.
    scale: flipTransform(obj),
    cursor: readOnly || locked ? "default" : editing ? "text" : "grab",
    // Hidden objects are dimmed and click-through in the editor (manage them via
    // the Layers panel) — they never render on the projector at all.
    opacity: hidden ? 0.3 : undefined,
    pointerEvents: hidden ? "none" : undefined,
  };

  let inner: React.ReactNode = null;
  if (obj.kind === "text") {
    // Shared font styling so the inline-edit textarea matches the rendered text
    // exactly (true WYSIWYG while typing).
    const textStyle: React.CSSProperties = {
      fontFamily: obj.fontFamily || "Inter, system-ui, sans-serif",
      // fontSize is expressed in canvas px (1920×1080 virtual space) so we
      // scale via a container-derived em unit. Approximation with cqw.
      // textScale previews the Projection-Zone Font multiplier live.
      fontSize: `${((obj.fontSize ?? 96) * textScale / CANVAS_H) * 100}cqh`,
      fontWeight: obj.fontWeight ?? 600,
      color: obj.color ?? "#ffffff",
      fontStyle: obj.italic ? "italic" : undefined,
      textDecoration: obj.underline ? "underline" : undefined,
      textAlign: obj.align ?? "center",
      padding: "2%",
      containerType: "size",
      lineHeight: obj.lineHeight ?? undefined,
      letterSpacing: obj.letterSpacing ? `${(obj.letterSpacing / CANVAS_H) * 100}cqh` : undefined,
      textTransform: obj.uppercase ? "uppercase" : undefined,
      WebkitTextStroke: obj.strokeWidth ? `${(obj.strokeWidth / CANVAS_W) * 100}cqw ${obj.stroke ?? "#000000"}` : undefined,
      // Match the projector's text shadow so the editor is true WYSIWYG.
      textShadow: (obj.shadow ?? true) ? "0 2px 8px rgba(0,0,0,0.45)" : undefined,
      opacity: obj.opacity ?? 1,
    };
    const justify = obj.align === "left" ? "flex-start" : obj.align === "right" ? "flex-end" : "center";
    inner = editing ? (
      // contentEditable (not a <textarea>) so the text stays VERTICALLY CENTERED
      // while editing — identical flex layout to the rendered view below, so
      // double-clicking to edit no longer jumps the text to the top. Uncontrolled:
      // the initial text is set once via the ref (dataset guard) and read back on
      // input, so typing never resets the caret.
      <div
        ref={(el) => {
          if (el && el.dataset.pfInit !== "1") {
            el.dataset.pfInit = "1";
            el.textContent = obj.text;
            el.focus();
            try {
              const range = document.createRange();
              range.selectNodeContents(el);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
            } catch { /* selection unavailable */ }
          }
        }}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onText(e.currentTarget.textContent ?? "")}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={onEndEdit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") { e.preventDefault(); onEndEdit(); }
          else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEndEdit(); }
        }}
        className="w-full h-full flex whitespace-pre-wrap overflow-hidden outline-none cursor-text"
        style={{ ...textStyle, justifyContent: justify, alignItems: "center", caretColor: obj.color ?? "#ffffff" }}
      />
    ) : (
      <div
        className="w-full h-full flex whitespace-pre-wrap overflow-hidden"
        style={{
          ...textStyle,
          justifyContent: justify,
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
            ? `linear-gradient(${obj.fillAngle ?? 135}deg, ${obj.fill ?? "#e8501a"}, ${obj.fill2})`
            : (obj.fill ?? "#e8501a"),
          border: obj.strokeWidth ? `${((obj.strokeWidth / CANVAS_W) * 100)}cqw solid ${obj.stroke ?? "#c2410c"}` : undefined,
          borderRadius: obj.shape === "ellipse" ? "50%" : `${(((obj.radius ?? 0) / CANVAS_W) * 100)}cqw`,
          opacity: obj.opacity ?? 1,
        }}
      />
    );
  } else if (obj.kind === "image") {
    inner = (
      // Must mirror SlideObjectsLayer's image render EXACTLY (object-position pan +
      // transform zoom, clipped by overflow:hidden) so the editor canvas is 1:1
      // with the projector.
      <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
        {obj.blurFill === true && (obj.fit ?? "contain") === "contain" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={obj.url}
            alt=""
            aria-hidden="true"
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover", objectPosition: "center", display: "block",
              filter: "blur(34px) brightness(0.62) saturate(1.08)", transform: "scale(1.15)",
            }}
            draggable={false}
          />
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={obj.url}
          alt=""
          style={{
            position: "relative", zIndex: 1,
            width: "100%", height: "100%", objectFit: obj.fit ?? "contain", display: "block", opacity: obj.opacity ?? 1,
            objectPosition: `${obj.posX ?? 50}% ${obj.posY ?? 50}%`,
            // Mirror SlideObjectsLayer: a full-screen blurred BACKGROUND layer
            // (obj.blur) so the editor canvas matches the projector 1:1.
            ...(obj.blur
              ? { filter: "blur(34px) brightness(0.62) saturate(1.08)", transform: "scale(1.15)" }
              : { transform: obj.zoom && obj.zoom !== 1 ? `scale(${obj.zoom})` : undefined }),
            transformOrigin: `${obj.posX ?? 50}% ${obj.posY ?? 50}%`,
          }}
          draggable={false}
        />
      </div>
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
        // Locked: selectable (so its props/unlock show in the inspector) but
        // never draggable/resizable on the canvas — manage via the Layers panel.
        if (locked) { e.stopPropagation(); onSelect(false); return; }
        // Plain click: if this object isn't already part of the selection,
        // select it alone; if it IS (part of a group), keep the group so the
        // drag moves the whole group. Then begin the move.
        if (!selectedNow) onSelect(false);
        beginDrag(e, obj, "move");
      }}
      onDoubleClick={(e) => {
        // Double-click a text object to edit its text right on the canvas.
        if (readOnly || locked || obj.kind !== "text") return;
        e.stopPropagation();
        onSelect(false);
        onStartEdit();
      }}
    >
      {inner}
      {locked && !readOnly && (
        <div className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded bg-black/60 text-[9px] text-white" aria-hidden>🔒</div>
      )}
      {selected && !readOnly && !editing && (
        <>
          <div className={cn("absolute inset-0 z-[2] pointer-events-none ring-2", soleSelected ? "ring-[#e8501a]" : "ring-[#e8501a]/70")} />
          {/* Resize handles only for an unlocked sole selection — a group moves
              as a unit and locked objects can't be resized. */}
          {soleSelected && !locked && (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as HandleKey[]).map((k) => (
            <Handle key={k} k={k} onBegin={(e) => beginDrag(e, obj, k)} edges={{ l: obj.x <= 0, t: obj.y <= 0, r: obj.x + obj.w >= CANVAS_W, b: obj.y + obj.h >= CANVAS_H }} />
          ))}
        </>
      )}
    </div>
  );
}

function Handle({ k, onBegin, edges }: { k: HandleKey; onBegin: (e: React.MouseEvent) => void; edges?: { l: boolean; t: boolean; r: boolean; b: boolean } }) {
  // zIndex 2: an image object's <img> is `position:relative; zIndex:1` (blur-fill
  // layering), which otherwise painted OVER the handles and swallowed every
  // resize drag (turning it into a move).
  const pos: React.CSSProperties = { position: "absolute", zIndex: 2, width: 10, height: 10, background: "#e8501a", border: "1px solid #fff", borderRadius: 2 };
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
  // The canvas clips (overflow:hidden). When the object sits flush with a canvas
  // edge, pull that side's handles INWARD (offset 0 instead of -5) so the whole
  // square is visible + grabbable. Objects inside the canvas are unaffected.
  const m = { ...map[k] };
  if (edges) {
    if (edges.l && m.left === -5) m.left = 0;
    if (edges.t && m.top === -5) m.top = 0;
    if (edges.r && m.right === -5) m.right = 0;
    if (edges.b && m.bottom === -5) m.bottom = 0;
  }
  return (
    <div
      data-handle={k}
      style={{ ...pos, ...m }}
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

/**
 * Ruler gutters.
 *
 * CRITICAL to the no-regression proof: these are SIBLINGS of `[data-canvas-inner]`
 * inside the aspect wrapper, positioned into the padding that already surrounded
 * the canvas. The canvas box keeps `absolute inset-0`, so its own coordinate
 * space is byte-identical with rulers on or off — which means every overlay
 * positioned in % of it (Projection-Zone preview, snap guides, marquee, object
 * badges, and the objects themselves) lands in exactly the same place.
 * Test-locked in test/editor-rulers.test.ts.
 */
function CanvasRulers({ pointer }: { pointer: { x: number; y: number } | null }) {
  const face = { background: "#141418", borderColor: "#2a3232" };
  const tick = (major: boolean) => (major ? "60%" : "35%");
  return (
    <>
      {/* Top ruler */}
      <div aria-hidden className="pointer-events-none absolute left-0 right-0 border-b overflow-hidden"
        style={{ ...face, top: -RULER_SIZE, height: RULER_SIZE }}>
        {rulerTicks(CANVAS_W).map((t) => (
          <div key={`tx${t.pct}`} className="absolute bottom-0 w-px bg-white/30"
            style={{ left: `${t.pct}%`, height: tick(t.major) }} />
        ))}
        {rulerTicks(CANVAS_W).filter((t) => t.label).map((t) => (
          <span key={`lx${t.pct}`} className="absolute top-px -translate-x-1/2 text-[8px] font-mono text-white/45"
            style={{ left: `${t.pct}%` }}>{t.label}</span>
        ))}
        {pointer && (
          <div className="absolute inset-y-0 w-px bg-[#e8501a]" style={{ left: `${markerPct(pointer.x, CANVAS_W)}%` }} />
        )}
      </div>
      {/* Left ruler */}
      <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 border-r overflow-hidden"
        style={{ ...face, left: -RULER_SIZE, width: RULER_SIZE }}>
        {rulerTicks(CANVAS_H).map((t) => (
          <div key={`ty${t.pct}`} className="absolute right-0 h-px bg-white/30"
            style={{ top: `${t.pct}%`, width: tick(t.major) }} />
        ))}
        {rulerTicks(CANVAS_H).filter((t) => t.label).map((t) => (
          <span key={`ly${t.pct}`} className="absolute left-px -translate-y-1/2 text-[8px] font-mono text-white/45"
            style={{ top: `${t.pct}%` }}>{t.label}</span>
        ))}
        {pointer && (
          <div className="absolute inset-x-0 h-px bg-[#e8501a]" style={{ top: `${markerPct(pointer.y, CANVAS_H)}%` }} />
        )}
      </div>
    </>
  );
}
