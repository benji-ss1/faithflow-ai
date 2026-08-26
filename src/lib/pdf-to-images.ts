/**
 * PDF → slide images (Increment B2 — "import a deck as pictures").
 *
 * Churches export PowerPoint / Google Slides / Gemini / Word decks to PDF (one
 * click), then import here. Each PDF page is rendered to a PNG IN THE BROWSER
 * (canvas) and uploaded as a media image — because PDF→image rendering does NOT
 * work in Vercel serverless (needs native canvas), but the browser has it.
 * Spec: docs/IMPORT_EXPANSION_SPEC.md (KEY 2).
 *
 * The pure helpers (naming, scale, page-cap) are unit-tested; the actual render
 * is browser-only (canvas) and verified on the dummy app.
 */

// Cap how many pages a single deck can expand into (guards memory/time on a
// pathological giant PDF). Beyond this we truncate and tell the user.
export const MAX_DECK_PAGES = 200;

// Target rendered width in CSS pixels — high enough for a projector, bounded so
// a 100-page deck doesn't blow up browser memory.
export const DECK_TARGET_WIDTH = 1920;

// Never upscale a page beyond this factor (a tiny source page shouldn't become a
// giant blurry PNG).
export const DECK_MAX_SCALE = 3;

// Rendered pages are encoded as JPEG (not PNG): a slide photo/screenshot is a
// photographic raster, so JPEG is several times smaller than PNG — much faster
// to upload AND to later load in the grid — with no visible loss at q0.82.
export const DECK_JPEG_QUALITY = 0.82;

export interface DeckRenderResult {
  /** Pages actually rendered + handed to onPage (≤ MAX_DECK_PAGES). */
  renderedPages: number;
  /** Real page count of the source PDF (may exceed renderedPages). */
  totalPages: number;
  /** True if the PDF had more pages than MAX_DECK_PAGES and was truncated. */
  truncated: boolean;
}

/** Callback invoked once per rendered page. Awaited, so the caller can upload
 *  and DISCARD each page before the next renders — keeping ≤1 PNG blob resident
 *  instead of the whole deck (the memory fix all three reviewers flagged). */
export type DeckPageHandler = (page: File, index: number, total: number) => Promise<void> | void;

/** Zero-padded, human-readable per-page name: "sermon-slides — p03.jpg". */
export function deckPageName(baseName: string, pageNum: number, totalPages: number): string {
  const stem = baseName.replace(/\.[^.]+$/, "").trim() || "deck";
  const width = String(totalPages).length;
  const num = String(pageNum).padStart(Math.max(2, width), "0");
  return `${stem} — p${num}.jpg`;
}

/** Scale to render a page so its width ≈ targetWidth, never upscaling past max. */
export function renderScale(baseWidth: number, targetWidth = DECK_TARGET_WIDTH, maxScale = DECK_MAX_SCALE): number {
  if (!(baseWidth > 0)) return 1;
  return Math.min(targetWidth / baseWidth, maxScale);
}

/** Clamp a page count to the cap; report whether truncation happened. */
export function clampPageCount(n: number, max = MAX_DECK_PAGES): { count: number; truncated: boolean } {
  const count = Math.max(0, Math.min(n, max));
  return { count, truncated: n > max };
}

/** True if the file is a PDF we can expand into slide images. */
export function isPdfFile(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * Render each page of a PDF to a PNG and hand it to `onPage` ONE AT A TIME.
 * Browser-only (canvas). Lazily imports pdfjs-dist so its weight never lands on
 * non-import routes. Streaming (vs returning File[]) keeps only one page's blob
 * resident — the caller uploads-then-discards inside onPage.
 *
 * Returns a summary so the caller can tell the user when a deck was truncated.
 */
export async function renderPdfToImages(
  file: File,
  onPage: DeckPageHandler,
  opts: { signal?: AbortSignal } = {},
): Promise<DeckRenderResult> {
  if (typeof document === "undefined") {
    throw new Error("renderPdfToImages must run in the browser");
  }

  const pdfjs = await import("pdfjs-dist");
  // Worker served from public/ as a same-origin absolute path with a .js
  // extension: Next serves .js as text/javascript, which the global nosniff
  // header requires (a .mjs would be blocked). Bundler-agnostic, offline-safe.
  // Kept in sync with node_modules by scripts/copy-pdf-worker.mjs (pre dev/build).
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    const totalPages = pdf.numPages;
    const { count: total, truncated } = clampPageCount(totalPages);

    for (let i = 1; i <= total; i++) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: renderScale(base.width) });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get a 2D canvas context");

      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", DECK_JPEG_QUALITY));
      // Free the canvas backing store promptly (many pages = lots of memory).
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      if (!blob) throw new Error(`Failed to render page ${i}`);

      // Hand off + await so the caller applies backpressure (its onPage resolves
      // once an upload SLOT is free, not once the upload completes) — that keeps
      // only a bounded number of page blobs resident while uploads overlap. A
      // throw here aborts the deck (caller decides recovery).
      await onPage(new File([blob], deckPageName(file.name, i, total), { type: "image/jpeg" }), i, total);
    }

    return { renderedPages: total, totalPages, truncated };
  } finally {
    await pdf.destroy();
  }
}
