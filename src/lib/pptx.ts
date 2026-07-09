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
import { sql } from "drizzle-orm";
import { embed, toVectorLiteral } from "./embeddings";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

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

// ------- Phase 6: PPTX text + notes extraction -----------------------------
// PPTX files are zip archives with slide XML under ppt/slides/slideN.xml and
// speaker notes under ppt/notesSlides/notesSlideN.xml. Slide/notes text
// lives inside <a:t> nodes. We extract via adm-zip + fast-xml-parser
// (already deps), no shell out. Extraction failures never fail the whole
// conversion — per-slide fields simply stay NULL.

function collectATexts(node: unknown, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) collectATexts(n, out); return; }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    // fast-xml-parser flattens <a:t>text</a:t> → { "a:t": "text" } (or array)
    if (k === "a:t") {
      if (typeof v === "string") out.push(v);
      else if (typeof v === "number") out.push(String(v));
      else if (Array.isArray(v)) for (const it of v) { if (typeof it === "string") out.push(it); else if (it && typeof it === "object") out.push(String((it as Record<string, unknown>)["#text"] ?? "")); }
      else if (v && typeof v === "object") out.push(String((v as Record<string, unknown>)["#text"] ?? ""));
      continue;
    }
    if (v && typeof v === "object") collectATexts(v, out);
  }
}

export function extractTextFromSlideXml(xml: string): string {
  try {
    const parser = new XMLParser({ ignoreAttributes: true, textNodeName: "#text", trimValues: true });
    const doc = parser.parse(xml);
    const out: string[] = [];
    collectATexts(doc, out);
    return out.map((s) => s.trim()).filter(Boolean).join(" ").trim();
  } catch {
    // Safe regex fallback for <a:t>…</a:t>
    try {
      const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
      return matches.map((m) => m.replace(/<[^>]+>/g, "")).join(" ").trim();
    } catch { return ""; }
  }
}

type ExtractedSlide = { slideText: string | null; notesText: string | null };

export function extractPptxTextPerSlide(pptxBuf: Buffer): Map<number, ExtractedSlide> {
  // Returns Map<1-based-index, {slideText, notesText}>
  const map = new Map<number, ExtractedSlide>();
  try {
    const zip = new AdmZip(pptxBuf);
    const entries = zip.getEntries();
    // Group entries by index
    const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/;
    const notesRe = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;
    for (const e of entries) {
      const name = e.entryName;
      let m = slideRe.exec(name);
      if (m) {
        const idx = parseInt(m[1], 10);
        const xml = e.getData().toString("utf8");
        const text = extractTextFromSlideXml(xml);
        const existing = map.get(idx) || { slideText: null, notesText: null };
        existing.slideText = text || null;
        map.set(idx, existing);
        continue;
      }
      m = notesRe.exec(name);
      if (m) {
        const idx = parseInt(m[1], 10);
        const xml = e.getData().toString("utf8");
        const text = extractTextFromSlideXml(xml);
        const existing = map.get(idx) || { slideText: null, notesText: null };
        existing.notesText = text || null;
        map.set(idx, existing);
      }
    }
  } catch (e) {
    console.warn("[pptx] text extraction failed:", e instanceof Error ? e.message : String(e));
  }
  return map;
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
    // Phase 6: extract text/notes from source pptx (defensive — never throws)
    let extractedTexts = new Map<number, ExtractedSlide>();
    try { extractedTexts = extractPptxTextPerSlide(pptxBuf); }
    catch (e) { console.warn("[pptx] text extraction wrapper failed:", e instanceof Error ? e.message : String(e)); }
    const slides: { imageS3Key: string; widthPx: number; heightPx: number; slideText: string | null; notesText: string | null }[] = [];

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
      const ex = extractedTexts.get(i) || { slideText: null, notesText: null };
      slides.push({ imageS3Key: key, widthPx: Math.round(viewport.width), heightPx: Math.round(viewport.height), slideText: ex.slideText, notesText: ex.notesText });
    }

    if (slides.length > 0) {
      const inserted = await db.insert(pptxSlides).values(
        slides.map((s, i) => ({ pptxImportId: imp.id, order: i, imageS3Key: s.imageS3Key, widthPx: s.widthPx, heightPx: s.heightPx, slideText: s.slideText, notesText: s.notesText }))
      ).returning({ id: pptxSlides.id, order: pptxSlides.order });

      // Embed per-slide combined text (only if non-empty). One-at-a-time to
      // avoid a large batch on decks with dozens of blank image slides.
      for (const row of inserted) {
        const s = slides[row.order];
        const combined = [s.slideText, s.notesText].filter(Boolean).join(" ").trim();
        if (!combined) continue;
        try {
          const vec = await embed(combined);
          await db.execute(sql`UPDATE pptx_slides SET embedding = ${toVectorLiteral(vec)}::vector WHERE id = ${row.id}`);
        } catch (e) {
          console.warn("[pptx] embedding failed for slide", row.order, e instanceof Error ? e.message : String(e));
        }
      }
    }
    await db.update(pptxImports).set({ status: "ready" }).where(eq(pptxImports.id, importId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await db.update(pptxImports).set({ status: "failed", errorMessage: msg }).where(eq(pptxImports.id, importId));
    throw e;
  }
}
