"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { reChunkSong } from "@/lib/actions";

/**
 * "Tidy slides" — re-chunks an existing song into cleaner, phrase-broken slides
 * (A2). Fixes songs that were imported clunky (too many words per slide) without
 * re-importing. Skips richly-styled songs and never orphans a service plan's
 * slide order (both handled server-side in reChunkSong).
 */
export function TidySlidesButton({ songId }: { songId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function run() {
    setConfirming(false);
    startTransition(async () => {
      const res = await reChunkSong(songId);
      if (!res.ok) { toast.error(res.error ?? "Tidy failed"); return; }
      const d = res.data;
      if (!d || d.skipped === "noop") { toast.success("Slides are already tidy — nothing to change."); return; }
      if (d.skipped === "rich") { toast.error("This song has images or shapes on its slides — tidy skipped so they aren't moved. Text-styled songs tidy fine."); return; }
      if (d.skipped === "empty") { toast.error("This song has no lyrics to tidy."); return; }
      toast.success(`Tidied — ${d.before} slide${d.before === 1 ? "" : "s"} → ${d.after} cleaner slide${d.after === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      {confirming ? (
        <>
          <span className="text-xs text-[var(--color-muted-foreground)]">Re-break this song into cleaner slides?</span>
          <button type="button" onClick={run} disabled={pending}
            className="inline-flex h-8 items-center rounded-md bg-[var(--color-brand)] px-3 text-xs font-semibold text-black disabled:opacity-50">
            {pending ? "Tidying…" : "Yes, tidy"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending}
            className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">Cancel</button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-foreground)] hover:border-[var(--color-muted-foreground)]">
          <Sparkles className="h-3.5 w-3.5" />
          Tidy slides
        </button>
      )}
    </div>
  );
}
