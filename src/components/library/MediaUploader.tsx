"use client";
import { useState } from "react";
import { toast } from "sonner";
import { registerMediaAsset, createPptxImport } from "@/lib/actions";
import { ElectronPickFilesButton } from "@/components/electron/ElectronFilePickers";

function base64ToFile(name: string, mime: string, b64: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

function guessMime(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(e)) return `image/${e === "jpg" ? "jpeg" : e}`;
  if (["mp4", "webm", "mkv"].includes(e)) return `video/${e}`;
  if (e === "mov") return "video/quicktime";
  if (e === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

export function MediaUploader({ purpose }: { purpose: "media" | "pptx" }) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function uploadFile(file: File) {
    setBusy(true);
    try {
      const presign = await fetch("/api/media/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose }),
      }).then((r) => r.json());
      if (presign.error) throw new Error(presign.error);
      const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed");

      if (purpose === "media") {
        const kind = file.type.startsWith("video/") ? "video" : "image";
        const res = await registerMediaAsset({ kind, fileName: file.name, s3Key: presign.key, mimeType: file.type, sizeBytes: file.size });
        if (!res.ok) throw new Error(res.error);
        toast.success("Uploaded");
      } else {
        const res = await createPptxImport(file.name, presign.key);
        if (!res.ok) throw new Error(res.error);
        toast.info("Uploaded — converting…");
        const convRes = await fetch("/api/pptx/convert", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ importId: res.data!.id }),
        }).then((r) => r.json()).catch(() => ({ ok: false, error: "Conversion request failed" }));
        if (!convRes.ok) throw new Error(convRes.error || "Conversion failed");
        toast.success("Converted");
      }
      location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  const extensions = purpose === "pptx"
    ? [".pptx"]
    : [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".mp4", ".webm", ".mov", ".mkv"];

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`inline-flex items-center gap-2 ${dragOver ? "ring-2 ring-primary rounded-md" : ""}`}
    >
      <label className="inline-flex items-center gap-2 h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 cursor-pointer">
        <input type="file" onChange={onFile} disabled={busy}
          accept={purpose === "pptx" ? ".pptx" : "image/*,video/*"} className="hidden" />
        {busy ? "Uploading..." : purpose === "pptx" ? "Upload .pptx" : "Upload media"}
      </label>
      <ElectronPickFilesButton
        extensions={extensions}
        label="Choose from computer…"
        className="inline-flex items-center gap-2 h-9 px-3 border border-border rounded-md text-sm font-semibold hover:bg-accent"
        onFiles={async (files) => {
          for (const f of files) {
            if (f.tooLarge || !f.base64) {
              toast.error(`${f.name}: file too large for in-process read`);
              continue;
            }
            const mime = guessMime(f.ext);
            await uploadFile(base64ToFile(f.name, mime, f.base64));
          }
        }}
      />
    </div>
  );
}
