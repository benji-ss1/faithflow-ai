"use client";

export function AudioTab() {
  return (
    <div className="flex flex-col gap-3">
      <div className="eyebrow">Playlist</div>
      <div className="text-[var(--color-muted-foreground)] py-4 text-center text-[12px]">
        No audio items yet.
        <div className="mt-1 text-[10px] opacity-70">
          Add audio via the Media library.
        </div>
      </div>
    </div>
  );
}
