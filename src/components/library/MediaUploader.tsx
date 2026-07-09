"use client";
import { useState } from "react";
import { toast } from "sonner";
import { registerMediaAsset, createPptxImport } from "@/lib/actions";

export function MediaUploader({ purpose }: { purpose: "media" | "pptx" }) {
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
        // Await synchronously so the operator sees success/failure, not a
        // silent "pending" row that only clears when they revisit later.
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
      e.target.value = "";
    }
  }

  return (
    <label className="inline-flex items-center gap-2 h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 cursor-pointer">
      <input type="file" onChange={onFile} disabled={busy}
        accept={purpose === "pptx" ? ".pptx" : "image/*,video/*"} className="hidden" />
      {busy ? "Uploading..." : purpose === "pptx" ? "Upload .pptx" : "Upload media"}
    </label>
  );
}
