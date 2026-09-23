"use client";
/**
 * MediaImportWizard — 4-step modal wizard for importing media and ProPresenter files.
 *
 * Step 1  SELECT   — Drop zone; accepts images, videos, AND .pro6/.pro7/.pro5
 * Step 2  PREVIEW  — Thumbnail grid (images/videos) + list (ProPresenter files)
 * Step 3  UPLOAD   — Dual-path: media → presign→S3→register; ProPresenter → parse API→finalize
 * Step 4  DONE     — Combined success summary
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2, Upload, X, FileImage, FileVideo, AlertCircle, Presentation, FolderOpen, Music, AlertTriangle,
} from "lucide-react";
import { isDuplicateUpload, notifyMediaChanged } from "@/lib/media-sync";
import { toast } from "sonner";
import { probeVideoCodec, uploadCodecWarning, CODEC_PROBE_BYTES } from "@/lib/video-codec";
import { cn } from "@/lib/utils";
import { registerMediaAsset } from "@/lib/actions";
import { isPdfFile, renderPdfToImages } from "@/lib/pdf-to-images";
import { CONVERT_CLIENT_TIMEOUT_MS, PPTX_MAX_BYTES, deckStageLabel, isDeckOnlyQueue, responseKind, type DeckStage } from "@/lib/pptx-import";
import { finalizeImport } from "@/lib/import-actions";
import { classifyDroppedFile, MEDIA_BIN_MAX_BYTES, type DroppedFileRoute } from "@/lib/media-bin-drop";
import { cachedAudioSupport, convertHeicToJpeg, isHeicFile, loadMediaCapabilities, shouldUseMultipart, uploadMultipart } from "@/lib/media-upload-client";

// Re-export Pencil for MediaBrowser without a separate import
export { Pencil } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const PRO_EXTENSIONS = [".pro6", ".pro7", ".pro7x", ".pro5", ".pro"];
// Videos can be up to 5 GB (large ones upload in parts); everything else 500 MB.
const MAX_FILE_SIZE_MB = 5120;

/** Read the header, and if the video is HEVC tell the operator what it means
 *  for a Windows machine. Best-effort: any failure is silent — a codec probe
 *  must never stop someone uploading. */
async function warnIfHevc(file: File): Promise<void> {
  try {
    const head = new Uint8Array(await file.slice(0, CODEC_PROBE_BYTES).arrayBuffer());
    const warning = uploadCodecWarning(probeVideoCodec(head));
    if (warning) toast.warning(`"${file.name}": ${warning}`, { duration: 12000 });
  } catch { /* probe is advisory only */ }
}
const MAX_NON_VIDEO_SIZE_MB = 500;

function isProFile(file: File): boolean {
  const n = file.name.toLowerCase();
  return PRO_EXTENSIONS.some((ext) => n.endsWith(ext));
}

/**
 * Upload ONE media file: presign → S3 PUT → registerMediaAsset. Shared by the
 * normal media path and each rendered deck page (B2), so there is one upload
 * path, not two divergent copies. Throws on any failure.
 */
export async function uploadMediaFile(
  file: File,
  signal?: AbortSignal,
  libraryId?: string | null,
  // Media Bin OS drop: `contentType` overrides an empty/unreliable OS file.type
  // (Windows .mov); `onProgress` switches the PUT to XHR for byte progress.
  // Both optional — existing wizard callers are byte-identical.
  opts?: { contentType?: string; onProgress?: (fraction: number) => void; /** true while a slide is live → large uploads send one part at a time */ isLive?: () => boolean },
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  // iPhone HEIC/HEIF → JPEG in the browser first (converter lazy-loaded only here).
  if (isHeicFile(file)) {
    file = await convertHeicToJpeg(file);
    opts = { ...opts, contentType: "image/jpeg" };
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }
  const contentType = opts?.contentType || file.type;
  let key: string;
  if (shouldUseMultipart(contentType, file.size)) {
    // Large video (>100 MB): S3 multipart with progress + abort.
    key = await uploadMultipart(file, contentType, signal, opts?.onProgress, opts?.isLive);
  } else {
    // Small-file path — unchanged.
    const presignRes = await fetch("/api/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentType, size: file.size, purpose: "media" }),
      signal,
    });
    if (!presignRes.ok) {
      const err = (await presignRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Presign failed (${presignRes.status})`);
    }
    const presigned = (await presignRes.json()) as { url: string; key: string };
    key = presigned.key;
    if (opts?.onProgress) {
      await putWithProgress(presigned.url, file, contentType, opts.onProgress, signal);
    } else {
      const uploadRes = await fetch(presigned.url, { method: "PUT", headers: { "Content-Type": contentType }, body: file, signal });
      if (!uploadRes.ok) throw new Error("Storage upload failed");
    }
  }
  const kind = contentType.startsWith("video") ? ("video" as const) : contentType.startsWith("audio") ? ("audio" as const) : ("image" as const);
  const result = await registerMediaAsset({ kind, fileName: file.name, s3Key: key, mimeType: contentType, sizeBytes: file.size, libraryId });
  if (!result?.ok) throw new Error((result as { error?: string } | undefined)?.error ?? "Registration failed");
}

/** PUT via XHR so upload byte progress is observable (fetch can't report it). */
function putWithProgress(url: string, file: File, contentType: string, onProgress: (f: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Storage upload failed")));
    xhr.onerror = () => reject(new Error("Storage upload failed — check your connection"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal) {
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

/** True if the file is a PowerPoint we convert (server-side) to a PDF, then
 *  reuse the PDF→images deck path. Extension-based: browsers report office
 *  MIME types inconsistently (often "" for .pptx). */
function isPptxFile(file: { name: string }): boolean {
  return /\.pptx?$/i.test(file.name);
}

/** Best-effort delete of a temp PowerPoint/PDF object (church-scoped server-side). */
function deletePptxTemp(key: string): void {
  void fetch("/api/pptx/to-pdf", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
    keepalive: true,
  }).catch(() => {});
}

/** A signal that aborts when `signal` does OR after `ms` (tagged so we can tell them apart). */
function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; timedOut: () => boolean; clear: () => void } {
  const ac = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ac.abort(); }, ms);
  const onAbort = () => ac.abort();
  if (signal?.aborted) ac.abort(); else signal?.addEventListener("abort", onAbort, { once: true });
  return { signal: ac.signal, timedOut: () => timedOut, clear: () => { clearTimeout(t); signal?.removeEventListener("abort", onAbort); } };
}

/** What renderPdfToImages needs: a name and the bytes (read ONCE). */
type PdfSource = Pick<File, "name" | "arrayBuffer">;

/**
 * Convert a PowerPoint to a PDF via the server (LibreOffice on Fly): upload the
 * PPTX to S3 (with byte progress), ask /api/pptx/to-pdf to convert it, then get
 * the PDF — either from storage via the returned `pdfUrl` (new converter; the
 * PDF never passes through Vercel) or as the response body (older converter).
 * The caller feeds the result into the SAME renderPdfToImages deck path. Throws
 * with a clear, operator-facing message; AbortError when cancelled.
 */
async function convertPptxToPdf(file: File, signal: AbortSignal, onStage: (s: DeckStage) => void): Promise<PdfSource> {
  const isLegacy = /\.ppt$/i.test(file.name);
  const ext = isLegacy ? ".ppt" : ".pptx";
  // Send a CANONICAL office contentType by extension — file.type is unreliable
  // for office docs and the presign allowlist checks the MIME.
  const contentType = isLegacy
    ? "application/vnd.ms-powerpoint"
    : "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  onStage({ kind: "upload-source", fraction: 0 });
  const presignRes = await fetch("/api/media/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType, size: file.size, purpose: "pptx" }),
    signal,
  });
  if (!presignRes.ok) {
    const err = (await presignRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Presign failed (${presignRes.status})`);
  }
  const { url: uploadUrl, key } = (await presignRes.json()) as { url: string; key: string };
  try {
    await putWithProgress(uploadUrl, file, contentType, (f) => onStage({ kind: "upload-source", fraction: f }), signal);

    // Conversion: tick an elapsed timer so a long convert never looks frozen.
    const t0 = Date.now();
    onStage({ kind: "convert", elapsedSec: 0 });
    const tick = setInterval(() => onStage({ kind: "convert", elapsedSec: (Date.now() - t0) / 1000 }), 1000);
    const to = withTimeout(signal, CONVERT_CLIENT_TIMEOUT_MS);
    let convRes: Response;
    try {
      convRes = await fetch("/api/pptx/to-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, ext }),
        signal: to.signal,
      });
    } catch (e) {
      if (to.timedOut()) throw new Error("This presentation took too long to convert. Try again, or export it as PDF from PowerPoint and drop that in.");
      throw e;
    } finally {
      clearInterval(tick);
      to.clear();
    }
    if (!convRes.ok) {
      const err = (await convRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Conversion failed (${convRes.status})`);
    }

    const pdfName = file.name.replace(/\.pptx?$/i, ".pdf");
    let buf: ArrayBuffer;
    if (responseKind(convRes.headers.get("content-type")) === "pdf") {
      // Older converter: the PDF came back in the response body.
      buf = await convRes.arrayBuffer();
    } else {
      const { pdfUrl, key: pdfKey } = (await convRes.json()) as { pdfUrl?: string; key?: string };
      if (!pdfUrl || !pdfKey) throw new Error("Conversion failed — please try again.");
      onStage({ kind: "download-pdf" });
      try {
        const pdfRes = await fetch(pdfUrl, { signal });
        if (!pdfRes.ok) throw new Error("Couldn't download the converted slides — please try again.");
        buf = await pdfRes.arrayBuffer();
      } finally {
        deletePptxTemp(pdfKey); // fetched (or failed) — the temp PDF is no longer needed
      }
    }
    // Hand the bytes over exactly once; pdf.js takes ownership of the buffer.
    let once: ArrayBuffer | null = buf;
    return {
      name: pdfName,
      arrayBuffer: async () => {
        if (!once) throw new Error("PDF already consumed");
        const b = once; once = null; return b;
      },
    };
  } catch (e) {
    // Cancelled/failed → make sure the uploaded source is gone (the server also
    // deletes it once conversion was requested; a second delete is harmless).
    deletePptxTemp(key);
    throw e;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadStatus = "pending" | "uploading" | "done" | "error" | "skipped";

interface QueuedMedia {
  tag: "media";
  key: string;
  file: File;
  previewUrl: string | null; // object URL for images
  status: UploadStatus;
  error?: string;
  deck?: boolean;        // PDF/PPTX deck → expand to page images on upload (B2)
  pptx?: boolean;        // PowerPoint → convert to PDF (server) FIRST, then deck
  progress?: string;     // e.g. "3/12" while rendering deck pages
  contentType?: string;  // canonical MIME when the OS type is empty/unreliable (audio, HEIC→JPEG)
}

interface QueuedPro {
  tag: "pro";
  key: string;
  file: File;
  status: UploadStatus;
  error?: string;
  songsImported?: number;
}

type QueuedFile = QueuedMedia | QueuedPro;

type Step = 1 | 2 | 3 | 4;

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: "Select" },
  { n: 2, label: "Preview" },
  { n: 3, label: "Upload" },
  { n: 4, label: "Done" },
] as const;

function StepBar({ step }: { step: Step }) {
  return (
    <ol className="flex items-center gap-2 text-xs mb-5">
      {STEPS.map((s, i) => (
        <li key={s.n} className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-full px-2.5 font-medium",
              step === s.n
                ? "bg-[var(--color-brand)] text-black"
                : step > s.n
                  ? "bg-[var(--color-brand)]/20 text-[var(--color-brand)]"
                  : "bg-white/10 text-[var(--color-muted-foreground)]",
            )}
          >
            {step > s.n ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <span className="text-[var(--color-muted-foreground)]">→</span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ── Main wizard ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  // Wave 3 (item 4c): when opened by an OS-file drop onto a Library row, the
  // dropped files are pre-queued and this library is preselected as the target.
  initialFiles?: File[];
  initialLibraryId?: string | null;
  // Only the Media Bin passes this: decks DROPPED there start importing straight
  // away. Every other opener (Media browser, Songs panel) and the wizard's own
  // drop zone keep the manual Preview → Import flow.
  autoStartDecks?: boolean;
}

export function MediaImportWizard({ open, onClose, onImported, initialFiles, initialLibraryId = null, autoStartDecks = false }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [doneMedia, setDoneMedia] = useState(0);
  const [doneSongs, setDoneSongs] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const deckAbortRef = useRef<AbortController | null>(null); // cancels an in-flight deck render on close
  const cancelRef = useRef(false); // operator pressed Cancel during an import
  // Set when files arrive by DROP (onto the wizard or the Media Bin): if every
  // queued file is a slide deck, the import starts straight away (no Preview /
  // Import clicks). Browse-picked files and mixed queues keep the manual flow.
  const autoStartRef = useRef(false);

  // Audio-enabled check (cached) so audio is routed before any upload.
  useEffect(() => { if (open) void loadMediaCapabilities(); }, [open]);
  // 2026-09-23 "never have duplicates": the library as it stands, so a file
  // that's already in Media (same type + name + size) is flagged and SKIPPED
  // by default — the operator can still tick "Import anyway".
  const [existing, setExisting] = useState<Array<{ fileName: string; kind: string; sizeBytes: number }>>([]);
  const [allowDup, setAllowDup] = useState<Set<string>>(new Set());
  const [doneSkipped, setDoneSkipped] = useState(0);
  const [existingTick, setExistingTick] = useState(0); // re-pull after an upload ("Import more")
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/media/list", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { assets: [] }))
      .then((j: { assets?: Array<{ fileName: string; kind: string; sizeBytes: number }> }) => { if (live) setExisting(Array.isArray(j?.assets) ? j.assets : []); })
      .catch(() => { /* fail-open: no dup flags, upload still works */ });
    return () => { live = false; };
  }, [open, existingTick]);
  const isDupItem = (q: QueuedFile) => q.tag === "media" && !q.deck && isDuplicateUpload(q.file, existing);

  // Reset on close
  useEffect(() => {
    if (!open) {
      autoStartRef.current = false;
      cancelRef.current = true;
      deckAbortRef.current?.abort(); // stop any in-flight deck render/upload
      setTimeout(() => {
        setStep(1);
        setQueue((prev) => {
          prev.forEach((q) => { if (q.tag === "media" && q.previewUrl) URL.revokeObjectURL(q.previewUrl); });
          return [];
        });
        setUploading(false);
        setDoneMedia(0);
        setDoneSongs(0);
        setErrorCount(0);
        setDoneSkipped(0);
        setAllowDup(new Set());
        setDragOver(false);
      }, 200);
    }
  }, [open]);

  // Revoke URLs on unmount
  useEffect(() => {
    return () => {
      queue.forEach((q) => { if (q.tag === "media" && q.previewUrl) URL.revokeObjectURL(q.previewUrl); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Queue management ────────────────────────────────────────────────────────

  const enqueueFiles = useCallback((incoming: File[], opts?: { autoStart?: boolean }) => {
    const valid: QueuedFile[] = [];
    for (const file of incoming) {
      let routed: DroppedFileRoute;
      // Non-video files keep the 500 MB cap; videos may be up to 5 GB (multipart).
      const isVideoFile = ALLOWED_VIDEO_TYPES.includes(file.type) || /\.(mp4|m4v|webm|mov)$/i.test(file.name);
      if (!isVideoFile && file.size > MAX_NON_VIDEO_SIZE_MB * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds ${MAX_NON_VIDEO_SIZE_MB} MB — skipped.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds ${MAX_FILE_SIZE_MB} MB — skipped.`);
        continue;
      }
      // Skip empty (0-byte) files with an honest note — an empty upload would
      // presign + PUT a valid-looking-but-broken asset. (MIME magic-byte
      // sniffing for content/extension mismatch is a deeper check, deferred —
      // see DECOUPLING_PLAN deferred log.)
      if (file.size === 0) {
        toast.error(`"${file.name}" is empty (0 bytes) — skipped.`);
        continue;
      }
      const key = `${file.name}:${file.size}`;
      if (isProFile(file)) {
        valid.push({ tag: "pro", key, file, status: "pending" });
      } else if (isPdfFile(file)) {
        // PDF deck → each page becomes a slide image on upload (B2).
        valid.push({ tag: "media", key, file, previewUrl: null, status: "pending", deck: true });
      } else if (isPptxFile(file) && file.size > PPTX_MAX_BYTES) {
        // Checked BEFORE any upload — the server would refuse it anyway.
        toast.error(`"${file.name}" is bigger than 150 MB — PowerPoints must be 150 MB or less. Compress its pictures in PowerPoint, or export it as PDF.`);
        continue;
      } else if (isPptxFile(file)) {
        // PowerPoint → convert to PDF server-side, then reuse the deck path.
        valid.push({ tag: "media", key, file, previewUrl: null, status: "pending", deck: true, pptx: true });
      } else if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
        valid.push({ tag: "media", key, file, previewUrl: URL.createObjectURL(file), status: "pending" });
      } else if (ALLOWED_VIDEO_TYPES.includes(file.type)) {
        valid.push({ tag: "media", key, file, previewUrl: null, status: "pending" });
        // Windows churches cannot play HEVC (H.265). A Mac/iPhone export looks
        // perfect here and can be a BLACK SCREEN on their projector, so warn
        // now while swapping the file is still cheap. Async + best-effort: it
        // never blocks or fails the upload.
        void warnIfHevc(file);
      } else if ((routed = classifyDroppedFile(file)).route === "audio" && cachedAudioSupport() === false) {
        toast.info(`"${file.name}": audio in the Media Bin is coming soon.`);
        continue;
      } else if (routed.route === "image" || routed.route === "video" || routed.route === "audio") {
        // Extension-first fallback: iPhone HEIC (converted to JPEG on upload),
        // audio, and files whose OS type is empty (Windows).
        if (routed.route === "image" && file.size > MEDIA_BIN_MAX_BYTES) { toast.error(`"${file.name}" exceeds ${MAX_NON_VIDEO_SIZE_MB} MB — skipped.`); continue; }
        const canPreview = routed.route === "image" && !("heic" in routed && routed.heic);
        valid.push({ tag: "media", key, file, previewUrl: canPreview ? URL.createObjectURL(file) : null, status: "pending", contentType: routed.contentType });
      } else if (routed.route === "too-large") {
        toast.error(`"${file.name}" exceeds ${routed.limitMb} MB — skipped.`);
        continue;
      } else if (routed.route === "audio-format") {
        toast.error(`"${file.name}": that audio format isn't supported — use MP3, WAV, M4A or AAC.`);
        continue;
      } else {
        toast.error(`"${file.name}" is not supported — drop images, videos, a PowerPoint (.pptx/.ppt) or a PDF.`);
        continue;
      }
    }
    if (valid.length === 0) return;
    if (opts?.autoStart) autoStartRef.current = true;
    setQueue((prev) => {
      const existing = new Set(prev.map((q) => q.key));
      return [...prev, ...valid.filter((v) => !existing.has(v.key))];
    });
  }, []);

  // Wave 3 (item 4c): when opened by an OS-file drop, pre-queue the dropped
  // files once per open. Keyed by the array identity so re-renders don't
  // re-enqueue; a fresh drop passes a fresh array.
  const seededFilesRef = useRef<File[] | null>(null);
  useEffect(() => {
    if (!open) { seededFilesRef.current = null; return; }
    if (initialFiles && initialFiles.length > 0 && seededFilesRef.current !== initialFiles) {
      seededFilesRef.current = initialFiles;
      enqueueFiles(initialFiles, { autoStart: autoStartDecks });
    }
  }, [open, initialFiles, enqueueFiles, autoStartDecks]);

  // Decks dropped in start importing immediately (see autoStartRef).
  useEffect(() => {
    if (!autoStartRef.current) return;
    // Can't auto-start now (closed / already past step 1 / an import running) →
    // drop the request so it can't fire later on an unrelated queue change.
    if (!open || step !== 1 || uploading) { autoStartRef.current = false; return; }
    // Wait for the enqueue's state update to land (this effect also runs in the
    // same commit as the enqueue, while `queue` is still the old value).
    if (queue.length === 0) return;
    autoStartRef.current = false;
    if (isDeckOnlyQueue(queue)) void uploadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, step, uploading, open]);

  const removeFromQueue = (key: string) => {
    setQueue((prev) => {
      const q = prev.find((f) => f.key === key);
      if (q?.tag === "media" && q.previewUrl) URL.revokeObjectURL(q.previewUrl);
      return prev.filter((f) => f.key !== key);
    });
  };

  // ── Upload ───────────────────────────────────────────────────────────────────

  const cancelImport = () => {
    setCancelling(true);
    cancelRef.current = true;
    deckAbortRef.current?.abort();
  };

  const uploadAll = async () => {
    cancelRef.current = false;
    setCancelling(false);
    setUploading(true);
    setStep(3);
    let media = 0;
    let songs = 0;
    let errors = 0;
    let skipped = 0;

    for (const item of queue) {
      if (cancelRef.current) {
        setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "error", error: "Cancelled", progress: undefined } : q));
        continue;
      }
      if (isDupItem(item) && !allowDup.has(item.key)) {
        setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "skipped" } : q));
        skipped++;
        continue;
      }
      setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "uploading" } : q));

      if (item.tag === "media" && item.deck) {
        // ── PDF deck path: render each page → image (in-browser) → upload ────
        // Streaming: renderPdfToImages hands us one page at a time; we upload
        // and drop it before the next renders (keeps ≤1 blob resident). A page
        // upload failure is non-fatal — skip and continue so one bad page (or a
        // presign rate-limit on a big deck) doesn't lose the whole import.
        const ac = new AbortController();
        deckAbortRef.current = ac;
        let ok = 0;
        let failedPages = 0;
        // Hoisted so the catch (abort path) can also await in-flight uploads —
        // otherwise a cancel would leave already-dispatched page uploads running
        // and leaking media rows the operator thought they cancelled.
        const pending: Array<Promise<void>> = [];
        let lastLabel = "";
        const setStage = (st: DeckStage) => {
          const label = deckStageLabel(st);
          if (label === lastLabel) return; // XHR progress fires often — only re-render on change
          lastLabel = label;
          setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "uploading", progress: label } : q));
        };
        let renderDone = false;
        let deckTotal = 0;
        try {
          // PowerPoint decks convert to PDF server-side FIRST (LibreOffice on
          // Fly), then flow through the identical PDF→images path below.
          let deckFile: Pick<File, "name" | "arrayBuffer"> = item.file;
          if (item.pptx) {
            deckFile = await convertPptxToPdf(item.file, ac.signal, setStage);
          }
          // Bounded-concurrency uploader: onPage acquires a slot (awaiting when
          // the pool is full — that await is the backpressure that keeps only a
          // few page blobs resident), then fires the upload WITHOUT blocking the
          // next page's render. Overlapping the (slow, network-bound) uploads is
          // what removes the old one-page-at-a-time serialization. We await every
          // in-flight upload after the render loop before tallying results.
          const DECK_UPLOAD_CONCURRENCY = 4;
          let inFlight = 0;
          const waiters: Array<() => void> = [];
          const acquire = (): Promise<void> => inFlight < DECK_UPLOAD_CONCURRENCY
            ? (inFlight++, Promise.resolve())
            : new Promise<void>((r) => waiters.push(() => { inFlight++; r(); }));
          const release = () => { inFlight--; const w = waiters.shift(); if (w) w(); };

          const result = await renderPdfToImages(
            deckFile,
            async (pageFile, index, total) => {
              await acquire();
              deckTotal = total;
              setStage({ kind: "prepare", index, total });
              pending.push((async () => {
                // ac.signal cancels the presign + PUT so a mid-import cancel
                // actually stops the upload instead of leaking a media row.
                try { await uploadMediaFile(pageFile, ac.signal, initialLibraryId); ok++; }
                catch { failedPages++; }
                finally {
                  release();
                  if (renderDone && !ac.signal.aborted) setStage({ kind: "upload-slides", done: ok + failedPages, total: deckTotal });
                }
              })());
            },
            { signal: ac.signal },
          );
          renderDone = true;
          if (ok + failedPages < result.renderedPages) setStage({ kind: "upload-slides", done: ok + failedPages, total: result.renderedPages });
          await Promise.all(pending); // let every overlapped upload settle before tallying
          media += ok;
          if (ok === 0) {
            const why = result.renderedPages === 0 ? "No pages found in PDF" : "Every slide failed to upload";
            toast.error(`"${item.file.name}": ${why}`);
            setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "error", error: why, progress: undefined } : q));
            errors++;
          } else {
            const notes: string[] = [];
            if (failedPages > 0) {
              notes.push(`${ok}/${result.renderedPages} slides imported`);
              // Surface partial loss prominently — not just in the row note.
              toast.error(`"${item.file.name}": ${failedPages} of ${result.renderedPages} slides failed to upload (imported ${ok}).`);
            }
            if (result.truncated) {
              notes.push(`first ${result.renderedPages} of ${result.totalPages} pages`);
              toast.error(`"${item.file.name}" has ${result.totalPages} pages — imported the first ${result.renderedPages}.`);
            }
            setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "done", progress: notes.join(" · ") || undefined } : q));
          }
        } catch (err) {
          const aborted = err instanceof DOMException && err.name === "AbortError";
          const msg = aborted ? "Cancelled" : err instanceof Error ? err.message : "Deck import failed";
          // Let every already-dispatched upload settle (ac.signal makes the
          // aborted ones reject fast) BEFORE reading `ok`, so no upload keeps
          // mutating the tally after cancel and no row is left mid-flight.
          await Promise.all(pending);
          media += ok; // whatever uploaded before the failure is real
          setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "error", error: msg, progress: undefined } : q));
          if (!aborted) { toast.error(`"${item.file.name}": ${msg}`); errors++; }
        } finally {
          if (deckAbortRef.current === ac) deckAbortRef.current = null;
        }
      } else if (item.tag === "media") {
        // ── Media path: presign → S3 PUT → registerMediaAsset ──────────────
        try {
          await uploadMediaFile(item.file, undefined, initialLibraryId, item.contentType ? { contentType: item.contentType } : undefined);
          setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "done" } : q));
          media++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Upload failed";
          setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "error", error: msg } : q));
          errors++;
        }
      } else {
        // ── ProPresenter path: POST /api/imports/parse → finalizeImport ────
        try {
          const fd = new FormData();
          fd.append("files", item.file, item.file.name);
          const res = await fetch("/api/imports/parse?source=propresenter", { method: "POST", body: fd });
          if (!res.ok) {
            const j = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(j.error ?? `Parse failed (${res.status})`);
          }
          if (!res.body) throw new Error("No response body from parse");
          // Consume NDJSON stream
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let migrationJobId: string | null = null;
          let songCount = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const event = JSON.parse(trimmed) as { type: string; migrationJobId?: string; summary?: { counts?: { songs?: number } } };
                if (event.type === "done") {
                  migrationJobId = event.migrationJobId ?? null;
                  songCount = event.summary?.counts?.songs ?? 0;
                }
              } catch { /* skip malformed lines */ }
            }
          }
          if (migrationJobId) {
            const finResult = await finalizeImport(migrationJobId);
            if (!finResult.ok) throw new Error(finResult.error ?? "Finalize failed");
            const added = finResult.data?.added?.songs ?? songCount;
            setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "done", songsImported: added } : q));
            songs += added;
          } else {
            throw new Error("No migration job returned from parse");
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Import failed";
          setQueue((prev) => prev.map((q) => q.key === item.key ? { ...q, status: "error", error: msg } : q));
          errors++;
        }
      }
    }

    setDoneMedia(media);
    setDoneSongs(songs);
    setErrorCount(errors);
    setDoneSkipped(skipped);
    setUploading(false);
    setStep(4);
    if (media > 0) onImported();
    // One library: every media surface (Media, Media Bin, other windows) re-pulls.
    // ProPresenter imports can also add media rows, so notify on songs too.
    if (media > 0 || songs > 0) { notifyMediaChanged(); setExistingTick((n) => n + 1); }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const mediaQueue = queue.filter((q): q is QueuedMedia => q.tag === "media");
  const proQueue = queue.filter((q): q is QueuedPro => q.tag === "pro");
  const totalSizeMB = (queue.reduce((s, q) => s + q.file.size, 0) / 1024 / 1024).toFixed(1);
  const uploadedCount = queue.filter((q) => q.status === "done" || q.status === "error" || q.status === "skipped").length;
  const dupQueued = queue.filter((q) => isDupItem(q) && !allowDup.has(q.key)).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl bg-[var(--color-panel)] border border-[var(--color-border)] shadow-2xl overflow-hidden"
          aria-describedby={undefined}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[var(--color-border)] shrink-0">
            <Dialog.Title className="text-base font-semibold text-[var(--color-foreground)]">
              Import Media
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close"
                className="h-7 w-7 flex items-center justify-center rounded hover:bg-white/10 text-[var(--color-muted-foreground)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <StepBar step={step} />

            {/* ── Step 1: SELECT ─────────────────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                {/* sr-only, NOT `hidden`/display:none — a display:none file input
                    frequently refuses to open the OS picker (via label OR .click());
                    sr-only keeps it interactive while visually hidden. */}
                <input
                  id="media-import-input"
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.heic,.heif,.mp4,.webm,.mov,.mp3,.wav,.m4a,.aac,.pdf,.pptx,.ppt,.pro6,.pro7,.pro7x,.pro5,.pro"
                  className="sr-only"
                  onChange={(e) => { enqueueFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
                />

                {/* The WHOLE drop zone is a native <label> tied to the hidden file
                    input — clicking anywhere (incl. the Browse button) opens Finder
                    via the browser's native gesture. No programmatic .click(): a
                    label + a parent onClick both firing made Chrome cancel the file
                    dialog as an untrusted double-gesture, which is why Browse failed. */}
                <label
                  htmlFor="media-import-input"
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); enqueueFiles(Array.from(e.dataTransfer.files)); }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-14 text-center cursor-pointer transition-colors",
                    dragOver
                      ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10"
                      : "border-[var(--color-border)] bg-white/[0.02] hover:border-[var(--color-muted-foreground)]",
                  )}
                >
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--color-brand)]/15">
                    <Upload className="h-7 w-7 text-[var(--color-brand)]" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-[var(--color-foreground)]">
                      {dragOver ? "Drop files to add" : "Drop your media files here"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                      JPG, PNG, WebP, GIF, AVIF, MP4, WebM, MOV
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">
                      ProPresenter: .pro6 / .pro7 / .pro7x / .pro5 · Slide decks: PowerPoint (.pptx / .ppt) or PDF
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                      Drop a PowerPoint straight in — each slide becomes a picture. Google Slides or Gemini? Export as PDF and drop that.
                    </p>
                  </div>
                  {/* Visual button only — the parent <label> handles the click. */}
                  <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 transition-opacity">
                    <FolderOpen className="h-4 w-4" />
                    Browse files
                  </span>
                  <p className="text-xs text-[var(--color-muted-foreground)]">or drag &amp; drop · videos up to 5 GB, other files up to {MAX_NON_VIDEO_SIZE_MB} MB</p>
                </label>

                {queue.length > 0 && (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    <span className="font-medium text-[var(--color-foreground)]">{queue.length}</span> file{queue.length !== 1 ? "s" : ""} selected · {totalSizeMB} MB
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={queue.length === 0}
                    onClick={() => setStep(2)}
                    className="inline-flex h-10 items-center rounded-md bg-[var(--color-brand)] px-5 text-sm font-semibold text-black disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    Preview {queue.length > 0 ? `${queue.length} file${queue.length !== 1 ? "s" : ""}` : ""}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: PREVIEW ──────────────────────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-foreground)]">
                    Review {queue.length} file{queue.length !== 1 ? "s" : ""} · {totalSizeMB} MB
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                    Nothing is uploaded yet. Remove files you don't want, then click Import.
                  </p>
                  {dupQueued > 0 && (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10 px-2 py-1 text-xs font-medium text-[var(--color-warning)]">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {dupQueued} file{dupQueued !== 1 ? "s are" : " is"} already in your media — will be skipped so you don&rsquo;t get duplicates.
                    </p>
                  )}
                </div>

                {/* Media thumbnails */}
                {mediaQueue.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                      Media files ({mediaQueue.length})
                    </p>
                    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
                      {mediaQueue.map((q) => (
                        <div key={q.key} className="relative group rounded-lg overflow-hidden border border-[var(--color-border)] bg-black aspect-video">
                          {q.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={q.previewUrl} alt={q.file.name} className="w-full h-full object-contain" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-[var(--color-elevated)]">
                              {(q.contentType ?? "").startsWith("audio") ? <Music className="h-8 w-8 text-[var(--color-muted-foreground)]" /> : q.contentType === "image/jpeg" ? <FileImage className="h-8 w-8 text-[var(--color-muted-foreground)]" /> : <FileVideo className="h-8 w-8 text-[var(--color-muted-foreground)]" />}
                            </div>
                          )}
                          <div className="absolute bottom-0 inset-x-0 bg-black/70 px-1.5 py-1 flex items-center gap-1">
                            {q.file.type.startsWith("video") ? <FileVideo className="h-3 w-3 shrink-0 text-white/70" /> : (q.contentType ?? q.file.type).startsWith("audio") ? <Music className="h-3 w-3 shrink-0 text-white/70" /> : <FileImage className="h-3 w-3 shrink-0 text-white/70" />}
                            <span className="text-[10px] text-white/90 truncate flex-1" title={q.file.name}>{q.file.name}</span>
                          </div>
                          <button type="button" onClick={() => removeFromQueue(q.key)}
                            className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all">
                            <X className="h-3 w-3" />
                          </button>
                          {isDupItem(q) && (
                            <label
                              title="This file is already in your media (same name, type and size)"
                              className="absolute top-1 left-1 inline-flex items-center gap-1 rounded bg-black/75 px-1 h-5 text-[9px] font-semibold text-[var(--color-warning)] ring-1 ring-[var(--color-warning)]/60 cursor-pointer"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {allowDup.has(q.key) ? "Duplicate · importing" : "Already in media"}
                              <input
                                type="checkbox"
                                className="h-3 w-3 accent-[var(--color-warning)]"
                                aria-label="Import anyway"
                                checked={allowDup.has(q.key)}
                                onChange={(e) => setAllowDup((prev) => { const n = new Set(prev); if (e.target.checked) n.add(q.key); else n.delete(q.key); return n; })}
                              />
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ProPresenter files */}
                {proQueue.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                      ProPresenter files — will be imported as songs ({proQueue.length})
                    </p>
                    <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] overflow-hidden">
                      {proQueue.map((q) => (
                        <li key={q.key} className="flex items-center gap-3 px-3 py-2 bg-[var(--color-elevated)]">
                          <Presentation className="h-4 w-4 shrink-0 text-[var(--color-brand)]" />
                          <span className="flex-1 text-xs text-[var(--color-foreground)] truncate">{q.file.name}</span>
                          <span className="text-[10px] text-[var(--color-muted-foreground)] shrink-0">{(q.file.size / 1024).toFixed(0)} KB</span>
                          <button type="button" onClick={() => removeFromQueue(q.key)}
                            className="h-5 w-5 flex items-center justify-center rounded text-[var(--color-muted-foreground)] hover:text-red-400 hover:bg-white/5">
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button type="button" onClick={() => setStep(1)}
                  className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:underline underline-offset-2">
                  ← Add more files
                </button>

                <div className="flex gap-2 pt-1">
                  <button type="button" disabled={queue.length === 0 || uploading} onClick={uploadAll}
                    className="inline-flex h-10 items-center rounded-md bg-[var(--color-brand)] px-5 text-sm font-semibold text-black disabled:opacity-40 hover:opacity-90 transition-opacity">
                    Import {queue.length} file{queue.length !== 1 ? "s" : ""}
                  </button>
                  <button type="button" onClick={onClose}
                    className="inline-flex h-10 items-center rounded-md border border-[var(--color-border)] px-4 text-sm hover:bg-white/5 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: UPLOAD ────────────────────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-foreground)]">
                    Uploading {queue.length} file{queue.length !== 1 ? "s" : ""}…
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">Do not close this window.</p>
                </div>

                <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] overflow-hidden">
                  {queue.map((q) => (
                    <li key={q.key} className="flex items-center gap-3 px-3 py-2 bg-[var(--color-elevated)]">
                      <div className="shrink-0">
                        {q.status === "done" && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                        {q.status === "error" && q.error === "Cancelled" && <X className="h-4 w-4 text-[var(--color-muted-foreground)]" />}
                        {q.status === "error" && q.error !== "Cancelled" && <AlertCircle className="h-4 w-4 text-red-400" />}
                        {q.status === "uploading" && <div className="h-4 w-4 rounded-full border-2 border-[var(--color-brand)] border-t-transparent animate-spin" />}
                        {q.status === "pending" && <div className="h-4 w-4 rounded-full border-2 border-[var(--color-border)]" />}
                        {q.status === "skipped" && <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-[var(--color-foreground)] truncate block">{q.file.name}</span>
                        {q.status === "error" && q.error && <span className={cn("text-[10px]", q.error === "Cancelled" ? "text-[var(--color-muted-foreground)]" : "text-red-400")}>{q.error}</span>}
                        {q.status === "skipped" && <span className="text-[10px] text-[var(--color-warning)]">Already in your media — skipped</span>}
                        {q.tag === "media" && q.deck && q.status === "uploading" && q.progress && (
                          <span className="text-[10px] text-[var(--color-muted-foreground)]" aria-live="polite">{q.progress}</span>
                        )}
                        {q.tag === "media" && q.deck && q.status === "done" && q.progress && (
                          <span className="text-[10px] text-green-400">{q.progress}</span>
                        )}
                        {q.tag === "pro" && q.status === "done" && (
                          <span className="text-[10px] text-green-400">{q.songsImported ?? 0} songs imported</span>
                        )}
                      </div>
                      <span className="text-[10px] text-[var(--color-muted-foreground)] shrink-0">
                        {(q.file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-[var(--color-muted-foreground)]">
                    <span>{uploadedCount} of {queue.length}</span>
                    <span>{Math.round((uploadedCount / queue.length) * 100)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--color-brand)] transition-all duration-300"
                      style={{ width: `${Math.round((uploadedCount / queue.length) * 100)}%` }} />
                  </div>
                </div>

                {uploading && (
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={cancelImport} disabled={cancelling}
                      className="inline-flex h-10 items-center rounded-md border border-[var(--color-border)] px-4 text-sm hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                      {cancelling ? "Cancelling…" : "Cancel import"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Step 4: DONE ──────────────────────────────────────────────────── */}
            {step === 4 && (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-6 w-6 text-green-400 mt-0.5 shrink-0" />
                  <div>
                    <h3 className="text-base font-semibold text-[var(--color-foreground)]">
                      {doneMedia + doneSongs > 0 ? "Import complete" : "Nothing imported"}
                    </h3>
                    <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                      {doneMedia > 0 && <><strong className="text-[var(--color-foreground)]">{doneMedia}</strong> media file{doneMedia !== 1 ? "s" : ""} added to your media library. </>}
                      {doneSongs > 0 && <><strong className="text-[var(--color-foreground)]">{doneSongs}</strong> song{doneSongs !== 1 ? "s" : ""} imported from ProPresenter. </>}
                      {errorCount > 0 && <><strong className="text-red-400">{errorCount}</strong> failed. </>}
                      {doneSkipped > 0 && <><strong className="text-[var(--color-warning)]">{doneSkipped}</strong> skipped — already in your media.</>}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 flex-wrap">
                  {doneMedia > 0 && (
                    <div className="flex-1 min-w-[100px] rounded-lg border border-[var(--color-brand)]/25 bg-[var(--color-brand)]/10 p-4">
                      <div className="text-2xl font-bold text-[var(--color-foreground)]">{doneMedia}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">Media files</div>
                    </div>
                  )}
                  {doneSongs > 0 && (
                    <div className="flex-1 min-w-[100px] rounded-lg border border-[var(--color-brand)]/25 bg-[var(--color-brand)]/10 p-4">
                      <div className="text-2xl font-bold text-[var(--color-foreground)]">{doneSongs}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">Songs (ProPresenter)</div>
                    </div>
                  )}
                  {errorCount > 0 && (
                    <div className="flex-1 min-w-[100px] rounded-lg border border-red-500/25 bg-red-500/10 p-4">
                      <div className="text-2xl font-bold text-red-400">{errorCount}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">Failed</div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={onClose}
                    className="inline-flex h-10 items-center rounded-md bg-[var(--color-brand)] px-5 text-sm font-semibold text-black hover:opacity-90 transition-opacity">
                    Done
                  </button>
                  <button type="button" onClick={() => {
                    queue.forEach((q) => { if (q.tag === "media" && q.previewUrl) URL.revokeObjectURL(q.previewUrl); });
                    setStep(1); setQueue([]); setDoneMedia(0); setDoneSongs(0); setErrorCount(0); setDoneSkipped(0); setAllowDup(new Set());
                  }}
                    className="inline-flex h-10 items-center rounded-md border border-[var(--color-border)] px-4 text-sm hover:bg-white/5 transition-colors">
                    Import more
                  </button>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
