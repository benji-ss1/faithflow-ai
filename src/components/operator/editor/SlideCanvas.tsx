"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CANVAS_W, CANVAS_H, type EditableSlide, type SlideObject } from "@/lib/slide-objects";
import { cn } from "@/lib/utils";

type HandleKey = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export function SlideCanvas({
  slide,
  selectedObjectId,
  onSelectObject,
  onUpdateObject,
  onRemoveObject,
  readOnly,
}: {
  slide: EditableSlide | null;
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  onUpdateObject: (id: string, patch: Partial<SlideObject>) => void;
  onRemoveObject: (id: string) => void;
  readOnly?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Snap guides — teal alignment lines (in canvas units) shown while a moving
  // object's edge/centre snaps to the canvas or another object's edge/centre.
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  // Fresh slide ref so the drag's mousemove closure reads the latest objects.
  const slideRef = useRef(slide);
  slideRef.current = slide;

  // Keyboard: delete / escape. Don't hijack when a text input has focus.
  useEffect(() => {
    if (readOnly) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!selectedObjectId) {
        if (e.key === "Escape") onSelectObject(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onRemoveObject(selectedObjectId);
      } else if (e.key === "Escape") {
        onSelectObject(null);
      } else if (e.key.startsWith("Arrow")) {
        // Nudge the selected object. Shift = 1px fine, otherwise 10px (canvas units).
        const obj = slide?.objects.find((o) => o.id === selectedObjectId);
        if (!obj) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 10;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        onUpdateObject(selectedObjectId, { x: obj.x + dx, y: obj.y + dy } as Partial<SlideObject>);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedObjectId, onRemoveObject, onSelectObject, onUpdateObject, slide, readOnly]);

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

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) * scaleX;
      const dy = (ev.clientY - startY) * scaleY;
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
  }, [getCanvasRect, onUpdateObject, readOnly]);

  if (!slide) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-500 text-[12px]">
        No slide.
      </div>
    );
  }

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
            if (e.target === e.currentTarget) onSelectObject(null);
          }}
        >
          {/* Alignment snap guides (positioned at the snapped canvas coordinate) */}
          {guides.x !== null && <div className="pointer-events-none absolute inset-y-0 w-px bg-teal-400/80 z-50" style={{ left: `${(guides.x / CANVAS_W) * 100}%` }} />}
          {guides.y !== null && <div className="pointer-events-none absolute inset-x-0 h-px bg-teal-400/80 z-50" style={{ top: `${(guides.y / CANVAS_H) * 100}%` }} />}
          {slide.objects.map((o) => (
            <ObjectView
              key={o.id}
              obj={o}
              selected={!readOnly && selectedObjectId === o.id}
              onSelect={() => !readOnly && onSelectObject(o.id)}
              beginDrag={beginDrag}
              readOnly={!!readOnly}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ObjectView({
  obj, selected, onSelect, beginDrag, readOnly,
}: {
  obj: SlideObject;
  selected: boolean;
  onSelect: () => void;
  beginDrag: (e: React.MouseEvent, obj: SlideObject, mode: "move" | HandleKey) => void;
  readOnly: boolean;
}) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: `${(obj.x / CANVAS_W) * 100}%`,
    top: `${(obj.y / CANVAS_H) * 100}%`,
    width: `${(obj.w / CANVAS_W) * 100}%`,
    height: `${(obj.h / CANVAS_H) * 100}%`,
    rotate: obj.rotation ? `${obj.rotation}deg` : undefined,
    cursor: readOnly ? "default" : "grab",
  };

  let inner: React.ReactNode = null;
  if (obj.kind === "text") {
    inner = (
      <div
        className="w-full h-full flex whitespace-pre-wrap overflow-hidden"
        style={{
          fontFamily: obj.fontFamily || "Inter, system-ui, sans-serif",
          // fontSize is expressed in canvas px (1920×1080 virtual space) so we
          // scale via a container-derived em unit. Approximation with cqw:
          fontSize: `${((obj.fontSize ?? 96) / CANVAS_H) * 100}cqh`,
          fontWeight: obj.fontWeight ?? 600,
          color: obj.color ?? "#ffffff",
          fontStyle: obj.italic ? "italic" : undefined,
          textDecoration: obj.underline ? "underline" : undefined,
          justifyContent: obj.align === "left" ? "flex-start" : obj.align === "right" ? "flex-end" : "center",
          alignItems: "center",
          textAlign: obj.align ?? "center",
          padding: "2%",
          containerType: "size",
          // Match the projector's text shadow so the editor is true WYSIWYG.
          textShadow: "0 2px 8px rgba(0,0,0,0.45)",
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
        style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", display: "block" }}
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
        style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", display: "block" }}
      />
    );
  }

  return (
    <div
      style={style}
      onMouseDown={(e) => {
        if (readOnly) return;
        onSelect();
        beginDrag(e, obj, "move");
      }}
    >
      {inner}
      {selected && !readOnly && (
        <>
          <div className="absolute inset-0 pointer-events-none ring-2 ring-teal-400" />
          {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as HandleKey[]).map((k) => (
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
