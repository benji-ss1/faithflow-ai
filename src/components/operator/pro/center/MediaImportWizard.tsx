"use client";
/**
 * MediaImportWizard — 4-step modal wizard for importing media (images/videos).
 *
 * Matches the ProPresenter-style import flow used in the songs wizard:
 *   Step 1  SELECT   — Drop zone or file picker; files accumulate with previews
 *   Step 2  PREVIEW  — Thumbnail grid; remove individual files before committing
 *   Step 3  UPLOAD   — Per-file sequential upload with real progress feedback
 *   Step 4  DONE     — Success summary + close
 *
 * Upload path: presign → S3 PUT → registerMediaAsset (server action)
 * No files leave the browser until the user confirms on step 3.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, Upload, X, Pencil, FileImage, FileVideo, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { registerMediaAsset } from "@/lib/actions";

// ── Types ──────────────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_FILE_SIZE_MB = 500;

type UploadStatus = "pending" | "uploading" | "done" | "error";

interface QueuedFile {
  key: string; // `${name}:${size}` for dedup
  file: File;
  previewUrl: string | null; // object URL for images; null for videos
  status: UploadStatus;
  error?: string;
}

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
  onImported: () => void; // parent reloads the media grid
}

export function MediaImportWizard({ open, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(1);
        setQueue([]);
        setUploading(false);
        setDoneCount(0);
        setErrorCount(0);
        setDragOver(false);
      }, 200); // after close animation
    }
  }, [open]);

  // Revoke object URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      queue.forEach((q) => { if (q.previewUrl) URL.revokeObjectURL(q.previewUrl); });
    };
    // intentionally only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── File queueing ────────────────────────────────────────────────────────────

  const enqueueFiles = useCallback((incoming: File[]) => {
    const valid: QueuedFile[] = [];
    for (const file of incoming) {
      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
      const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
      if (!isImage && !isVideo) {
        toast.error(`"${file.name}" is not a supported media type — skipped.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds ${MAX_FILE_SIZE_MB} MB — skipped.`);
        continue;
      }
      const key = `${file.name}:${file.size}`;
      const previewUrl = isImage ? URL.createObjectURL(file) : null;
      valid.push({ key, file, previewUrl, status: "pending" });
    }
    if (valid.length === 0) return;
    setQueue((prev) => {
      const existingKeys = new Set(prev.map((q) => q.key));
      return [...prev, ...valid.filter((v) => !existingKeys.has(v.key))];
    });
  }, []);

  const removeFromQueue = (key: string) => {
    setQueue((prev) => {
      const q = prev.find((f) => f.key === key);
      if (q?.previewUrl) URL.revokeObjectURL(q.previewUrl);
      return prev.filter((f) => f.key !== key);
    });
  };

  // ── Upload ───────────────────────────────────────────────────────────────────

  const uploadAll = async () => {
    setUploading(true);
    setStep(3);
    let done = 0;
    let errors = 0;

    for (const item of queue) {
      setQueue((prev) =>
        prev.map((q) => (q.key === item.key ? { ...q, status: "uploading" } : q)),
      );

      try {
        // 1. Presign
        const presignRes = await fetch("/api/media/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: item.file.name,
            contentType: item.file.type,
            size: item.file.size,
            purpose: "media",
          }),
        });
        if (!presignRes.ok) {
          const err = await presignRes.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? `Presign failed (HTTP ${presignRes.status})`);
        }
        const { url: uploadUrl, key } = await presignRes.json() as { url: string; key: string };

        // 2. S3 PUT
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": item.file.type },
          body: item.file,
        });
        if (!uploadRes.ok) throw new Error("Upload to storage failed");

        // 3. Register (church-scoped server action)
        const kind = item.file.type.startsWith("video") ? "video" as const : "image" as const;
        const result = await registerMediaAsset({
          kind,
          fileName: item.file.name,
          s3Key: key,
          mimeType: item.file.type,
          sizeBytes: item.file.size,
        });
        if (!result?.ok) {
          throw new Error((result as { error?: string } | undefined)?.error ?? "Registration failed");
        }

        setQueue((prev) =>
          prev.map((q) => (q.key === item.key ? { ...q, status: "done" } : q)),
        );
        done++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setQueue((prev) =>
          prev.map((q) => (q.key === item.key ? { ...q, status: "error", error: msg } : q)),
        );
        errors++;
      }
    }

    setDoneCount(done);
    setErrorCount(errors);
    setUploading(false);
    setStep(4);

    if (done > 0) {
      onImported(); // refresh the media grid in the parent
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────────

  const totalSizeMB = (queue.reduce((s, q) => s + q.file.size, 0) / 1024 / 1024).toFixed(1);

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
              <button
                type="button"
                className="h-7 w-7 flex items-center justify-center rounded hover:bg-white/10 text-[var(--color-muted-foreground)] transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <StepBar step={step} />

            {/* ── Step 1: SELECT ──────────────────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov"
                  className="hidden"
                  onChange={(e) => {
                    enqueueFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />

                {/* Drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    enqueueFiles(Array.from(e.dataTransfer.files));
                  }}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors cursor-pointer",
                    dragOver
                      ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10"
                      : "border-[var(--color-border)] bg-white/[0.02] hover:border-[var(--color-muted-foreground)]",
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--color-brand)]/15">
                    <Upload className="h-7 w-7 text-[var(--color-brand)]" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-[var(--color-foreground)]">
                      {dragOver ? "Drop files to add" : "Drop your media files here"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                      or click to browse — JPG, PNG, WebP, GIF, AVIF, MP4, WebM, MOV
                    </p>
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Up to {MAX_FILE_SIZE_MB} MB per file
                  </p>
                </div>

                {queue.length > 0 && (
                  <div className="text-sm text-[var(--color-muted-foreground)]">
                    <span className="font-medium text-[var(--color-foreground)]">{queue.length}</span> file{queue.length !== 1 ? "s" : ""} selected
                    <span className="ml-2">· {totalSizeMB} MB total</span>
                  </div>
                )}

                {/* CTA */}
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

            {/* ── Step 2: PREVIEW ─────────────────────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-foreground)]">
                    Review {queue.length} file{queue.length !== 1 ? "s" : ""} · {totalSizeMB} MB
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                    Nothing is uploaded yet. Remove any files you don't want, then click Import.
                  </p>
                </div>

                {/* Thumbnail grid */}
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}
                >
                  {queue.map((q) => (
                    <div key={q.key} className="relative group rounded-lg overflow-hidden border border-[var(--color-border)] bg-black aspect-video">
                      {q.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={q.previewUrl}
                          alt={q.file.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-[var(--color-elevated)]">
                          <FileVideo className="h-8 w-8 text-[var(--color-muted-foreground)]" />
                        </div>
                      )}
                      {/* Overlay with filename */}
                      <div className="absolute bottom-0 inset-x-0 bg-black/70 px-1.5 py-1 flex items-center gap-1">
                        {q.file.type.startsWith("video") ? (
                          <FileVideo className="h-3 w-3 shrink-0 text-white/70" />
                        ) : (
                          <FileImage className="h-3 w-3 shrink-0 text-white/70" />
                        )}
                        <span className="text-[10px] text-white/90 truncate flex-1" title={q.file.name}>
                          {q.file.name}
                        </span>
                      </div>
                      {/* Remove button */}
                      <button
                        type="button"
                        onClick={() => removeFromQueue(q.key)}
                        className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add more */}
                <button
                  type="button"
                  className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] underline-offset-2 hover:underline"
                  onClick={() => setStep(1)}
                >
                  ← Add more files
                </button>

                {/* CTA */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={queue.length === 0 || uploading}
                    onClick={uploadAll}
                    className="inline-flex h-10 items-center rounded-md bg-[var(--color-brand)] px-5 text-sm font-semibold text-black disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    Import {queue.length} file{queue.length !== 1 ? "s" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-10 items-center rounded-md border border-[var(--color-border)] px-4 text-sm hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: UPLOAD ───────────────────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-foreground)]">
                    Uploading {queue.length} file{queue.length !== 1 ? "s" : ""}…
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                    Do not close this window.
                  </p>
                </div>

                {/* Per-file progress list */}
                <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] overflow-hidden">
                  {queue.map((q) => (
                    <li key={q.key} className="flex items-center gap-3 px-3 py-2 bg-[var(--color-elevated)]">
                      {/* Icon */}
                      <div className="shrink-0">
                        {q.status === "done" && (
                          <CheckCircle2 className="h-4 w-4 text-green-400" />
                        )}
                        {q.status === "error" && (
                          <AlertCircle className="h-4 w-4 text-red-400" />
                        )}
                        {q.status === "uploading" && (
                          <div className="h-4 w-4 rounded-full border-2 border-[var(--color-brand)] border-t-transparent animate-spin" />
                        )}
                        {q.status === "pending" && (
                          <div className="h-4 w-4 rounded-full border-2 border-[var(--color-border)]" />
                        )}
                      </div>
                      {/* Filename */}
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-[var(--color-foreground)] truncate block">
                          {q.file.name}
                        </span>
                        {q.status === "error" && q.error && (
                          <span className="text-[10px] text-red-400">{q.error}</span>
                        )}
                      </div>
                      {/* Size */}
                      <span className="text-[10px] text-[var(--color-muted-foreground)] shrink-0">
                        {(q.file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Overall progress bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-[var(--color-muted-foreground)]">
                    <span>{queue.filter((q) => q.status === "done" || q.status === "error").length} of {queue.length}</span>
                    <span>{Math.round((queue.filter((q) => q.status === "done" || q.status === "error").length / queue.length) * 100)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--color-brand)] transition-all duration-300"
                      style={{
                        width: `${Math.round((queue.filter((q) => q.status === "done" || q.status === "error").length / queue.length) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 4: DONE ─────────────────────────────────────────────────── */}
            {step === 4 && (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-6 w-6 text-green-400 mt-0.5 shrink-0" />
                  <div>
                    <h3 className="text-base font-semibold text-[var(--color-foreground)]">
                      {doneCount > 0 ? "Import complete" : "Nothing imported"}
                    </h3>
                    <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                      {doneCount > 0 && (
                        <>
                          <strong className="text-[var(--color-foreground)]">{doneCount}</strong> file{doneCount !== 1 ? "s" : ""} added to your media library.
                        </>
                      )}
                      {errorCount > 0 && (
                        <> <strong className="text-red-400">{errorCount}</strong> failed — check your connection and try again.</>
                      )}
                    </p>
                  </div>
                </div>

                {/* Summary tiles */}
                <div className="flex gap-3">
                  <div className="flex-1 rounded-lg border border-[var(--color-brand)]/25 bg-[var(--color-brand)]/10 p-4">
                    <div className="text-2xl font-bold text-[var(--color-foreground)]">{doneCount}</div>
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">Imported</div>
                  </div>
                  {errorCount > 0 && (
                    <div className="flex-1 rounded-lg border border-red-500/25 bg-red-500/10 p-4">
                      <div className="text-2xl font-bold text-red-400">{errorCount}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">Failed</div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-10 items-center rounded-md bg-[var(--color-brand)] px-5 text-sm font-semibold text-black hover:opacity-90 transition-opacity"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Revoke old preview URLs before resetting
                      queue.forEach((q) => { if (q.previewUrl) URL.revokeObjectURL(q.previewUrl); });
                      setStep(1);
                      setQueue([]);
                      setDoneCount(0);
                      setErrorCount(0);
                    }}
                    className="inline-flex h-10 items-center rounded-md border border-[var(--color-border)] px-4 text-sm hover:bg-white/5 transition-colors"
                  >
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

// Re-export Pencil icon for use in MediaBrowser without adding another import
export { Pencil };
