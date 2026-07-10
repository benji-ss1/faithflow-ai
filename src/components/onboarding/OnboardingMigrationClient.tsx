"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ChevronLeft, Upload } from "lucide-react";
import { finalizeImport } from "@/lib/import-actions";

// CP5 onboarding migration: same 4-step model as /library/imports/wizard
// (source → upload → review → confirm) with a "Skip this step" affordance
// that jumps straight to /onboarding/tutorial without touching the DB.

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

export function OnboardingMigrationClient() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [source, setSource] = useState<SourceCard | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [migrationJobId, setMigrationJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState<{ songs: number; media: number; skipped: number } | null>(null);

  function advanceToTutorial() {
    router.push("/onboarding/tutorial");
  }

  function pickSource(s: SourceCard) {
    setSource(s);
    setError(null);
    if (s.id === "none") { setStep(4); return; }
    setStep(2);
  }

  async function submitFiles() {
    if (!source || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.webkitRelativePath || f.name);
      const res = await fetch(`/api/imports/parse?source=${encodeURIComponent(source.id)}`, { method: "POST", body: fd });
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

  async function confirm() {
    if (!migrationJobId) return;
    setFinalizing(true);
    setError(null);
    try {
      const res = await finalizeImport(migrationJobId);
      if (!res.ok) throw new Error(res.error);
      setFinalized({ songs: res.data!.added.songs, media: res.data!.added.media, skipped: res.data!.skipped });
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Finalize failed");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="space-y-4">
      <ol className="flex items-center gap-1 text-xs">
        {["Choose source", "Upload files", "Review", "Confirm"].map((label, i) => {
          const idx = (i + 1) as 1 | 2 | 3 | 4;
          const active = idx === step;
          const past = idx < step;
          return (
            <li key={label} className="flex items-center gap-1 flex-1">
              <span className={
                "flex items-center gap-1.5 px-2 py-1 rounded-sm " +
                (active ? "bg-foreground text-background font-semibold" : past ? "text-success" : "text-muted-foreground")
              }>
                <span className="w-3 h-3 rounded-full border border-current inline-block" />
                {label}
              </span>
              {idx < 4 && <span className="flex-1 h-px bg-border" />}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="border border-border rounded-md bg-card p-6 space-y-4">
          <div className="text-sm font-semibold">Where are you migrating from?</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {SOURCES.map((s) => (
              <button type="button" key={s.id} onClick={() => pickSource(s)}
                className="text-left border border-border rounded-md p-3 hover:bg-accent transition-all">
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="text-xs text-muted-foreground">{s.subtitle}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-between pt-2 border-t border-border">
            <Link href="/onboarding/church" className="h-9 px-4 border border-border rounded-md text-xs font-semibold hover:bg-accent flex items-center gap-1.5">
              <ChevronLeft className="w-3 h-3" /> Back
            </Link>
            <button onClick={advanceToTutorial} className="h-9 px-4 text-xs font-semibold text-muted-foreground hover:text-foreground">
              Skip this step →
            </button>
          </div>
        </div>
      )}

      {step === 2 && source && (
        <div className="border border-border rounded-md bg-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Upload className="w-4 h-4" />
            <div>
              <div className="text-sm font-semibold">Upload {source.title} files</div>
              <div className="text-xs text-muted-foreground">{source.subtitle}</div>
            </div>
          </div>
          <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="text-xs" />
          {files.length > 0 && (
            <div className="text-xs text-muted-foreground">{files.length} file{files.length !== 1 && "s"} selected</div>
          )}
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex justify-between pt-2 border-t border-border">
            <button type="button" onClick={() => setStep(1)} className="h-9 px-4 border border-border rounded-md text-xs font-semibold hover:bg-accent flex items-center gap-1.5">
              <ChevronLeft className="w-3 h-3" /> Back
            </button>
            <div className="flex gap-2">
              <button onClick={advanceToTutorial} className="h-9 px-4 text-xs font-semibold text-muted-foreground hover:text-foreground">Skip this step</button>
              <button type="button" onClick={submitFiles} disabled={uploading || files.length === 0}
                className="h-9 px-4 bg-foreground text-background rounded-md text-xs font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
                {uploading ? "Parsing…" : "Parse files"} <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && summary && (
        <div className="border border-border rounded-md bg-card p-6 space-y-4">
          <div className="text-sm font-semibold">Review — {summary.counts.songs} song{summary.counts.songs !== 1 && "s"}, {summary.counts.media} media, {summary.counts.skipped} skipped</div>
          {summary.songs.length > 0 && (
            <ul className="text-xs space-y-1 max-h-64 overflow-y-auto">
              {summary.songs.slice(0, 50).map((s, i) => (
                <li key={i} className="flex justify-between border-b border-border/50 pb-1">
                  <span>{s.title}{s.artist ? ` — ${s.artist}` : ""}</span>
                  <span className="text-muted-foreground">{s.slideCount} slide{s.slideCount !== 1 && "s"}</span>
                </li>
              ))}
              {summary.songs.length > 50 && <li className="text-muted-foreground">…and {summary.songs.length - 50} more</li>}
            </ul>
          )}
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex justify-between pt-2 border-t border-border">
            <button type="button" onClick={() => setStep(2)} className="h-9 px-4 border border-border rounded-md text-xs font-semibold hover:bg-accent flex items-center gap-1.5">
              <ChevronLeft className="w-3 h-3" /> Back
            </button>
            <div className="flex gap-2">
              <button onClick={advanceToTutorial} className="h-9 px-4 text-xs font-semibold text-muted-foreground hover:text-foreground">Skip this step</button>
              <button type="button" onClick={confirm} disabled={finalizing}
                className="h-9 px-4 bg-foreground text-background rounded-md text-xs font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
                {finalizing ? "Confirming…" : "Confirm import"} <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="border border-border rounded-md bg-card p-6 space-y-4">
          {finalized ? (
            <div className="border border-success/40 bg-success/5 rounded-md p-3 text-sm">
              <div className="font-semibold text-success">Imported {finalized.songs} song{finalized.songs !== 1 && "s"} + {finalized.media} media</div>
              {finalized.skipped > 0 && <div className="text-xs text-muted-foreground mt-1">{finalized.skipped} skipped (duplicates or empty).</div>}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Starting fresh — no problem. You can import later from Library → Imports.</div>
          )}
          <div className="flex justify-end pt-2 border-t border-border">
            <button onClick={advanceToTutorial}
              className="h-11 px-6 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 flex items-center gap-1.5">
              Continue to tutorial <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
