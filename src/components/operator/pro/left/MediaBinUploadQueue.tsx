"use client";
/**
 * Inline upload queue for files dropped from Finder / File Explorer onto the
 * Media Bin. Lives in its OWN component so per-file progress re-renders only
 * these placeholder tiles — never the (large) Media Bin asset grid and its
 * context menus, which matters on a machine that is projecting live.
 *
 * Images / videos upload here (presign → PUT with progress → register, via the
 * wizard's shared `uploadMediaFile`). Decks + ProPresenter are handed back to
 * the parent to open the existing MediaImportWizard. Everything else gets one
 * grouped, honest toast.
 */
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Film, Music, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadMediaFile } from "../center/MediaImportWizard";
import {
  classifyDroppedFile, skippedSummary, MEDIA_BIN_UPLOAD_CONCURRENCY, type DroppedFileRoute,
} from "@/lib/media-bin-drop";

type Status = "queued" | "uploading" | "done" | "error";
type Item = {
  id: number;
  fingerprint: string;
  file: File;
  contentType: string;
  isVideo: boolean;
  /** Audio / HEIC can't be previewed as an <img> — show an icon instead. */
  noPreview?: boolean;
  isAudio?: boolean;
  previewUrl: string | null;
  progress: number;
  status: Status;
  error?: string;
  offline?: boolean;
};

export type MediaBinUploadQueueHandle = {
  importFiles: (files: File[], opts?: { truncated?: boolean }) => void;
};

/** Only this many image previews are decoded at once (uploading + next up). */
const PREVIEW_WINDOW = 6;

/** Park the queue ONLY when the browser itself reports offline — a CORS/S3
 *  error while online must fail that one file, never freeze the queue. */
function browserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export const MediaBinUploadQueue = forwardRef<MediaBinUploadQueueHandle, {
  /** Re-pull the bin list. Resolves true only if the list actually refreshed. */
  refresh: () => Promise<boolean>;
  /** Decks / ProPresenter files → open the existing import wizard. */
  onOpenWizard: (files: File[]) => void;
  /** Queued+uploading count (only fires when the COUNT changes, not on progress). */
  onActiveCountChange: (n: number) => void;
  /** Gentler on bandwidth while something is live (livestream uplink). */
  live?: boolean;
  /** Stagger index offset / thumbnail min width to match the asset grid. */
  thumbMin: number;
}>(function MediaBinUploadQueue({ refresh, onOpenWizard, onActiveCountChange, live, thumbMin }, ref) {
  const [items, setItems] = useState<Item[]>([]);
  // The ref is the source of truth for scheduling (updated synchronously);
  // state mirrors it for rendering. This avoids reading a stale render.
  const itemsRef = useRef<Item[]>([]);
  const nextId = useRef(1);
  const active = useRef(0);
  const unmounted = useRef(false);
  const abort = useRef(new AbortController());
  const uploadedSinceRefresh = useRef<number[]>([]);
  const lastCount = useRef(0);

  const commit = useCallback((next: Item[]) => {
    itemsRef.current = next;
    if (unmounted.current) return;
    setItems(next);
    const n = next.filter((i) => i.status === "uploading" || (i.status === "queued" && !i.offline)).length;
    if (n !== lastCount.current) { lastCount.current = n; onActiveCountChange(n); }
  }, [onActiveCountChange]);

  const patch = useCallback((id: number, p: Partial<Item>) => {
    commit(itemsRef.current.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, [commit]);

  // Keep decoded previews bounded: uploading items + the next few queued get an
  // object URL; everything else shows an icon until its turn.
  const syncPreviews = useCallback(() => {
    let budget = PREVIEW_WINDOW;
    let changed = false;
    const next = itemsRef.current.map((i) => {
      const wants = !i.isVideo && !i.noPreview && (i.status === "uploading" || (i.status === "queued" && budget > 0));
      if (i.status === "uploading" || (i.status === "queued" && !i.isVideo)) budget--;
      if (wants && !i.previewUrl) { changed = true; return { ...i, previewUrl: URL.createObjectURL(i.file) }; }
      if (!wants && i.previewUrl && i.status !== "error") { URL.revokeObjectURL(i.previewUrl); changed = true; return { ...i, previewUrl: null }; }
      return i;
    });
    if (changed) commit(next);
  }, [commit]);

  const removeWhere = useCallback((pred: (i: Item) => boolean) => {
    const keep: Item[] = [];
    for (const i of itemsRef.current) {
      if (pred(i)) { if (i.previewUrl) URL.revokeObjectURL(i.previewUrl); } else keep.push(i);
    }
    commit(keep);
  }, [commit]);

  const liveRef = useRef(live);
  liveRef.current = live;
  const pumpRef = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    if (unmounted.current) return;
    const limit = liveRef.current ? Math.min(2, MEDIA_BIN_UPLOAD_CONCURRENCY) : MEDIA_BIN_UPLOAD_CONCURRENCY;
    while (active.current < limit) {
      const next = itemsRef.current.find((i) => i.status === "queued" && !i.offline);
      if (!next) break;
      active.current++;
      patch(next.id, { status: "uploading", progress: 0, error: undefined });
      syncPreviews();
      let lastPaint = 0;
      void uploadMediaFile(next.file, abort.current.signal, undefined, {
        contentType: next.contentType,
        onProgress: (fr) => {
          const now = performance.now();
          if (now - lastPaint < 100 && fr < 1) return; // ≤10 paints/s per tile
          lastPaint = now;
          patch(next.id, { progress: fr });
        },
      })
        .then(() => {
          uploadedSinceRefresh.current.push(next.id);
          patch(next.id, { status: "done", progress: 1 });
          syncPreviews(); // release the decoded preview straight away
        })
        .catch((err: unknown) => {
          if (unmounted.current) return;
          if ((err as { name?: string })?.name === "AbortError") return;
          const offline = browserOffline();
          const message = err instanceof Error ? err.message : "Upload failed";
          patch(next.id, { status: "error", error: offline ? "No connection — will retry when back online" : message });
          if (offline) {
            // Park the rest of the queue instead of failing it item by item.
            commit(itemsRef.current.map((i) => (i.status === "queued" ? { ...i, offline: true } : i)));
          } else {
            toast.error(`Couldn't upload “${next.file.name}”: ${message}`, { id: `pf-bin-upload-${next.id}` });
          }
        })
        .finally(() => {
          active.current--;
          if (unmounted.current) return;
          const busy = itemsRef.current.some((i) => i.status === "uploading" || (i.status === "queued" && !i.offline));
          if (!busy && uploadedSinceRefresh.current.length > 0) {
            const batch = new Set(uploadedSinceRefresh.current);
            uploadedSinceRefresh.current = [];
            // Swap placeholders for real tiles only once the refreshed list is
            // actually in (never a gap), with a beat so the check mark reads.
            void Promise.all([refresh(), new Promise((r) => window.setTimeout(r, 700))]).then(([ok]) => {
              if (unmounted.current) return;
              // Files ARE uploaded either way — always clear their placeholders so a
              // failed refresh can't leave stale tiles that block re-dropping.
              removeWhere((i) => i.status === "done" && batch.has(i.id));
              if (!ok) toast.error("Uploaded — but the Media Bin couldn't refresh. Reopen it to see the new media.");
              window.dispatchEvent(new CustomEvent("presentflow:libraries-changed"));
            });
          }
          syncPreviews();
          pumpRef.current(); // latest pump (fresh live/refresh), never a stale closure
        });
    }
  }, [patch, commit, syncPreviews, refresh, removeWhere]);
  pumpRef.current = pump;

  // Back online → resume anything parked by a network drop.
  useEffect(() => {
    const onOnline = () => {
      commit(itemsRef.current.map((i) =>
        i.offline ? { ...i, offline: false } : i.status === "error" && i.error?.startsWith("No connection") ? { ...i, status: "queued" as const, error: undefined } : i,
      ));
      pump();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [commit, pump]);

  useEffect(() => {
    unmounted.current = false;
    // Fresh controller per mount (React StrictMode mounts twice in dev).
    const ac = new AbortController();
    abort.current = ac;
    return () => {
      unmounted.current = true;
      if (itemsRef.current.some((i) => i.status === "uploading" || i.status === "queued")) {
        toast.warning("Media Bin uploads were stopped — drop the files again to finish.", { id: "pf-bin-upload-stopped" });
      }
      ac.abort(); // cancel in-flight uploads — nothing continues invisibly
      for (const i of itemsRef.current) if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    importFiles(files, opts) {
      const add: Item[] = [];
      const wizard: File[] = [];
      const skipped: Array<{ name: string; route: DroppedFileRoute["route"] }> = [];
      let alreadyFailed = 0;
      let alreadyInQueue = 0;
      const known = new Map(itemsRef.current.map((i) => [i.fingerprint, i] as const));
      for (const file of files) {
        const r = classifyDroppedFile(file);
        if (r.route === "image" || r.route === "video" || r.route === "audio") {
          const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
          const dup = known.get(fingerprint);
          if (dup) { if (dup.status === "error") alreadyFailed++; else alreadyInQueue++; continue; }
          const item: Item = {
            id: nextId.current++, fingerprint, file, contentType: r.contentType,
            isVideo: r.route === "video", isAudio: r.route === "audio",
            noPreview: r.route === "audio" || (r.route === "image" && !!r.heic), previewUrl: null, progress: 0, status: "queued",
          };
          known.set(fingerprint, item);
          add.push(item);
        } else if (r.route === "deck" || r.route === "pro") {
          wizard.push(file);
        } else {
          skipped.push({ name: file.name, route: r.route });
        }
      }
      const summary = skippedSummary(skipped);
      if (summary) toast.error(summary, { duration: 7000 });
      if (opts?.truncated) toast.warning("Only the first 200 files were added — drop the rest in a second batch.");
      if (alreadyFailed > 0) toast.info(`${alreadyFailed === 1 ? "That file is" : `${alreadyFailed} files are`} already in the bin — use Retry on the tile.`);
      if (add.length > 0) {
        commit([...itemsRef.current, ...add]); // FIFO: earlier drops upload first
        syncPreviews();
        pump();
      }
      if (wizard.length > 0) {
        toast.info(`Opening the import wizard for ${wizard.length} presentation${wizard.length === 1 ? "" : "s"}…`, { id: "pf-bin-wizard" });
        onOpenWizard([...wizard]);
      }
      if (alreadyInQueue > 0) toast.info(`${alreadyInQueue === 1 ? "That file is" : `${alreadyInQueue} files are`} already uploading or just uploaded.`);
      if (add.length === 0 && wizard.length === 0 && !summary && alreadyFailed === 0 && alreadyInQueue === 0) {
        toast.error("Nothing to import from that drop");
      }
    },
  }), [commit, syncPreviews, pump, onOpenWizard]);

  const unpark = (xs: Item[]) => xs.map((i) => (i.offline ? { ...i, offline: false } : i));
  const retry = (id: number) => {
    commit(unpark(itemsRef.current).map((i) => (i.id === id ? { ...i, status: "queued" as const, progress: 0, error: undefined } : i)));
    syncPreviews();
    pump();
  };
  const retryAllFailed = () => {
    commit(unpark(itemsRef.current).map((i) => (i.status === "error" ? { ...i, status: "queued" as const, progress: 0, error: undefined } : i)));
    syncPreviews();
    pump();
  };
  const dismiss = (id: number) => removeWhere((i) => i.id === id);

  if (items.length === 0) return null;
  const failed = items.filter((i) => i.status === "error").length;
  return (
    <div className="px-2 pt-2 max-h-[45vh] overflow-y-auto overscroll-contain">
      <span className="sr-only" aria-live="polite">
        {failed > 0 ? `${failed} upload${failed === 1 ? "" : "s"} failed` : ""}
      </span>
      {failed > 1 && (
        <button type="button" onClick={retryAllFailed} className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-brand)] hover:underline">
          <RotateCw className="w-3 h-3" /> Retry all {failed} failed
        </button>
      )}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbMin}px, 1fr))` }}>
        {items.map((i, idx) => (
          <PendingTile key={i.id} item={i} index={idx} onRetry={retry} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
});

const PendingTile = memo(function PendingTile({ item, index, onRetry, onDismiss }: {
  item: Item; index: number; onRetry: (id: number) => void; onDismiss: (id: number) => void;
}) {
  const R = 7, C = 2 * Math.PI * R;
  const failed = item.status === "error";
  const working = item.status === "uploading";
  return (
    <div
      className={cn(
        "pf-bin-tile-in relative aspect-video rounded-md overflow-hidden bg-black border",
        failed ? "pf-bin-tile-shake pf-bin-tile-failed" : "border-[var(--color-border)]",
      )}
      style={{ ["--i" as string]: Math.min(index, 6) }}
      title={failed ? `${item.file.name} — ${item.error}` : item.file.name}
    >
      {item.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.previewUrl} alt="" decoding="async" className="pf-bin-tile-media w-full h-full object-cover pointer-events-none" data-ready={item.status === "done" ? "" : undefined} />
      ) : (
        <div className="w-full h-full grid place-items-center text-white/40">
          {item.isVideo ? <Film className="w-5 h-5" /> : item.isAudio ? <Music className="w-5 h-5" /> : null}
        </div>
      )}
      {working && <div className="pf-bin-shimmer" aria-hidden />}
      <div className="absolute inset-0 grid place-items-center">
        {item.status === "done" ? (
          <CheckCircle2 className="pf-bin-check w-5 h-5 text-[var(--color-brand)] drop-shadow" />
        ) : failed ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onRetry(item.id)} aria-label={`Retry uploading ${item.file.name}`} title="Retry" className="grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white hover:bg-black/90"><RotateCw className="w-3 h-3" /></button>
            <button type="button" onClick={() => onDismiss(item.id)} aria-label={`Dismiss ${item.file.name}`} title="Dismiss" className="grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white hover:bg-black/90"><X className="w-3 h-3" /></button>
          </div>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" className="drop-shadow" aria-hidden>
            <circle cx="10" cy="10" r={R} fill="rgba(0,0,0,.55)" stroke="rgba(255,255,255,.25)" strokeWidth="2" />
            <circle cx="10" cy="10" r={R} fill="none" stroke="var(--color-brand)" strokeWidth="2" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.04, item.progress))} transform="rotate(-90 10 10)" className="pf-bin-ring" />
          </svg>
        )}
      </div>
      <span className="absolute left-0 right-0 bottom-0 px-1 py-0.5 truncate text-[9px] text-white/85 bg-gradient-to-t from-black/70 to-transparent">
        {failed ? (item.offline || item.error?.startsWith("No connection") ? "Waiting for connection" : "Failed — retry?") : item.status === "queued" ? `Waiting · ${item.file.name}` : item.file.name}
      </span>
    </div>
  );
});
