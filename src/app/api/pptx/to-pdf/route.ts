import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { presignGet, deleteObject } from "@/lib/s3";

export const runtime = "nodejs";
export const maxDuration = 300; // LibreOffice conversion of a big deck can be slow

// Turn an already-uploaded PowerPoint (in S3) into a PDF by delegating to the
// Fly LibreOffice converter, then hand the PDF back to the browser — which
// renders each page to a projectable media image via the existing PDF path.
//
// The heavy file never flows through this function: we give the converter a
// short-lived presigned GET url and stream back only the (small) PDF. Auth +
// church-scoping happen HERE; the converter is a dumb, secret-gated transform.
const toPdfLimiter = createLimiter("pptx-to-pdf", 20, 60_000);

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
  if (!(await toPdfLimiter(user.id))) {
    return NextResponse.json({ error: "Too many conversions — slow down" }, { status: 429 });
  }

  const serviceUrl = process.env.CONVERT_SERVICE_URL;
  const secret = process.env.CONVERT_SHARED_SECRET;
  if (!serviceUrl || !secret) {
    // Graceful degradation: the converter isn't wired up (env missing). Tell the
    // operator to export as PDF in the meantime rather than failing opaquely.
    return NextResponse.json(
      { error: "PowerPoint conversion isn't available yet — export your deck as PDF and drop that in instead." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { key?: string; ext?: string };
  const key = typeof body.key === "string" ? body.key : "";
  // Church-scope the key: an uploaded pptx lives at `${churchId}/pptx/...`
  // (see /api/media/presign). Reject anything outside this church's prefix so a
  // caller can't have us convert (and leak) another tenant's object.
  if (!key || !key.startsWith(`${user.churchId}/`)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const ext = body.ext === ".ppt" ? ".ppt" : ".pptx";

  const sourceUrl = await presignGet(key, 600); // 10-min window is plenty
  if (!sourceUrl) return NextResponse.json({ error: "Storage not configured" }, { status: 500 });

  let convertRes: Response;
  try {
    convertRes = await fetch(`${serviceUrl.replace(/\/$/, "")}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-convert-secret": secret },
      body: JSON.stringify({ url: sourceUrl, ext }),
    });
  } catch {
    return NextResponse.json({ error: "Conversion service unreachable — try again shortly." }, { status: 502 });
  }

  if (!convertRes.ok) {
    const detail = (await convertRes.json().catch(() => ({}))) as { error?: string };
    return NextResponse.json(
      { error: detail.error ? `Conversion failed: ${detail.error}` : "Conversion failed" },
      { status: 502 },
    );
  }

  // Stream the PDF straight back to the browser.
  const pdf = await convertRes.arrayBuffer();

  // The source .pptx was only a conversion input — the projectable output is the
  // rendered page images the client uploads next. Delete it so PowerPoint
  // imports don't leave a (5–150MB) object in storage forever. Best-effort: an
  // orphan is recoverable and must never fail the conversion the user is waiting
  // on. Church-scoping was already enforced on `key` above.
  void deleteObject(key).catch(() => { /* orphan — recoverable */ });

  return new NextResponse(pdf, {
    status: 200,
    headers: { "content-type": "application/pdf", "content-length": String(pdf.byteLength) },
  });
}
