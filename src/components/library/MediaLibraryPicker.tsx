"use client";
import { useState, useEffect } from "react";
import { X } from "lucide-react";

export type LibraryAsset = { id: string; fileName: string; kind: string; url: string };

/**
 * Shared media-library picker modal. Fetches the church's media (GET
 * /api/media/list — auth-gated + church-scoped; mints fresh presigned URLs),
 * filters to the requested kind, and hands back a ready-to-use URL on pick.
 * Used by the theme editor and the slide editor so operators reuse assets
 * they've already uploaded, in-app, instead of re-uploading or pasting URLs.
 */
export function MediaLibraryPicker({
  kind, onPick, onClose,
}: {
  kind: "image" | "video";
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/media/list").then((r) => r.json()) as { assets?: LibraryAsset[]; error?: string };
        if (!alive) return;
        if (res.error) { setError(res.error); return; }
        setAssets((res.assets ?? []).filter((a) => a.kind === kind));
      } catch {
        if (alive) setError("Couldn't load your media library");
      }
    })();
    return () => { alive = false; };
  }, [kind]);

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-[var(--color-panel,#141818)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border p-4">
          <div className="text-sm font-semibold">Choose {kind === "image" ? "an image" : "a video"} from your library</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.05] hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{error}</div>
          ) : assets === null ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading your library…</div>
          ) : assets.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No {kind}s in your library yet. Upload one first and it'll appear here.
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {assets.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => { onPick(a.url); onClose(); }}
                    className="group block w-full overflow-hidden rounded-lg border border-border bg-black/40 text-left transition hover:border-[var(--color-primary)]"
                    title={a.fileName}
                  >
                    <div className="aspect-video w-full overflow-hidden bg-black/60">
                      {a.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt={a.fileName} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <video src={a.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      )}
                    </div>
                    <div className="truncate px-2 py-1.5 text-[11px] text-muted-foreground group-hover:text-foreground">{a.fileName}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
