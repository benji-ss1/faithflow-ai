"use client";
// Theme background / logo asset picker — extracted VERBATIM from
// ThemesManager.tsx (Theme Editor PR 1) so the old theme screen and the new
// PP7-style theme editor share one upload/library/URL flow. Behaviour is
// unchanged; only the file it lives in moved.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Image as ImageIcon, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFileToMediaStorage } from "@/lib/media-upload";

const fieldCls =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none transition-colors focus:border-[color-mix(in_oklab,var(--color-brand)_60%,var(--color-border))] focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.28),0_0_0_3px_color-mix(in_oklab,var(--color-brand)_22%,transparent)]";
const inputCls = `h-9 w-full px-2.5 text-sm text-foreground ${fieldCls}`;
const btnOutline =
  "border border-[var(--color-border)] bg-[var(--color-card)] text-foreground shadow-[var(--edge-top),var(--shadow-sm)] transition-[transform,border-color] duration-150 hover:border-[color-mix(in_oklab,var(--color-brand)_50%,var(--color-border))] motion-safe:hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0";

// -- media library picker (modal) --
//
// Opens the church's existing Media library (GET /api/media/list, already
// auth-gated + church-scoped) filtered to the asset kind, so an operator can
// re-use a video/image they've already uploaded instead of re-uploading. The
// list route mints fresh presigned GET URLs, so clicking a tile hands back a
// ready-to-use URL — exactly what the theme bg/logo fields store.
type LibraryAsset = { id: string; fileName: string; kind: string; url: string };

function ThemeLibraryPicker({
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
        // The library stores images and videos together; show only the kind
        // this picker wants. `kind` on the media row is "image"/"video".
        setAssets((res.assets ?? []).filter((a) => a.kind === kind));
      } catch {
        if (alive) setError("Couldn't load your media library");
      }
    })();
    return () => { alive = false; };
  }, [kind]);

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-[var(--edge-top),var(--shadow-xl)]"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
          <div className="text-sm font-semibold text-foreground">Choose {kind === "image" ? "an image" : "a video"} from your library</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-[var(--color-elevated)] hover:text-foreground">
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
              No {kind}s in your library yet. Upload one below and it'll appear here next time.
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {assets.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => { onPick(a.url); onClose(); }}
                    className="group block w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-black/40 text-left transition hover:border-[var(--color-brand)]"
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

// -- background asset picker (image + video) --
//
// Two-input row: paste a presigned URL from your Media library, OR upload
// a fresh file which the component sends to /api/media/presign, PUTs to S3
// with the returned presign URL, then stores the resulting S3 key path as
// the theme's bgImageUrl/bgVideoUrl.
//
// Uses the same `media` purpose as the rest of the app — the S3 key ends
// up under `{churchId}/media/...` which the existing media library reader
// (getExpandedServicePlan etc.) also reads. So a theme background upload
// becomes a real Media entry, browsable + reusable elsewhere.
export function BgAssetPicker({
  kind, url, onUrl, label, hint, maxMBOverride,
}: {
  kind: "image" | "video";
  url: string;
  onUrl: (nextUrl: string) => void;
  label?: string;
  hint?: string;
  maxMBOverride?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Ref to the hidden <input type="file"> so the web-fallback picker can open it.
  // (The old getElementById(`bg-picker-${kind}-${Math.random()}`) never matched
  // an element, so clicking "upload" silently did nothing in the browser.)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  const accept = kind === "image"
    ? "image/png,image/jpeg,image/webp,image/gif,image/avif"
    : "video/mp4,video/webm,video/quicktime";
  const maxMB = maxMBOverride ?? (kind === "image" ? 10 : 100);

  async function pickFile(file: File) {
    setUploading(true);
    try {
      // Shared presign → PUT → signed-URL path (wave-6 fix pass): one upload flow
      // reused across the Layers logo picker and this Themes bg picker.
      const downloadUrl = await uploadFileToMediaStorage(file, "media");
      onUrl(downloadUrl);
      toast.success(`${kind === "image" ? "Image" : "Video"} uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Use native Electron file dialog when available (desktop app); fall back
  // to the hidden <input type="file"> otherwise.
  async function openNativePicker() {
    const api = typeof window !== "undefined" && (window as any).electronAPI;
    if (api?.dialog?.openFile) {
      const extFilters = kind === "image"
        ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }]
        : [{ name: "Videos", extensions: ["mp4", "webm", "mov"] }];
      const result = await api.dialog.openFile({ filters: extFilters, properties: ["openFile"] });
      if (result?.canceled || !result?.filePaths?.length) return;
      // In Electron the path is a local filesystem path — fetch as a blob.
      try {
        const blob = await fetch(`file://${result.filePaths[0]}`).then((r) => r.blob());
        const fileName = result.filePaths[0].split(/[/\\]/).pop() ?? "upload";
        await pickFile(new File([blob], fileName, { type: blob.type || "application/octet-stream" }));
      } catch {
        toast.error("Could not read file");
      }
      return;
    }
    // Web fallback: open the hidden <input type="file"> via its ref.
    fileInputRef.current?.click();
  }

  return (
    <div className="space-y-2.5">
      {/* Header — the label + hint that used to live on the URL Row. Surfaced
          up top so the upload zone reads as the primary action. */}
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {label ?? `${kind === "image" ? "Image" : "Video"}`}
        </div>
        <div className="mt-0.5 text-[10.5px] text-muted-foreground/70">
          {hint ?? `Drag a file here, pick from your library, or paste a URL (max ${maxMB} MB).`}
        </div>
      </div>

      {/* Current asset preview + Replace/Remove affordance */}
      {url && !uploading ? (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-[var(--edge-top),var(--shadow-sm)]">
          <div className="h-11 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-black/50">
            {kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="h-full w-full object-cover" />
            ) : (
              <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground">Current {kind}</div>
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void openNativePicker()}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold", btnOutline)}
              >
                <RefreshCw className="h-3 w-3" /> Replace
              </button>
              <button
                type="button"
                onClick={() => onUrl("")}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 text-[11px] font-semibold text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/10"
              >
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Drag-and-drop zone — the hero. Works in both Electron (Finder drag)
          and web (file drag). Reads as an inviting, obvious upload target. */}
      <div
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition-colors [transition-timing-function:var(--ease-house)]",
          url ? "min-h-[84px] py-4" : "min-h-[128px] py-6",
          dragOver
            ? "border-[var(--color-brand)] bg-[color-mix(in_oklab,var(--color-brand)_12%,transparent)] text-[var(--color-brand)] shadow-[var(--edge-top),var(--shadow-ember)]"
            : "border-[var(--color-border)] bg-[var(--color-muted)] text-muted-foreground hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:bg-[color-mix(in_oklab,var(--color-brand)_6%,var(--color-muted))] hover:text-foreground",
          uploading && "pointer-events-none cursor-wait opacity-70",
        )}
        onClick={() => void openNativePicker()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          // Prefer an already-uploaded library asset dragged from the media
          // browser (carries a ready URL) over re-uploading a raw file.
          const lib = e.dataTransfer.getData("application/x-pf-library-item");
          if (lib) {
            try {
              const item = JSON.parse(lib) as { url?: string; kind?: string };
              if (item.url && (kind === "video" ? String(item.kind).startsWith("video") : !String(item.kind).startsWith("video"))) {
                onUrl(item.url);
                toast.success(`${kind === "image" ? "Image" : "Video"} set from library`);
                return;
              }
            } catch { /* fall through to file handling */ }
          }
          const f = e.dataTransfer.files?.[0];
          if (f) void pickFile(f);
        }}
      >
        <div
          className={cn(
            "grid h-10 w-10 place-items-center rounded-full transition-colors",
            dragOver
              ? "bg-[var(--color-brand)] text-black shadow-[var(--edge-top),var(--shadow-ember)]"
              : "bg-[color-mix(in_oklab,var(--color-brand)_14%,var(--color-elevated))] text-[var(--color-brand)] shadow-[var(--edge-top)]",
          )}
        >
          <Upload className="h-5 w-5" />
        </div>
        {uploading ? (
          <span className="text-sm font-semibold">Uploading…</span>
        ) : (
          <>
            <span className="text-sm font-semibold text-foreground">
              {dragOver ? `Drop ${kind} to upload` : `Drag ${kind === "image" ? "an image" : "a video"} here or click to upload`}
            </span>
            <span className="text-[10px] opacity-70">{kind === "image" ? "PNG, JPG, WEBP, GIF" : "MP4, WEBM, MOV"} · max {maxMB} MB</span>
          </>
        )}
        {/* Hidden fallback for non-Electron / older browsers */}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Secondary sources: media library + paste a URL */}
      <button
        type="button"
        onClick={() => setLibOpen(true)}
        className={cn("inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium", btnOutline)}
      >
        <ImageIcon className="h-3.5 w-3.5" /> Choose from media library
      </button>
      {libOpen && (
        <ThemeLibraryPicker kind={kind} onPick={onUrl} onClose={() => setLibOpen(false)} />
      )}
      <input
        type="url"
        value={url}
        onChange={(e) => onUrl(e.target.value)}
        placeholder="Or paste an image URL (https://…)"
        className={inputCls}
      />
    </div>
  );
}
