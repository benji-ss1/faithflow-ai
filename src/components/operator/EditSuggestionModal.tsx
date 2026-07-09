"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { editAiSuggestion } from "@/lib/actions";

export type EditableSuggestion = {
  suggestionId: string;
  type: "scripture" | "song" | "action";
  payload: Record<string, unknown>;
};

export function EditSuggestionModal({
  open, suggestion, onClose, onSaved,
}: {
  open: boolean;
  suggestion: EditableSuggestion | null;
  onClose: () => void;
  onSaved: (edited: Record<string, unknown>) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [patch, setPatch] = useState<Record<string, string>>({});

  if (!open || !suggestion) return null;
  const p = suggestion.payload;

  async function save() {
    if (!suggestion) return;
    setSaving(true);
    const normalised: Record<string, unknown> = { ...patch };
    if (suggestion.type === "scripture") {
      if (patch.chapter) normalised.chapter = Number(patch.chapter);
      if (patch.verseStart) normalised.verseStart = Number(patch.verseStart);
      if (patch.verseEnd) normalised.verseEnd = Number(patch.verseEnd);
    }
    const res = await editAiSuggestion(suggestion.suggestionId, normalised);
    setSaving(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Edited — approved & ready to stage");
    onSaved({ ...p, ...normalised });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="w-full max-w-md rounded-md border shadow-lg" onClick={(e) => e.stopPropagation()}
           style={{ background: "var(--color-panel)", borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <div className="text-sm font-semibold">Edit AI suggestion</div>
          <button onClick={onClose} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {suggestion.type === "scripture" && (
            <>
              <Field label="Book" defaultValue={String(p.book || "")} onChange={(v) => setPatch({ ...patch, book: v })} />
              <div className="grid grid-cols-3 gap-2">
                <Field label="Chapter" defaultValue={String(p.chapter || "")} onChange={(v) => setPatch({ ...patch, chapter: v })} />
                <Field label="Verse start" defaultValue={String(p.verseStart || "")} onChange={(v) => setPatch({ ...patch, verseStart: v })} />
                <Field label="Verse end" defaultValue={String(p.verseEnd || "")} onChange={(v) => setPatch({ ...patch, verseEnd: v })} />
              </div>
            </>
          )}
          {suggestion.type === "song" && (
            <Field label="Song title" defaultValue={String(p.title || "")} onChange={(v) => setPatch({ ...patch, title: v })} />
          )}
          {suggestion.type === "action" && (
            <Field label="Query" defaultValue={String(p.query || "")} onChange={(v) => setPatch({ ...patch, query: v })} />
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: "var(--color-border)" }}>
          <button onClick={onClose} className="h-9 px-3 text-xs rounded-md border" style={{ borderColor: "var(--color-border)" }}>Cancel</button>
          <button onClick={save} disabled={saving}
            className="h-9 px-4 text-xs font-semibold rounded-md bg-[color:var(--color-foreground)] text-[color:var(--color-background)] disabled:opacity-50">
            {saving ? "Saving…" : "Save & approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, defaultValue, onChange }: { label: string; defaultValue: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] mb-1">{label}</div>
      <input defaultValue={defaultValue} onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-3 rounded-md border text-sm bg-transparent"
        style={{ borderColor: "var(--color-border)" }} />
    </label>
  );
}
