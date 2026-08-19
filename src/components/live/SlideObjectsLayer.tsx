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
export function SlideObjectsLayer({ objects, fontScale = 1 }: { objects: SlideObjectWire[]; fontScale?: number }) {
  // Global font multiplier (operator A-/A+ × Projection-Zone Font). Previously
  // this layer ignored it, so the Font slider / A-/A+ had NO effect on the
  // projector for designed or song slides (only plain-lyric slides scaled).
  // Now every text object scales by it — matching the plain-lyric path and the
  // editor's live preview.
  const fs = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return (
    <div
      className="absolute inset-0 z-0"
      style={{ containerType: "size" }}
      aria-hidden
    >
      {objects.map((obj, i) => {
        // Hidden objects are for the operator's editing convenience only — never
        // rendered on the congregation's screen.
        if (obj.hidden) return null;
        const box: React.CSSProperties = {
          position: "absolute",
          left: `${(obj.x / SLIDE_CANVAS_W) * 100}%`,
          top: `${(obj.y / SLIDE_CANVAS_H) * 100}%`,
          width: `${(obj.w / SLIDE_CANVAS_W) * 100}%`,
          height: `${(obj.h / SLIDE_CANVAS_H) * 100}%`,
          // Rotation via the INDEPENDENT `rotate` property (not `transform`) so
          // it composes cleanly with the entrance animation's transform instead
          // of being overwritten by it.
          rotate: obj.rotation ? `${obj.rotation}deg` : undefined,
        };
        const key = `${obj.kind}-${i}`;
        // Entrance animation: applied to the positioned box only. `both` fill
        // mode means it starts hidden/offset and RESTS at the natural state
        // (identity transform, full opacity) — so it never permanently changes
        // an object's position, size, or font; it only plays once on slide show.
        const animName = obj.anim && obj.anim !== "none" ? `pf-obj-${obj.anim}` : null;
        // No persistent `willChange`: the browser auto-promotes a transform/
        // opacity animation to its own layer for the animation's duration and
        // de-promotes after, so we avoid holding a compositor layer for the whole
        // time an animated slide is on screen.
        const boxStyle: React.CSSProperties = animName
          ? { ...box, animation: `${animName} 550ms cubic-bezier(0.2,0.7,0.2,1) ${Math.min(Math.max(obj.animDelayMs ?? 0, 0), 10000)}ms both` }
          : box;
        const animCls = animName ? "pf-obj-anim" : undefined;
        if (obj.kind === "text") {
          return (
            <div key={key} className={animCls} style={boxStyle}>
              <div
                className="w-full h-full flex whitespace-pre-wrap overflow-hidden"
                style={{
                  fontFamily: obj.fontFamily || "Inter, system-ui, sans-serif",
                  fontSize: `${((obj.fontSize ?? 96) * fs / SLIDE_CANVAS_H) * 100}cqh`,
                  fontWeight: obj.fontWeight ?? 600,
                  color: obj.color ?? "#ffffff",
                  fontStyle: obj.italic ? "italic" : undefined,
                  textDecoration: obj.underline ? "underline" : undefined,
                  justifyContent: obj.align === "left" ? "flex-start" : obj.align === "right" ? "flex-end" : "center",
                  alignItems: "center",
                  textAlign: obj.align ?? "center",
                  padding: "2%",
                  containerType: "size",
                  lineHeight: obj.lineHeight ?? undefined,
                  // letterSpacing/stroke scale with the output surface (cqh/cqw)
                  // exactly like fontSize, so they hold at 720p/1080p/4K/preview.
                  letterSpacing: obj.letterSpacing ? `${(obj.letterSpacing * fs / SLIDE_CANVAS_H) * 100}cqh` : undefined,
                  textTransform: obj.uppercase ? "uppercase" : undefined,
                  WebkitTextStroke: obj.strokeWidth ? `${(obj.strokeWidth / SLIDE_CANVAS_W) * 100}cqw ${obj.stroke ?? "#000000"}` : undefined,
                  textShadow: (obj.shadow ?? true) ? "0 2px 8px rgba(0,0,0,0.45)" : undefined,
                  opacity: obj.opacity ?? 1,
                }}
              >
                {obj.text}
              </div>
            </div>
          );
        }
        if (obj.kind === "shape") {
          return (
            <div key={key} className={animCls} style={boxStyle}>
              <div
                className="w-full h-full"
                style={{
                  background: obj.fill2
                    ? `linear-gradient(${obj.fillAngle ?? 135}deg, ${obj.fill ?? "#14b8a6"}, ${obj.fill2})`
                    : (obj.fill ?? "#14b8a6"),
                  // stroke/radius expressed in cqw (against the container-type:size
                  // root) so they scale with the output surface exactly like text,
                  // instead of a fixed px that looks heavy small / thin at 4K.
                  border: obj.strokeWidth ? `${((obj.strokeWidth / SLIDE_CANVAS_W) * 100)}cqw solid ${obj.stroke ?? "#0f766e"}` : undefined,
                  borderRadius: obj.shape === "ellipse" ? "50%" : `${(((obj.radius ?? 0) / SLIDE_CANVAS_W) * 100)}cqw`,
                  opacity: obj.opacity ?? 1,
                }}
              />
            </div>
          );
        }
        if (obj.kind === "video") {
          return (
            <div key={key} className={animCls} style={boxStyle}>
              <video
                src={obj.url}
                autoPlay
                loop={obj.loop ?? true}
                muted={obj.muted ?? true}
                playsInline
                style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", display: "block", opacity: obj.opacity ?? 1 }}
                onError={(e) => { (e.currentTarget as HTMLVideoElement).style.visibility = "hidden"; }}
              />
            </div>
          );
        }
        // image
        return (
          <div key={key} className={animCls} style={boxStyle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={obj.url}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", display: "block", opacity: obj.opacity ?? 1 }}
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
