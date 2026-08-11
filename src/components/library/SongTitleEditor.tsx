"use client";
import { useRef, useState, useTransition } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { renameSong } from "@/lib/actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

/**
 * Editable song title header. Matches PageHeader's eyebrow/title/description
 * styling but lets the title be renamed inline (works for imported songs too).
 * Enter or the check saves; Escape or the X cancels; blur commits.
 */
export function SongTitleEditor({
  songId,
  initialTitle,
  eyebrow = "Song",
  description,
}: {
  songId: string;
  initialTitle: string;
  eyebrow?: string;
  description?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialTitle);
  const [pending, startTransition] = useTransition();
  const committedRef = useRef(false);

  function begin() {
    if (pending) return; // don't start a new rename while one is still saving
    setDraft(title);
    committedRef.current = false;
    setEditing(true);
  }

  function commit() {
    if (committedRef.current) return; // guard double-fire (Enter + blur)
    committedRef.current = true;
    const next = draft.trim();
    setEditing(false);
    if (!next || next === title) { setDraft(title); return; }
    const prev = title;
    setTitle(next); // optimistic
    startTransition(async () => {
      const res = await renameSong(songId, next);
      if (!res.ok) {
        setTitle(prev);
        toast.error(res.error ?? "Rename failed");
      } else {
        toast.success("Song renamed");
        router.refresh(); // propagate to playlist labels / other surfaces
      }
    });
  }

  function cancel() {
    committedRef.current = true;
    setEditing(false);
    setDraft(title);
  }

  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-1.5">
        {eyebrow && (
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-admin-text-muted)]">
            {eyebrow}
          </div>
        )}
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(); }
                else if (e.key === "Escape") { e.preventDefault(); cancel(); }
              }}
              onBlur={commit}
              aria-label="Song title"
              className="w-full max-w-xl rounded-md border border-[var(--pf-admin-border,#2a3232)] bg-transparent px-2 py-1 text-2xl font-semibold tracking-[-0.01em] text-[var(--pf-admin-text)] outline-none focus:border-[var(--color-brand,#ff7a2c)] md:text-[28px]"
            />
            <button onMouseDown={(e) => e.preventDefault()} onClick={commit} aria-label="Save title" className="text-emerald-500 hover:opacity-80">
              <Check className="h-5 w-5" />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={cancel} aria-label="Cancel rename" className="text-[var(--pf-admin-text-muted)] hover:opacity-80">
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={begin}
            disabled={pending}
            title="Click to rename"
            className="group inline-flex items-center gap-2 text-left"
          >
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[var(--pf-admin-text)] md:text-[28px]">
              {title}
            </h1>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--pf-admin-text-muted)]" />
            ) : (
              <Pencil className="h-4 w-4 text-[var(--pf-admin-text-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </button>
        )}
        {description && (
          <p className="max-w-2xl text-sm leading-6 text-[var(--pf-admin-text-secondary)]">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
