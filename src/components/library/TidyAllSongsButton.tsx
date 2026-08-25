"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { reChunkAllSongs } from "@/lib/actions";

/**
 * "Tidy all songs" — re-chunks every song in the library into cleaner slides
 * (A2 bulk). Fixes an existing clunky library in one go. Each song tidies in its
 * own transaction (one failure never rolls back the rest); richly-styled songs
 * are skipped automatically. Bounded by the church's library size.
 */
export function TidyAllSongsButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function run() {
    setConfirming(false);
    startTransition(async () => {
      const res = await reChunkAllSongs();
      if (!res.ok) { toast.error(res.error ?? "Tidy failed"); return; }
      if (!res.data) { toast.error("Tidy failed"); return; }
      const d = res.data;
      const parts = [`${d.tidied} tidied`];
      if (d.skipped > 0) parts.push(`${d.skipped} skipped`);
      if (d.failed > 0) parts.push(`${d.failed} failed`);
      const summary = `Done — ${parts.join(" · ")} (${d.totalSlidesBefore} → ${d.totalSlidesAfter} slides).`;
      if (d.remaining > 0) toast.success(`${summary} ${d.remaining} more — click “Tidy all” again to continue.`);
      else toast.success(summary);
      router.refresh();
    });
  }

  if (count === 0) return null;

  return confirming ? (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-[var(--color-muted-foreground)]">Re-break all {count} songs into cleaner slides?</span>
      <button type="button" onClick={run} disabled={pending}
        className="inline-flex h-7 items-center rounded-md bg-[var(--color-brand)] px-2.5 text-xs font-semibold text-black disabled:opacity-50">
        {pending ? "Tidying…" : "Yes, tidy all"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} disabled={pending}
        className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">Cancel</button>
    </span>
  ) : (
    <button type="button" onClick={() => setConfirming(true)}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-foreground)] hover:border-[var(--color-muted-foreground)]">
      <Sparkles className="h-3.5 w-3.5" />
      Tidy all songs
    </button>
  );
}
