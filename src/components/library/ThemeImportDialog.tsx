"use client";

/**
 * ThemeImportDialog — Import backgrounds from ProPresenter files (.pro7,
 * .proBundle, .pro6, .pro5) and turn them into PresentFlow themes.
 *
 * Flow (mirrors the song ProPresenterImportDialog UX):
 *   1. Upload   → drag-drop zone for ProPresenter files
 *   2. Extract  → server extracts background images/videos and uploads to S3
 *   3. Review   → gallery of backgrounds; user names each + picks which to keep
 *   4. Create   → calls createTheme for each selected background
 *   5. Done     → summary
 *
 * Only backgrounds are imported — lyrics/songs from the same files are
 * ignored here (use the Songs import flow for that).
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, X, CheckCircle2, AlertTriangle, Image as ImageIcon, Film, ArrowRight } from "lucide-react";
import { extractThemeBackgrounds, type FileDrop } from "@/lib/import-actions";
import { createTheme } from "@/lib/actions";
import { cn } from "@/lib/utils";

type Phase = "upload" | "extracting" | "review" | "creating" | "complete";

type Background = {
  fileName: string;
  kind: "image" | "video";
  url: string;
  sizeBytes: number;
};

type ReviewItem = Background & {
  selected: boolean;
  themeName: string;
};

const ACCEPTED_EXTS = [".proBundle", ".pro", ".pro6", ".pro5", ".pro7", ".pro7x", ".zip"];
const MAX_TOTAL_MB = 250;

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function ThemeImportDialog({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [warnings, setWarnings] = useState<{ file: string; warnings: string[] }[]>([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase("upload");
    setFiles([]);
    setItems([]);
    setWarnings([]);
    setCreatedCount(0);
    setErrorMsg(null);
  };

  const addFiles = useCallback((incoming: File[]) => {
    const matched = incoming.filter((f) =>
      ACCEPTED_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext.toLowerCase())),
    );
    if (matched.length === 0) {
      toast.error("No ProPresenter files found — drop .proBundle, .pro7, .pro6, or .pro5");
      return;
    }
    const totalMB = matched.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
    if (totalMB > MAX_TOTAL_MB) {
      toast.error(`Files too large (${Math.round(totalMB)} MB). Max ${MAX_TOTAL_MB} MB.`);
      return;
    }
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...matched.filter((f) => !names.has(f.name))];
    });
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragDepth(0);
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const handleExtract = async () => {
    if (files.length === 0) return;
    setPhase("extracting");
    setErrorMsg(null);
    try {
      const drop: FileDrop[] = await Promise.all(
        files.map(async (f) => ({ path: f.name, b64: await fileToBase64(f) })),
      );
      const res = await extractThemeBackgrounds({ drop });
      if (!res.ok) { setErrorMsg(res.error); setPhase("upload"); return; }
      const bgs = res.data?.backgrounds ?? [];
      if (bgs.length === 0) {
        setErrorMsg("No background images or videos were found in the provided file(s).");
        setPhase("upload");
        return;
      }
      setWarnings(res.data?.warnings ?? []);
      setItems(bgs.map((b) => ({
        ...b,
        selected: true,
        themeName: baseName(b.fileName),
      })));
      setPhase("review");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Extraction failed");
      setPhase("upload");
    }
  };

  const handleCreate = async () => {
    const selected = items.filter((i) => i.selected);
    if (selected.length === 0) return;
    setPhase("creating");
    let created = 0;
    for (const item of selected) {
      try {
        const config = {
          bgType: (item.kind === "video" ? "video" : "image") as "image" | "video",
          bgImageUrl: item.kind === "image" ? item.url : "",
          bgVideoUrl: item.kind === "video" ? item.url : "",
          bgColor: "#000000",
          textColor: "#F1EFE8",
          fontFamily: "Inter",
          fontSizePx: 72,
          fontSizeScripturePx: 56,
          fontWeight: 600,
          align: "center" as const,
          bgOpacity: 1,
          logoPosition: "none" as const,
        };
        const res = await createTheme(item.themeName.trim() || baseName(item.fileName), config);
        if (res.ok) created++;
        else toast.error(`Could not create "${item.themeName}": ${res.error}`);
      } catch { /* per-theme failures don't abort the batch */ }
    }
    setCreatedCount(created);
    setPhase("complete");
  };

  if (!open) return null;

  const STEP_LABELS = ["Upload", "Preview & Review", "Create", "Done"];
  const stepIdx = phase === "upload" || phase === "extracting" ? 0
    : phase === "review" ? 1
    : phase === "creating" ? 2
    : 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative flex flex-col w-[680px] max-w-[95vw] max-h-[85vh] rounded-xl bg-[var(--color-panel,#141818)] border border-[var(--color-border)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <div className="text-sm font-semibold">Import from ProPresenter</div>
            <div className="text-[11px] text-[var(--color-muted-foreground)] mt-0.5">
              Bring backgrounds from your ProPresenter library
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--color-muted-foreground)] hover:bg-white/[0.05] hover:text-[var(--color-foreground)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-0 border-b border-[var(--color-border)] px-5 py-3">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center">
              <div className={cn(
                "flex items-center gap-1.5 text-[11px] font-medium",
                i === stepIdx ? "text-[var(--color-brand)]" : i < stepIdx ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]",
              )}>
                <span className={cn(
                  "inline-flex w-4 h-4 rounded-full items-center justify-center text-[9px] font-bold",
                  i === stepIdx ? "bg-[var(--color-brand)] text-black"
                    : i < stepIdx ? "bg-[var(--color-foreground)] text-[var(--color-panel)]"
                    : "bg-[var(--color-elevated)] text-[var(--color-muted-foreground)]",
                )}>{i + 1}</span>
                {label}
              </div>
              {i < STEP_LABELS.length - 1 && (
                <ArrowRight className="w-3 h-3 mx-2 text-[var(--color-muted-foreground)]" />
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* UPLOAD / EXTRACTING */}
          {(phase === "upload" || phase === "extracting") && (
            <div className="space-y-4">
              <p className="text-[12px] text-[var(--color-muted-foreground)]">
                Drop your ProPresenter file here. PresentFlow will extract embedded backgrounds and let you create themes from them.
              </p>

              {/* Drop zone */}
              <div
                className={cn(
                  "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-10 transition-colors cursor-pointer",
                  dragOver
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10"
                    : "border-[var(--color-border)] hover:border-[var(--color-brand)]/60",
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragEnter={(e) => { e.preventDefault(); setDragDepth((d) => d + 1); setDragOver(true); }}
                onDragLeave={() => { setDragDepth((d) => { const n = d - 1; if (n <= 0) setDragOver(false); return n; }); }}
                onDrop={onDrop}
              >
                <Upload className="w-8 h-8 text-[var(--color-muted-foreground)]" />
                <div className="text-sm font-medium text-[var(--color-foreground)]">
                  Drop your ProPresenter file here
                </div>
                <div className="text-[11px] text-[var(--color-muted-foreground)]">
                  .proBundle, .pro, .pro7, .pro7x, .pro6, .pro5 — up to {MAX_TOTAL_MB} MB
                </div>
                <button
                  type="button"
                  className="mt-1 h-8 px-4 rounded border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-elevated)] transition-colors"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  or click to browse
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_EXTS.join(",")}
                  className="sr-only"
                  onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
                />
              </div>

              {/* File list */}
              {files.length > 0 && (
                <div className="space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md bg-[var(--color-elevated)] px-3 py-2 text-[12px]">
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-[var(--color-muted-foreground)]">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                      <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                        <X className="w-3 h-3 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-[12px] text-red-400">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {errorMsg}
                </div>
              )}

              <p className="text-[11px] text-[var(--color-muted-foreground)]">
                How do I export from ProPresenter? Open ProPresenter → right-click a presentation → Export → Presentation Bundle → save the .proBundle file.
              </p>
            </div>
          )}

          {/* REVIEW */}
          {phase === "review" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[12px] text-[var(--color-muted-foreground)]">
                  {items.length} background{items.length === 1 ? "" : "s"} found.
                  Select the ones to import and give each a theme name.
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setItems((p) => p.map((i) => ({ ...i, selected: true })))}
                    className="text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setItems((p) => p.map((i) => ({ ...i, selected: false })))}
                    className="text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  >
                    None
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {items.map((item, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-md border overflow-hidden transition-colors",
                      item.selected ? "border-[var(--color-brand)]" : "border-[var(--color-border)] opacity-60",
                    )}
                  >
                    {/* Thumbnail */}
                    <div
                      className="relative aspect-video bg-black cursor-pointer"
                      onClick={() => setItems((p) => p.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))}
                    >
                      {item.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-1 text-[var(--color-muted-foreground)]">
                          <Film className="w-6 h-6" />
                          <span className="text-[10px]">Video background</span>
                        </div>
                      )}
                      <div className="absolute top-1.5 left-1.5">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={(e) => setItems((p) => p.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                          className="w-4 h-4 accent-[var(--color-brand)] cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-black/60 rounded px-1 py-0.5">
                        {item.kind === "image" ? <ImageIcon className="w-2.5 h-2.5 text-white/70" /> : <Film className="w-2.5 h-2.5 text-white/70" />}
                        <span className="text-[9px] text-white/70 uppercase">{item.kind}</span>
                      </div>
                    </div>
                    {/* Name input */}
                    <div className="px-2 py-1.5 bg-[var(--color-elevated)]">
                      <input
                        value={item.themeName}
                        onChange={(e) => setItems((p) => p.map((x, j) => j === i ? { ...x, themeName: e.target.value } : x))}
                        placeholder="Theme name…"
                        disabled={!item.selected}
                        className="w-full bg-transparent text-[11px] outline-none placeholder:text-[var(--color-muted-foreground)]/60 disabled:opacity-40"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {warnings.flatMap((w) => w.warnings).length > 0 && (
                <details className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
                  <summary className="flex items-center gap-2 text-[11px] text-amber-400 cursor-pointer">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {warnings.flatMap((w) => w.warnings).length} warning(s)
                  </summary>
                  <ul className="mt-2 space-y-0.5 text-[10px] text-amber-300/80">
                    {warnings.map((w, i) => w.warnings.map((msg, j) => (
                      <li key={`${i}-${j}`}>{w.file !== "*" ? `${w.file}: ` : ""}{msg}</li>
                    )))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* CREATING */}
          {phase === "creating" && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-[var(--color-brand)] animate-pulse"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
              <div className="text-[13px] font-medium">Creating themes…</div>
              <div className="text-[11px] text-[var(--color-muted-foreground)]">
                Saving backgrounds, building theme configs
              </div>
            </div>
          )}

          {/* COMPLETE */}
          {phase === "complete" && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-teal-400" />
              </div>
              <div className="text-base font-semibold text-[var(--color-foreground)]">
                {createdCount} theme{createdCount === 1 ? "" : "s"} created
              </div>
              <div className="text-[12px] text-[var(--color-muted-foreground)] text-center max-w-[320px]">
                Your new themes are available in the Themes Library. Apply them to any song or scripture from the Theme Editor.
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={reset}
                  className="h-9 px-4 rounded-md border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)]"
                >
                  Import more
                </button>
                <button
                  type="button"
                  onClick={() => { window.location.href = "/library/themes"; }}
                  className="h-9 px-4 rounded-md bg-[var(--color-brand)] text-black text-[12px] font-semibold"
                >
                  Go to Themes Library
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {(phase === "upload" || phase === "review") && (
          <div className="flex items-center justify-between border-t border-[var(--color-border)] px-5 py-3">
            <button
              type="button"
              onClick={phase === "review" ? () => { setPhase("upload"); setItems([]); } : onClose}
              className="h-9 px-4 rounded-md border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)]"
            >
              {phase === "review" ? "← Back" : "Cancel"}
            </button>
            {phase === "upload" && (
              <button
                type="button"
                disabled={files.length === 0}
                onClick={() => void handleExtract()}
                className="h-9 px-5 rounded-md bg-[var(--color-brand)] text-black text-[12px] font-semibold disabled:opacity-40"
              >
                Extract backgrounds →
              </button>
            )}
            {phase === "review" && (
              <button
                type="button"
                disabled={!items.some((i) => i.selected)}
                onClick={() => void handleCreate()}
                className="h-9 px-5 rounded-md bg-[var(--color-brand)] text-black text-[12px] font-semibold disabled:opacity-40"
              >
                Create {items.filter((i) => i.selected).length} theme{items.filter((i) => i.selected).length === 1 ? "" : "s"} →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
