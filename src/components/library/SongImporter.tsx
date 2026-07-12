"use client";
import { useState, useTransition } from "react";
import { Upload, FileText } from "lucide-react";
import { toast } from "sonner";
import { importSongsCsv } from "@/lib/actions";
import { ElectronPickFilesButton } from "@/components/electron/ElectronFilePickers";

const SAMPLE = `Amazing Grace
by John Newton

Amazing grace! how sweet the sound,
That saved a wretch like me!

'Twas grace that taught my heart to fear,
And grace my fears relieved;

---

Doxology
by Thomas Ken

Praise God, from whom all blessings flow;
Praise Him, all creatures here below;
`;

export function SongImporter() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!text.trim()) { toast.error("Paste or upload some text first"); return; }
    startTransition(async () => {
      const res = await importSongsCsv(text);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`Imported ${res.data!.added} song${res.data!.added !== 1 ? "s" : ""}${res.data!.skipped ? ` · ${res.data!.skipped} skipped (duplicate title)` : ""}`);
      setOpen(false);
      setText("");
      location.reload();
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const t = await file.text();
    setText(t);
    e.target.value = "";
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-9 px-3 border border-border rounded-md text-sm font-semibold hover:bg-accent">
        <Upload className="w-4 h-4" /> Import
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={() => setOpen(false)}>
      <div className="bg-background border border-border rounded-md w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Import songs</h2>
            <p className="text-xs text-muted-foreground">Two formats accepted — pick whichever your library uses.</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground text-sm">Close</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="border border-border rounded-md p-3 bg-muted/30">
              <div className="eyebrow text-muted-foreground mb-1"><FileText className="w-3 h-3 inline mr-1" /> Plain text</div>
              <p className="text-muted-foreground leading-relaxed">
                Songs separated by <code className="font-mono px-1 bg-muted rounded-sm">---</code> or <code className="font-mono px-1 bg-muted rounded-sm">===</code>.
                First line is title, optional <code className="font-mono px-1 bg-muted rounded-sm">by X</code> line for the artist,
                slides separated by blank lines.
              </p>
            </div>
            <div className="border border-border rounded-md p-3 bg-muted/30">
              <div className="eyebrow text-muted-foreground mb-1"><FileText className="w-3 h-3 inline mr-1" /> CSV</div>
              <p className="text-muted-foreground leading-relaxed">
                One row per song: <code className="font-mono px-1 bg-muted rounded-sm">title,artist,slide1,slide2,…</code>.
                Simple parser — commas inside lyrics need to be escaped (or use plain-text format).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 h-9 px-3 border border-border rounded-md text-sm font-semibold hover:bg-accent cursor-pointer">
              <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={onFile} className="hidden" />
              <Upload className="w-4 h-4" /> Choose file
            </label>
            <ElectronPickFilesButton
              extensions={[".txt", ".csv", ".pro"]}
              label="Choose from computer…"
              className="inline-flex items-center gap-1.5 h-9 px-3 border border-border rounded-md text-sm font-semibold hover:bg-accent"
              onFiles={async (files) => {
                const parts: string[] = [];
                for (const f of files) {
                  if (f.tooLarge || !f.base64) { toast.error(`${f.name}: file too large`); continue; }
                  try { parts.push(atob(f.base64)); } catch { /* skip */ }
                }
                if (parts.length) setText((prev) => (prev ? prev + "\n---\n" : "") + parts.join("\n---\n"));
              }}
            />
            <button onClick={() => setText(SAMPLE)} className="text-xs text-muted-foreground hover:text-foreground underline">
              Load sample plain-text
            </button>
          </div>

          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16}
            placeholder="Paste songs here or use Choose file above…"
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              const t = await file.text();
              setText((prev) => (prev ? prev + "\n---\n" : "") + t);
            }}
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm font-mono resize-none" />
        </div>
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent">Cancel</button>
          <button onClick={submit} disabled={pending || !text.trim()}
            className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            {pending ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
