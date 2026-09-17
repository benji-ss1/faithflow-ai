import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isChurchUploadKey } from "@/lib/media-types";
import { apiUser, hasCap } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { presignGet, presignPut, deleteObject } from "@/lib/s3";
import {
  CONVERT_ROUTE_BUDGET_MS, canRetry, isChurchPptxTempKey, isRetryableStatus, operatorConvertError,
  responseKind, retryDelayMs,
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
// Busy/cold-start retries: Fly normally routes around a busy machine (hard_limit=1),
// so this is a backstop — keep retrying while the time budget allows.
const MAX_RETRIES = 12;

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
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
    const outputPutUrl = await presignPut(outKey, "application/pdf", 900).catch(() => "");
    if (!sourceUrl || !outputPutUrl) return NextResponse.json({ error: "Storage not configured" }, { status: 500 });

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
          body: JSON.stringify({ url: sourceUrl, ext, outputPutUrl }),
          signal,
        });
      } catch {
        if (budget.aborted) return NextResponse.json({ error: operatorConvertError(504, null) }, { status: 504 });
        if (signal.aborted) return NextResponse.json({ error: "Cancelled" }, { status: 499 });
        convertRes = null; // connection error (e.g. cold start) → retry
      }
      const retryable = convertRes === null || isRetryableStatus(convertRes.status);
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
    void deleteObject(key).catch(() => { /* orphan — recoverable */ });
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
  const body = (await req.json().catch(() => ({}))) as { key?: string };
  if (!isChurchPptxTempKey(body.key, user.churchId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try { await deleteObject(body.key); } catch { /* already gone */ }
  return NextResponse.json({ ok: true });
}
