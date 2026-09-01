"use client";

// Migration wizard: 4 steps, all client-side navigation with server-side
// parsing. Files are only sent to /api/imports/parse (server) — never to
// a client-side parser or a third party. On confirm the client calls the
// finalizeImport server action.

import { useCallback, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileText, FolderOpen, Upload, X } from "lucide-react";
import { finalizeImport } from "@/lib/import-actions";
import { ElectronPickFilesButton, ElectronPickFolderButton } from "@/components/electron/ElectronFilePickers";
import { stripProBundles } from "@/lib/pro-bundle-strip";

type SourceCard = {
  id: "propresenter" | "easyworship" | "proclaim" | "openlp" | "mediashout" | "worshiptools" | "videopsalm" | "csv" | "none";
  title: string;
  subtitle: string;
  support: "full" | "partial" | "stub" | "skip";
};

const SOURCES: SourceCard[] = [
  { id: "propresenter", title: "ProPresenter", subtitle: ".pro6 / .pro5 XML", support: "full" },
  { id: "videopsalm", title: "VideoPsalm", subtitle: ".json songbook export", support: "full" },
  { id: "csv", title: "CSV or Plain Text", subtitle: "Spreadsheet export or copy-paste", support: "full" },
  { id: "proclaim", title: "Proclaim (Faithlife)", subtitle: "JSON export", support: "partial" },
  { id: "openlp", title: "OpenLP", subtitle: ".osz OpenLyrics archive", support: "partial" },
  { id: "easyworship", title: "EasyWorship", subtitle: "SongsDB.db (SQLite)", support: "stub" },
  { id: "mediashout", title: "MediaShout", subtitle: ".msh (proprietary)", support: "stub" },
  { id: "worshiptools", title: "WorshipTools", subtitle: ".wtx / .wtt", support: "stub" },
  { id: "none", title: "Starting fresh", subtitle: "Skip and start with an empty library", support: "skip" },
];

type Summary = {
  parserId: string;
  counts: { songs: number; media: number; skipped: number; duplicates: number };
  // `alreadyExists` marks songs whose title matches an existing entry in the
  // church's library — finalize will silently skip them, so we surface which
  // ones on the review step.
  songs: { title: string; artist: string | null; slideCount: number; sourceFile: string; alreadyExists: boolean }[];
  media: { fileName: string; mimeType: string; sizeBytes: number }[];
  skipped: { file: string; reason: string }[];
  duplicates: string[];
};

type StageKind = "parsing" | "uploading-media" | "checking-duplicates";
type ProgressState = {
  stage: StageKind;
  processed: number;
  total: number;
  currentFile?: string;
};

const STAGE_LABELS: Record<StageKind, string> = {
  parsing: "Parsing files",
  "uploading-media": "Uploading media",
  "checking-duplicates": "Checking for duplicates",
};

export function WizardClient() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [source, setSource] = useState<SourceCard | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [migrationJobId, setMigrationJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState<{ songs: number; media: number; skipped: number } | null>(null);

  const addFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    setFiles((prev) => {
      const byKey = new Map(prev.map((f) => [`${f.name}:${f.size}`, f]));
      for (const f of incoming) byKey.set(`${f.name}:${f.size}`, f);
      return Array.from(byKey.values());
    });
  }, []);

  function removeFile(target: File) {
    setFiles((prev) => prev.filter((f) => !(f.name === target.name && f.size === target.size)));
  }

  function pickSource(s: SourceCard) {
    setSource(s);
    setError(null);
    if (s.id === "none") setStep(4);
    else setStep(2);
  }

  async function submitFiles() {
    if (!source || files.length === 0) return;
    setUploading(true);
    setError(null);
    setProgress({ stage: "parsing", processed: 0, total: files.length });
    try {
      // Strip embedded media in the browser BEFORE upload. A ProPresenter
      // .probundle bundles the (tiny) lyric docs with (huge) backgrounds — a
      // real 171 MB export was 559 songs but only 5.4 MB of lyrics. Sending the
      // raw bundle blows the server's 100 MB/file + 250 MB caps and the import
      // dies with a generic error. We upload lyrics only (backgrounds are
      // re-themed in-app). Bare .pro/.pro6/.pro7 files pass through unchanged.
      const isProPresenter = source.id === "propresenter";
      const fd = new FormData();
      if (isProPresenter) {
        const { docs, expandedFrom, skippedMedia, truncated, skippedFiles } = await stripProBundles(files);
        if (docs.length === 0) {
          throw new Error(skippedFiles.length
            ? `Could not read ${skippedFiles.length} file(s). If these are very large bundles, export the library in smaller parts.`
            : "No song documents found in these files.");
        }
        for (const d of docs) {
          const name = d.path.split("/").pop() || d.path;
          // Copy into a fresh ArrayBuffer so the Blob type is definitively
          // ArrayBuffer (not a shared view) before handing it to File().
          const ab = new ArrayBuffer(d.bytes.length);
          new Uint8Array(ab).set(d.bytes);
          fd.append("files", new File([ab], name, { type: "application/octet-stream" }), name);
        }
        const rawBytes = docs.reduce((s, d) => s + d.bytes.length, 0);
        if (expandedFrom > 0 || skippedMedia > 0) {
          setProgress({ stage: "parsing", processed: 0, total: docs.length,
            currentFile: `Extracted ${docs.length} songs (${Math.round(rawBytes / 1024 / 1024)} MB, skipped ${skippedMedia} media)` });
        }
        if (truncated || skippedFiles.length > 0) {
          // Non-fatal: proceed with what we extracted, warn via error banner after.
          console.warn("[import] some content skipped (size caps):", skippedFiles);
        }
      } else {
        for (const f of files) fd.append("files", f, f.webkitRelativePath || f.name);
      }
      const res = await fetch(`/api/imports/parse?source=${encodeURIComponent(source.id)}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        // Errors on the parse endpoint are JSON (not NDJSON) — a 4xx / 5xx
        // never enters streaming mode. Fall back to json().
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      // Consume NDJSON stream — one JSON event per line. Bufferful reads
      // are split on newlines; anything after the last newline stays in
      // buffer for the next chunk.
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: {
            type: string;
            stage?: StageKind;
            processed?: number;
            total?: number;
            currentFile?: string;
            migrationJobId?: string;
            summary?: Summary;
            error?: string;
          };
          try {
            event = JSON.parse(trimmed);
          } catch { continue; }
          if (event.type === "stage" || event.type === "progress") {
            if (event.stage && typeof event.processed === "number" && typeof event.total === "number") {
              setProgress({
                stage: event.stage,
                processed: event.processed,
                total: event.total,
                currentFile: event.currentFile,
              });
            }
          } else if (event.type === "done") {
            if (event.migrationJobId) setMigrationJobId(event.migrationJobId);
            if (event.summary) setSummary(event.summary);
            setStep(3);
          } else if (event.type === "error") {
            throw new Error(event.error || "Server error during parse");
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function confirmImport() {
    if (!migrationJobId) return;
    setUploading(true);
    setError(null);
    try {
      const res = await finalizeImport(migrationJobId);
      if (!res.ok) throw new Error(res.error);
      setFinalized({ songs: res.data!.added.songs, media: res.data!.added.media, skipped: res.data!.skipped });
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Finalize failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <ol className="flex items-center gap-2 text-xs">
        {[
          { n: 1, label: "Source" },
          { n: 2, label: "Files" },
          { n: 3, label: "Review" },
          { n: 4, label: "Done" },
        ].map((s, i, arr) => (
          <li key={s.n} className="flex items-center gap-2">
            <span
              className={`inline-flex h-6 items-center rounded-full px-2.5 font-medium ${
                step === s.n
                  ? "bg-[var(--pf-admin-accent)] text-[var(--pf-admin-text-inverse)]"
                  : step > s.n
                    ? "bg-[var(--pf-admin-accent-soft)] text-[var(--pf-admin-accent)]"
                    : "bg-[var(--pf-admin-bg-muted)] text-[var(--pf-admin-text-secondary)]"
              }`}
            >
              {step > s.n ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
              {s.label}
            </span>
            {i < arr.length - 1 ? <span className="text-[var(--pf-admin-text-muted)]">→</span> : null}
          </li>
        ))}
      </ol>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {step === 1 && (
        <div>
          <h2 className="mb-3 text-lg font-medium">What are you switching from?</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                onClick={() => pickSource(s)}
                className="rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-[var(--pf-admin-accent)]/40 hover:bg-[var(--pf-admin-bg-hover)]"
              >
                <div className="font-medium">{s.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.subtitle}</div>
                <div className="mt-2 text-[10px] uppercase tracking-wide">
                  {s.support === "full" && <span className="text-[var(--pf-admin-green)]">Fully supported</span>}
                  {s.support === "partial" && <span className="text-[var(--pf-admin-gold)]">Partial support</span>}
                  {s.support === "stub" && <span className="text-muted-foreground">Detection only — export as CSV</span>}
                  {s.support === "skip" && <span className="text-muted-foreground">No import</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && source && (
        <div className="space-y-4">
          <div>
            <button onClick={() => setStep(1)} className="text-xs text-muted-foreground hover:underline">← Change source</button>
            <h2 className="mt-2 text-lg font-medium">Select files from your {source.title} library</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Drop files, pick a folder, or choose individual files. Everything is parsed server-side; nothing commits until you confirm on the next step.
            </p>
          </div>

          {/* Prominent full-width drop zone — primary interaction. */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = Array.from(e.dataTransfer.files || []);
              addFiles(dropped);
            }}
            className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
              dragOver
                ? "border-[var(--pf-admin-accent)] bg-[var(--pf-admin-accent-soft)]"
                : "border-border bg-[var(--pf-admin-bg-subtle)] hover:border-[var(--pf-admin-border-strong)]"
            }`}
          >
            <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--pf-admin-accent-soft)]">
              <Upload className="h-6 w-6 text-[var(--pf-admin-accent)]" />
            </div>
            <div className="text-base font-semibold text-foreground">
              {dragOver ? "Drop to add files" : `Drop ${source.title} files here`}
            </div>
            <div className="text-xs text-muted-foreground">
              or use the buttons below to pick from your computer
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-[var(--pf-admin-bg-hover)]">
                <FolderOpen className="h-4 w-4" />
                Pick a folder
                <input
                  type="file"
                  // @ts-expect-error webkitdirectory is nonstandard but widely supported
                  webkitdirectory=""
                  directory=""
                  multiple
                  className="sr-only"
                  onChange={(e) => addFiles(Array.from(e.target.files || []))}
                />
              </label>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-[var(--pf-admin-bg-hover)]">
                <FileText className="h-4 w-4" />
                Pick individual files
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(e) => addFiles(Array.from(e.target.files || []))}
                />
              </label>
              <ElectronPickFilesButton
                extensions={[".pro6", ".pro7", ".pro7x", ".pro5", ".xml", ".easypres", ".osz", ".json", ".csv", ".txt"]}
                label="Choose from computer…"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-[var(--pf-admin-bg-hover)]"
                onFiles={async (picked) => {
                  const built: File[] = [];
                  for (const f of picked) {
                    if (f.tooLarge || !f.base64) continue;
                    const bin = atob(f.base64);
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    built.push(new File([bytes], f.name));
                  }
                  if (built.length) addFiles(built);
                }}
              />
              <ElectronPickFolderButton
                extensions={[".pro6", ".pro7", ".pro7x", ".pro5", ".easypres", ".xml"]}
                label="Import folder…"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-[var(--pf-admin-bg-hover)]"
                onFolder={async (entries) => {
                  const api = window.electronAPI!;
                  const built: File[] = [];
                  for (const entry of entries) {
                    const r = await api.fs.readFile(entry.absPath);
                    if (r.tooLarge) continue;
                    const bin = atob(r.base64);
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    const file = new File([bytes], r.name);
                    try { Object.defineProperty(file, "webkitRelativePath", { value: entry.relPath }); } catch { /* readonly in some runtimes */ }
                    built.push(file);
                  }
                  if (built.length) addFiles(built);
                }}
              />
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="font-medium text-foreground">
                  {files.length} file{files.length === 1 ? "" : "s"} selected
                  <span className="ml-2 text-muted-foreground">
                    · {(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB total
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
              </div>
              <ul className="max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border bg-[var(--pf-admin-bg-subtle)] text-xs">
                {files.map((f) => (
                  <li key={`${f.name}:${f.size}`} className="flex items-center justify-between gap-2 p-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{f.webkitRelativePath || f.name}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                      <button
                        type="button"
                        onClick={() => removeFile(f)}
                        title="Remove"
                        className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-white/[0.04] hover:text-red-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Real progress bar driven by the NDJSON stream from
              /api/imports/parse. When idle: hidden. When running: shows
              the current stage (parsing / uploading-media / checking-
              duplicates), an X of Y, and the current filename. */}
          {uploading && progress ? (
            <div className="space-y-2 rounded-md border border-border bg-[var(--pf-admin-bg-subtle)] p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {STAGE_LABELS[progress.stage]}
                  {progress.total > 0 ? ` — ${Math.min(progress.processed, progress.total)} of ${progress.total}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {progress.total > 0 ? `${Math.round((progress.processed / progress.total) * 100)}%` : "…"}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--pf-admin-bg-muted)]">
                <div
                  className="h-full rounded-full bg-[var(--pf-admin-accent)] transition-all duration-200"
                  style={{ width: progress.total > 0 ? `${Math.min(100, (progress.processed / progress.total) * 100)}%` : "5%" }}
                />
              </div>
              {progress.currentFile ? (
                <div className="truncate font-mono text-[11px] text-muted-foreground" title={progress.currentFile}>
                  {progress.currentFile}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex gap-2">
            <button
              disabled={files.length === 0 || uploading}
              onClick={submitFiles}
              className="inline-flex h-10 items-center rounded-md bg-[var(--pf-admin-accent)] px-4 text-sm font-semibold text-[var(--pf-admin-text-inverse)] transition-colors hover:bg-[var(--pf-admin-accent-hover)] disabled:opacity-50"
            >
              {uploading ? `Parsing ${files.length} file${files.length === 1 ? "" : "s"}…` : `Parse ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {step === 3 && summary && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Review parse results</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing has been added to your library yet. Confirm below to commit.
              Duplicates (matched by title against songs already in your church) are
              automatically skipped — nothing overwrites your existing lyrics.
            </p>
          </div>
          <div className="grid max-w-xl grid-cols-4 gap-3">
            <Stat label="Songs found" value={summary.counts.songs} tone="brand" />
            <Stat label="Duplicates" value={summary.counts.duplicates} tone={summary.counts.duplicates > 0 ? "warning" : "neutral"} />
            <Stat label="Media" value={summary.counts.media} tone="neutral" />
            <Stat label="Skipped" value={summary.counts.skipped} tone={summary.counts.skipped > 0 ? "warning" : "neutral"} />
          </div>

          {summary.duplicates.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Duplicates — will be skipped ({summary.duplicates.length})
              </div>
              <div className="rounded-md border border-[var(--pf-admin-gold)]/25 bg-[rgba(239,159,39,0.06)] p-3 text-xs">
                <p className="mb-2 text-muted-foreground">
                  These titles already exist in your church library. Finalize will skip them instead of overwriting your existing lyrics. Rename in your source file and re-import if you want a second copy.
                </p>
                <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                  {summary.duplicates.map((title) => (
                    <li key={title} className="rounded border border-[var(--pf-admin-gold)]/30 bg-[var(--pf-admin-bg-card)] px-2 py-1 font-medium text-foreground">
                      {title}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {summary.songs.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Sample songs (first 10 of {summary.songs.length})
              </div>
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {summary.songs.slice(0, 10).map((s, i) => (
                  <li key={i} className="flex justify-between gap-2 p-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.title}</div>
                      {s.artist && <div className="text-xs text-muted-foreground">{s.artist}</div>}
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">{s.slideCount} slides</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.skipped.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Skipped (top 10)
              </div>
              <ul className="divide-y divide-border rounded-md border border-border text-xs">
                {summary.skipped.slice(0, 10).map((s, i) => (
                  <li key={i} className="p-2">
                    <div className="truncate font-mono">{s.file}</div>
                    <div className="text-muted-foreground">{s.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button
              disabled={uploading || summary.counts.songs === 0}
              onClick={confirmImport}
              className="inline-flex h-10 items-center rounded-md bg-[var(--pf-admin-accent)] px-4 text-sm font-semibold text-[var(--pf-admin-text-inverse)] disabled:opacity-50"
            >
              {uploading ? "Importing…" : "Confirm import"}
            </button>
            <button
              onClick={() => { setStep(1); setSummary(null); setMigrationJobId(null); setFiles([]); }}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-[var(--pf-admin-bg-hover)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-[var(--pf-admin-green)]" />
            <h2 className="text-lg font-medium">All done</h2>
          </div>
          {finalized ? (
            <p className="text-sm">
              Imported <strong>{finalized.songs}</strong> song{finalized.songs === 1 ? "" : "s"},{" "}
              <strong>{finalized.media}</strong> media asset{finalized.media === 1 ? "" : "s"}.
              {finalized.skipped > 0 ? <> Skipped <strong>{finalized.skipped}</strong> (duplicates or parse errors).</> : null}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to import. Your library is ready to use.</p>
          )}
          <div className="flex gap-2">
            <Link href="/library/songs" className="inline-flex h-10 items-center rounded-md bg-[var(--pf-admin-accent)] px-4 text-sm font-semibold text-[var(--pf-admin-text-inverse)]">
              Go to songs
            </Link>
            <Link href="/library/imports/wizard" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-[var(--pf-admin-bg-hover)]">
              Import another
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "brand" | "warning" | "neutral" }) {
  const cls =
    tone === "brand"
      ? "border-[var(--pf-admin-accent)]/25 bg-[var(--pf-admin-accent-soft)]"
      : tone === "warning"
        ? "border-[var(--pf-admin-gold)]/25 bg-[rgba(239,159,39,0.08)]"
        : "border-border bg-[var(--pf-admin-bg-subtle)]";
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
