"use client";

/**
 * ProPresenter migration flow — 4 steps in a single modal.
 *
 *   1. Upload    → drop zone, accepts .proBundle / .pro / .pro6 / .pro5 / .pro7 / .pro7x
 *   2. Preview   → parse-only pass (previewImportDrop), song list with
 *                  checkboxes, expandable rows for first-two-slides preview,
 *                  duplicate badges (unchecked by default)
 *   3. Import    → progress indicator while the write happens
 *   4. Complete  → summary counts + media thumbnail grid, links back to the library
 *
 * This is intentionally one file. The steps are simple enough that splitting
 * them into 4 sibling components adds indirection without value; the state
 * (uploaded files → preview data → selection set → result) has to flow
 * between them anyway.
 */

import { useState, useTransition, useMemo, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Upload, X, FileText, ChevronDown, ChevronRight, CheckCircle2,
  AlertTriangle, Image as ImageIcon, Film, ArrowRight, Music,
} from "lucide-react";
import { previewImportDrop, importDrop, type FileDrop } from "@/lib/import-actions";
import { stripProBundles } from "@/lib/pro-bundle-strip";

type Phase = "upload" | "scanning" | "preview" | "importing" | "complete";

type PreviewSong = {
  title: string;
  artist: string | null;
  ccli: string | null;
  slidesPreview: string[];
  slideCount: number;
  mediaHints: string[];
  isDuplicate: boolean;
  sourceRef?: string;
};

type PreviewData = {
  songs: PreviewSong[];
  mediaCount: number;
  mediaSample: { fileName: string; kind: "image" | "video"; sizeBytes: number }[];
  warnings: { file: string; warnings: string[] }[];
};

type CompleteData = {
  added: number;
  skipped: number;
  mediaAdded: number;
  backgroundsLinked: number;
  warnings: { file: string; warnings: string[] }[];
};

const ACCEPTED_EXTS = [".proBundle", ".pro", ".pro6", ".pro5", ".pro7", ".pro7x", ".zip"];
const MAX_TOTAL_MB = 250;

function fileMatchesAccept(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext.toLowerCase()));
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Post-strip payload guard, applied on BOTH scan and import paths. Kept under
// the 50 MB server-action bodySizeLimit (next.config.ts) so an oversized library
// gets this friendly message instead of a framework 413.
function importDropsTooLarge(drops: FileDrop[]): string | null {
  const b64Bytes = drops.reduce((s, d) => s + d.b64.length, 0);
  if (b64Bytes > 45 * 1024 * 1024) {
    return `This library's lyrics are ${Math.round(b64Bytes / 1024 / 1024)} MB after stripping media — over the 45 MB per-import limit. Split it into two exports and import each.`;
  }
  return null;
}

// Delegates to the shared browser media-stripper (also used by the Import
// Wizard) and maps the lyrics-only docs to base64 FileDrops for the
// server-action import path. Single source of truth for the strip logic so the
// two import UIs can't diverge.
async function expandProBundleDrops(files: File[]): Promise<{ drops: FileDrop[]; expandedFrom: number; skippedMedia: number; truncated: boolean; skippedFiles: string[] }> {
  const { docs, expandedFrom, skippedMedia, truncated, skippedFiles } = await stripProBundles(files);
  const drops: FileDrop[] = docs.map((d) => ({ path: d.path, b64: bytesToBase64(d.bytes) }));
  return { drops, expandedFrom, skippedMedia, truncated, skippedFiles };
}

export function ProPresenterImportDialog({
  open, onClose, initialFiles,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-loaded files (used when a drop on the parent surface routes here). */
  initialFiles?: File[];
}) {
  const [phase, setPhase] = useState<Phase>("upload");
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CompleteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = useCallback(() => {
    setPhase("upload");
    setFiles([]);
    setPreview(null);
    setSelected(new Set());
    setExpanded(new Set());
    setQuery("");
    setResult(null);
    setError(null);
    scannedDropsRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    if (pending) return; // don't close mid-write
    reset();
    onClose();
  }, [pending, reset, onClose]);

  // If the parent hands us pre-loaded files (drag-drop routed here), adopt
  // them on open so the user lands on the upload step with them queued.
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      setFiles(initialFiles);
      setPhase("upload");
    }
  }, [open, initialFiles]);

  // Cache of the media-stripped drops produced by scan(), so runImport() doesn't
  // re-read + re-unzip the (possibly 171MB) bundle a second time. Invalidated
  // whenever the file set changes.
  const scannedDropsRef = useRef<FileDrop[] | null>(null);

  const handleFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) => fileMatchesAccept(f.name));
    if (arr.length === 0) {
      toast.error("No ProPresenter files found. Accepted: .proBundle, .pro, .pro6, .pro5, .pro7, .pro7x");
      return;
    }
    // NB: no raw-size gate here anymore. Bundles are media-heavy (a 171 MB
    // .probundle can be 559 songs + 158 MB of backgrounds); media is stripped
    // in the browser before upload (expandProBundleDrops), so what actually
    // matters is the post-strip lyrics size, checked at scan/import time.
    scannedDropsRef.current = null;
    setFiles(arr);
  }, []);

  const scan = useCallback(() => {
    if (files.length === 0) return;
    setPhase("scanning");
    setError(null);
    startTransition(async () => {
      try {
        const { drops: drop, expandedFrom, skippedMedia, truncated, skippedFiles } = await expandProBundleDrops(files);
        if (expandedFrom > 0) {
          toast.info(`Extracted ${drop.length} song document${drop.length === 1 ? "" : "s"} from ${expandedFrom} bundle${expandedFrom === 1 ? "" : "s"} (skipped ${skippedMedia} media file${skippedMedia === 1 ? "" : "s"} — lyrics only).`);
        }
        if (truncated || skippedFiles.length > 0) {
          toast.warning(`Some content was skipped (over safe size limits${skippedFiles.length ? `: ${skippedFiles.slice(0, 2).join(", ")}${skippedFiles.length > 2 ? "…" : ""}` : ""}). If songs are missing, split the export into smaller files.`);
        }
        const oversize = importDropsTooLarge(drop);
        if (oversize) { setError(oversize); setPhase("upload"); return; }
        scannedDropsRef.current = drop; // reuse in runImport() — avoid re-unzipping
        const res = await previewImportDrop({ drop });
        if (!res.ok) {
          setError(res.error);
          setPhase("upload");
          return;
        }
        const data = res.data!;
        setPreview(data);
        // Default selection: everything EXCEPT duplicates.
        setSelected(new Set(data.songs.filter((s) => !s.isDuplicate).map((s) => s.title)));
        setPhase("preview");
        if (data.songs.length === 0) {
          toast.info("No songs found in this file. Make sure you exported as a ProPresenter bundle.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Scan failed");
        setPhase("upload");
      }
    });
  }, [files]);

  const runImport = useCallback(() => {
    if (!preview || selected.size === 0) return;
    setPhase("importing");
    setError(null);
    startTransition(async () => {
      try {
        // Reuse the drops already produced by scan() — don't re-read + re-unzip
        // the bundle. Fall back to expanding only if the cache was invalidated.
        const drop = scannedDropsRef.current ?? (await expandProBundleDrops(files)).drops;
        const oversize = importDropsTooLarge(drop);
        if (oversize) { setError(oversize); setPhase("preview"); return; }
        const res = await importDrop({ drop, onlyTitles: Array.from(selected) });
        if (!res.ok) {
          setError(res.error);
          setPhase("preview");
          return;
        }
        const d = res.data!;
        setResult({
          added: d.added,
          skipped: d.skipped,
          mediaAdded: d.mediaAdded,
          backgroundsLinked: d.backgroundsLinked,
          warnings: d.warnings,
        });
        setPhase("complete");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed");
        setPhase("preview");
      }
    });
  }, [preview, selected, files]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Header phase={phase} onClose={handleClose} pending={pending} />

        <div className="flex-1 overflow-y-auto">
          {phase === "upload" && (
            <UploadStep
              files={files}
              onFiles={handleFiles}
              onScan={scan}
              onClear={() => setFiles([])}
              error={error}
            />
          )}
          {phase === "scanning" && <ScanningStep />}
          {phase === "preview" && preview && (
            <PreviewStep
              preview={preview}
              selected={selected}
              setSelected={setSelected}
              expanded={expanded}
              setExpanded={setExpanded}
              query={query}
              setQuery={setQuery}
              error={error}
            />
          )}
          {phase === "importing" && <ImportingStep total={selected.size} />}
          {phase === "complete" && result && preview && (
            <CompleteStep result={result} preview={preview} />
          )}
        </div>

        <Footer
          phase={phase}
          files={files}
          selected={selected}
          preview={preview}
          pending={pending}
          onClose={handleClose}
          onScan={scan}
          onImport={runImport}
          onDone={handleClose}
          onImportMore={reset}
        />
      </div>
    </div>
  );
}

/* ─── Header ─────────────────────────────────────────────────────────── */

function Header({ phase, onClose, pending }: { phase: Phase; onClose: () => void; pending: boolean }) {
  const stepIndex = phase === "upload" ? 0
    : phase === "scanning" ? 0
    : phase === "preview" ? 1
    : phase === "importing" ? 2
    : 3;
  const steps = ["Upload", "Preview & review", "Import", "Done"];
  return (
    <div className="border-b border-border px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Import from ProPresenter</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bring over songs and backgrounds from your ProPresenter library.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-30"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em]">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-6 items-center gap-2 rounded-full px-3 font-semibold transition ${
                i < stepIndex
                  ? "bg-emerald-500/15 text-emerald-500"
                  : i === stepIndex
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i < stepIndex ? <CheckCircle2 className="h-3 w-3" /> : <span>{i + 1}</span>}
              {label}
            </div>
            {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Step 1: Upload ─────────────────────────────────────────────────── */

function UploadStep({
  files, onFiles, onScan, onClear, error,
}: {
  files: File[];
  onFiles: (fs: FileList | File[]) => void;
  onScan: () => void;
  onClear: () => void;
  error: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="space-y-4 p-6">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-12 text-center transition ${
          dragOver
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
            : "border-border hover:border-[var(--color-primary)]/50"
        }`}
      >
        <input
          type="file"
          multiple
          accept=".proBundle,.pro,.pro6,.pro5,.pro7,.pro7x,.zip"
          className="hidden"
          onChange={(e) => e.target.files && onFiles(e.target.files)}
        />
        <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
          <Upload className="h-6 w-6" />
        </div>
        <div className="text-base font-semibold text-foreground">
          Drop your ProPresenter file here
        </div>
        <div className="text-sm text-muted-foreground">
          or <span className="text-[var(--color-primary)] underline">click to browse</span>
        </div>
        <div className="text-xs text-muted-foreground">
          .proBundle, .pro, .pro6, .pro5, .pro7, .pro7x — up to {MAX_TOTAL_MB} MB
        </div>
      </label>

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {files.length} file{files.length === 1 ? "" : "s"} ready
            </div>
            <button type="button" onClick={onClear} className="text-xs text-muted-foreground underline hover:text-foreground">
              Clear
            </button>
          </div>
          <ul className="space-y-1.5 text-sm">
            {files.slice(0, 5).map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 truncate">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </li>
            ))}
            {files.length > 5 && (
              <li className="text-xs text-muted-foreground">…and {files.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setHelpOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {helpOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        How do I export from ProPresenter?
      </button>
      {helpOpen && (
        <ol className="space-y-1 rounded-xl border border-border bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
          <li>1. Open ProPresenter on your computer.</li>
          <li>2. In your song library, select all songs (Cmd+A on Mac, Ctrl+A on Windows).</li>
          <li>3. Right-click, choose <span className="text-foreground">Export</span> → <span className="text-foreground">Presentation Bundle</span>.</li>
          <li>4. Save the .proBundle file somewhere easy to find.</li>
          <li>5. Come back here and drop it above.</li>
        </ol>
      )}
    </div>
  );
}

/* ─── Step 1b: Scanning ──────────────────────────────────────────────── */

function ScanningStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
      <div className="grid h-14 w-14 animate-pulse place-items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
        <Music className="h-6 w-6" />
      </div>
      <div className="text-base font-semibold text-foreground">Reading your library…</div>
      <div className="text-sm text-muted-foreground">
        Parsing songs and extracting backgrounds. Larger bundles take a few seconds.
      </div>
    </div>
  );
}

/* ─── Step 2: Preview ────────────────────────────────────────────────── */

function PreviewStep({
  preview, selected, setSelected, expanded, setExpanded, query, setQuery, error,
}: {
  preview: PreviewData;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  expanded: Set<string>;
  setExpanded: (s: Set<string>) => void;
  query: string;
  setQuery: (s: string) => void;
  error: string | null;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return preview.songs;
    return preview.songs.filter((s) =>
      s.title.toLowerCase().includes(q) || (s.artist || "").toLowerCase().includes(q),
    );
  }, [preview.songs, query]);

  const dupCount = preview.songs.filter((s) => s.isDuplicate).length;
  const cleanCount = preview.songs.length - dupCount;

  function toggle(title: string) {
    const next = new Set(selected);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    setSelected(next);
  }

  function toggleExpand(title: string) {
    const next = new Set(expanded);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    setExpanded(next);
  }

  function selectAll() { setSelected(new Set(preview.songs.map((s) => s.title))); }
  function selectNone() { setSelected(new Set()); }
  function selectNonDupes() { setSelected(new Set(preview.songs.filter((s) => !s.isDuplicate).map((s) => s.title))); }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-bold text-foreground">
            {preview.songs.length} song{preview.songs.length === 1 ? "" : "s"} found
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> {cleanCount} ready
            </span>
            {dupCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> {dupCount} duplicate{dupCount === 1 ? "" : "s"}
              </span>
            )}
            {preview.mediaCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <ImageIcon className="h-3 w-3" /> {preview.mediaCount} background{preview.mediaCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="h-9 w-48 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-[var(--color-primary)]/70"
          />
          <button onClick={selectAll} className="text-xs text-muted-foreground underline hover:text-foreground">Select all</button>
          <button onClick={selectNonDupes} className="text-xs text-muted-foreground underline hover:text-foreground">Non-duplicates</button>
          <button onClick={selectNone} className="text-xs text-muted-foreground underline hover:text-foreground">None</button>
        </div>
      </div>

      {preview.warnings.length > 0 && (
        <details className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <summary className="cursor-pointer text-amber-400">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            {preview.warnings.length} file{preview.warnings.length === 1 ? "" : "s"} had warnings — click to review
          </summary>
          <ul className="mt-2 space-y-1 pl-6 text-xs text-muted-foreground">
            {preview.warnings.slice(0, 20).map((w, i) => (
              <li key={i}>
                <span className="text-foreground">{w.file}</span>: {w.warnings.join("; ")}
              </li>
            ))}
            {preview.warnings.length > 20 && <li>…and {preview.warnings.length - 20} more</li>}
          </ul>
        </details>
      )}

      <div className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No songs match &ldquo;{query}&rdquo;
          </div>
        ) : (
          filtered.map((s) => (
            <PreviewRow
              key={s.title + (s.sourceRef || "")}
              song={s}
              checked={selected.has(s.title)}
              expanded={expanded.has(s.title)}
              onToggle={() => toggle(s.title)}
              onToggleExpand={() => toggleExpand(s.title)}
            />
          ))
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function PreviewRow({
  song, checked, expanded, onToggle, onToggleExpand,
}: {
  song: PreviewSong;
  checked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onToggleExpand: () => void;
}) {
  return (
    <div className={`transition ${checked ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 rounded border-border accent-[var(--color-primary)]"
        />
        <button
          type="button"
          onClick={onToggleExpand}
          className="text-muted-foreground transition hover:text-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{song.title}</span>
            {song.isDuplicate && (
              <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                Duplicate
              </span>
            )}
            {song.ccli && (
              <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                CCLI {song.ccli}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {song.artist ? `${song.artist} · ` : ""}
            {song.slideCount} slide{song.slideCount === 1 ? "" : "s"}
            {song.mediaHints.length > 0 ? ` · ${song.mediaHints.length} media` : ""}
          </div>
        </div>
        <div className="shrink-0">
          <span className={`h-2 w-2 rounded-full ${
            song.slideCount === 0 ? "bg-red-500 inline-block" :
            song.isDuplicate ? "bg-amber-500 inline-block" : "bg-emerald-500 inline-block"
          }`} />
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          {song.slidesPreview.length === 0 ? (
            <div className="text-xs italic text-muted-foreground">No lyric text extracted for this song.</div>
          ) : (
            <div className="space-y-3">
              {song.slidesPreview.map((slide, i) => (
                <div key={i} className="rounded-lg border border-border bg-background p-3 text-xs leading-relaxed">
                  <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Slide {i + 1}</div>
                  <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{slide}</pre>
                </div>
              ))}
              {song.slideCount > 2 && (
                <div className="text-xs text-muted-foreground">
                  …plus {song.slideCount - 2} more slide{song.slideCount - 2 === 1 ? "" : "s"} in this song.
                </div>
              )}
            </div>
          )}
          {song.mediaHints.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ImageIcon className="h-3 w-3" />
              Referenced media: <span className="truncate text-foreground">{song.mediaHints.slice(0, 3).join(", ")}</span>
              {song.mediaHints.length > 3 && <span>+{song.mediaHints.length - 3}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Step 3: Importing ──────────────────────────────────────────────── */

function ImportingStep({ total }: { total: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
        <Upload className="h-6 w-6 animate-bounce" />
      </div>
      <div className="text-base font-semibold text-foreground">
        Importing {total} song{total === 1 ? "" : "s"}…
      </div>
      <div className="text-sm text-muted-foreground">
        Uploading backgrounds, generating thumbnails, writing to your library.
      </div>
      <div className="mt-2 h-2 w-64 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-pulse bg-[var(--color-primary)]" />
      </div>
    </div>
  );
}

/* ─── Step 4: Complete ───────────────────────────────────────────────── */

function CompleteStep({ result, preview }: { result: CompleteData; preview: PreviewData }) {
  return (
    <div className="space-y-6 p-6">
      <div className="text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <div className="mt-4 text-2xl font-bold text-foreground">
          {result.added} song{result.added === 1 ? "" : "s"} imported!
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Your library is ready. Head to the Songs page to project them, or reopen to import more.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Songs imported" value={result.added} tone="emerald" />
        <StatTile label="Backgrounds saved" value={result.mediaAdded} tone="primary" icon={<ImageIcon className="h-3.5 w-3.5" />} />
        <StatTile label="Songs linked to a background" value={result.backgroundsLinked} tone="primary" />
        <StatTile label="Skipped" value={result.skipped} tone={result.skipped > 0 ? "amber" : "muted"} />
      </div>

      {preview.mediaSample.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Backgrounds you brought over
          </div>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {preview.mediaSample.slice(0, 12).map((m) => (
              <div
                key={m.fileName}
                className="flex aspect-video items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground"
                title={m.fileName}
              >
                {m.kind === "video" ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
              </div>
            ))}
          </div>
          {preview.mediaCount > 12 && (
            <div className="mt-2 text-xs text-muted-foreground">
              …plus {preview.mediaCount - 12} more in your Media library.
            </div>
          )}
        </div>
      )}

      {result.warnings.length > 0 && (
        <details className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <summary className="cursor-pointer text-amber-400">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"} — click to review
          </summary>
          <ul className="mt-2 space-y-1 pl-6 text-xs text-muted-foreground">
            {result.warnings.slice(0, 15).map((w, i) => (
              <li key={i}>
                <span className="text-foreground">{w.file}</span>: {w.warnings.join("; ")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function StatTile({ label, value, tone, icon }: {
  label: string; value: number;
  tone: "emerald" | "primary" | "amber" | "muted";
  icon?: React.ReactNode;
}) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    primary: "border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5 text-[var(--color-primary)]",
    amber: "border-amber-500/20 bg-amber-500/5 text-amber-400",
    muted: "border-border bg-muted/30 text-muted-foreground",
  }[tone];
  return (
    <div className={`rounded-xl border p-4 text-center ${tones}`}>
      <div className="flex items-center justify-center gap-1.5 text-3xl font-bold">
        {icon} {value}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.1em]">{label}</div>
    </div>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────── */

function Footer({
  phase, files, selected, preview, pending,
  onClose, onScan, onImport, onDone, onImportMore,
}: {
  phase: Phase;
  files: File[];
  selected: Set<string>;
  preview: PreviewData | null;
  pending: boolean;
  onClose: () => void;
  onScan: () => void;
  onImport: () => void;
  onDone: () => void;
  onImportMore: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/20 px-6 py-3">
      <div className="text-xs text-muted-foreground">
        {phase === "preview" && preview && (
          <>Importing {selected.size} of {preview.songs.length} song{preview.songs.length === 1 ? "" : "s"}</>
        )}
        {phase === "upload" && files.length > 0 && (
          <>{files.length} file{files.length === 1 ? "" : "s"} ready to scan</>
        )}
      </div>
      <div className="flex items-center gap-2">
        {(phase === "upload" || phase === "preview") && (
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-9 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-30"
          >
            Cancel
          </button>
        )}
        {phase === "upload" && (
          <button
            type="button"
            onClick={onScan}
            disabled={pending || files.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-40"
          >
            Scan library <ArrowRight className="h-4 w-4" />
          </button>
        )}
        {phase === "preview" && (
          <button
            type="button"
            onClick={onImport}
            disabled={pending || selected.size === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-40"
          >
            Import {selected.size} song{selected.size === 1 ? "" : "s"} <ArrowRight className="h-4 w-4" />
          </button>
        )}
        {phase === "complete" && (
          <>
            <button
              type="button"
              onClick={onImportMore}
              className="h-9 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-accent"
            >
              Import more
            </button>
            <button
              type="button"
              onClick={onDone}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] hover:opacity-90"
            >
              Go to Song Library
            </button>
          </>
        )}
      </div>
    </div>
  );
}
