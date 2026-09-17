/**
 * PresentFlow document converter — a tiny HTTP service deployed to Fly.io that
 * turns a PowerPoint (.pptx/.ppt) into a PDF using headless LibreOffice.
 *
 * WHY this exists: Vercel serverless can't run LibreOffice, and browsers can't
 * render PPTX. So the operator's media import uploads the PPTX to S3, the Next
 * app (/api/pptx/to-pdf) hands us a short-lived presigned URL, we download +
 * convert here. The Next app then reuses its client-side PDF→images path.
 *
 * Two response modes (the Next route supports BOTH, so Vercel and Fly can ship
 * in either order):
 *  - body.outputPutUrl present → we PUT the PDF straight to storage and reply
 *    JSON {ok:true, pdfUploaded:true}. The PDF never transits Vercel (whose
 *    ~4.5MB response cap broke photo-heavy decks).
 *  - absent (legacy caller) → reply with the PDF bytes (application/pdf).
 *
 * Hardening: one conversion per machine (429 "busy" otherwise; Fly's
 * concurrency hard_limit=1 routes the next request to another machine), the
 * source is streamed to a temp file (never fully buffered), its file signature
 * is checked before LibreOffice sees it, each job gets its own LibreOffice
 * profile + temp dir, and a hard timeout kills the whole soffice process tree.
 * Errors are mapped to plain operator messages (scripts/convert-lib.ts) — raw
 * stderr is only logged, never returned.
 *
 * Security model: every /convert call MUST carry CONVERT_SHARED_SECRET in the
 * x-convert-secret header (fail closed). No DB, no S3 credentials — it only
 * touches the exact presigned URLs the trusted Next app gives it.
 */
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, promises as fsp, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CONVERT_MESSAGES, MAX_OUTPUT_PDF_BYTES, checkZipCentralDirectory, findZipEocd, isAllowedUrl, isIpAllowed,
  mapSofficeFailure, sniffDeckSignature, statusForCode, type ConvertErrorCode,
} from "./convert-lib";
import { secretMatches } from "./convert-auth";

const PORT = Number(process.env.CONVERT_PORT || 3002);
const SECRET = process.env.CONVERT_SHARED_SECRET || "";
const SOFFICE = process.env.SOFFICE_PATH || "soffice";
const ALLOW_HTTP = process.env.CONVERT_ALLOW_HTTP === "1"; // local dev only
const MAX_SOURCE_BYTES = 150 * 1024 * 1024; // 150MB — mirrors the presign cap
const DOWNLOAD_TIMEOUT_MS = 60_000;
const CONVERT_TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS || 170_000);
const UPLOAD_TIMEOUT_MS = 90_000;
const ALLOWED_HOSTS = (process.env.CONVERT_ALLOWED_HOSTS || "")
  .split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

class ConvertError extends Error {
  constructor(public code: ConvertErrorCode, detail?: string) { super(detail || code); }
}

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

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, code: ConvertErrorCode) {
  sendJson(res, statusForCode(code), { error: CONVERT_MESSAGES[code], code });
}

/**
 * SSRF guard: resolve the URL's host ONCE, refuse any non-public address
 * (private, loopback, link-local/metadata, CGNAT, ULA incl. Fly 6PN…), and
 * return a `lookup` that PINS the socket to that vetted address — so a DNS
 * rebind between check and connect can't redirect us inside the network.
 * Loopback is allowed only under CONVERT_ALLOW_HTTP=1 (local dev).
 */
async function vetUrl(url: string): Promise<{ u: URL; lookup: LookupFunction }> {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let address: string;
  let family: number;
  if (isIP(host)) {
    address = host; family = isIP(host);
    if (!isIpAllowed(address, ALLOW_HTTP)) throw new ConvertError("bad_request", `blocked ip ${address}`);
  } else {
    let addrs: Array<{ address: string; family: number }>;
    try { addrs = await dnsLookup(host, { all: true, verbatim: true }); }
    catch (e) { throw new ConvertError("source_unavailable", `dns ${String(e)}`); }
    if (!addrs.length || addrs.some((a) => !isIpAllowed(a.address, ALLOW_HTTP))) {
      throw new ConvertError("bad_request", `blocked host ${host} -> ${addrs.map((a) => a.address).join(",")}`);
    }
    ({ address, family } = addrs[0]);
  }
  const lookup = ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    if (opts && opts.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as unknown as LookupFunction;
  return { u, lookup };
}

/** Request a vetted URL with the pinned address. Never follows redirects. */
function pinnedRequest(u: URL, lookup: LookupFunction, opts: RequestOptions, onResponse?: (res: IncomingMessage) => void) {
  const fn = u.protocol === "https:" ? httpsRequest : httpRequest;
  return onResponse ? fn(u, { ...opts, lookup }, onResponse) : fn(u, { ...opts, lookup });
}

/** Stream the presigned source to `dest`, enforcing the size cap mid-stream. */
async function downloadTo(url: string, dest: string, signal: AbortSignal): Promise<number> {
  const { u, lookup } = await vetUrl(url);
  const dlSignal = AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]);
  let res: IncomingMessage;
  try {
    res = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = pinnedRequest(u, lookup, { method: "GET", signal: dlSignal });
      req.on("response", resolve);
      req.on("error", reject);
      req.end();
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ConvertError("source_unavailable", String(e));
  }
  const sc = res.statusCode ?? 0;
  if (sc < 200 || sc >= 300) { res.resume(); throw new ConvertError("source_unavailable", `source fetch ${sc}`); }
  const len = Number(res.headers["content-length"] || 0);
  if (len && len > MAX_SOURCE_BYTES) { res.destroy(); throw new ConvertError("too_large"); }
  let total = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > MAX_SOURCE_BYTES) cb(new ConvertError("too_large"));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(res, cap, createWriteStream(dest), { signal: dlSignal });
  } catch (e) {
    if (e instanceof ConvertError || signal.aborted) throw e;
    throw new ConvertError("source_unavailable", String(e));
  }
  return total;
}

/** Reject ZIP decompression bombs before LibreOffice inflates them. */
async function assertNotZipBomb(path: string, size: number, tail: Uint8Array): Promise<void> {
  const eocd = findZipEocd(tail, size);
  if (!eocd) throw new ConvertError("corrupt", "no zip EOCD");
  if (eocd.cdSize > 64 * 1024 * 1024) throw new ConvertError("corrupt", `central dir ${eocd.cdSize}`);
  const fh = await fsp.open(path, "r");
  try {
    const cd = Buffer.alloc(eocd.cdSize);
    await fh.read(cd, 0, eocd.cdSize, eocd.cdOffset);
    const v = checkZipCentralDirectory(cd, eocd.entries);
    if (!v.ok) throw new ConvertError("corrupt", `zip bomb: ${v.reason}`);
  } finally {
    await fh.close();
  }
}

async function readHeadTail(path: string, size: number): Promise<{ head: Uint8Array; tail: Uint8Array }> {
  const fh = await fsp.open(path, "r");
  try {
    const headLen = Math.min(size, 64 * 1024);
    const head = Buffer.alloc(headLen);
    await fh.read(head, 0, headLen, 0);
    const tailLen = Math.min(size, 1024 * 1024);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    return { head, tail };
  } finally {
    await fh.close();
  }
}

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

/** Run soffice on `input` → PDF in `outDir`. Resolves the PDF path. */
function runSoffice(input: string, outDir: string, profileDir: string, signal: AbortSignal, timeoutMs = CONVERT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      `-env:UserInstallation=file://${profileDir}`,
      "--headless", "--norestore", "--nologo", "--nolockcheck", "--nodefault", "--nofirststartwizard",
      "--convert-to", "pdf", "--outdir", outDir, input,
    ];
    // detached → own process group, so a timeout/cancel can kill soffice.bin too.
    const child = spawn(SOFFICE, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout?.on("data", (d) => { stderr += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    let settled = false;
    const onAbort = () => { killTree(child); finish(() => reject(new DOMException("Aborted", "AbortError"))); };
    const timer = setTimeout(() => { killTree(child); finish(() => reject(new ConvertError("timeout"))); }, timeoutMs);
    // Output cap: a pathological deck can balloon the PDF; stop at MAX_OUTPUT_PDF_BYTES.
    const sizePoll = setInterval(() => {
      void fsp.readdir(outDir).then(async (names) => {
        let sum = 0;
        for (const n of names) sum += (await fsp.stat(join(outDir, n)).catch(() => ({ size: 0 }))).size;
        if (sum > MAX_OUTPUT_PDF_BYTES) { killTree(child); finish(() => reject(new ConvertError("too_large", `pdf ${sum}`))); }
      }).catch(() => {});
    }, 2000);
    function finish(fn: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(sizePoll);
      signal.removeEventListener("abort", onAbort);
      fn();
    }
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => finish(() => reject(new ConvertError("failed", `spawn: ${e.message}`))));
    child.on("close", (code) => {
      const base = input.slice(input.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
      const pdf = join(outDir, `${base}.pdf`);
      const produced = existsSync(pdf);
      finish(() => {
        if (code === 0 && produced) { resolve(pdf); return; }
        console.error(`[convert] soffice exit=${code} produced=${produced} out=${stderr.slice(0, 500)}`);
        reject(new ConvertError(mapSofficeFailure(stderr, produced), stderr));
      });
    });
  });
}

/** PUT the file to a presigned URL with an explicit content-length (S3 rejects chunked PUTs). */
async function putFile(url: string, path: string, signal: AbortSignal): Promise<void> {
  const { size } = await fsp.stat(path);
  const { u, lookup } = await vetUrl(url);
  await new Promise<void>((resolve, reject) => {
    const req = pinnedRequest(u, lookup, {
      method: "PUT",
      headers: { "content-type": "application/pdf", "content-length": String(size) },
      timeout: UPLOAD_TIMEOUT_MS,
      signal,
    }, (res) => {
      res.resume();
      res.on("end", () => {
        const sc = res.statusCode ?? 0;
        if (sc >= 200 && sc < 300) resolve();
        else reject(new ConvertError("upload_failed", `put ${sc}`));
      });
    });
    req.on("timeout", () => req.destroy(new ConvertError("upload_failed", "put timeout")));
    req.on("error", (e) => reject(e instanceof ConvertError || signal.aborted ? e : new ConvertError("upload_failed", e.message)));
    createReadStream(path).on("error", (e) => req.destroy(e)).pipe(req);
  });
}

let busy = false;

async function handleConvert(req: IncomingMessage, res: ServerResponse) {
  // Timing-safe secret check; empty server secret / array header = deny (fail closed).
  if (!secretMatches(req.headers["x-convert-secret"], SECRET)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (busy) { req.resume(); console.log("[convert] busy → 429"); sendError(res, "busy"); return; }
  busy = true;

  const jobId = randomUUID();
  const workDir = join(tmpdir(), `convert-${jobId}`);
  const profileDir = join(tmpdir(), `lo-${jobId}`);
  const ac = new AbortController();
  // The caller hung up (operator cancelled / route timed out) → stop the work.
  res.on("close", () => { if (!res.writableFinished) ac.abort(); });
  const started = Date.now();

  try {
    let body: Record<string, unknown>;
    try { body = await readJson(req); } catch { sendError(res, "bad_request"); return; }
    const url = body.url;
    const outputPutUrl = body.outputPutUrl;
    if (!isAllowedUrl(url, ALLOW_HTTP, ALLOWED_HOSTS)) { sendJson(res, 400, { error: "missing or non-https url", code: "bad_request" }); return; }
    if (outputPutUrl !== undefined && !isAllowedUrl(outputPutUrl, ALLOW_HTTP, ALLOWED_HOSTS)) {
      sendJson(res, 400, { error: "bad outputPutUrl", code: "bad_request" });
      return;
    }
    const requestedExt = body.ext === ".ppt" ? ".ppt" : ".pptx";

    // Vet the output target up front (resolved-IP check) so a bad URL fails fast;
    // putFile re-vets and pins at upload time.
    if (typeof outputPutUrl === "string") await vetUrl(outputPutUrl);
    await fsp.mkdir(workDir, { recursive: true });
    const raw = join(workDir, "source.bin");
    const size = await downloadTo(url, raw, ac.signal);
    if (size === 0) throw new ConvertError("not_presentation");

    const { head, tail } = await readHeadTail(raw, size);
    const sig = sniffDeckSignature(head, tail);
    if (sig === null) throw new ConvertError("not_presentation");
    if (sig === "encrypted") throw new ConvertError("password");
    if (sig === "pptx") await assertNotZipBomb(raw, size, tail);
    // The signature wins over the claimed extension (a renamed .ppt/.pptx still
    // converts); requestedExt only matters if the sniff ever widens.
    const ext = sig === "pptx" ? ".pptx" : sig === "ppt" ? ".ppt" : requestedExt;
    const input = join(workDir, `deck${ext}`);
    await fsp.rename(raw, input);

    const outDir = join(workDir, "out");
    await fsp.mkdir(outDir);
    const pdfPath = await runSoffice(input, outDir, profileDir, ac.signal);
    await fsp.rm(input, { force: true }); // free disk before the upload
    const pdfSize = (await fsp.stat(pdfPath)).size;
    if (pdfSize > MAX_OUTPUT_PDF_BYTES) throw new ConvertError("too_large", `pdf ${pdfSize}`);

    if (typeof outputPutUrl === "string") {
      await putFile(outputPutUrl, pdfPath, ac.signal);
      sendJson(res, 200, { ok: true, pdfUploaded: true, bytes: pdfSize });
    } else {
      res.writeHead(200, { "content-type": "application/pdf", "content-length": String(pdfSize) });
      await pipeline(createReadStream(pdfPath), res);
    }
    console.log(`[convert] ${jobId} ok ${(size / 1048576).toFixed(1)}MB -> ${(pdfSize / 1048576).toFixed(1)}MB pdf in ${((Date.now() - started) / 1000).toFixed(1)}s mode=${typeof outputPutUrl === "string" ? "put" : "bytes"}`);
  } catch (err) {
    if (ac.signal.aborted) {
      console.log(`[convert] ${jobId} cancelled by caller after ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return;
    }
    const code: ConvertErrorCode = err instanceof ConvertError ? err.code : "failed";
    console.error(`[convert] ${jobId} ${code}: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
    sendError(res, code);
  } finally {
    busy = false;
    await Promise.all([
      fsp.rm(workDir, { recursive: true, force: true }).catch(() => {}),
      fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {}),
    ]);
  }
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.method !== "POST" || req.url !== "/convert") {
      res.writeHead(404).end("not found");
      return;
    }
    try { await handleConvert(req, res); }
    catch { sendError(res, "failed"); }
  })();
});

// A conversion can legitimately take minutes with zero bytes on the wire.
server.requestTimeout = 0;

server.listen(PORT, () => {
  console.log(`[convert] listening on :${PORT}`);
  // Warm LibreOffice once in the background (loads binaries + fonts into the
  // page cache) so the first real deck after a cold start is faster. Best-effort.
  // It HOLDS the busy slot (two soffice runs on 2GB is what the slot prevents):
  // a request arriving mid-warm-up gets 429 "busy", which the Next route retries.
  const warm = process.env.CONVERT_WARMUP_FILE || join(__dirname, "convert-warmup.pptx");
  if (process.env.CONVERT_WARMUP !== "0" && existsSync(warm)) {
    busy = true;
    void (async () => {
      const id = `warm-${randomUUID()}`;
      const dir = join(tmpdir(), `convert-${id}`);
      const prof = join(tmpdir(), `lo-${id}`);
      const t = Date.now();
      try {
        await fsp.mkdir(join(dir, "out"), { recursive: true });
        await fsp.copyFile(warm, join(dir, "warm.pptx"));
        await runSoffice(join(dir, "warm.pptx"), join(dir, "out"), prof, new AbortController().signal, 120_000);
        console.log(`[convert] warm-up done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      } catch (e) {
        console.error(`[convert] warm-up failed: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
      } finally {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        await fsp.rm(prof, { recursive: true, force: true }).catch(() => {});
        busy = false;
      }
    })();
  }
});
