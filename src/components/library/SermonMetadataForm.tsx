"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { upsertSermonMetadata } from "@/lib/actions";

type Initial = {
  sermonTitle: string | null;
  speakerName: string | null;
  series: string | null;
  mainScripture: string | null;
  notes: string | null;
  serviceDate: string | null;
};

export function SermonMetadataForm({ pptxImportId, initial }: { pptxImportId: string; initial: Initial }) {
  const [pending, start] = useTransition();
  const [form, setForm] = useState<Initial>({
    sermonTitle: initial.sermonTitle ?? "",
    speakerName: initial.speakerName ?? "",
    series: initial.series ?? "",
    mainScripture: initial.mainScripture ?? "",
    notes: initial.notes ?? "",
    serviceDate: initial.serviceDate ?? "",
  });
  const set = (k: keyof Initial) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSave = () => {
    start(async () => {
      const res = await upsertSermonMetadata({
        pptxImportId,
        sermonTitle: form.sermonTitle || null,
        speakerName: form.speakerName || null,
        series: form.series || null,
        mainScripture: form.mainScripture || null,
        notes: form.notes || null,
        serviceDate: form.serviceDate || null,
      });
      if (res.ok) toast.success("Sermon metadata saved");
      else toast.error(res.error);
    });
  };

  const inputClass = "w-full h-9 rounded-md border border-border bg-background px-3 text-sm";

  return (
    <div className="space-y-3 border border-border rounded-md p-4">
      <div className="eyebrow">Sermon metadata</div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="text-muted-foreground">Sermon title</span>
          <input className={inputClass} value={form.sermonTitle ?? ""} onChange={set("sermonTitle")} />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">Speaker</span>
          <input className={inputClass} value={form.speakerName ?? ""} onChange={set("speakerName")} />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">Series</span>
          <input className={inputClass} value={form.series ?? ""} onChange={set("series")} />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">Main scripture</span>
          <input className={inputClass} value={form.mainScripture ?? ""} onChange={set("mainScripture")} placeholder="e.g. John 3:16" />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">Service date</span>
          <input type="date" className={inputClass} value={form.serviceDate ?? ""} onChange={set("serviceDate")} />
        </label>
      </div>
      <label className="block text-xs">
        <span className="text-muted-foreground">Notes</span>
        <textarea className="w-full min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.notes ?? ""} onChange={set("notes")} />
      </label>
      <div>
        <button onClick={onSave} disabled={pending}
          className="h-9 px-4 rounded-md text-sm font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50">
          {pending ? "Saving…" : "Save metadata"}
        </button>
      </div>
    </div>
  );
}
