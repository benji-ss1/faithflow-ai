"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Plus } from "lucide-react";
import { createSong, updateSongSlides } from "@/lib/actions";

/**
 * Quick-import a song from the operator console. Pastes CHURCH-OWNED or
 * PUBLIC-DOMAIN lyrics only — this modal never fetches or accepts scraped
 * web lyrics on the user's behalf.
 */
export function ImportSongModal({
  open, initialTitle, initialArtist, onClose,
}: {
  open: boolean;
  initialTitle: string;
  initialArtist: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [artist, setArtist] = useState(initialArtist);
  const [lyrics, setLyrics] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setTitle(initialTitle); setArtist(initialArtist); setLyrics(""); }
  }, [open, initialTitle, initialArtist]);

  if (!open) return null;

  async function save() {
    if (!title.trim()) { toast.error("Title required"); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("title", title.trim());
      if (artist.trim()) fd.set("artist", artist.trim());
      const res = await createSong(fd);
      if (!res.ok) throw new Error(res.error || "Create failed");
      const slides = lyrics.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).map((s) => ({ lyrics: s }));
      if (slides.length > 0 && res.data) {
        const r2 = await updateSongSlides(res.data.id, slides);
        if (!r2.ok) throw new Error(r2.error || "Slides save failed");
      }
      toast.success(`Imported "${title.trim()}"`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border shadow-xl" onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--color-panel)", borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[color:var(--color-muted-foreground)]">Import Song</div>
            <div className="text-sm font-semibold">Church-owned or public-domain lyrics only</div>
          </div>
          <button onClick={onClose} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)] mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="h-9 w-full px-2 rounded-md border text-[12px]"
              style={{ background: "var(--color-app-bg)", borderColor: "var(--color-border)" }} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)] mb-1">Artist</label>
            <input value={artist} onChange={(e) => setArtist(e.target.value)}
              className="h-9 w-full px-2 rounded-md border text-[12px]"
              style={{ background: "var(--color-app-bg)", borderColor: "var(--color-border)" }} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)] mb-1">Lyrics (paste church-owned or public-domain only)</label>
            <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={8}
              placeholder={"Verse 1\nAmazing grace how sweet the sound...\n\nChorus\n..."}
              className="w-full px-2 py-1.5 rounded-md border text-[12px] font-mono"
              style={{ background: "var(--color-app-bg)", borderColor: "var(--color-border)" }} />
            <p className="text-[10px] text-[color:var(--color-muted-foreground)] mt-1">Separate slides with a blank line. Leave empty to create a draft you can fill in later.</p>
          </div>
        </div>
        <div className="px-4 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: "var(--color-border)" }}>
          <button onClick={onClose} className="h-9 px-3 rounded-md border text-[11px] font-semibold" style={{ borderColor: "var(--color-border)" }}>Cancel</button>
          <button onClick={save} disabled={saving || !title.trim()}
            className="h-9 px-3 rounded-md bg-[color:var(--color-brand)] text-black text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Import song"}
          </button>
        </div>
      </div>
    </div>
  );
}
