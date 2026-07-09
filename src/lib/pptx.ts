// Server-only. Do not import from client components.
import { promisify } from "util";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
// @ts-ignore - no types export in root
import libre from "libreoffice-convert";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { pptxImports, pptxSlides } from "./db/schema";
import { s3, BUCKET, putBuffer } from "./s3";

const convert = promisify(libre.convert) as (buf: Buffer, ext: string, filter: string | undefined) => Promise<Buffer>;
const execFileP = promisify(execFile);

// Fast probe — fail early with a clear message rather than let
// libreoffice-convert die inside the child process silently.
const CANDIDATE_SOFFICE_PATHS = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/opt/homebrew/bin/soffice",
];

async function assertSofficeAvailable(): Promise<void> {
  // 1. Try PATH lookup
  try { await execFileP("which", ["soffice"]); return; } catch { /* fall through */ }
  // 2. Try well-known install paths
  for (const p of CANDIDATE_SOFFICE_PATHS) if (existsSync(p)) return;
  throw new Error("LibreOffice is not installed. Install with `brew install --cask libreoffice` (macOS) or `apt-get install libreoffice` (Debian/Ubuntu), then retry the upload.");
}

async function s3GetBuffer(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
  const chunks: Buffer[] = [];
  const stream = res.Body as unknown as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function convertPptxImport(importId: string) {
  const db = getDb();
  const [imp] = await db.select().from(pptxImports).where(eq(pptxImports.id, importId)).limit(1);
  if (!imp) throw new Error("Import not found");

  try {
    await db.update(pptxImports).set({ status: "converting", errorMessage: null }).where(eq(pptxImports.id, importId));

    // Fast-fail if soffice isn't present so the row never sits at "converting"
    // while libreoffice-convert times out inside a child process.
    await assertSofficeAvailable();

    const pptxBuf = await s3GetBuffer(imp.sourceS3Key);
    let pdfBuf: Buffer;
    try {
      pdfBuf = await convert(pptxBuf, ".pdf", undefined);
    } catch (e) {
      throw new Error(`LibreOffice conversion failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }

    // Dynamic import of pdfjs (ESM)
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");

    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuf) }).promise;
    const slides: { imageS3Key: string; widthPx: number; heightPx: number }[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1920 / page.getViewport({ scale: 1 }).width });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      // @ts-expect-error - node-canvas Ctx matches enough for pdfjs
      await page.render({ canvasContext: ctx, viewport }).promise;
      const png = await canvas.encode("png");
      const key = `${imp.churchId}/pptx/${imp.id}/slide-${String(i).padStart(3, "0")}.png`;
      await putBuffer(key, png, "image/png");
      slides.push({ imageS3Key: key, widthPx: Math.round(viewport.width), heightPx: Math.round(viewport.height) });
    }

    if (slides.length > 0) {
      await db.insert(pptxSlides).values(slides.map((s, i) => ({ pptxImportId: imp.id, order: i, ...s })));
    }
    await db.update(pptxImports).set({ status: "ready" }).where(eq(pptxImports.id, importId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await db.update(pptxImports).set({ status: "failed", errorMessage: msg }).where(eq(pptxImports.id, importId));
    throw e;
  }
}
