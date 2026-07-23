"use client";
/**
 * Inline songs library — center-mode "songs".
 * Left: searchable song list. Right: preview slides for the selected song.
 * Single click = select (loads preview). Double click = add to playlist &
 * jump to slides mode. "Send first to live" button honors nothing extra —
 * onSendSlideToLive is the operator's opt-in.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Pencil } from "lucide-react";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { cn } from "@/lib/utils";
import type { OperatorShellCtx } from "../../shell/types";
import type { SlidePayload } from "@/lib/broadcast";
import { createSong, createSongSlide, updateSongSlides } from "@/lib/actions";

type SongRow = { id: string; title: string; artist: string | null };
type SlideRow = { id?: string; lyrics: string };

export function SongsBrowser({
  ctx,
  onExitToSlides,
}: {
  ctx: OperatorShellCtx;
  onExitToSlides: () => void;
}) {
  const [songs, setSongs] = useState<SongRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SongRow | null>(null);
  const [slides, setSlides] = useState<SlideRow[] | null>(null);
  const [slidesLoading, setSlidesLoading] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Shared slide-size preference — same event/localStorage key the CenterHeader
  // and BottomBar use so a single slider works everywhere.
  const [slideSize, setSlideSize] = useState(280);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("presentflow.center.slideSize");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 120 && n <= 480) setSlideSize(n);
    } catch { /* noop */ }
    const handler = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      if (typeof d === "number" && d >= 120 && d <= 480) setSlideSize(d);
    };
    window.addEventListener("presentflow:center-slide-size", handler);
    return () => window.removeEventListener("presentflow:center-slide-size", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/songs/list")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { toast.error(data.error || `Failed to load songs (${r.status})`); return; }
        setSongs(Array.isArray(data.songs) ? data.songs : []);
      })
      .catch((err) => { if (!cancelled) toast.error(err instanceof Error ? err.message : "Failed to load songs"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selected) { setSlides(null); return; }
    let cancelled = false;
    setSlidesLoading(true);
    fetch(`/api/songs/${selected.id}/slides`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setSlides(data.slides || []); })
      .catch(() => { if (!cancelled) toast.error("Failed to load slides"); })
      .finally(() => { if (!cancelled) setSlidesLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) =>
      s.title.toLowerCase().includes(q) || (s.artist || "").toLowerCase().includes(q));
  }, [songs, query]);

  const refreshSlides = (songId: string) => {
    fetch(`/api/songs/${songId}/slides`)
      .then((r) => r.json())
      .then((data) => setSlides(data.slides || []))
      .catch(() => { /* silent — retry on next select */ });
    // Signal the live detector to refetch its song library — a slide (lyric)
    // change here must become detectable in-session, not after a reload.
    try { window.dispatchEvent(new Event("presentflow:songs-changed")); } catch { /* ignore */ }
  };

  const saveSlideEdit = async (idx: number) => {
    if (!selected || !slides || savingEdit) return;
    setSavingEdit(true);
    try {
      const next = slides.map((sl, i) => (i === idx ? { lyrics: editDraft } : { lyrics: sl.lyrics }));
      const res = await updateSongSlides(selected.id, next);
      if (!res.ok) { toast.error(res.error || "Save failed"); return; }
      setSlides(next);
      setEditingIdx(null);
      // In-place lyric edits must reach the live detector in-session too —
      // slide count is unchanged here, so the library refetch + content-digest
      // signature is what catches the text change (review 🟡).
      try { window.dispatchEvent(new Event("presentflow:songs-changed")); } catch { /* ignore */ }
      toast.success("Slide updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingEdit(false);
    }
  };

  const addToPlaylist = async (s: SongRow) => {
    if (!ctx.onAddLibraryItem) { toast.info("Playlist add not available in this view"); return; }
    await ctx.onAddLibraryItem("song", { id: s.id, title: s.title });
    onExitToSlides();
  };

  return (
    <div className="p-4 grid gap-3 h-full" style={{ gridTemplateColumns: "minmax(280px, 360px) 1fr" }}>
      {/* Song list */}
      <div className="flex flex-col border border-[var(--color-border)] rounded-md overflow-hidden">
        <div className="p-2 border-b border-[var(--color-border)] flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={loading ? "Loading songs…" : `Search ${songs.length} songs…`}
            className="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-3 h-8 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <AddSongDialog
            existingTitles={songs.map((s) => s.title)}
            onCreated={(row) => {
              // Optimistic: prepend to local list so the operator sees it
              // instantly, then select it so the preview panel opens the
              // (still-empty) slide editor path.
              setSongs((cur) => [{ id: row.id, title: row.title, artist: row.artist }, ...cur]);
              setSelected({ id: row.id, title: row.title, artist: row.artist });
            }}
          />
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 && !loading && (
            <li className="p-3 text-[12px] text-[var(--color-muted-foreground)]">No songs found.</li>
          )}
          {filtered.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setSelected(s)}
                onDoubleClick={() => void addToPlaylist(s)}
                className={cn(
                  "w-full text-left px-3 py-2 border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)]",
                  selected?.id === s.id && "bg-[var(--color-elevated)]",
                )}
              >
                <div className="text-[13px] text-[var(--color-foreground)] truncate">{s.title}</div>
                {s.artist && <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">{s.artist}</div>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Preview column */}
      <div className="flex flex-col border border-[var(--color-border)] rounded-md overflow-hidden">
        <div className="p-2 border-b border-[var(--color-border)] flex items-center gap-2">
          <div className="flex-1 text-[13px] font-medium truncate">
            {selected ? selected.title : "Select a song to preview"}
          </div>
          {selected && (
            <>
              <button
                onClick={() => {
                  setEditingIdx(null);
                  void createSongSlide(selected.id, undefined, { objects: [], lyrics: "" }).then((res) => {
                    if (!res.ok) { toast.error(res.error || "Add slide failed"); return; }
                    refreshSlides(selected.id);
                  });
                }}
                className="h-8 px-3 rounded-md border border-[var(--color-border)] text-[12px] font-semibold hover:bg-[var(--color-elevated)]"
                title="Add a new blank lyric slide to this song"
              >
                + Add slide
              </button>
              <button
                onClick={() => void addToPlaylist(selected)}
                className="h-8 px-3 rounded-md bg-[var(--color-brand)] text-black text-[12px] font-semibold"
              >
                Add to playlist
              </button>
            </>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {slidesLoading && <div className="text-[11px] text-[var(--color-muted-foreground)]">Loading slides…</div>}
          {slides && slides.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="text-[12px] text-[var(--color-muted-foreground)]">No slides yet for this song.</div>
              {selected && (
                <AddLyricSlide
                  songId={selected.id}
                  onAdded={() => refreshSlides(selected.id)}
                />
              )}
            </div>
          )}
          {slides && slides.length > 0 && (
            // Match the Bible verse-card grid density: 280px minmax + slightly
            // larger gap so lyrics don't feel cramped next to Bible cards.
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${slideSize}px, 1fr))` }}>
              {slides.map((sl, idx) => {
                const payload: SlidePayload = { kind: "text", text: sl.lyrics };
                const isEditing = editingIdx === idx;
                if (isEditing) {
                  return (
                    <div
                      key={idx}
                      className="relative aspect-video rounded overflow-hidden border-2 border-[var(--color-brand)] bg-[var(--color-elevated)] flex flex-col p-2 gap-1"
                    >
                      <textarea
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { setEditingIdx(null); return; }
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void saveSlideEdit(idx); }
                        }}
                        maxLength={5000}
                        className="flex-1 w-full resize-none bg-transparent text-[12px] outline-none"
                        placeholder="Type lyrics for this slide…"
                      />
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditingIdx(null)}
                          className="h-6 px-2 rounded border border-[var(--color-border)] text-[10px]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => void saveSlideEdit(idx)}
                          disabled={savingEdit}
                          className="h-6 px-2 rounded bg-[var(--color-brand)] text-black text-[10px] font-semibold disabled:opacity-50"
                        >
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={idx}
                    className="group relative aspect-video rounded overflow-hidden border-2 border-[var(--color-border)] hover:border-[var(--color-brand)] transition-colors"
                  >
                    <button
                      // Operator-directive: single-click sends to live. This is
                      // a MANUAL operator click — copyright rule 7 (songs never
                      // AUTO-project) applies to AI/autopilot only. Direct
                      // operator intent is trusted.
                      onClick={() => ctx.onSendSlideToLive(payload)}
                      className="absolute inset-0 w-full h-full"
                      title="Click to send lyric slide to live"
                    >
                      <SlideRenderer slide={payload} />
                      {!sl.lyrics.trim() && (
                        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--color-muted-foreground)]">
                          Empty slide — click pencil to add lyrics
                        </div>
                      )}
                    </button>
                    <div className="absolute top-1 left-1 text-[10px] font-mono text-white/70 bg-black/40 px-1.5 py-0.5 rounded pointer-events-none">
                      {idx + 1}
                    </div>
                    <button
                      type="button"
                      aria-label="Edit slide lyrics"
                      title="Edit lyrics"
                      onClick={(e) => { e.stopPropagation(); setEditDraft(sl.lyrics); setEditingIdx(idx); }}
                      className="absolute top-1 right-1 h-5 w-5 inline-flex items-center justify-center rounded bg-black/50 text-white/80 hover:bg-[var(--color-brand)] hover:text-black transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddSongDialog({ onCreated, existingTitles }: { onCreated: (row: SongRow) => void; existingTitles: string[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [theme, setTheme] = useState<"default" | "dark" | "light" | "brand">("default");
  const [aspect, setAspect] = useState<"16:9" | "4:3" | "1:1">("16:9");
  const [seedFirstSlide, setSeedFirstSlide] = useState(true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    const t = title.trim();
    if (!t) { toast.error("Song title required"); return; }
    if (t.length > 200) { toast.error("Title too long (max 200 chars)"); return; }
    if (!/[\p{L}\p{N}]/u.test(t)) { toast.error("Song title needs letters or numbers"); return; }
    const dup = existingTitles.some((x) => x.trim().toLowerCase() === t.toLowerCase());
    if (dup && !window.confirm(`A song titled "${t}" already exists. Create another anyway?`)) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("title", t);
      if (artist.trim()) fd.set("artist", artist.trim().slice(0, 120));
      const res = await createSong(fd);
      if (!res.ok) { toast.error(res.error); return; }
      const newId = res.data!.id;
      // Seed a first blank slide template so the operator lands ready-to-type
      // instead of an empty-state prompt. Mirrors ProPresenter's flow —
      // filename + theme + size → dialog closes into the slide editor with
      // one placeholder slide already present. Theme + aspect are persisted
      // per-song via localStorage so future edits reload the chosen template.
      if (seedFirstSlide) {
        try {
          await createSongSlide(newId, undefined, { objects: [], lyrics: "" });
        } catch { /* non-fatal — user can add manually */ }
      }
      try {
        window.localStorage.setItem(
          `presentflow.song.template.${newId}`,
          JSON.stringify({ theme, aspect }),
        );
      } catch { /* noop */ }
      onCreated({ id: newId, title: t, artist: artist.trim() || null });
      toast.success(`"${t}" created${seedFirstSlide ? " with blank slide" : ""} — edit lyrics on the right`);
      setTitle(""); setArtist(""); setTheme("default"); setAspect("16:9"); setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          title="Add new song"
          className="h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-brand)] text-black flex items-center gap-1 text-[11px] font-semibold hover:opacity-90"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[440px] bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4 flex flex-col gap-3">
          <Dialog.Title className="text-sm font-semibold">New song</Dialog.Title>
          <label className="text-[11px] flex flex-col gap-1">
            <span>Title <span className="text-[var(--color-muted-foreground)]">(required)</span></span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) void save(); }}
              maxLength={200}
              placeholder="Amazing Grace"
              className="h-9 px-3 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-sm"
            />
          </label>
          <label className="text-[11px] flex flex-col gap-1">
            Artist / author (optional)
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) void save(); }}
              maxLength={120}
              placeholder="John Newton"
              className="h-9 px-3 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[11px] flex flex-col gap-1">
              Theme
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as typeof theme)}
                className="h-9 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-sm"
              >
                <option value="default">Default</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="brand">Brand</option>
              </select>
            </label>
            <label className="text-[11px] flex flex-col gap-1">
              Size
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value as typeof aspect)}
                className="h-9 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-sm"
              >
                <option value="16:9">1920 × 1080 (16:9)</option>
                <option value="4:3">1024 × 768 (4:3)</option>
                <option value="1:1">1080 × 1080 (Square)</option>
              </select>
            </label>
          </div>
          <label className="text-[11px] inline-flex items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={seedFirstSlide}
              onChange={(e) => setSeedFirstSlide(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Create a blank slide template ready to edit
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <Dialog.Close asChild>
              <button className="h-8 px-3 rounded border border-[var(--color-border)] text-[12px]">Cancel</button>
            </Dialog.Close>
            <button
              onClick={save}
              disabled={busy || !title.trim()}
              className="h-8 px-3 rounded bg-[var(--color-brand)] text-black text-[12px] font-semibold disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create song"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AddLyricSlide({ songId, onAdded }: { songId: string; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    const t = text.trim();
    if (!t) { toast.error("Enter lyrics for the slide"); return; }
    if (t.length > 5000) { toast.error("Slide text too long (max 5000 chars)"); return; }
    setBusy(true);
    try {
      const res = await createSongSlide(songId, undefined, { objects: [], lyrics: t });
      if (!res.ok) { toast.error(res.error); return; }
      setText("");
      toast.success("Slide added");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add slide failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-full max-w-md flex flex-col gap-2 items-stretch">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Amazing grace, how sweet the sound\nThat saved a wretch like me…"}
        rows={4}
        maxLength={5000}
        className="w-full px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] text-sm resize-none"
      />
      <button
        onClick={save}
        disabled={busy || !text.trim()}
        className="h-8 px-3 rounded bg-[var(--color-brand)] text-black text-[12px] font-semibold self-end disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add lyric slide"}
      </button>
    </div>
  );
}
