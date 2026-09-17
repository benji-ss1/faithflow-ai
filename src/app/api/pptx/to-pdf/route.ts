import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { pptxImports } from "@/lib/db/schema";
import { randomUUID } from "crypto";
import { isChurchUploadKey } from "@/lib/media-types";
import { apiUser, hasCap } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { presignGet, presignPut, deleteObject } from "@/lib/s3";
import {
  CONVERT_ROUTE_BUDGET_MS, canRetry, isChurchPptxTempKey, isRetryableConverterReply, operatorConvertError,
  pptxDeleteKind, responseKind, retryDelayMs,
} from "@/lib/pptx-import";

export const runtime = "nodejs";
export const maxDuration = 300; // LibreOffice conversion of a big deck can be slow

// Turn an already-uploaded PowerPoint (in S3) into a PDF by delegating to the
// Fly LibreOffice converter. Auth + church-scoping happen HERE; the converter is
// a dumb, secret-gated transform.
//
// The PDF never transits this function when the converter supports it: we
// presign a PUT for `${churchId}/pptx/<uuid>.pdf`, the converter uploads the PDF
// there and replies JSON, and we return {pdfUrl, key} for the browser to fetch
// directly (Vercel caps function responses at ~4.5MB; photo decks make 90MB PDFs).
// BACK-COMPAT: an older converter ignores outputPutUrl and replies with the PDF
// bytes — we then return those bytes exactly as before, so Vercel and Fly can
// deploy in either order.
const toPdfLimiter = createLimiter("pptx-to-pdf", 20, 60_000);
const cleanupLimiter = createLimiter("pptx-cleanup", 60, 60_000);
// Busy/cold-start retries: Fly normally routes around a busy machine (hard_limit=1),
// so this is a backstop — keep retrying while the time budget allows.
const MAX_RETRIES = 12;

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
  const onAbort = () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); };
  const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal.addEventListener("abort", onAbort, { once: true });
});

/** A legacy library import (pptx_imports) still references this source — its
 *  Retry button needs it, so this route must never delete it. Fails SAFE: on a
 *  DB error, treat it as referenced (an orphan is recoverable, lost data isn't). */
async function isLegacyImportSource(key: string, churchId: string): Promise<boolean> {
  try {
    const rows = await getDb().select({ id: pptxImports.id }).from(pptxImports)
      .where(and(eq(pptxImports.churchId, churchId), eq(pptxImports.sourceS3Key, key))).limit(1);
    return rows.length > 0;
  } catch {
    return true;
  }
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
  // Same capability as uploading the pptx source and the DELETE below.
  if (!hasCap(user.role, "edit_library")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await toPdfLimiter(user.id))) {
    return NextResponse.json({ error: "Too many conversions — slow down" }, { status: 429 });
  }

  const serviceUrl = process.env.CONVERT_SERVICE_URL;
  const secret = process.env.CONVERT_SHARED_SECRET;
  if (!serviceUrl || !secret) {
    // Graceful degradation: the converter isn't wired up (env missing).
    return NextResponse.json(
      { error: "PowerPoint conversion isn't available yet — export your deck as PDF and drop that in instead." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { key?: string; ext?: string };
  const key = typeof body.key === "string" ? body.key : "";
  // Must be exactly a pptx-purpose key issued to THIS church (never its media
  // objects — the source is deleted below), and never a converted .pdf output.
  if (!isChurchUploadKey(key, user.churchId, "pptx") || /\.pdf$/i.test(key)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const ext = body.ext === ".ppt" ? ".ppt" : ".pptx";

  const outKey = `${user.churchId}/pptx/${randomUUID()}.pdf`;
  let handedOff = false; // true once the browser has been given outKey (it cleans it up)

  try {
    const sourceUrl = await presignGet(key, 600); // 10-min window is plenty
    if (!sourceUrl) return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
    // If the output PUT can't be presigned, fall back to the old byte path
    // (omit outputPutUrl → the converter replies with the PDF bytes).
    const outputPutUrl = await presignPut(outKey, "application/pdf", 900).catch(() => "");

    // Total budget for the converter conversation; also stop if the browser
    // disconnects (operator pressed Cancel) so the converter kills LibreOffice.
    const budget = AbortSignal.timeout(CONVERT_ROUTE_BUDGET_MS);
    const signal = req.signal ? AbortSignal.any([budget, req.signal]) : budget;
    const started = Date.now();

    let convertRes: Response | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        convertRes = await fetch(`${serviceUrl.replace(/\/$/, "")}/convert`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-convert-secret": secret },
          body: JSON.stringify(outputPutUrl ? { url: sourceUrl, ext, outputPutUrl } : { url: sourceUrl, ext }),
          signal,
        });
      } catch {
        if (budget.aborted) return NextResponse.json({ error: operatorConvertError(504, null) }, { status: 504 });
        if (signal.aborted) return NextResponse.json({ error: "Cancelled" }, { status: 499 });
        convertRes = null; // connection error (e.g. cold start) → retry
      }
      let retryable = convertRes === null;
      if (convertRes && [429, 502, 503].includes(convertRes.status)) {
        // Peek the converter's JSON code without consuming the body we may still report.
        const peek = (await convertRes.clone().json().catch(() => null)) as { code?: unknown } | null;
        retryable = isRetryableConverterReply(convertRes.status, peek?.code);
      }
      if (!retryable || !canRetry(attempt, MAX_RETRIES, Date.now() - started)) break;
      await convertRes?.body?.cancel().catch(() => {});
      try { await sleep(retryDelayMs(attempt), signal); }
      catch { return NextResponse.json({ error: "Cancelled" }, { status: 499 }); }
    }

    if (!convertRes) {
      return NextResponse.json({ error: "Conversion service unreachable — try again shortly." }, { status: 502 });
    }
    if (!convertRes.ok) {
      const detail = (await convertRes.json().catch(() => ({}))) as { error?: string; code?: string };
      return NextResponse.json({ error: operatorConvertError(convertRes.status, detail) }, { status: 502 });
    }

    if (responseKind(convertRes.headers.get("content-type")) === "pdf") {
      // OLD converter: it returned the PDF bytes. Behave exactly as before.
      const pdf = await convertRes.arrayBuffer();
      return new NextResponse(pdf, {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(pdf.byteLength) },
      });
    }

    const json = (await convertRes.json().catch(() => ({}))) as { ok?: boolean; pdfUploaded?: boolean };
    if (!json.ok || !json.pdfUploaded) {
      return NextResponse.json({ error: operatorConvertError(502, null) }, { status: 502 });
    }
    const pdfUrl = await presignGet(outKey, 900);
    if (!pdfUrl) return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
    handedOff = true;
    return NextResponse.json({ pdfUrl, key: outKey });
  } finally {
    // The source .pptx was only a conversion input — delete it on success AND
    // failure. Best-effort: an orphan is recoverable and must never fail the
    // response. Church-scoping was enforced on `key` above.
    // Never a legacy library import's source (its Retry re-reads it).
    void isLegacyImportSource(key, user.churchId)
      .then((legacy) => (legacy ? undefined : deleteObject(key)))
      .catch(() => { /* orphan — recoverable */ });
    // Output PDF: if the browser never got it (failure/cancel), remove any
    // (partial) upload now. Otherwise the browser DELETEs it after fetching.
    if (!handedOff) void deleteObject(outKey).catch(() => {});
  }
}

// Cleanup: the browser deletes the converted PDF once it has fetched it, and the
// source PowerPoint if the operator cancels before conversion starts.
// Church-scoped: only this church's `pptx/<uuid>.(pptx|ppt|pdf)` temp objects.
export async function DELETE(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
  // Same capability that may upload a pptx-purpose object (/api/media/presign).
  if (!hasCap(user.role, "edit_library")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await cleanupLimiter(user.id))) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { key?: string };
  if (!isChurchPptxTempKey(body.key, user.churchId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  // .pdf outputs always; a .pptx/.ppt source only if no legacy import uses it.
  if (pptxDeleteKind(body.key) !== "pdf" && (await isLegacyImportSource(body.key, user.churchId))) {
    return NextResponse.json({ ok: true, kept: true });
  }
  try { await deleteObject(body.key); } catch { /* already gone */ }
  return NextResponse.json({ ok: true });
}
