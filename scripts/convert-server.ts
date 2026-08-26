/**
 * PresentFlow document converter — a tiny HTTP service deployed to Fly.io that
 * turns a PowerPoint (.pptx/.ppt) into a PDF using headless LibreOffice.
 *
 * WHY this exists: Vercel serverless can't run LibreOffice, and browsers can't
 * render PPTX. So the operator's media import uploads the PPTX to S3, the Next
 * app (/api/pptx/to-pdf) hands us a short-lived presigned URL, we download +
 * convert here, and stream the PDF back. The Next app then reuses its existing
 * client-side PDF→images path to turn each page into a projectable media slide.
 *
 * Security model: this service is reachable on the public internet, so every
 * /convert call MUST carry the shared secret (CONVERT_SHARED_SECRET) in the
 * x-convert-secret header. Without a matching secret it returns 401 and does no
 * work. It never touches the database and holds no S3 credentials — it only
 * fetches the exact presigned URL the trusted Next app gives it.
 *
 * Runs as a long-lived Node process on CONVERT_PORT (default 3002); Fly's edge
 * terminates TLS on 443. Machines scale to zero when idle (see fly.convert.toml)
 * so an idle converter costs nothing.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
// @ts-ignore - no types export in root
import libre from "libreoffice-convert";

const convert = promisify(libre.convert) as (buf: Buffer, ext: string, filter: string | undefined) => Promise<Buffer>;

const PORT = Number(process.env.CONVERT_PORT || 3002);
const SECRET = process.env.CONVERT_SHARED_SECRET || "";
// Cap the source file we'll pull — a PPTX beyond this is almost certainly not a
// sermon deck, and LibreOffice on a small machine shouldn't chew on it.
const MAX_SOURCE_BYTES = 150 * 1024 * 1024; // 150MB
const ALLOWED_EXT = new Set([".pptx", ".ppt"]);
// Hard timeout on the source download so a slow/hanging URL can't wedge the
// process (LibreOffice has no such loop; the fetch does).
const DOWNLOAD_TIMEOUT_MS = 60_000;
// Optional defense-in-depth against SSRF: if CONVERT_ALLOWED_HOSTS is set
// (comma-separated hostnames), the source URL's host MUST be one of them. The
// app always sends a presigned STORAGE url, so set this to your S3/Supabase
// host in prod. Unset = allow any https host (still secret-gated).
const ALLOWED_HOSTS = (process.env.CONVERT_ALLOWED_HOSTS || "")
  .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

function readJson(req: IncomingMessage, limitBytes = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error("body too large")); req.destroy(); return; }
      raw += c.toString("utf8");
    });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

async function downloadPptx(url: string): Promise<Buffer> {
  // Optional host allowlist (SSRF defense-in-depth on top of the shared secret).
  if (ALLOWED_HOSTS.length) {
    let host = "";
    try { host = new URL(url).host.toLowerCase(); } catch { throw new Error("bad url"); }
    if (!ALLOWED_HOSTS.includes(host)) throw new Error("source host not allowed");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    // redirect:"error" — never follow a redirect to a different (possibly
    // internal) host; the presigned URL we're given resolves directly.
    const res = await fetch(url, { redirect: "error", signal: ctrl.signal });
    if (!res.ok) throw new Error(`source fetch failed (${res.status})`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len && len > MAX_SOURCE_BYTES) throw new Error("source too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SOURCE_BYTES) throw new Error("source too large");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    // Health check — used by Fly's http_checks and the deploy script.
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.method !== "POST" || req.url !== "/convert") {
      res.writeHead(404).end("not found");
      return;
    }

    // Constant-work secret check. Missing/empty server secret = deny all
    // (fail closed) so a misconfigured deploy can't accept anonymous work.
    const provided = req.headers["x-convert-secret"];
    if (!SECRET || provided !== SECRET) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    try {
      const body = await readJson(req);
      const url = typeof body.url === "string" ? body.url : "";
      const ext = typeof body.ext === "string" && ALLOWED_EXT.has(body.ext) ? body.ext : ".pptx";
      if (!url || !/^https:\/\//i.test(url)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing or non-https url" }));
        return;
      }

      const source = await downloadPptx(url);
      const pdf = await convert(source, ".pdf", undefined);

      res.writeHead(200, { "content-type": "application/pdf", "content-length": String(pdf.length) });
      res.end(pdf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "conversion failed";
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
  })();
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[convert] listening on :${PORT}`);
});
