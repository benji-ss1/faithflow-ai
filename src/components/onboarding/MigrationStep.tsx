"use client";
import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Upload, FileText, AlertCircle, ExternalLink, Info } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { importPro6Files, importSongsCsv } from "@/lib/actions";

type Source = "propresenter" | "easyworship" | "proclaim" | "csv" | "skip";

type Summary = { added: number; skipped: number; warnings?: { file: string; warnings: string[] }[] };

export function MigrationStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [source, setSource] = useState<Source | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pending, startTransition] = useTransition();

  async function handlePro6Upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    startTransition(async () => {
      const payload: { name: string; content: string }[] = [];
      for (const f of Array.from(files)) {
        if (!/\.pro6?$/i.test(f.name)) continue;
        payload.push({ name: f.name, content: await f.text() });
      }
      if (payload.length === 0) { toast.error("No .pro6 files selected"); return; }
      const res = await importPro6Files(payload);
      if (!res.ok) { toast.error(res.error); return; }
      setSummary(res.data!);
      toast.success(`Imported ${res.data!.added} song${res.data!.added !== 1 ? "s" : ""}`);
    });
    e.target.value = "";
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    startTransition(async () => {
      const text = await f.text();
      const res = await importSongsCsv(text);
      if (!res.ok) { toast.error(res.error); return; }
      setSummary({ added: res.data!.added, skipped: res.data!.skipped });
      toast.success(`Imported ${res.data!.added} song${res.data!.added !== 1 ? "s" : ""}`);
    });
    e.target.value = "";
  }

  return (
    <div className="border border-border rounded-md bg-card p-6 space-y-4">
      <header className="border-b border-border pb-3 mb-1 flex items-start gap-3">
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Upload className="w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-semibold">Bring your library</div>
          <div className="text-xs text-muted-foreground mt-0.5">Are you switching from another system? Import your songs so you're not starting from an empty library.</div>
        </div>
      </header>

      {!source && (
        <div className="grid grid-cols-2 gap-3">
          <SourceCard
            title="ProPresenter" description=".pro6 file export"
            supported="full"
            onClick={() => setSource("propresenter")} />
          <SourceCard
            title="EasyWorship" description="CSV export from the app"
            supported="via_csv"
            onClick={() => setSource("easyworship")} />
          <SourceCard
            title="Proclaim" description="Cloud-only; no file export"
            supported="none"
            onClick={() => setSource("proclaim")} />
          <SourceCard
            title="Starting fresh / Other" description="Skip this step or bring CSV"
            supported="skip"
            onClick={() => setSource("skip")} />
        </div>
      )}

      {source === "propresenter" && (
        <div className="space-y-3">
          <button onClick={() => { setSource(null); setSummary(null); }} className="text-xs text-muted-foreground hover:text-foreground">← Choose a different source</button>
          <p className="text-xs text-muted-foreground">
            Select one or more <span className="font-mono">.pro6</span> files. We'll extract song titles, authors, and slide lyrics.
            <span className="block mt-1">Note: <span className="font-mono">.pro7</span> is a different (JSON) format not covered here — export as .pro6 or paste as CSV.</span>
          </p>
          <label className="inline-flex items-center gap-2 h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent cursor-pointer">
            <input type="file" multiple accept=".pro6" onChange={handlePro6Upload} disabled={pending} className="hidden" />
            <Upload className="w-4 h-4" /> {pending ? "Importing…" : "Choose .pro6 files"}
          </label>
        </div>
      )}

      {source === "easyworship" && (
        <div className="space-y-3">
          <button onClick={() => { setSource(null); setSummary(null); }} className="text-xs text-muted-foreground hover:text-foreground">← Choose a different source</button>
          <div className="border border-warning/40 bg-warning/5 rounded-md p-3 text-xs space-y-2">
            <div className="flex items-start gap-2 font-semibold text-warning"><Info className="w-3 h-3 mt-0.5" /> EasyWorship uses a proprietary database (Songs.db)</div>
            <p className="text-muted-foreground">
              EasyWorship's <span className="font-mono">Songs.db</span> is a Firebird database that we can't parse safely without reverse-engineering their schema.
              The cleanest path is EasyWorship's own <b>Export &rarr; CSV</b> feature (File → Songs → Export):
            </p>
            <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
              <li>In EasyWorship: File → Songs, select all, Export to CSV.</li>
              <li>Upload the CSV below.</li>
            </ol>
          </div>
          <label className="inline-flex items-center gap-2 h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent cursor-pointer">
            <input type="file" accept=".csv,.txt" onChange={handleCsvUpload} disabled={pending} className="hidden" />
            <Upload className="w-4 h-4" /> {pending ? "Importing…" : "Upload EasyWorship CSV"}
          </label>
        </div>
      )}

      {source === "proclaim" && (
        <div className="space-y-3">
          <button onClick={() => { setSource(null); setSummary(null); }} className="text-xs text-muted-foreground hover:text-foreground">← Choose a different source</button>
          <div className="border border-warning/40 bg-warning/5 rounded-md p-3 text-xs space-y-2">
            <div className="flex items-start gap-2 font-semibold text-warning"><AlertCircle className="w-3 h-3 mt-0.5" /> Proclaim has no bulk export</div>
            <p className="text-muted-foreground">
              Faithlife's Proclaim is cloud-only. There's no supported file export we can import from.
              You have three realistic options:
            </p>
            <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
              <li>Copy your song titles + lyrics into a CSV using the Universal importer below.</li>
              <li>Use the seeded public-domain hymns as a starting library.</li>
              <li>Add songs one at a time from Library → Songs.</li>
            </ol>
            <p className="text-muted-foreground">
              We'd rather be honest here than promise an import that isn't real. If Faithlife adds an export API, we'll wire it up.
            </p>
          </div>
          <button onClick={() => setSource("csv")} className="h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent">
            Use the universal CSV importer
          </button>
        </div>
      )}

      {(source === "csv" || source === "skip") && (
        <div className="space-y-3">
          <button onClick={() => { setSource(null); setSummary(null); }} className="text-xs text-muted-foreground hover:text-foreground">← Choose a different source</button>
          {source === "csv" && (
            <>
              <p className="text-xs text-muted-foreground">
                CSV format: <code className="font-mono px-1 bg-muted rounded-sm">title,artist,slide1,slide2,…</code>. Also accepts a plain text file with
                songs separated by <span className="font-mono">---</span>.
              </p>
              <label className="inline-flex items-center gap-2 h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent cursor-pointer">
                <input type="file" accept=".csv,.txt" onChange={handleCsvUpload} disabled={pending} className="hidden" />
                <Upload className="w-4 h-4" /> {pending ? "Importing…" : "Upload CSV or text"}
              </label>
            </>
          )}
          {source === "skip" && (
            <p className="text-xs text-muted-foreground">
              No problem — you can always add songs later from the <b>Songs</b> library, one at a time or via the same importers.
            </p>
          )}
        </div>
      )}

      {summary && (
        <div className="border border-success/40 bg-success/5 rounded-md p-3 text-xs space-y-2">
          <div className="font-semibold text-success">Imported {summary.added} song{summary.added !== 1 && "s"}
            {summary.skipped > 0 && <span className="text-muted-foreground font-normal"> · {summary.skipped} skipped (duplicate title or empty)</span>}
          </div>
          {summary.warnings && summary.warnings.length > 0 && (
            <details>
              <summary className="cursor-pointer text-warning font-semibold">{summary.warnings.length} file{summary.warnings.length !== 1 && "s"} had warnings</summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {summary.warnings.slice(0, 20).map((w, i) => (
                  <li key={i}><span className="font-mono">{w.file}</span>: {w.warnings.join("; ")}</li>
                ))}
                {summary.warnings.length > 20 && <li>…and {summary.warnings.length - 20} more</li>}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex justify-between pt-2 border-t border-border">
        <button onClick={onBack} className="h-11 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent flex items-center gap-1.5">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button onClick={onNext} className="h-11 px-6 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 flex items-center gap-1.5">
          {summary ? "Continue" : "Skip for now"} <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function SourceCard({ title, description, supported, onClick }: {
  title: string;
  description: string;
  supported: "full" | "via_csv" | "none" | "skip";
  onClick: () => void;
}) {
  const badge =
    supported === "full" ? { text: "Supported", cls: "text-success border-success/40 bg-success/5" }
    : supported === "via_csv" ? { text: "Via CSV export", cls: "text-warning border-warning/40 bg-warning/5" }
    : supported === "none" ? { text: "No import path", cls: "text-destructive border-destructive/40 bg-destructive/5" }
    : { text: "Manual", cls: "text-muted-foreground border-border" };

  return (
    <button onClick={onClick}
      className="text-left border border-border rounded-md p-3 hover:bg-accent transition-all">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold">{title}</div>
        <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded-sm border", badge.cls)}>{badge.text}</span>
      </div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </button>
  );
}
