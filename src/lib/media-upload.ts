"use client";
/**
 * Shared client-side media upload — the presign → PUT → signed-URL flow used by
 * the operator surfaces to put an image/video into church media storage and get
 * back a durable URL. Extracted so the Layers logo picker (wave 6F rec5) reuses
 * the SAME upload path as the Themes BgAssetPicker rather than duplicating it.
 *
 * Server-scoped: `/api/media/presign` and `/api/media/url` are auth-gated and
 * church-scoped (see the route handlers) — this helper carries no church_id of
 * its own, so it can never cross tenants.
 */

export type UploadPurpose = "media" | "logo" | "background";

/** Upload a File and resolve to a durable signed download URL. Throws on any
 *  failure with a human-readable message the caller can toast. */
export async function uploadMediaFile(file: File, purpose: UploadPurpose = "media"): Promise<string> {
  const presign = await fetch("/api/media/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose }),
  }).then((r) => r.json()) as { url?: string; key?: string; error?: string };
  if (presign.error) throw new Error(presign.error);
  if (!presign.url || !presign.key) throw new Error("Presign response missing url or key");

  const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!put.ok) throw new Error("Upload failed");

  const got = await fetch("/api/media/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: presign.key }),
  }).then((r) => r.json()) as { url?: string; error?: string };
  if (got.error) throw new Error(got.error);
  if (!got.url) throw new Error("Could not get download URL");
  return got.url;
}

/** Convenience wrapper for image uploads (logo, thumbnails). */
export function uploadImageFile(file: File, purpose: UploadPurpose = "logo"): Promise<string> {
  return uploadMediaFile(file, purpose);
}
