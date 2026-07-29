"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, FileText, Presentation, FileSpreadsheet, FileCode2, Boxes } from "lucide-react";
import { importPro6Files, importSongsCsv, createPptxImport } from "@/lib/actions";

type CardDef = {
  key: "propresenter" | "easyworship" | "pptx" | "text" | "openlp";
  name: string;
  extensions: string;
  accept: string;
  description: string;
  icon: React.ReactNode;
  active: boolean;
};

const CARDS: CardDef[] = [
  {
    key: "propresenter",
    name: "ProPresenter",
    extensions: ".pro6, .pro7",
    accept: ".pro6,.pro7,.pro5",
    description: "Import songs and arrangements",
    icon: <Presentation className="h-5 w-5" />,
    active: true,
  },
  {
    key: "easyworship",
    name: "EasyWorship",
    extensions: ".ewsx",
    accept: ".ewsx",
    description: "Import songs and media",
    icon: <Boxes className="h-5 w-5" />,
    active: false,
  },
  {
    key: "pptx",
    name: "PowerPoint",
    extensions: ".pptx",
    accept: ".pptx",
    description: "Import slides as media",
    icon: <FileText className="h-5 w-5" />,
    active: true,
  },
  {
    key: "text",
    name: "Plain Text / CSV",
    extensions: ".txt, .csv",
    accept: ".txt,.csv,text/plain,text/csv",
    description: "Import song lyrics",
    icon: <FileSpreadsheet className="h-5 w-5" />,
    active: true,
  },
  {
    key: "openlp",
    name: "OpenLP",
    extensions: ".xml",
    accept: ".xml",
    description: "Import songs from OpenLP",
    icon: <FileCode2 className="h-5 w-5" />,
    active: false,
  },
];

export function ImportsGrid() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handlePro6(files: FileList) {
    const items: { name: string; content: string }[] = [];
    for (const file of Array.from(files)) {
      const content = await file.text();
      items.push({ name: file.name, content });
    }
    const res = await importPro6Files(items);
    if (!res.ok) throw new Error(res.error);
    const d = res.data!;
    toast.success(`Imported ${d.added} · skipped ${d.skipped} · duplicates ${d.duplicates}${d.limitSkipped ? ` · limit-skipped ${d.limitSkipped}` : ""}`);
  }

  async function handlePptx(files: FileList) {
    const file = files[0];
    if (!file) return;
    const presign = await fetch("/api/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: "pptx" }),
    }).then((r) => r.json());
    if (presign.error) throw new Error(presign.error);
    const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!put.ok) throw new Error("Upload failed");
    const res = await createPptxImport(file.name, presign.key);
    if (!res.ok) throw new Error(res.error);
    toast.info("Uploaded — converting…");
    const convRes = await fetch("/api/pptx/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importId: res.data!.id }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Conversion request failed" }));
    if (!convRes.ok) throw new Error(convRes.error || "Conversion failed");
    toast.success("Converted");
  }

  async function handleText(files: FileList) {
    const parts: string[] = [];
    for (const file of Array.from(files)) {
      parts.push(await file.text());
    }
    const merged = parts.join("\n---\n");
    const res = await importSongsCsv(merged);
    if (!res.ok) throw new Error(res.error);
    toast.success(`Imported ${res.data!.added} song${res.data!.added === 1 ? "" : "s"}${res.data!.skipped ? ` · ${res.data!.skipped} skipped` : ""}`);
  }

  async function onFileChosen(key: CardDef["key"], e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setBusyKey(key);
    try {
      if (key === "propresenter") await handlePro6(files);
      else if (key === "pptx") await handlePptx(files);
      else if (key === "text") await handleText(files);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusyKey(null);
      e.target.value = "";
      if (key === "pptx") location.reload();
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {CARDS.map((card) => (
        <article key={card.key} className="rounded-2xl border border-border bg-card/80 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{card.icon}</span>
              <div>
                <div className="text-sm font-semibold">{card.name}</div>
                <div className="text-xs text-muted-foreground">{card.extensions}</div>
              </div>
            </div>
            {!card.active ? (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Coming soon
              </span>
            ) : null}
          </div>
          <p className="mb-4 text-xs leading-5 text-muted-foreground">{card.description}</p>
          <div>
            <input
              ref={(el) => { inputRefs.current[card.key] = el; }}
              type="file"
              multiple={card.key !== "pptx"}
              accept={card.accept}
              className="hidden"
              disabled={!card.active || busyKey !== null}
              onChange={(e) => onFileChosen(card.key, e)}
            />
            <button
              type="button"
              disabled={!card.active || busyKey !== null}
              onClick={() => inputRefs.current[card.key]?.click()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="h-4 w-4" />
              {busyKey === card.key ? "Working…" : card.active ? "Upload" : "Unavailable"}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
