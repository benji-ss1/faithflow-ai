"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Plus, Trash2, Check, Loader2, Circle } from "lucide-react";
import { updateSongSlides } from "@/lib/actions";
import { toast } from "sonner";

const MAX_SLIDE_CHARS = 5000;
const MAX_SLIDES_PER_SONG = 500;
const AUTOSAVE_DEBOUNCE_MS = 1500;

type Slide = { lyrics: string };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Song slide editor with debounced autosave + unsaved-changes warning.
 *
 * Was previously a manual-Save-button-only design where an operator typing
 * a full song and navigating away lost everything with no warning. Now:
 *   - Debounced autosave (1.5s after last keystroke).
 *   - Manual "Save now" for the impatient.
 *   - beforeunload guard while dirty.
 *   - Per-slide character cap (5000) with visible counter.
 */
export function SongSlideEditor({ songId, initialSlides }: { songId: string; initialSlides: { lyrics: string }[] }) {
  const [slides, setSlides] = useState<Slide[]>(initialSlides.length ? initialSlides : [{ lyrics: "" }]);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SaveState>("idle");
  const savedRef = useRef<string>(JSON.stringify(initialSlides));
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((next: Slide[]) => {
    startTransition(async () => {
      setState("saving");
      const res = await updateSongSlides(songId, next.filter((s) => s.lyrics.trim()));
      if (res.ok) {
        savedRef.current = JSON.stringify(next);
        setState("saved");
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
      } else {
        setState("error");
        toast.error(res.error ?? "Save failed");
      }
    });
  }, [songId]);

  // Autosave on change (debounced).
  useEffect(() => {
    const serialized = JSON.stringify(slides);
    if (serialized === savedRef.current) {
      setState("idle");
      return;
    }
    setState("dirty");
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      persist(slides);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
    };
  }, [slides, persist]);

  // beforeunload guard — the debounced autosave might have 1.5s of unsaved
  // edits at the moment the operator hits close.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state === "dirty" || state === "saving") {
        e.preventDefault();
        // Chromium ignores the string but requires returnValue set.
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state]);

  function update(i: number, lyrics: string) {
    if (lyrics.length > MAX_SLIDE_CHARS) lyrics = lyrics.slice(0, MAX_SLIDE_CHARS);
    setSlides((cur) => cur.map((s, idx) => (idx === i ? { lyrics } : s)));
  }
  function add() {
    setSlides((cur) => {
      if (cur.length >= MAX_SLIDES_PER_SONG) {
        toast.error(`Cap of ${MAX_SLIDES_PER_SONG} slides per song`);
        return cur;
      }
      return [...cur, { lyrics: "" }];
    });
  }
  function remove(i: number) { setSlides((cur) => cur.filter((_, idx) => idx !== i)); }

  function saveNow() {
    if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
    persist(slides);
  }

  const StatusIcon = state === "saving" ? Loader2 : state === "saved" ? Check : state === "error" ? Circle : Circle;
  const statusText =
    state === "saving" ? "Saving…" :
    state === "saved" ? "Saved" :
    state === "dirty" ? "Unsaved changes" :
    state === "error" ? "Save failed" :
    "All changes saved";
  const statusClass =
    state === "saving" ? "text-muted-foreground animate-spin" :
    state === "saved" ? "text-emerald-500" :
    state === "dirty" ? "text-amber-500" :
    state === "error" ? "text-destructive" :
    "text-muted-foreground";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px]">
        <StatusIcon className={`w-3.5 h-3.5 ${statusClass}`} />
        <span className={statusClass}>{statusText}</span>
        {(state === "dirty" || state === "error") && (
          <button
            onClick={saveNow}
            disabled={pending}
            className="ml-2 h-6 px-2 rounded border border-border text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
          >
            Save now
          </button>
        )}
      </div>
      {slides.map((s, i) => (
        <div key={i} className="border border-border rounded-md p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="eyebrow text-muted-foreground">Slide {i + 1}</div>
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-mono ${s.lyrics.length > MAX_SLIDE_CHARS * 0.9 ? "text-amber-500" : "text-muted-foreground"}`}>
                {s.lyrics.length}/{MAX_SLIDE_CHARS}
              </span>
              <button onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
          <textarea
            value={s.lyrics}
            onChange={(e) => update(i, e.target.value)}
            maxLength={MAX_SLIDE_CHARS}
            rows={4}
            placeholder="Lyrics for this slide..."
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm resize-none"
          />
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={add} className="h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add slide
        </button>
        <button onClick={saveNow} disabled={pending || state === "idle" || state === "saved"}
          className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {pending ? "Saving..." : "Save now"}
        </button>
      </div>
    </div>
  );
}
