"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, ImageIcon } from "lucide-react";
import { updateSettings } from "@/lib/actions";

// Keep in sync with /api/media/presign's ALLOWED_IMAGE + MAX_BYTES.logo.
// SVG intentionally excluded (XSS via inline <script>) — see presign route.
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/avif"];
const MAX_BYTES = 2 * 1024 * 1024;

export function ChurchBrandingUploader({ initialLogoUrl }: { initialLogoUrl: string | null }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Track any object URL we mint so we can revoke it on replace/unmount and
  // avoid leaking the last upload's blob until page nav.
  const blobUrlRef = useRef<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  async function handleFile(file: File) {
    // Re-entry guard: while a save is in flight, ignore additional drops.
    if (pending) return;
    if (!ALLOWED.includes(file.type)) {
      toast.error("Use a PNG, JPG, WebP, or AVIF image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Logo must be under 2 MB");
      return;
    }
    startTransition(async () => {
      try {
        const presign = await fetch("/api/media/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // New `logo` purpose caps at 2MB server-side + only accepts image
          // MIME. Matches the client-side gate above, prevents an accidental
          // 500MB video upload burning storage under the `logo` label.
          body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: "logo" }),
        }).then((r) => r.json());
        if (presign.error) throw new Error(presign.error);

        const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) throw new Error("Upload failed");

        const res = await updateSettings({ logoS3Key: presign.key });
        if (!res.ok) throw new Error(res.error || "Save failed");

        // Optimistic preview from the local file. Revoke the previous blob
        // first so we don't leak. router.refresh() then re-fetches server
        // components — the sidebar workspace pill picks up the real
        // presigned URL from the (app) layout on next render.
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const nextUrl = URL.createObjectURL(file);
        blobUrlRef.current = nextUrl;
        setLogoUrl(nextUrl);
        toast.success("Church logo saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      }
    });
  }

  function removeLogo() {
    if (pending) return;
    if (!confirm("Remove your church logo? You can upload another later.")) return;
    startTransition(async () => {
      const res = await updateSettings({ logoS3Key: null });
      if (!res.ok) {
        toast.error(res.error || "Could not remove");
        return;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setLogoUrl(null);
      toast.success("Logo removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!pending) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (pending) return;
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        onClick={() => { if (!pending) inputRef.current?.click(); }}
        aria-busy={pending}
        className={`relative grid min-h-[176px] place-items-center rounded-xl border border-dashed transition ${
          dragOver ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-border bg-white/[0.02] hover:border-border/80"
        } ${pending ? "pointer-events-none cursor-wait opacity-60" : "cursor-pointer"}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        {logoUrl ? (
          <div className="flex flex-col items-center gap-3 p-4">
            {/* Use plain <img> here so a presigned S3 URL isn't blocked by next/image domain rules. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt="Church logo"
              referrerPolicy="no-referrer"
              className="max-h-24 max-w-full rounded-lg object-contain"
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Click to replace</span>
              <span>·</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeLogo(); }}
                disabled={pending}
                className="inline-flex items-center gap-1 text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <ImageIcon className="h-5 w-5" />
            </div>
            <div className="text-sm font-medium text-foreground">
              {pending ? "Uploading…" : dragOver ? "Drop to upload" : "Drop a logo here or click to upload"}
            </div>
            <div className="text-[11px] text-muted-foreground">PNG, JPG, WebP, or AVIF · up to 2 MB</div>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Appears in your sidebar, on the desktop app splash, and as the &ldquo;Logo&rdquo; slide type in service plans.
      </p>
    </div>
  );
}
