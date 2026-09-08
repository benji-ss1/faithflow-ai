// Client-side "remove flat background" keying for logo PNGs/JPEGs that ship with
// a BAKED flat background (a near-black or near-white rectangle behind the mark)
// instead of real transparency. We sample the four corners to detect the flat
// colour, then key out every pixel within a tolerance of it, writing a new PNG
// WITH an alpha channel. The processed PNG is uploaded through the EXISTING media
// upload path (presign → PUT → registerMediaAsset), so it becomes a normal,
// reusable library asset — no new endpoint, no server work.
//
// The numeric core is pure + unit-testable (no DOM); removeFlatBackground() is
// the thin canvas wrapper. Honest by design: if the corners DON'T agree (the
// image has no flat background) we report flat:false so the UI can say so rather
// than silently mangling a real photo.

export type Rgb = { r: number; g: number; b: number };

// Max possible Euclidean distance in RGB space (sqrt(255^2 * 3)).
export const MAX_RGB_DISTANCE = Math.sqrt(255 * 255 * 3);

export function rgbDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Corners must agree within this distance to count as a genuine flat background.
// ~48 tolerates JPEG ringing / faint vignettes on an otherwise-flat fill.
export const FLAT_CORNER_VARIANCE_MAX = 48;

/**
 * Decide the flat key colour from corner samples. Returns { flat:false } when the
 * corners disagree too much (not a flat background) so the caller can warn the
 * operator instead of keying out random pixels.
 */
export function pickFlatKeyColor(corners: Rgb[]): { flat: boolean; color: Rgb } {
  const n = corners.length;
  const avg: Rgb = {
    r: Math.round(corners.reduce((s, c) => s + c.r, 0) / n),
    g: Math.round(corners.reduce((s, c) => s + c.g, 0) / n),
    b: Math.round(corners.reduce((s, c) => s + c.b, 0) / n),
  };
  let maxD = 0;
  for (const c of corners) maxD = Math.max(maxD, rgbDistance(c, avg));
  return { flat: maxD <= FLAT_CORNER_VARIANCE_MAX, color: avg };
}

/**
 * Alpha (0-255) for a pixel given the key colour and a tolerance percentage
 * (0-100 → 0..MAX_RGB_DISTANCE). Pixels well within tolerance become fully
 * transparent; a soft feather band above the tolerance ramps back to opaque so
 * anti-aliased logo edges don't get a hard halo. Returns the ORIGINAL alpha when
 * the pixel is clearly foreground.
 */
export function alphaForKey(px: Rgb, origAlpha: number, key: Rgb, thresholdPct: number): number {
  const maxD = (Math.max(0, Math.min(100, thresholdPct)) / 100) * MAX_RGB_DISTANCE;
  if (maxD <= 0) return origAlpha;
  const feather = maxD * 0.35;
  const d = rgbDistance(px, key);
  if (d <= maxD - feather) return 0;
  if (d >= maxD) return origAlpha;
  // Linear ramp across the feather band.
  const t = (d - (maxD - feather)) / feather; // 0..1
  return Math.round(origAlpha * t);
}

/** Sample a small patch average around (x,y) to resist single-pixel noise. */
function samplePatch(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): Rgb {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 4; dx++) {
      const sx = Math.min(w - 1, Math.max(0, x + dx));
      const sy = Math.min(h - 1, Math.max(0, y + dy));
      const i = (sy * w + sx) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

export type RemoveFlatResult = { blob: Blob; keyColor: Rgb; flat: boolean };

/**
 * Load an image (CORS-enabled), detect its flat corner colour, key it out at the
 * given tolerance, and return a PNG blob WITH transparency. Rejects on load /
 * tainted-canvas / decode failure so the caller can fall back gracefully.
 * Dimension-capped so a huge original can't blow up memory on a weak PC.
 */
export function removeFlatBackground(url: string, thresholdPct: number, maxDim = 1600): Promise<RemoveFlatResult> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    const watchdog = window.setTimeout(() => { im.onload = null; im.onerror = null; reject(new Error("timeout")); }, 12000);
    im.onerror = () => { window.clearTimeout(watchdog); reject(new Error("load")); };
    im.onload = () => {
      window.clearTimeout(watchdog);
      try {
        const nW = im.naturalWidth, nH = im.naturalHeight;
        if (!nW || !nH) throw new Error("no dims");
        const scale = Math.min(1, maxDim / Math.max(nW, nH));
        const w = Math.max(1, Math.round(nW * scale)), h = Math.max(1, Math.round(nH * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) throw new Error("no ctx");
        g.drawImage(im, 0, 0, w, h);
        const imgData = g.getImageData(0, 0, w, h); // throws SecurityError if tainted
        const data = imgData.data;
        const corners = [
          samplePatch(data, w, h, 0, 0),
          samplePatch(data, w, h, w - 4, 0),
          samplePatch(data, w, h, 0, h - 4),
          samplePatch(data, w, h, w - 4, h - 4),
        ];
        const { flat, color } = pickFlatKeyColor(corners);
        for (let i = 0; i < data.length; i += 4) {
          const a = alphaForKey({ r: data[i], g: data[i + 1], b: data[i + 2] }, data[i + 3], color, thresholdPct);
          data[i + 3] = a;
        }
        g.putImageData(imgData, 0, 0);
        c.toBlob((blob) => {
          if (!blob) { reject(new Error("encode")); return; }
          resolve({ blob, keyColor: color, flat });
        }, "image/png");
      } catch (e) {
        reject(e instanceof Error ? e : new Error("process"));
      }
    };
    im.src = url;
  });
}
