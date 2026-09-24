// Static thumbnails for animated themes (2026-09-24). Renders ONE frame of a
// shader preset into a data URL using a single short-lived WebGL context at a
// time, then releases it — so a grid of N animated-theme tiles costs zero live
// GPU contexts (browsers cap ~16 per page and the operator window already holds
// preview/card renderers). Cached per preset+colours for the page's lifetime.
import { createShaderRenderer } from "./ShaderRenderer";

const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.04, 0.04, 0.05];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function shaderThumbnail(opts: { preset: string; intensity?: number; primaryColor: string; secondaryColor: string }): Promise<string | null> {
  const key = `${opts.preset}|${opts.intensity ?? 1}|${opts.primaryColor}|${opts.secondaryColor}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  if (typeof document === "undefined") return Promise.resolve(null);
  // Serialise: only one thumbnail context exists at any moment.
  const job = queue.then(() => {
    const canvas = document.createElement("canvas");
    const handle = createShaderRenderer({
      canvas, preset: opts.preset, speed: 1, intensity: opts.intensity ?? 1,
      primaryColor: hexToRgb(opts.primaryColor), secondaryColor: hexToRgb(opts.secondaryColor),
      frozen: true, offscreenSize: { width: 320, height: 180 }, preserveDrawingBuffer: true,
    });
    if (!handle) return null;
    let url: string | null = null;
    try { url = canvas.toDataURL("image/jpeg", 0.85); } catch { url = null; }
    handle.stop();
    if (url) cache.set(key, url);
    return url;
  });
  queue = job.catch(() => null);
  return job;
}
