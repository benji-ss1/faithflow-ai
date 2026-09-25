/**
 * Watched media folders — the sync runner (renderer side).
 *
 * WHY THE RENDERER: the Electron main process cannot register media. It has
 * no HTTP client to the app API and no session cookie — every upload rides the
 * renderer's cookie (see docs/WATCHED_MEDIA_FOLDERS.md, Decision 4). So the
 * main process only lists the folder and reads bytes; the renderer does the
 * uploading through the SAME `uploadMediaFile` path the media bin already uses.
 * One upload path, not two divergent copies.
 *
 * This is a RECONCILE, not a watcher: list, diff, act. It is self-healing —
 * a missed event, a sleeping laptop, a USB drive reconnecting all resolve on
 * the next pass, where an event stream would silently drift out of sync.
 */

import { reconcile, normalizeRelPath, WATCHED_EXTENSIONS, type DiskFile, type LibraryAsset } from "./watched-folders";
import { unfileMissingWatchedAssets, refileReturnedWatchedAssets } from "./actions";
import { uploadMediaFile } from "@/components/operator/pro/center/MediaImportWizard";

export type SyncProgress = { done: number; total: number; currentFile?: string };
export type SyncResult = {
  /** True when the folder was read fine but held no images or videos at all. */
  folderHadNoMedia?: boolean;
  added: number;
  unfiled: number;
  unchanged: number;
  /** Per-file failures — reported, never thrown away silently. */
  failed: { relPath: string; reason: string }[];
  /** Set when the folder itself could not be read on this machine. */
  folderError?: string;
  /** Un-filing was held back because the folder listing looked incomplete. */
  unfileSkipped?: number;
  /** Files that had gone missing and were recognised on their return. */
  refiled?: number;
};

/** Largest file we will pull through IPC in one piece (matches fs:readFile). */
const MAX_INLINE_BYTES = 50 * 1024 * 1024;

/**
 * NOTE the return type. `fs:readDirRecursive` resolves to an ARRAY on success
 * but to `{ ok:false, error, entries: [] }` when the path is not authorised —
 * which is the state after EVERY app restart, because the allowlist is
 * session-scoped. The ambient type in src/types/electron.d.ts declares only
 * the array, so TypeScript cannot catch this; iterating the object threw an
 * uncaught TypeError and the operator saw a spinner stop with no message.
 */
type ReadDirResult = DiskFile[] | { ok: false; error?: string; entries: DiskFile[] };
type ElectronFsApi = {
  readDirRecursive: (dirPath: string, extensions: string[]) => Promise<ReadDirResult>;
  readFile: (filePath: string) => Promise<{ tooLarge?: boolean; size?: number; base64?: string; name?: string; ext?: string }>;
};

function fsApi(): ElectronFsApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: { fs?: ElectronFsApi } }).electronAPI;
  return api?.fs ?? null;
}

/** True when folder watching is even possible — desktop app only. */
export function canWatchFolders(): boolean {
  return fsApi() !== null;
}

function guessMime(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", avif: "image/avif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  };
  return map[ext] ?? "application/octet-stream";
}

/** base64 (from IPC) → File, without blowing memory on a big video. */
function base64ToFile(b64: string, name: string, mime: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

/**
 * Reconcile one watched library against its folder.
 *
 * Never throws: a folder that cannot be read (unplugged drive, path from
 * another machine, permission revoked after restart) returns `folderError` so
 * the UI can say something true, rather than failing the whole media bin.
 */
export async function syncWatchedLibrary(
  libraryId: string,
  watchPath: string,
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncResult> {
  const empty: SyncResult = { added: 0, unfiled: 0, unchanged: 0, failed: [] };
  const result0: { refiled?: number } = {};
  const fs = fsApi();
  if (!fs) return { ...empty, folderError: "Watched folders need the desktop app" };

  // 1. What is on disk?
  let disk: DiskFile[];
  try {
    const raw = await fs.readDirRecursive(watchPath, [...WATCHED_EXTENSIONS]);
    if (!Array.isArray(raw)) {
      // The authorised-path failure. Resolves successfully, so no throw.
      console.error("[watched] folder not readable", { watchPath, error: raw?.error });
      return { ...empty, folderError: "Can't read that folder — it may be disconnected, or need re-connecting after a restart. Use \u201cChoose folder\u2026\u201d on the folder in your Library list." };
    }
    disk = raw;
  } catch (e) {
    // The Electron path allowlist is session-scoped, so after a restart this
    // is the expected failure until the folder is re-picked. Say so plainly.
    // Deliberately no raw Error.message: the operator sees a toast, not a log.
    // The real cause is almost always one of three things and the remedy is the
    // same for all of them, so say the remedy.
    console.error("[watched] readDirRecursive failed", { watchPath, e });
    return { ...empty, folderError: "Can't read that folder — it may be disconnected, on another computer, or need re-connecting after a restart. Re-pick it from the Library list." };
  }

  // 2. What is already in the library?
  let library: LibraryAsset[] = [];
  try {
    const res = await fetch(`/api/media/list?library=${encodeURIComponent(libraryId)}&audio=1`);
    if (!res.ok) return { ...empty, folderError: `Couldn't load what is already in this folder (server error ${res.status}) — try again in a moment.` };
    const json = (await res.json()) as { assets: { id: string; fileName: string; sizeBytes: number; sourceRelPath: string | null }[] };
    library = json.assets.map((a) => ({ id: a.id, fileName: a.fileName, sizeBytes: a.sizeBytes, sourceRelPath: a.sourceRelPath }));
  } catch (e) {
    console.error("[watched] library read failed", e);
    return { ...empty, folderError: "Couldn't load what is already in this folder — check your connection and try again." };
  }

  // Before planning uploads: a file that went away and came back is still
  // known to us (un-filing keeps sourceRelPath), so return it to the folder
  // rather than uploading a duplicate. This is what makes a replugged drive
  // heal instead of doubling the library.
  const diskKeys = disk.filter((f) => f?.relPath).map((f) => normalizeRelPath(f.relPath));
  if (diskKeys.length > 0 && diskKeys.length <= 2000) {
    const back = await refileReturnedWatchedAssets(libraryId, diskKeys);
    if (back.ok && (back.data?.refiled ?? 0) > 0) {
      result0.refiled = back.data!.refiled;
      // Re-read the library so those rows count as `unchanged`, not as uploads.
      try {
        const res2 = await fetch(`/api/media/list?library=${encodeURIComponent(libraryId)}&audio=1`);
        if (res2.ok) {
          const j2 = (await res2.json()) as { assets: { id: string; fileName: string; sizeBytes: number; sourceRelPath: string | null }[] };
          library = j2.assets.map((a) => ({ id: a.id, fileName: a.fileName, sizeBytes: a.sizeBytes, sourceRelPath: a.sourceRelPath }));
        }
      } catch { /* a stale list only means a file re-uploads; not fatal */ }
    }
  }

  const plan = reconcile(disk, library);

  // SAFETY: the walker swallows per-directory read errors and stops at its
  // depth/entry caps, so a permission-denied subfolder or a half-mounted drive
  // can return a SHORT list — which reconcile would read as "everything
  // vanished" and un-file the whole folder mid-service. Un-filing is therefore
  // refused when the listing looks implausible: nothing on disk at all, or
  // more than half the folder disappearing at once. The uploads still proceed;
  // only the destructive half is held back, and we say why.
  const librarySize = library.filter((a) => a.sourceRelPath).length;
  const vanishing = plan.toUnfile.length;
  const suspiciousListing =
    vanishing > 0 && librarySize > 0 && (disk.length === 0 || vanishing / librarySize > 0.5);
  // A folder full of .mp3/.key/.pdf reads as "0 files" otherwise, which looks
  // like success to an operator who can see files sitting in it.
  const folderHadNoMedia = plan.toUpload.length === 0 && plan.unchanged === 0 && plan.toUnfile.length === 0 && disk.length >= 0;
  const result: SyncResult = { added: 0, unfiled: 0, unchanged: plan.unchanged, failed: [], folderHadNoMedia, refiled: result0.refiled };

  // 3. Upload what is new. Sequential on purpose: this can run while a service
  //    is live, and saturating the uplink would starve the projector's own
  //    media fetches. One file at a time is slower and safer.
  let done = 0;
  for (const file of plan.toUpload) {
    onProgress?.({ done, total: plan.toUpload.length, currentFile: file.relPath });
    try {
      if (file.size > MAX_INLINE_BYTES) {
        result.failed.push({ relPath: file.relPath, reason: `Too large to sync (${Math.round(file.size / 1024 / 1024)} MB)` });
        continue;
      }
      const read = await fs.readFile(file.absPath);
      if (read?.tooLarge || !read?.base64) {
        result.failed.push({ relPath: file.relPath, reason: "Could not read the file" });
        continue;
      }
      const name = file.relPath.split("/").pop() || file.relPath;
      const mime = guessMime(name);
      await uploadMediaFile(base64ToFile(read.base64, name, mime), undefined, libraryId, {
        contentType: mime,
        sourceRelPath: file.relPath,
      });
      result.added++;
    } catch (e) {
      // One bad file must never abort the whole sync.
      result.failed.push({ relPath: file.relPath, reason: (e as Error).message });
    }
    done++;
  }
  onProgress?.({ done, total: plan.toUpload.length });

  // 4. Un-file what has left the folder. NEVER a delete — see Decision 3.
  if (plan.toUnfile.length > 0 && suspiciousListing) {
    result.unfileSkipped = vanishing;
  } else if (plan.toUnfile.length > 0) {
    const res = await unfileMissingWatchedAssets(libraryId, plan.toUnfile.map((a) => a.id));
    // 5b: a failure here must be SEEN. Reporting "up to date" after a failed
    // un-file is exactly the silent wrongness this module claims to avoid.
    if (res.ok) result.unfiled = res.data?.unfiled ?? 0;
    else result.failed.push({ relPath: `${vanishing} removed file(s)`, reason: res.error ?? "Couldn't update the folder" });
  }

  return result;
}
