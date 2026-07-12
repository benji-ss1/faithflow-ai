"use client";

// Migration wizard: 4 steps, all client-side navigation with server-side
// parsing. Files are only sent to /api/imports/parse (server) — never to
// a client-side parser or a third party. On confirm the client calls the
// finalizeImport server action.

import { useState } from "react";
import Link from "next/link";
import { finalizeImport } from "@/lib/import-actions";
import { ElectronPickFilesButton, ElectronPickFolderButton } from "@/components/electron/ElectronFilePickers";

type SourceCard = {
  id: "propresenter" | "easyworship" | "proclaim" | "openlp" | "mediashout" | "worshiptools" | "csv" | "none";
  title: string;
  subtitle: string;
  support: "full" | "partial" | "stub" | "skip";
};

const SOURCES: SourceCard[] = [
  { id: "propresenter", title: "ProPresenter", subtitle: ".pro6 / .pro5 XML", support: "full" },
  { id: "csv", title: "CSV or Plain Text", subtitle: "Spreadsheet export or copy-paste", support: "full" },
  { id: "proclaim", title: "Proclaim (Faithlife)", subtitle: "JSON export", support: "partial" },
  { id: "openlp", title: "OpenLP", subtitle: ".osz OpenLyrics archive", support: "partial" },
  { id: "easyworship", title: "EasyWorship", subtitle: "SongsDB.db (SQLite)", support: "stub" },
  { id: "mediashout", title: "MediaShout", subtitle: ".msh (proprietary)", support: "stub" },
  { id: "worshiptools", title: "WorshipTools", subtitle: ".wtx / .wtt", support: "stub" },
  { id: "none", title: "Starting Fresh", subtitle: "Skip and start with an empty library", support: "skip" },
];

type Summary = {
  parserId: string;
  counts: { songs: number; media: number; skipped: number };
  songs: { title: string; artist: string | null; slideCount: number; sourceFile: string }[];
  media: { fileName: string; mimeType: string; sizeBytes: number }[];
  skipped: { file: string; reason: string }[];
};

export function WizardClient() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [source, setSource] = useState<SourceCard | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [migrationJobId, setMigrationJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState<{ songs: number; media: number; skipped: number } | null>(null);

  function pickSource(s: SourceCard) {
    setSource(s);
    setError(null);
    if (s.id === "none") {
      setStep(4); // Nothing to import — jump to done state.
    } else {
      setStep(2);
    }
  }

  async function submitFiles() {
    if (!source || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.webkitRelativePath || f.name);
      const res = await fetch(`/api/imports/parse?source=${encodeURIComponent(source.id)}`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMigrationJobId(json.migrationJobId);
      setSummary(json.summary);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
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
      <ol className="flex gap-2 text-xs text-muted-foreground">
        {[1, 2, 3, 4].map((n) => (
          <li key={n} className={`px-2 py-1 rounded-sm ${step === n ? "bg-primary text-primary-foreground font-medium" : "bg-muted"}`}>
            Step {n}
          </li>
        ))}
      </ol>

      {error && <div className="border border-destructive bg-destructive/10 text-destructive text-sm rounded-md p-3">{error}</div>}

      {step === 1 && (
        <div>
          <h2 className="text-lg font-medium mb-3">What are you switching from?</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                onClick={() => pickSource(s)}
                className="text-left border border-border rounded-md p-4 hover:border-primary hover:bg-muted transition-colors"
              >
                <div className="font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.subtitle}</div>
                <div className="mt-2 text-[10px] uppercase tracking-wide">
                  {s.support === "full" && <span className="text-success">Fully supported</span>}
                  {s.support === "partial" && <span className="text-warning">Partial support</span>}
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
            <h2 className="text-lg font-medium mt-2">Select files from your {source.title} library</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Pick individual files or an entire folder. Files are parsed server-side; nothing leaves your session until you confirm.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="border border-border rounded-md p-4 cursor-pointer hover:border-primary">
              <div className="font-medium text-sm">Pick a folder</div>
              <div className="text-xs text-muted-foreground mt-1">Recursively scans everything inside.</div>
              <input
                type="file"
                // @ts-expect-error webkitdirectory is nonstandard but widely supported
                webkitdirectory=""
                directory=""
                multiple
                className="mt-2 text-xs"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
            </label>
            <label className="border border-border rounded-md p-4 cursor-pointer hover:border-primary">
              <div className="font-medium text-sm">Pick individual files</div>
              <div className="text-xs text-muted-foreground mt-1">Cmd/Ctrl-click to select multiple.</div>
              <input
                type="file"
                multiple
                className="mt-2 text-xs"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
            </label>
          </div>
          <div
            className="flex flex-wrap items-center gap-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = Array.from(e.dataTransfer.files || []);
              if (dropped.length) setFiles(dropped);
            }}
          >
            <ElectronPickFilesButton
              extensions={[".pro6", ".pro7", ".pro7x", ".pro5", ".xml", ".easypres", ".osz", ".json", ".csv", ".txt"]}
              label="Choose from computer…"
              className="h-9 px-3 border border-border rounded-md text-sm font-semibold hover:bg-accent"
              onFiles={async (picked) => {
                const built: File[] = [];
                for (const f of picked) {
                  if (f.tooLarge || !f.base64) continue;
                  const bin = atob(f.base64);
                  const bytes = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                  built.push(new File([bytes], f.name));
                }
                if (built.length) setFiles((prev) => [...prev, ...built]);
              }}
            />
            <ElectronPickFolderButton
              extensions={[".pro6", ".pro7", ".pro7x", ".pro5", ".easypres", ".xml"]}
              label="Import folder…"
              className="h-9 px-3 border border-border rounded-md text-sm font-semibold hover:bg-accent"
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
                  // Attach relative path (used server-side via file.webkitRelativePath).
                  try { Object.defineProperty(file, "webkitRelativePath", { value: entry.relPath }); } catch { /* readonly in some runtimes */ }
                  built.push(file);
                }
                if (built.length) setFiles((prev) => [...prev, ...built]);
              }}
            />
            <span className="text-xs text-muted-foreground">Or drop files here.</span>
          </div>
          {files.length > 0 && (
            <div className="text-sm">
              <div className="font-medium">{files.length} file(s) selected</div>
              <div className="text-xs text-muted-foreground">
                Total {(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              disabled={files.length === 0 || uploading}
              onClick={submitFiles}
              className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md disabled:opacity-50"
            >
              {uploading ? "Parsing…" : "Parse files"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && summary && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Review parse results</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Nothing has been added to your library yet. Confirm below to commit.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 max-w-lg">
            <Stat label="Songs found" value={summary.counts.songs} />
            <Stat label="Media files" value={summary.counts.media} />
            <Stat label="Skipped" value={summary.counts.skipped} />
          </div>
          {summary.songs.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Sample songs</div>
              <ul className="border border-border rounded-md divide-y divide-border text-sm">
                {summary.songs.slice(0, 10).map((s, i) => (
                  <li key={i} className="p-2 flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.title}</div>
                      {s.artist && <div className="text-xs text-muted-foreground">{s.artist}</div>}
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">{s.slideCount} slides</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.skipped.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Skipped (top 10)</div>
              <ul className="border border-border rounded-md divide-y divide-border text-xs">
                {summary.skipped.slice(0, 10).map((s, i) => (
                  <li key={i} className="p-2">
                    <div className="font-mono truncate">{s.file}</div>
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
              className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md disabled:opacity-50"
            >
              {uploading ? "Importing…" : "Confirm import"}
            </button>
            <button
              onClick={() => { setStep(1); setSummary(null); setMigrationJobId(null); setFiles([]); }}
              className="border border-border text-sm px-4 py-2 rounded-md"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">All done</h2>
          {finalized ? (
            <p className="text-sm">
              Imported <strong>{finalized.songs}</strong> song(s), <strong>{finalized.media}</strong> media asset(s).
              {" "}Skipped <strong>{finalized.skipped}</strong>.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to import. Your library is ready to use.</p>
          )}
          <div className="flex gap-2">
            <Link href="/library/songs" className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md">Go to songs</Link>
            <Link href="/library/imports/wizard" className="border border-border text-sm px-4 py-2 rounded-md">Import another</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
