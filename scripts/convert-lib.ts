/**
 * Pure helpers for the document converter (scripts/convert-server.ts).
 * No I/O here — everything is unit-tested in test/pptx-convert.test.ts.
 * Copied into the converter image alongside convert-server.ts (Dockerfile.convert).
 */

export type DeckSignature = "pptx" | "ppt" | "encrypted" | null;

/** Error codes the converter returns. The Next route only passes the message
 *  through for codes in this list; anything else becomes a generic message. */
export type ConvertErrorCode =
  | "busy" | "not_presentation" | "password" | "corrupt" | "unsupported"
  | "timeout" | "too_large" | "source_unavailable" | "upload_failed" | "bad_request" | "failed";

export const CONVERT_MESSAGES: Record<ConvertErrorCode, string> = {
  busy: "The converter is busy — please try again in a moment.",
  not_presentation: "This doesn't look like a PowerPoint file.",
  password: "This presentation is password-protected. Remove the password in PowerPoint, save, and import it again.",
  corrupt: "This PowerPoint file looks damaged or unreadable. Open it in PowerPoint, save a new copy, and try again — or export it as PDF.",
  unsupported: "This presentation uses a format we can't convert. Export it as PDF from PowerPoint and drop that in instead.",
  timeout: "This presentation took too long to convert. Try again, or export it as PDF from PowerPoint and drop that in.",
  too_large: "This PowerPoint is too big to convert (150 MB max). Compress its pictures or export it as PDF.",
  source_unavailable: "We couldn't read the uploaded PowerPoint. Please try importing it again.",
  upload_failed: "The converted slides couldn't be saved. Please try again.",
  bad_request: "We couldn't convert this PowerPoint. Please try again.",
  failed: "We couldn't convert this PowerPoint. Try again, or export it as PDF and drop that in.",
};

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(b: Uint8Array, sig: number[]): boolean {
  if (b.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false;
  return true;
}

function indexOfAscii(b: Uint8Array, s: string): number {
  const n = s.length;
  outer: for (let i = 0; i + n <= b.length; i++) {
    for (let j = 0; j < n; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/** UTF-16LE search (OLE directory entry names are UTF-16LE). */
function indexOfUtf16(b: Uint8Array, s: string): number {
  const n = s.length * 2;
  outer: for (let i = 0; i + n <= b.length; i++) {
    for (let j = 0; j < s.length; j++) {
      if (b[i + j * 2] !== s.charCodeAt(j) || b[i + j * 2 + 1] !== 0) continue outer;
    }
    return i;
  }
  return -1;
}

/** Does an OLE compound file's directory name a "PowerPoint Document" stream?
 *  (A .doc/.xls OLE file does not — its streams are WordDocument / Workbook.)
 *  Cheap byte scan of the head+tail; directory sectors of small .ppt files sit
 *  near the start, big ones may not be in the scanned window, so absence is only
 *  treated as "not a presentation" when a Word/Excel stream name IS present. */
function oleLooksLikeOtherOffice(b: Uint8Array): boolean {
  return indexOfUtf16(b, "WordDocument") >= 0 || indexOfUtf16(b, "Workbook") >= 0;
}

/**
 * Classify a file from its first bytes (`head`) and last bytes (`tail`, which
 * holds the ZIP central directory for an OOXML file).
 *  - "pptx": ZIP ("PK\x03\x04") whose entries include ppt/ (presentation parts)
 *  - "ppt":  legacy OLE compound file (D0 CF 11 E0 …) that is NOT encrypted OOXML
 *  - "encrypted": OLE container carrying an EncryptedPackage (a password-
 *    protected .pptx is stored this way)
 *  - null: anything else (random bytes, a renamed image, a .docx/.xlsx zip…)
 */
export function sniffDeckSignature(head: Uint8Array, tail: Uint8Array = new Uint8Array()): DeckSignature {
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    const hasPpt = (b: Uint8Array) => indexOfAscii(b, "ppt/") >= 0;
    return hasPpt(head) || hasPpt(tail) ? "pptx" : null;
  }
  if (startsWith(head, OLE_MAGIC)) {
    const enc = (b: Uint8Array) => indexOfUtf16(b, "EncryptedPackage") >= 0 || indexOfUtf16(b, "EncryptionInfo") >= 0;
    if (enc(head) || enc(tail)) return "encrypted";
    const ppt = (b: Uint8Array) => indexOfUtf16(b, "PowerPoint Document") >= 0;
    if (ppt(head) || ppt(tail)) return "ppt";
    // No PowerPoint stream seen: reject only if it's clearly Word/Excel; otherwise
    // let LibreOffice decide (its failure maps to a plain "corrupt" message).
    return oleLooksLikeOtherOffice(head) || oleLooksLikeOtherOffice(tail) ? null : "ppt";
  }
  return null;
}

/** Map LibreOffice's exit/stderr to a plain error code — never leak raw stderr. */
export function mapSofficeFailure(stderr: string, producedPdf: boolean): ConvertErrorCode {
  const s = (stderr || "").toLowerCase();
  if (/password|encrypt/.test(s)) return "password";
  if (/no export filter|unsupported|filter.*not found/.test(s)) return "unsupported";
  if (/could not be loaded|source file|general error|i\/o error|format error|corrupt/.test(s)) return "corrupt";
  return producedPdf ? "failed" : "corrupt";
}

/** HTTP status for each code. */
export function statusForCode(code: ConvertErrorCode): number {
  switch (code) {
    case "busy": return 429;
    case "not_presentation": return 415;
    case "password": case "corrupt": case "unsupported": return 422;
    case "timeout": return 504;
    case "too_large": return 413;
    case "bad_request": return 400;
    case "source_unavailable": case "upload_failed": return 502;
    default: return 500;
  }
}

/** http(s) URL check; plain http only when explicitly allowed (local dev). */
export function isAllowedUrl(url: unknown, allowHttp: boolean, allowedHosts: string[] = []): url is string {
  if (typeof url !== "string" || !url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) return false;
  if (allowedHosts.length && !allowedHosts.includes(u.host.toLowerCase())) return false;
  return true;
}

// ── SSRF: IP classification ─────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inV4(ip: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((b & mask) >>> 0);
}

/** Expand an IPv6 literal to 8 hextets (null if not IPv6). Handles embedded IPv4. */
function ipv6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!s.includes(":")) return null;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    if (n === null) return null;
    s = s.slice(0, -v4[1].length) + `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const all = [...head, ...Array(fill).fill("0"), ...tail];
  if (all.length !== 8 || all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}

export type IpClass = "public" | "loopback" | "blocked" | "invalid";

/**
 * Classify a resolved IP for outbound fetches. "loopback" is separated so the
 * CONVERT_ALLOW_HTTP=1 local-dev bypass can permit ONLY loopback; everything
 * else non-public (private, link-local incl. 169.254.169.254 metadata, CGNAT,
 * ULA fc00::/7 incl. Fly 6PN fdaa::/16, fe80::/10, unspecified, multicast…) is
 * "blocked" unconditionally.
 */
export function classifyIp(ip: string): IpClass {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return classifyV4(v4);
  const h = ipv6Hextets(ip);
  if (!h) return "invalid";
  if (h.every((x, i) => (i < 7 ? x === 0 : x === 1))) return "loopback"; // ::1
  if (h.every((x) => x === 0)) return "blocked"; // ::
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d → classify the v4
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    return classifyV4(((h[6] << 16) >>> 0) + h[7]);
  }
  if ((h[0] & 0xfe00) === 0xfc00) return "blocked"; // fc00::/7 (incl. fdaa::/16 Fly 6PN)
  if ((h[0] & 0xffc0) === 0xfe80) return "blocked"; // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return "blocked"; // fec0::/10 site-local (deprecated)
  if ((h[0] & 0xff00) === 0xff00) return "blocked"; // multicast
  if (h[0] === 0x64 && h[1] === 0xff9b) return "blocked"; // NAT64 — could reach v4 internals
  if (h[0] === 0x2002) return "blocked"; // 6to4 embeds arbitrary v4
  return "public";
}

function classifyV4(n: number): IpClass {
  if (inV4(n, "127.0.0.0", 8)) return "loopback";
  const blocked: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["169.254.0.0", 16],
    ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
    ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  return blocked.some(([b, bits]) => inV4(n, b, bits)) ? "blocked" : "public";
}

/** May the converter connect to this resolved address? */
export function isIpAllowed(ip: string, allowHttpDev: boolean): boolean {
  const c = classifyIp(ip);
  return c === "public" || (c === "loopback" && allowHttpDev);
}

// ── Zip-bomb guard (OOXML central directory) ────────────────────────────────

export const ZIP_MAX_TOTAL_UNCOMPRESSED = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
export const ZIP_MAX_ENTRIES = 20_000;
export const ZIP_MAX_RATIO = 1000; // per entry, only judged when the entry is big
const ZIP_RATIO_MIN_BYTES = 10 * 1024 * 1024;

export interface ZipEocd { entries: number; cdSize: number; cdOffset: number }

/** Find the End Of Central Directory record in the file's last bytes. */
export function findZipEocd(tail: Uint8Array, fileSize: number): ZipEocd | null {
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const tailStart = fileSize - tail.byteLength;
  for (let i = tail.byteLength - 22; i >= 0 && i >= tail.byteLength - 22 - 65535; i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue;
    let entries = dv.getUint16(i + 10, true);
    let cdSize = dv.getUint32(i + 12, true);
    let cdOffset = dv.getUint32(i + 16, true);
    // ZIP64: locator sits 20 bytes before the EOCD.
    if ((entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && i >= 20 && dv.getUint32(i - 20, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(i - 20 + 8, true)) - tailStart;
      if (z64 >= 0 && z64 + 56 <= tail.byteLength && dv.getUint32(z64, true) === 0x06064b50) {
        entries = Number(dv.getBigUint64(z64 + 32, true));
        cdSize = Number(dv.getBigUint64(z64 + 40, true));
        cdOffset = Number(dv.getBigUint64(z64 + 48, true));
      }
    }
    if (cdOffset + cdSize > fileSize) return null;
    return { entries, cdSize, cdOffset };
  }
  return null;
}

export type ZipVerdict = { ok: true; entries: number; totalUncompressed: number } | { ok: false; reason: string };

/** Walk the central directory and reject decompression bombs. */
export function checkZipCentralDirectory(cd: Uint8Array, declaredEntries: number): ZipVerdict {
  if (declaredEntries > ZIP_MAX_ENTRIES) return { ok: false, reason: `entries ${declaredEntries}` };
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  let p = 0, n = 0, total = 0;
  while (p + 46 <= cd.byteLength && dv.getUint32(p, true) === 0x02014b50) {
    let comp = dv.getUint32(p + 20, true);
    let uncomp = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    if (comp === 0xffffffff || uncomp === 0xffffffff) {
      // ZIP64 extended info extra field (id 0x0001): uncompressed then compressed.
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end && e + 4 <= cd.byteLength) {
        const id = dv.getUint16(e, true), len = dv.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncomp === 0xffffffff && q + 8 <= cd.byteLength) { uncomp = Number(dv.getBigUint64(q, true)); q += 8; }
          if (comp === 0xffffffff && q + 8 <= cd.byteLength) { comp = Number(dv.getBigUint64(q, true)); }
          break;
        }
        e += 4 + len;
      }
    }
    total += uncomp;
    n++;
    if (n > ZIP_MAX_ENTRIES) return { ok: false, reason: `entries >${ZIP_MAX_ENTRIES}` };
    if (total > ZIP_MAX_TOTAL_UNCOMPRESSED) return { ok: false, reason: `uncompressed ${total}` };
    if (uncomp >= ZIP_RATIO_MIN_BYTES && uncomp / Math.max(comp, 1) > ZIP_MAX_RATIO) return { ok: false, reason: `ratio ${Math.round(uncomp / Math.max(comp, 1))}` };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { ok: true, entries: n, totalUncompressed: total };
}

/** Largest PDF the converter will upload/return. */
export const MAX_OUTPUT_PDF_BYTES = 1024 * 1024 * 1024; // 1 GB
