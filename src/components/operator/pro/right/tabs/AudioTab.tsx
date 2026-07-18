"use client";
import Link from "next/link";

export function AudioTab() {
  return (
    <div className="flex flex-col gap-3 py-4 text-center">
      <div className="text-sm font-semibold">Audio playlist — coming soon</div>
      <div className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed px-3">
        Sidebar audio playback isn't wired up yet. You can already add audio
        clips to a service plan via the Media library and trigger them from the
        slide grid.
      </div>
      <Link
        href="/library/media"
        className="mx-auto mt-1 h-8 px-3 inline-flex items-center rounded-md border border-[var(--color-border)] text-[11px] hover:bg-[var(--color-elevated)]"
      >
        Open Media library
      </Link>
    </div>
  );
}
