"use client";
/**
 * StageCanvas — drag-and-drop editing for a stage layout.
 *
 * USER DIRECTION 2026-09-22: creating a layout should feel like the slide
 * editor — you see the screen and move things on it — but "much, much, much
 * simpler and less detailed". So this is deliberately THREE gestures and
 * nothing else:
 *
 *   1. tap a box to select it
 *   2. drag it to move it
 *   3. drag the corner handle to resize it
 *
 * No rotation, no z-order handles, no snapping menus, no alignment toolbar, no
 * multi-select. An operator setting up a confidence monitor ten minutes before
 * a service needs to place three things and leave. Everything else about a
 * widget lives in the settings list below the canvas, where it can be read.
 *
 * WHY POINTER EVENTS, not mouse/touch: the operator machine is as likely to be
 * a touchscreen Windows laptop as a mouse-driven Mac, and pointer events cover
 * both with one code path, including pen. `setPointerCapture` means a fast drag
 * that leaves the canvas still tracks instead of stranding the box mid-move.
 *
 * Positions are normalised 0..1 (see StageRect) so a layout designed on this
 * small panel renders identically on a 720p monitor and a 4K LED wall.
 */
import { useRef, useState } from "react";
import { clampRect, STAGE_WIDGET_LABELS, type StageLayout, type StageWidget } from "@/engine/stage";

/** Below this the grab handle is bigger than the box it belongs to. */
const MIN_SIZE = 0.06;

type DragKind = "move" | "resize";

export function StageCanvas({
  layout, selectedId, onSelect, onChange, preview,
}: {
  layout: StageLayout;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Called continuously during a drag — the caller keeps it in local draft
   *  state and only persists on Save, so a drag never writes to the DB. */
  onChange: (id: string, rect: StageWidget["rect"]) => void;
  /** What each widget shows on the canvas — the same sample text the
   *  thumbnails use, so the editor and the list look like one thing. */
  preview: (w: StageWidget) => string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    kind: DragKind; id: string;
    startX: number; startY: number;
    orig: StageWidget["rect"];
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Pointer position as a 0..1 fraction of the canvas. */
  const frac = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const begin = (e: React.PointerEvent, w: StageWidget, kind: DragKind) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = frac(e);
    drag.current = { kind, id: w.id, startX: p.x, startY: p.y, orig: { ...w.rect } };
    setDragging(true);
    onSelect(w.id);
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = frac(e);
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    // clampRect keeps the box on-canvas, so a widget can never be dragged
    // somewhere the operator cannot get it back from.
    onChange(d.id, clampRect(
      d.kind === "move"
        ? { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }
        : {
            ...d.orig,
            w: Math.max(MIN_SIZE, d.orig.w + dx),
            h: Math.max(MIN_SIZE, d.orig.h + dy),
          },
    ));
  };

  const end = () => { drag.current = null; setDragging(false); };

  return (
    <div
      ref={boxRef}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className="relative w-full overflow-hidden rounded border border-[var(--color-border)] select-none"
      style={{ background: layout.background, aspectRatio: "16 / 9", touchAction: "none" }}
    >
      {layout.widgets.map((w) => {
        const sel = w.id === selectedId;
        return (
          <div
            key={w.id}
            onPointerDown={(e) => begin(e, w, "move")}
            role="button"
            tabIndex={0}
            aria-label={`${STAGE_WIDGET_LABELS[w.kind]} — drag to move`}
            onKeyDown={(e) => {
              // Keyboard nudge, so the canvas is not mouse-only. 1% a press,
              // 10% with Shift.
              const step = e.shiftKey ? 0.1 : 0.01;
              const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
              if (!d) return;
              e.preventDefault();
              onChange(w.id, clampRect({ ...w.rect, x: w.rect.x + d[0], y: w.rect.y + d[1] }));
            }}
            className={`absolute flex items-center overflow-hidden rounded-[2px] ${
              sel ? "outline outline-2 outline-[var(--color-brand)]" : "outline outline-1 outline-white/15"
            } ${dragging && sel ? "cursor-grabbing" : "cursor-grab"}`}
            style={{
              left: `${w.rect.x * 100}%`, top: `${w.rect.y * 100}%`,
              width: `${w.rect.w * 100}%`, height: `${w.rect.h * 100}%`,
              color: w.color ?? "#ffffff",
              fontSize: `${Math.max(5, w.rect.h * 58)}px`,
              justifyContent: w.align === "left" ? "flex-start" : w.align === "right" ? "flex-end" : "center",
            }}
          >
            <span className="font-mono truncate leading-none px-1 pointer-events-none">{preview(w)}</span>
            {sel && (
              // One handle, bottom-right, sized for a finger.
              <span
                onPointerDown={(e) => begin(e, w, "resize")}
                aria-label="Resize"
                className="absolute -right-0.5 -bottom-0.5 w-4 h-4 rounded-sm bg-[var(--color-brand)] cursor-nwse-resize"
              />
            )}
          </div>
        );
      })}
      {layout.widgets.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/45 px-4 text-center">
          Nothing on this screen yet — add the words, a timer or a clock below.
        </div>
      )}
    </div>
  );
}
