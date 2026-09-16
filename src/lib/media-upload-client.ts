/**
 * Browser-side helpers for media uploads that the small-file path doesn't need:
 *   • HEIC/HEIF (iPhone photos) → JPEG, via a LAZY-loaded converter (heic2any
 *     is only downloaded when a HEIC file is actually uploaded).
 *   • S3 multipart for large videos (> MEDIA_MULTIPART_THRESHOLD_BYTES) with
 *     byte progress, per-part retry and abort.
 * Small images/videos keep the original single-PUT path untouched.
 */
import { ALLOWED_VIDEO_MIME, MEDIA_MULTIPART_THRESHOLD_BYTES } from "./media-types";

export function isHeicFile(file: { name: string; type: string }): boolean {
  return /\.(heic|heif)$/i.test(file.name) || file.type === "image/heic" || file.type === "image/heif";
}

/** Convert an iPhone HEIC/HEIF photo to a JPEG File. Throws a friendly error. */
export async function convertHeicToJpeg(file: File): Promise<File> {
  let blob: Blob | Blob[];
  try {
    const { default: heic2any } = await import("heic2any");
    blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  } catch {
    throw new Error("Couldn't convert this iPhone photo — export it as JPG and try again");
  }
  const out = Array.isArray(blob) ? blob[0] : blob; // multi-image HEIC → first frame
  const name = file.name.replace(/\.(heic|heif)$/i, "") + ".jpg";
  return new File([out], name, { type: "image/jpeg", lastModified: file.lastModified });
}

export function shouldUseMultipart(contentType: string, size: number): boolean {
  return (ALLOWED_VIDEO_MIME as readonly string[]).includes(contentType) && size > MEDIA_MULTIPART_THRESHOLD_BYTES;
}

const PART_CONCURRENCY = 3;
const PART_RETRIES = 3;
const SIGN_BATCH = 50;

export const ETAG_CORS_ERROR =
  "Large uploads aren't set up on the storage server yet (it hides upload receipts). Ask your admin to allow the ETag header in storage CORS — or upload a file under 100 MB.";

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
  return json;
}

function putPart(url: string, blob: Blob, onBytes: (loaded: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onBytes(e.loaded); };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) { reject(new Error("Storage upload failed")); return; }
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) { reject(Object.assign(new Error(ETAG_CORS_ERROR), { fatal: true })); return; }
      resolve(etag);
    };
    xhr.onerror = () => reject(new Error("Storage upload failed — check your connection"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal) {
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(blob);
  });
}

/** Multipart upload; resolves to the server-issued key. Aborts server-side on failure. */
export async function uploadMultipart(
  file: File,
  contentType: string,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const { key, uploadId, partSize, parts } = await postJson<{ key: string; uploadId: string; partSize: number; parts: number }>(
    "/api/media/multipart/create", { fileName: file.name, contentType, size: file.size }, signal,
  );
  // One internal controller so a failed part stops the sibling workers too.
  const inner = new AbortController();
  const outer = signal;
  if (outer) outer.addEventListener("abort", () => inner.abort(), { once: true });
  signal = inner.signal;
  const loaded = new Array<number>(parts).fill(0);
  const report = () => onProgress?.(Math.min(0.99, loaded.reduce((a, b) => a + b, 0) / file.size));
  const etags = new Array<string>(parts);
  // Part URLs are signed in batches, lazily, and re-signed if older than 45 min
  // (they expire after 1 h — a slow 5 GB upload can outlive the first batch).
  const batches = new Map<number, { at: number; p: Promise<Record<string, string>> }>();
  const urlFor = async (n: number): Promise<string> => {
    const b = Math.floor((n - 1) / SIGN_BATCH);
    let entry = batches.get(b);
    if (!entry || Date.now() - entry.at > 45 * 60_000) {
      const nums = Array.from({ length: Math.min(SIGN_BATCH, parts - b * SIGN_BATCH) }, (_, i) => b * SIGN_BATCH + i + 1);
      entry = {
        at: Date.now(),
        p: postJson<{ urls: Record<string, string> }>("/api/media/multipart/parts", { key, uploadId, partNumbers: nums }, signal).then((r) => r.urls),
      };
      batches.set(b, entry);
      entry.p.catch(() => batches.delete(b));
    }
    const url = (await entry.p)[String(n)];
    if (!url) throw new Error("Upload failed — couldn't prepare part");
    return url;
  };
  try {
    let next = 1;
    const worker = async () => {
      while (next <= parts) {
        const n = next++;
        const start = (n - 1) * partSize;
        const blob = file.slice(start, Math.min(file.size, start + partSize));
        for (let attempt = 1; ; attempt++) {
          try {
            etags[n - 1] = await putPart(await urlFor(n), blob, (b) => { loaded[n - 1] = b; report(); }, signal);
            loaded[n - 1] = blob.size; report();
            break;
          } catch (e) {
            const err = e as { name?: string; fatal?: boolean };
            if (err.name === "AbortError" || err.fatal || attempt >= PART_RETRIES) throw e;
            loaded[n - 1] = 0;
            await new Promise((r) => setTimeout(r, 800 * attempt));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, parts) }, worker));
    await postJson("/api/media/multipart/complete", {
      key, uploadId, parts: etags.map((etag, i) => ({ partNumber: i + 1, etag })),
    }, signal);
    onProgress?.(1);
    return key;
  } catch (e) {
    inner.abort();
    // Release stored parts (fire-and-forget; not tied to the aborted signal).
    void fetch("/api/media/multipart/abort", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, uploadId }),
    }).catch(() => {});
    throw e;
  }
}
