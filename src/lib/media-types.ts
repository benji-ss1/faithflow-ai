/**
 * Media upload type policy — the SINGLE source of truth shared by the presign
 * route, the multipart routes and `registerMediaAsset`. Pure (no DB / S3 / Next
 * imports) so the adversarial tests run offline.
 *
 * Security model: the browser is untrusted. Anything it hands back after an
 * upload (s3Key, mimeType, kind, size) is re-validated here against what the
 * server itself would have issued, and the stored bytes are sniffed
 * (`sniffMediaMime`) before a row is written.
 */

// SVG is DELIBERATELY EXCLUDED — it can carry inline <script> (XSS) and there
// is no server-side sanitize step. HEIC is converted to JPEG in the browser
// before upload, so it never reaches the allowlist.
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
export const ALLOWED_VIDEO_MIME = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const ALLOWED_AUDIO_MIME = ["audio/mpeg", "audio/wav", "audio/mp4", "audio/aac"] as const;
export const ALLOWED_PPTX_MIME = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-powerpoint", // legacy .ppt
] as const;

const MB = 1024 * 1024;
/** Purpose-aware single-PUT caps (server-authoritative). */
export const MAX_BYTES = {
  logo: 2 * MB,
  media: 500 * MB,
  // Matches the Fly converter's MAX_SOURCE_BYTES — keep in lockstep.
  pptx: 150 * MB,
} as const;
/** Large videos go through S3 multipart; this is the hard ceiling. */
export const MEDIA_MULTIPART_MAX_BYTES = 5 * 1024 * MB;
/** Client switches to multipart above this size (videos only). */
export const MEDIA_MULTIPART_THRESHOLD_BYTES = 100 * MB;
/** Part size for multipart uploads (S3 minimum is 5 MB; 10,000 parts max). */
export const MEDIA_MULTIPART_PART_BYTES = 16 * MB;
/** Server thumbnails are skipped for images above this (avoids buffering huge originals in a function). */
export const THUMBNAIL_MAX_SOURCE_BYTES = 25 * MB;
export const MEDIA_MULTIPART_MAX_PARTS = Math.ceil(MEDIA_MULTIPART_MAX_BYTES / MEDIA_MULTIPART_PART_BYTES);

export const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
};

export type MediaKind = "image" | "video" | "audio";
export type UploadPurpose = "logo" | "media" | "pptx";

export function kindForMime(mime: string): MediaKind | null {
  if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)) return "image";
  if ((ALLOWED_VIDEO_MIME as readonly string[]).includes(mime)) return "video";
  if ((ALLOWED_AUDIO_MIME as readonly string[]).includes(mime)) return "audio";
  return null;
}

export function allowedMimesForPurpose(purpose: UploadPurpose): readonly string[] {
  if (purpose === "pptx") return ALLOWED_PPTX_MIME;
  if (purpose === "logo") return ALLOWED_IMAGE_MIME;
  return [...ALLOWED_IMAGE_MIME, ...ALLOWED_VIDEO_MIME, ...ALLOWED_AUDIO_MIME];
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Key the server issues: `${churchId}/${purpose}/${uuid}.${ext}`. */
export function buildUploadKey(churchId: string, purpose: UploadPurpose, uuid: string, contentType: string): string {
  return `${churchId}/${purpose}/${uuid}.${EXT_BY_TYPE[contentType] ?? "bin"}`;
}

/** True iff `key` is exactly a key this church could have been issued for `purpose`. */
export function isChurchUploadKey(key: unknown, churchId: string, purpose: UploadPurpose): key is string {
  if (typeof key !== "string" || !churchId || key.length > 300) return false;
  if (!key.startsWith(`${churchId}/`)) return false;
  const esc = churchId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc}/${purpose}/${UUID}\\.[a-z0-9]{2,5}$`, "i").test(key);
}

/** Per-kind byte ceiling for a registered media asset. */
export function maxBytesForKind(kind: MediaKind): number {
  return kind === "video" ? MEDIA_MULTIPART_MAX_BYTES : MAX_BYTES.media;
}

export type RegistrationInput = { kind: unknown; s3Key: unknown; mimeType: unknown; sizeBytes: unknown; fileName: unknown };
export type RegistrationCheck =
  | { ok: true; kind: MediaKind; s3Key: string; mimeType: string; fileName: string }
  | { ok: false; error: string };

/** Validate the client-supplied fields of `registerMediaAsset` (no I/O). */
export function validateMediaRegistration(input: RegistrationInput, churchId: string): RegistrationCheck {
  const { kind, s3Key, mimeType, fileName } = input;
  if (typeof mimeType !== "string" || typeof kind !== "string") return { ok: false, error: "Unsupported file type" };
  const expected = kindForMime(mimeType);
  if (!expected) return { ok: false, error: "Unsupported file type" };
  if (kind !== expected) return { ok: false, error: "File type doesn't match its kind" };
  if (!isChurchUploadKey(s3Key, churchId, "media")) return { ok: false, error: "Invalid upload reference" };
  // The extension baked into the key must match the claimed MIME (the key's ext
  // was derived server-side from the MIME that was presigned).
  const ext = s3Key.slice(s3Key.lastIndexOf(".") + 1).toLowerCase();
  if (EXT_BY_TYPE[mimeType] !== ext) return { ok: false, error: "File type doesn't match the upload" };
  const name = typeof fileName === "string" ? fileName.trim().slice(0, 255) : "";
  return { ok: true, kind: expected, s3Key, mimeType, fileName: name || "Untitled" };
}

// ── Magic-byte sniffing ───────────────────────────────────────────────────────

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...Array.from(b.subarray(start, Math.min(b.length, start + len))));

/** How many leading bytes the server reads for sniffing (covers ID3-less MP3 padding). */
export const SNIFF_BYTES = 4096;

const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis"];

/** ISO-BMFF `ftyp`: major brand + every compatible brand (offset 16+). */
function ftypBrands(b: Uint8Array): string[] {
  const size = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  const end = Math.min(b.length, size >= 16 && size <= 4096 ? size : 64);
  const brands = [ascii(b, 8, 4)];
  for (let o = 16; o + 4 <= end; o += 4) brands.push(ascii(b, o, 4));
  return brands;
}

/** MPEG audio frame sync (0xFFE, layer != 00) or ADTS at offset i. */
function mpegSyncAt(b: Uint8Array, i: number): "audio/mpeg" | "audio/aac" | null {
  if (i + 1 >= b.length || b[i] !== 0xff) return null;
  if ((b[i + 1] & 0xf6) === 0xf0) return "audio/aac";
  if ((b[i + 1] & 0xe0) === 0xe0 && (b[i + 1] & 0x06) !== 0) return "audio/mpeg";
  return null;
}

/**
 * Identify a file family from its first bytes. Returns a canonical MIME, or
 * null when unrecognised. ISO-BMFF containers (mp4/mov/m4a/avif) are resolved
 * by major + compatible brands.
 */
export function sniffMediaMime(head: Uint8Array): string | null {
  const b = head;
  if (b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "image/png";
  if (ascii(b, 0, 4) === "GIF8") return "image/gif";
  const riff = ascii(b, 0, 4);
  if ((riff === "RIFF" || riff === "RF64" || riff === "BW64") && b.length >= 12) {
    const f = ascii(b, 8, 4);
    if (f === "WEBP" && riff === "RIFF") return "image/webp";
    if (f === "WAVE") return "audio/wav";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (ascii(b, 0, 3) === "ID3" || ascii(b, 0, 8) === "APETAGEX") return "audio/mpeg";
  const sync = mpegSyncAt(b, 0);
  if (sync) return sync;
  if (b.length >= 8) {
    const box = ascii(b, 4, 4);
    if (box === "ftyp" && b.length >= 12) {
      const brands = ftypBrands(b);
      const major = brands[0];
      if (major === "avif" || major === "avis" || ((major === "mif1" || major === "msf1") && brands.some((x) => x === "avif" || x === "avis"))) return "image/avif";
      if (HEIC_BRANDS.includes(major) || major === "mif1" || major === "msf1") return "image/heic";
      if (major === "qt  ") return "video/quicktime";
      if (major === "M4A " || major === "M4B " || major === "M4P ") return "audio/mp4";
      return "video/mp4";
    }
    // MP4/MOV whose first box isn't ftyp (older QuickTime, some encoders).
    if (["moov", "mdat", "wide", "free", "skip", "pnot", "uuid"].includes(box)) return "video/quicktime";
  }
  // MP3 with leading zero padding before the first frame.
  let i = 0;
  while (i < b.length && i < 2048 && b[i] === 0) i++;
  if (i > 0 && mpegSyncAt(b, i) === "audio/mpeg") return "audio/mpeg";
  return null;
}

/** Bytes that must never be stored as media, whatever the claim (XSS / archives / executables). */
export function looksDangerous(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  let s = ascii(head, 0, 512);
  if (s.charCodeAt(0) === 0xef && s.charCodeAt(1) === 0xbb && s.charCodeAt(2) === 0xbf) s = s.slice(3);
  const t = s.replace(/^[\s\u0000]+/, "").toLowerCase();
  if (t.startsWith("<")) return true; // html / svg / xml / script
  if (t.startsWith("#!")) return true;
  if (s.startsWith("%PDF") || s.startsWith("PK\u0003\u0004") || s.startsWith("MZ") || s.startsWith("\u007fELF")) return true;
  // Markup hidden after a media-looking prefix (e.g. "ID3" + HTML): scan the
  // whole sniffed head for document/script markers.
  const all = ascii(head, 0, head.length).toLowerCase();
  if (/<(?:!doctype|html|script|svg|body|iframe|object|embed)[\s>/]/.test(all)) return true;
  return false;
}

const ISO_BMFF = new Set(["video/mp4", "video/quicktime", "audio/mp4"]);

export type StoredBytesCheck = { ok: true; mimeType: string } | { ok: false };

/**
 * Do the stored bytes plausibly belong to the claimed KIND? Tolerant of the
 * renames real users do (PNG saved as .jpg, webm↔mp4, .m4a named .aac …):
 * any allowed type of the SAME kind passes and the SNIFFED mime is recorded.
 * Rejected: a different kind, non-media/dangerous bytes, HEIC (should have been
 * converted), or unrecognised bytes claimed as an image.
 */
export function checkStoredBytes(head: Uint8Array, claimed: string): StoredBytesCheck {
  const claimedKind = kindForMime(claimed);
  if (!claimedKind || head.length === 0) return { ok: false };
  if (looksDangerous(head)) return { ok: false };
  const sniffed = sniffMediaMime(head);
  if (!sniffed) return claimedKind === "image" ? { ok: false } : { ok: true, mimeType: claimed };
  // ISO-BMFF brands are loose: an m4a can carry an mp4 brand and vice versa.
  if (ISO_BMFF.has(sniffed) && (claimedKind === "video" || claimedKind === "audio")) {
    if (ISO_BMFF.has(claimed)) return { ok: true, mimeType: claimed };
    return claimedKind === "video" ? { ok: true, mimeType: sniffed === "audio/mp4" ? "video/mp4" : sniffed } : { ok: true, mimeType: "audio/mp4" };
  }
  const sniffedKind = kindForMime(sniffed);
  if (!sniffedKind || sniffedKind !== claimedKind) return { ok: false };
  return { ok: true, mimeType: sniffed };
}

/** Do the stored bytes plausibly match the claimed MIME (same kind)? */
export function magicMatchesMime(head: Uint8Array, claimed: string): boolean {
  return checkStoredBytes(head, claimed).ok;
}

// ── Post-upload verification (S3 layer injected so it's testable) ─────────────

export type ObjectProbe = {
  /** Resolves null ONLY when the object does not exist; THROWS on any other error. */
  head: (key: string) => Promise<{ size: number; contentType?: string } | null>;
  /** THROWS (or resolves null) when the bytes could not be read. */
  readHead: (key: string, bytes: number) => Promise<Uint8Array | null>;
  remove: (key: string) => Promise<void>;
  /** True when any media row already references the key — such an object is never deleted. */
  isReferenced?: (key: string) => Promise<boolean>;
};

export type VerifyResult =
  | { ok: true; sizeBytes: number; mimeType: string }
  | { ok: false; error: string; retryable?: boolean };

const RETRY_ERROR = "Couldn't check the upload just now — please try again";

/**
 * Confirm the uploaded object exists, is within the per-kind cap and really is
 * the claimed kind. The object is DELETED (best-effort) only on a DEFINITE
 * failure (bytes were read and are wrong, or the real size is out of bounds) and
 * never when a row references it. A storage/read error keeps the object and
 * returns a retryable error.
 */
export async function verifyUploadedObject(key: string, mimeType: string, kind: MediaKind, probe: ObjectProbe): Promise<VerifyResult> {
  const reject = async (error: string): Promise<VerifyResult> => {
    const referenced = probe.isReferenced ? await probe.isReferenced(key).catch(() => true) : false;
    if (!referenced) await probe.remove(key).catch(() => {});
    return { ok: false, error };
  };
  let meta: { size: number; contentType?: string } | null;
  try {
    meta = await probe.head(key);
  } catch {
    return { ok: false, error: RETRY_ERROR, retryable: true };
  }
  if (!meta) return { ok: false, error: "Upload not found — please try again" };
  const cap = maxBytesForKind(kind);
  if (meta.size <= 0) return reject("The uploaded file is empty");
  if (meta.size > cap) return reject(`File too large — max ${Math.round(cap / MB)} MB`);
  let head: Uint8Array | null;
  try {
    head = await probe.readHead(key, SNIFF_BYTES);
  } catch {
    head = null;
  }
  if (!head || head.length === 0) return { ok: false, error: RETRY_ERROR, retryable: true };
  const check = checkStoredBytes(head, mimeType);
  if (!check.ok) return reject("That file isn't really the type it says it is — it wasn't added");
  return { ok: true, sizeBytes: meta.size, mimeType: check.mimeType };
}

// ── Multipart request validation ──────────────────────────────────────────────

export function validateMultipartCreate(body: { contentType?: unknown; size?: unknown }):
  | { ok: true; contentType: string; size: number; parts: number }
  | { ok: false; error: string } {
  const { contentType, size } = body;
  if (typeof contentType !== "string" || typeof size !== "number" || !Number.isFinite(size)) return { ok: false, error: "Bad request" };
  if (!(ALLOWED_VIDEO_MIME as readonly string[]).includes(contentType)) return { ok: false, error: "Only videos can use large uploads" };
  if (size <= 0) return { ok: false, error: "Empty file" };
  if (size > MEDIA_MULTIPART_MAX_BYTES) return { ok: false, error: `File too large — max ${Math.round(MEDIA_MULTIPART_MAX_BYTES / MB)} MB` };
  return { ok: true, contentType, size, parts: Math.max(1, Math.ceil(size / MEDIA_MULTIPART_PART_BYTES)) };
}

export function validatePartNumbers(nums: unknown): number[] | null {
  if (!Array.isArray(nums) || nums.length === 0 || nums.length > 100) return null;
  const out: number[] = [];
  for (const n of nums) {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MEDIA_MULTIPART_MAX_PARTS) return null;
    out.push(n);
  }
  return out;
}

export function validateCompletedParts(parts: unknown): { PartNumber: number; ETag: string }[] | null {
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > MEDIA_MULTIPART_MAX_PARTS) return null;
  const out: { PartNumber: number; ETag: string }[] = [];
  let prev = 0;
  for (const p of parts) {
    const n = (p as { partNumber?: unknown })?.partNumber;
    const e = (p as { etag?: unknown })?.etag;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= prev || n > MEDIA_MULTIPART_MAX_PARTS) return null;
    if (typeof e !== "string" || !/^"?[A-Za-z0-9-]{1,128}"?$/.test(e)) return null;
    out.push({ PartNumber: n, ETag: e });
    prev = n;
  }
  return out;
}

/** Upload ids are opaque provider strings; bound them so they're safe to forward. */
export function isPlausibleUploadId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 1024 && /^[A-Za-z0-9._~+/=-]+$/.test(id);
}
