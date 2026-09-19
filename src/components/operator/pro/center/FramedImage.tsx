"use client";
/**
 * An image drawn the way the operator EDITED it in the media editor (crop / pan /
 * zoom / blur-fill / logo on a colour) — used by the Media Bin and Media Browser
 * tiles so what you see in the library is what you get on the screen. With no saved
 * edit (or a trivial one) it renders the plain <img> exactly as those tiles always did.
 *
 * Drawn on a small canvas with the SAME drawing code that bakes the background image
 * (pixel-checked against the app's own renderer), and it redraws the moment an edit is
 * saved (MEDIA_FRAME_CHANGED_EVENT). Display only — no upload, no CORS requirement.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { loadMediaFrame, MEDIA_FRAME_CHANGED_EVENT } from "./mediaFrame";
import { drawFrame, isTrivialFrame } from "./mediaFrameBake";

export function FramedImage({
  churchId, assetId, src, fullSrc, alt, className, canvasWidth = 480,
}: {
  churchId: string | undefined;
  assetId: string;
  /** what the plain tile shows (usually the small thumbnail) */
  src: string;
  /** what the edit is drawn from (the full image); defaults to src */
  fullSrc?: string;
  alt: string;
  className?: string;
  canvasWidth?: number;
}) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<{ assetId?: string }>).detail?.assetId;
      if (!id || id === assetId) setVersion((v) => v + 1);
    };
    window.addEventListener(MEDIA_FRAME_CHANGED_EVENT, h);
    return () => window.removeEventListener(MEDIA_FRAME_CHANGED_EVENT, h);
  }, [assetId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frame = useMemo(() => loadMediaFrame(churchId, assetId), [churchId, assetId, version]);
  const framed = !!frame && !isTrivialFrame(frame);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const source = fullSrc ?? src;

  useEffect(() => {
    if (!framed || !frame) return;
    let cancelled = false;
    const im = new Image();
    im.onload = () => {
      const c = canvasRef.current;
      if (cancelled || !c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const scale = c.width / 1920;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.scale(scale, scale);
      try { drawFrame(ctx, frame, im, scale); } catch { /* leave the tile blank rather than throw */ }
      ctx.restore();
    };
    im.src = source;
    return () => { cancelled = true; };
  }, [framed, frame, source]);

  if (!framed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} loading="lazy" decoding="async" className={className} />;
  }
  return <canvas ref={canvasRef} width={canvasWidth} height={Math.round((canvasWidth * 9) / 16)} role="img" aria-label={alt} className={className} />;
}
