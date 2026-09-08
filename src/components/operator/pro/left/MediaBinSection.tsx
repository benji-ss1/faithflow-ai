"use client";
/**
 * Media bin — a compact, collapsible dock of the church's media assets that
 * is docked below the PLAYLIST in the left rail (field fix 5B-3, operator: "the
 * media bin should take over this bottom half").
 *
 * It is a THIN reuse of the existing media data + drag idiom:
 *   • lists /api/media/list assets as small thumbnails (same source as the full
 *     MediaBrowser / the old MediaStrip)
 *   • each thumbnail is HTML5-draggable with the SAME `application/x-pf-library-
 *     item` payload the MediaBrowser emits, so the EXISTING drop targets handle
 *     it with no new wiring:
 *       – drop on the PLAYLIST  → adds a media item (PlaylistSection.handleExternalDrop)
 *       – drop on a LIBRARY row → files it into that library (LibrarySection)
 *   • a hover "Background" affordance reuses setMediaAsBackground (undoable),
 *     matching the MediaBrowser card
 *   • clicking a thumbnail (or the header link) opens the full Media center panel
 *
 * It does NOT replace the existing "Media / PRO" upsell section or OpenFlow — it
 * is inserted above them, keyed off the shell's mediaStripOpen state so the
 * TopBar media toggle drives it.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Images, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CenterMode } from "../ProOperatorShell";
import { setMediaAsBackground, normalizeMediaKind } from "@/backgrounds/mediaAsBackground";
import { snapshotBackgroundState, restoreBackgroundState } from "@/backgrounds/store/backgroundStore";

type Asset = {
  id: string;
  fileName?: string | null;
  kind?: string | null;
  url?: string | null;
  thumbUrl?: string | null;
  mediaKey?: string | null;
};

export function MediaBinSection({
  open,
  onToggle,
  onCenterMode,
  poppedOut = false,
  onTogglePopout,
}: {
  open: boolean;
  onToggle: () => void;
  onCenterMode?: (m: CenterMode) => void;
  // Pop-out "v1" (field fix 6A): when open, the operator can expand the strip to
  // a taller state so more thumbnails are visible without leaving the console.
  poppedOut?: boolean;
  onTogglePopout?: () => void;
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  // Lazy: don't hit /api/media/list until the bin is first opened. Once opened,
  // keep it live (re-pull on library changes) even if collapsed again.
  const [hasOpened, setHasOpened] = useState(open);

  useEffect(() => { if (open) setHasOpened(true); }, [open]);

  useEffect(() => {
    if (!hasOpened) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/media/list", { cache: "no-store" });
        if (!res.ok) { if (!cancelled) setAssets([]); return; }
        const json = await res.json();
        if (cancelled) return;
        setAssets(Array.isArray(json?.assets) ? json.assets : []);
      } catch {
        if (!cancelled) setAssets([]);
      }
    };
    void load();
    // Re-pull when media changes elsewhere (upload / delete / move).
    const h = () => void load();
    window.addEventListener("presentflow:libraries-changed", h);
    return () => { cancelled = true; window.removeEventListener("presentflow:libraries-changed", h); };
  }, [hasOpened]);

  const setAsBackground = (a: Asset) => {
    if (!a.url) { toast.error("This asset has no file to use as a background"); return; }
    const prev = snapshotBackgroundState();
    const bg = setMediaAsBackground({
      id: a.id,
      url: a.url,
      fileName: a.fileName || "Media",
      kind: normalizeMediaKind(a.kind || "image"),
      mediaKey: a.mediaKey || undefined,
    });
    toast.success(`“${bg.name}” is now your background — it stays behind every slide`, {
      id: "pf-media-background",
      action: {
        label: "Undo",
        onClick: () => { restoreBackgroundState(prev); toast.success("Background reverted", { id: "pf-media-background" }); },
      },
      duration: 8000,
    });
  };

  const count = assets?.length ?? 0;
  // Cap the inline grid so a large library never renders hundreds of <img>/<video>
  // nodes into the rail — an "open full library" row surfaces the rest.
  const GRID_CAP = 60;
  const shown = assets ? assets.slice(0, GRID_CAP) : [];
  const overflow = Math.max(0, count - GRID_CAP);

  return (
    <section
      className={cn(
        // Center bottom-strip dock (field fix 6A): a border-TOP strip pinned at
        // the bottom of the center column. Closed = slim header bar only; open =
        // a bounded thumbnail strip; popped out = a taller strip. shrink-0 so it
        // never eats the slide grid above (which keeps flex-1).
        "border-t border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col min-h-0 shrink-0",
      )}
    >
      <header className="flex items-center h-8 px-2.5 gap-1 bg-[linear-gradient(180deg,var(--color-panel),transparent)] shrink-0">
        <button type="button" className="flex items-center gap-1 shrink-0 text-left" onClick={onToggle}>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="eyebrow">Media Bin</span>
          {/* Count is honest: only shown once the bin has been opened and the
              lazy fetch has resolved (before that we don't know the count). */}
          {assets !== null && (
            <span className="ml-1.5 min-w-[16px] h-[15px] px-1 grid place-items-center rounded-full bg-[var(--color-brand)]/16 text-[var(--color-brand)] text-[9px] font-mono font-bold tabular-nums">{count}</span>
          )}
        </button>
        <span className="h-px flex-1 mx-2" style={{ background: "linear-gradient(90deg, var(--color-border), transparent)" }} aria-hidden />
        {/* Pop-out (v1): expand/collapse the strip height. Only meaningful when
            the bin is open. */}
        {open && onTogglePopout && (
          <button
            type="button"
            onClick={onTogglePopout}
            title={poppedOut ? "Shrink the media bin" : "Pop out — show a taller media bin"}
            aria-label={poppedOut ? "Shrink the media bin" : "Pop out the media bin"}
            className="w-[22px] h-[22px] grid place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-brand)] hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))]"
          >
            {poppedOut ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => onCenterMode?.("media")}
          title="Open the full Media library"
          className="w-[22px] h-[22px] grid place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-brand)] hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))]"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </header>

      {open && (
        <div
          className="overflow-y-auto p-2"
          // Bounded strip so it never crowds out the slide grid. Popped out ⇒ a
          // taller band; default ⇒ a slim ~1-2 row strip.
          style={{ height: poppedOut ? "min(46vh, 420px)" : 148 }}
        >
          {assets === null && (
            <div className="text-[11px] text-[var(--color-muted-foreground)] opacity-60 px-1 py-2">Loading media…</div>
          )}
          {assets !== null && assets.length === 0 && (
            <button
              onClick={() => onCenterMode?.("media")}
              className="text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] underline px-1 py-2 text-left"
            >
              No media yet — open the Media library to upload.
            </button>
          )}
          {assets && assets.length > 0 && (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}>
              {shown.map((a) => {
                const isVideo = (a.kind || "").startsWith("video");
                return (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={(e) => {
                      // Same payload + "copyMove" the MediaBrowser uses so BOTH the
                      // playlist add (dropEffect copy) and library file (dropEffect
                      // move) drop targets accept it (see 5B-1).
                      e.dataTransfer.effectAllowed = "copyMove";
                      e.dataTransfer.setData(
                        "application/x-pf-library-item",
                        JSON.stringify({ pfType: "media", id: a.id, title: a.fileName || "Media", url: a.url, kind: a.kind }),
                      );
                    }}
                    onClick={() => onCenterMode?.("media")}
                    title={`${a.fileName || "Media"} — drag onto the playlist or a library, click to open`}
                    className="group relative aspect-video rounded-md overflow-hidden bg-black border border-[var(--color-border)] cursor-grab active:cursor-grabbing hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] transition-colors"
                  >
                    {a.url ? (
                      isVideo ? (
                        // preload="none" keeps the rail cheap (no video byte fetch
                        // until played elsewhere); poster shows the thumb when we
                        // have one, else nothing (honest — no broken frame).
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video src={a.url} muted preload="none" poster={a.thumbUrl || undefined} className="w-full h-full object-cover pointer-events-none" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.thumbUrl || a.url} alt={a.fileName || ""} loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none" />
                      )
                    ) : (
                      <div className="w-full h-full grid place-items-center text-[9px] text-[var(--color-muted-foreground)] px-1 text-center">{a.fileName || a.kind || "Asset"}</div>
                    )}
                    {/* Set-as-background affordance — mirrors the MediaBrowser card. */}
                    <button
                      type="button"
                      aria-label="Set as background"
                      title="Set as background — stays behind your lyrics for every slide"
                      onClick={(e) => { e.stopPropagation(); setAsBackground(a); }}
                      className="absolute right-0.5 bottom-0.5 z-10 inline-flex h-5 px-1 items-center gap-0.5 rounded bg-black/65 text-white/85 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/85 hover:text-white text-[9px] font-semibold"
                    >
                      <Images className="w-2.5 h-2.5" /> Bg
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {overflow > 0 && (
            <button
              type="button"
              onClick={() => onCenterMode?.("media")}
              className="mt-1.5 w-full text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-brand)] underline underline-offset-2 px-1 py-1.5 text-left"
              title="Open the full Media library"
            >
              Open full library ({overflow} more)
            </button>
          )}
        </div>
      )}
    </section>
  );
}
