"use client";
import type { SlideObjectWire } from "@/lib/broadcast";
import { SLIDE_CANVAS_W, SLIDE_CANVAS_H } from "@/lib/broadcast";

/**
 * Read-only projector render of a slide's positioned objects (Phase 1 of the
 * ProPresenter-style editor). Mirrors the editor's canvas math EXACTLY so the
 * projector is WYSIWYG with what the operator designed:
 *  - objects positioned by percentage of the 1920×1080 virtual canvas;
 *  - text sized in `cqh` against a container-type:size root, so it scales with
 *    the output surface (720p/1080p/4K/preview) without hardcoded pixels.
 * No drag handles, no interaction — this is output only. Objects render in
 * array order (first = back). Sits above the slide background, below the logo.
 */
export function SlideObjectsLayer({ objects }: { objects: SlideObjectWire[] }) {
  return (
    <div
      className="absolute inset-0 z-0"
      style={{ containerType: "size" }}
      aria-hidden
    >
      {objects.map((obj, i) => {
        const box: React.CSSProperties = {
          position: "absolute",
          left: `${(obj.x / SLIDE_CANVAS_W) * 100}%`,
          top: `${(obj.y / SLIDE_CANVAS_H) * 100}%`,
          width: `${(obj.w / SLIDE_CANVAS_W) * 100}%`,
          height: `${(obj.h / SLIDE_CANVAS_H) * 100}%`,
        };
        const key = `${obj.kind}-${i}`;
        if (obj.kind === "text") {
          return (
            <div key={key} style={box}>
              <div
                className="w-full h-full flex whitespace-pre-wrap overflow-hidden"
                style={{
                  fontFamily: obj.fontFamily || "Inter, system-ui, sans-serif",
                  fontSize: `${((obj.fontSize ?? 96) / SLIDE_CANVAS_H) * 100}cqh`,
                  fontWeight: obj.fontWeight ?? 600,
                  color: obj.color ?? "#ffffff",
                  fontStyle: obj.italic ? "italic" : undefined,
                  textDecoration: obj.underline ? "underline" : undefined,
                  justifyContent: obj.align === "left" ? "flex-start" : obj.align === "right" ? "flex-end" : "center",
                  alignItems: "center",
                  textAlign: obj.align ?? "center",
                  padding: "2%",
                  containerType: "size",
                  textShadow: "0 2px 8px rgba(0,0,0,0.45)",
                }}
              >
                {obj.text}
              </div>
            </div>
          );
        }
        if (obj.kind === "shape") {
          return (
            <div key={key} style={box}>
              <div
                className="w-full h-full"
                style={{
                  background: obj.fill ?? "#14b8a6",
                  border: obj.strokeWidth ? `${obj.strokeWidth}px solid ${obj.stroke ?? "#0f766e"}` : undefined,
                  borderRadius: obj.shape === "ellipse" ? "50%" : `${obj.radius ?? 0}px`,
                  opacity: obj.opacity ?? 1,
                }}
              />
            </div>
          );
        }
        // image
        return (
          <div key={key} style={box}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={obj.url}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", display: "block" }}
              draggable={false}
              // A 404 / expired-presign object image must never show the browser's
              // broken-image glyph on the congregation's screen — hide it instead.
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
            />
          </div>
        );
      })}
    </div>
  );
}
