/**
 * OS file drop → Media Bin (Finder / Explorer drag-in).
 *
 * The Media Bin already EMITS an in-app drag (`application/x-pf-library-item`)
 * that slides / playlist / library consume. This module is the other direction:
 * real files dragged in from the operating system. It is the single, pure,
 * test-locked source of:
 *   • is this drag OS files (and NOT one of our in-app drags)?  → `isOsFileDrag`
 *   • what is each dropped file, and how is it imported?        → `classifyDroppedFile`
 *
 * Classification is EXTENSION-FIRST with MIME as a fallback: Windows (and some
 * macOS sources) report `file.type === ""` for .mov/.mp3/.pptx, which used to
 * get perfectly good files rejected. The returned `contentType` is the canonical
 * MIME the presign allowlist expects, so an empty OS type can still upload.
 *
 * Routing:
 *   image / video   → uploaded straight into the bin (inline placeholder tiles)
 *   deck / pro      → the existing MediaImportWizard (PPTX→PDF→slide images,
 *                     PDF→slide images, ProPresenter→songs) — unchanged pipeline
 *   audio (mp3/wav/m4a/aac) → uploaded into the bin as an audio tile (server
 *                     gates it until the media_kind migration is applied)
 *   heic / heif     → "image": converted to JPEG in the browser, then uploaded
 *   other audio     → honest "use MP3/WAV/M4A/AAC" message
 *   unsupported     → honest message, never a silent no-op
 */
import { classifyDrop } from "./spring-load";

export const MEDIA_BIN_MAX_BYTES = 500 * 1024 * 1024; // mirrors /api/media/presign "media" cap (images, audio)
/** Videos over ~100 MB upload in parts (S3 multipart) — mirrors MEDIA_MULTIPART_MAX_BYTES. */
export const MEDIA_BIN_VIDEO_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const MEDIA_BIN_DECK_MAX_BYTES = 150 * 1024 * 1024; // mirrors presign "pptx" cap
/** Cap how many files a single drop (incl. folder expansion) may enqueue. */
export const MEDIA_BIN_MAX_FILES = 200;
/** Concurrent inline uploads — keeps a live-service machine responsive. */
export const MEDIA_BIN_UPLOAD_CONCURRENCY = 3;

export type DroppedFileRoute =
  | { route: "image"; contentType: string; heic?: true }
  | { route: "video"; contentType: string }
  | { route: "audio"; contentType: string }
  | { route: "audio-format" }
  | { route: "deck" }
  | { route: "pro" }
  | { route: "empty" }
  | { route: "too-large"; limitMb: number }
  | { route: "unsupported" };

const IMAGE_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", avif: "image/avif",
};
const VIDEO_EXT: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};
const IMAGE_MIME = new Set(Object.values(IMAGE_EXT));
const VIDEO_MIME = new Set(Object.values(VIDEO_EXT));
const DECK_EXT = new Set(["pptx", "ppt", "pdf"]);
const PRO_EXT = new Set(["pro", "pro5", "pro6", "pro7", "pro7x"]);
const AUDIO_EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac" };
const AUDIO_MIME_ALIASES: Record<string, string> = {
  "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav", "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/aac": "audio/aac",
};
const OTHER_AUDIO_EXT = new Set(["flac", "ogg", "oga", "aif", "aiff", "wma", "opus"]);
const HEIC_EXT = new Set(["heic", "heif"]);

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * True iff a drag carries real OS files and is NOT one of our in-app drags.
 * In-app library/media drags must keep flowing to their existing targets.
 */
export function isOsFileDrag(types: readonly string[] | undefined | null): boolean {
  return classifyDrop(types) === "os-files";
}

/** Decide how one dropped file is imported. Pure + total. */
export function classifyDroppedFile(file: { name: string; type: string; size: number }): DroppedFileRoute {
  const ext = fileExtension(file.name);
  const mime = (file.type || "").toLowerCase();

  if (DECK_EXT.has(ext) || mime === "application/pdf") {
    if (file.size === 0) return { route: "empty" };
    const isPpt = ext === "pptx" || ext === "ppt";
    if (isPpt && file.size > MEDIA_BIN_DECK_MAX_BYTES) return { route: "too-large", limitMb: 150 };
    return { route: "deck" };
  }
  if (PRO_EXT.has(ext)) return file.size === 0 ? { route: "empty" } : { route: "pro" };
  if (HEIC_EXT.has(ext) || mime === "image/heic" || mime === "image/heif") {
    if (file.size === 0) return { route: "empty" };
    if (file.size > MEDIA_BIN_MAX_BYTES) return { route: "too-large", limitMb: 500 };
    return { route: "image", contentType: "image/jpeg", heic: true }; // converted before upload
  }
  const audioType = AUDIO_EXT[ext] ?? (ext ? undefined : AUDIO_MIME_ALIASES[mime]);
  if (audioType) {
    if (file.size === 0) return { route: "empty" };
    if (file.size > MEDIA_BIN_MAX_BYTES) return { route: "too-large", limitMb: 500 };
    return { route: "audio", contentType: audioType };
  }
  if (OTHER_AUDIO_EXT.has(ext) || mime.startsWith("audio/")) return { route: "audio-format" };

  const imageType = IMAGE_EXT[ext] ?? (IMAGE_MIME.has(mime) ? mime : undefined);
  const videoType = imageType ? undefined : VIDEO_EXT[ext] ?? (VIDEO_MIME.has(mime) ? mime : undefined);
  if (!imageType && !videoType) return { route: "unsupported" };
  if (file.size === 0) return { route: "empty" };
  if (imageType) return file.size > MEDIA_BIN_MAX_BYTES ? { route: "too-large", limitMb: 500 } : { route: "image", contentType: imageType };
  return file.size > MEDIA_BIN_VIDEO_MAX_BYTES ? { route: "too-large", limitMb: 5120 } : { route: "video", contentType: videoType! };
}

/** Human summary for the files a drop could not import (grouped, one toast). */
export function skippedSummary(skipped: Array<{ name: string; route: DroppedFileRoute["route"] }>): string | null {
  if (skipped.length === 0) return null;
  const by = (r: string) => skipped.filter((s) => s.route === r);
  const parts: string[] = [];
  const list = (xs: typeof skipped) => (xs.length === 1 ? `“${xs[0].name}”` : `${xs.length} files`);
  if (by("audio").length) parts.push(`${list(by("audio"))}: audio in the Media Bin is coming soon`);
  if (by("audio-format").length) parts.push(`${list(by("audio-format"))}: that audio format isn't supported — use MP3, WAV, M4A or AAC`);
  if (by("too-large").length) parts.push(`${list(by("too-large"))}: too large (video 5 GB, images and audio 500 MB, PowerPoint 150 MB)`);
  if (by("empty").length) parts.push(`${list(by("empty"))}: empty file`);
  if (by("unsupported").length) parts.push(`${list(by("unsupported"))}: not a supported type`);
  return parts.join(" · ");
}

// ── DOM helper: expand a drop (incl. folders) into Files ─────────────────────
// Kept out of the pure core above; exercised in the browser flow test.

type FsEntry = {
  isFile: boolean; isDirectory: boolean; name: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void };
};

/** True when a drag/drop lands on a native <input type="file"> (leave it alone). */
export function isFileInputTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; type?: string } | null;
  return !!el && typeof el.tagName === "string" && el.tagName.toUpperCase() === "INPUT" && (el.type ?? "").toLowerCase() === "file";
}

/**
 * Collect files from a drop. Entries MUST be grabbed synchronously inside the
 * drop handler (DataTransfer is neutered after the event), so call this
 * directly from onDrop. Folders are walked (depth ≤ 4, `readEntries` looped —
 * Chromium returns ≤100 per call); hidden dotfiles skipped; capped at `max`.
 */
export async function collectDroppedFiles(dt: DataTransfer, max = MEDIA_BIN_MAX_FILES): Promise<{ files: File[]; truncated: boolean }> {
  const items = dt.items ? Array.from(dt.items) : [];
  const entries: FsEntry[] = [];
  for (const it of items) {
    if (it.kind !== "file") continue;
    const entry = (it as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  // No entry API (or a virtual file, e.g. an Outlook attachment) → plain files.
  const plain = Array.from(dt.files ?? []);
  if (entries.length === 0) return { files: plain.slice(0, max), truncated: plain.length > max };
  let truncated = false;

  const out: File[] = [];
  const walk = async (e: FsEntry, depth: number): Promise<void> => {
    if (e.name.startsWith(".")) return;
    if (out.length >= max) { truncated = true; return; }
    if (e.isFile && e.file) {
      const f = await new Promise<File | null>((res) => e.file!(res, () => res(null)));
      if (f) out.push(f);
      return;
    }
    if (e.isDirectory && e.createReader && depth < 4) {
      const reader = e.createReader();
      for (;;) {
        const batch = await new Promise<FsEntry[]>((res) => reader.readEntries(res, () => res([])));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, depth + 1);
        if (out.length >= max) break;
      }
    }
  };
  for (const e of entries) await walk(e, 0);
  // Entry read failed for everything (sandboxed/virtual source) → fall back.
  if (out.length > 0) return { files: out, truncated };
  // Entries unreadable (virtual/sandboxed source) → plain list, minus folders
  // (a directory surfaces in dt.files as a 0-byte entry with no type).
  const usable = plain.filter((f) => !(f.size === 0 && !f.type && !/\.[a-z0-9]+$/i.test(f.name)));
  return { files: usable.slice(0, max), truncated: usable.length > max };
}
