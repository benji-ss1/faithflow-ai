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
  busy: "The converter is busy with another presentation — trying again.",
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
    return enc(head) || enc(tail) ? "encrypted" : "ppt";
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
