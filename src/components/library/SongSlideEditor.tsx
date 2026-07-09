"use client";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { updateSongSlides } from "@/lib/actions";
import { toast } from "sonner";

export function SongSlideEditor({ songId, initialSlides }: { songId: string; initialSlides: { lyrics: string }[] }) {
  const [slides, setSlides] = useState(initialSlides.length ? initialSlides : [{ lyrics: "" }]);
  const [pending, startTransition] = useTransition();

  function update(i: number, lyrics: string) {
    setSlides((cur) => cur.map((s, idx) => (idx === i ? { lyrics } : s)));
  }
  function add() { setSlides((cur) => [...cur, { lyrics: "" }]); }
  function remove(i: number) { setSlides((cur) => cur.filter((_, idx) => idx !== i)); }

  function save() {
    startTransition(async () => {
      const res = await updateSongSlides(songId, slides.filter((s) => s.lyrics.trim()));
      if (res.ok) toast.success("Saved"); else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {slides.map((s, i) => (
        <div key={i} className="border border-border rounded-md p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="eyebrow text-muted-foreground">Slide {i + 1}</div>
            <button onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
          </div>
          <textarea value={s.lyrics} onChange={(e) => update(i, e.target.value)} rows={4}
            placeholder="Lyrics for this slide..."
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm resize-none" />
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={add} className="h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add slide
        </button>
        <button onClick={save} disabled={pending}
          className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
