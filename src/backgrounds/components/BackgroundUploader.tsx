"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Film, Loader2 } from "lucide-react";
import { addCustomBackground, setActiveBackgroundId } from "../store/backgroundStore";
import type { PFBackground } from "../models/BackgroundTypes";

/**
 * Upload an image or video as a custom background. Reuses the app's media upload
 * flow (presign → PUT to S3 → https URL) so the uploaded file loads on the
 * projector window too (a local file path wouldn't). The uploaded file becomes a
 * custom PFBackground and is set active immediately.
 */
export function BackgroundUploader() {
  const imgRef = useRef<HTMLInputElement | null>(null);
  const vidRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<null | "image" | "video">(null);

  async function upload(kind: "image" | "video", file: File) {
    const maxMB = kind === "image" ? 10 : 100;
    if (file.size > maxMB * 1024 * 1024) {
      toast.warning(`That ${kind} is over ${maxMB} MB — it may load slowly on the projector.`);
    }
    setBusy(kind);
    try {
      const presign = await fetch("/api/media/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: "media" }),
      }).then((r) => r.json()) as { url?: string; key?: string; error?: string };
      if (presign.error || !presign.url || !presign.key) throw new Error(presign.error || "Presign failed");
      const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      const got = await fetch("/api/media/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: presign.key }),
      }).then((r) => r.json()) as { url?: string; error?: string };
      if (got.error || !got.url) throw new Error(got.error || "Could not get URL");

      const id = `custom-${(crypto?.randomUUID?.() ?? String(file.size))}`;
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || (kind === "image" ? "Image" : "Video");
      const bg: PFBackground = kind === "image"
        ? { id, name, type: "image", isBuiltIn: false, category: "custom", imageUrl: got.url, imageFit: "fill", imageBlur: 0, mediaKey: presign.key }
        : { id, name, type: "video", isBuiltIn: false, category: "custom", videoUrl: got.url, videoPlaybackSpeed: 0.5, mediaKey: presign.key };
      addCustomBackground(bg);
      setActiveBackgroundId(id);
      toast.success(`${kind === "image" ? "Image" : "Video"} background added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={imgRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("image", f); e.currentTarget.value = ""; }} />
      <input ref={vidRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("video", f); e.currentTarget.value = ""; }} />
      <button
        onClick={() => imgRef.current?.click()}
        disabled={!!busy}
        className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-elevated)] disabled:opacity-50"
      >
        {busy === "image" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} Upload image
      </button>
      <button
        onClick={() => vidRef.current?.click()}
        disabled={!!busy}
        className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-elevated)] disabled:opacity-50"
      >
        {busy === "video" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />} Upload video
      </button>
    </div>
  );
}
